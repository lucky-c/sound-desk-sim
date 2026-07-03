<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { useMixerStore } from '../stores/mixer'
import { useStageStore } from '../stores/stage'
import { useMeters } from '../composables/useMeters'
import { clamp, linToDb } from '../lib/units'
import {
  FOH_POS,
  ROOM_PRESETS,
  ROOM_SIZE_RANGE,
  STAGE_BOUNDS,
  type RoomPreset,
} from '../audio/spatial'
import ParamSlider from './ParamSlider.vue'

/**
 * The virtual stage: performers you can drag around a venue, heard from the
 * fixed FOH mix position. Purely visual + store writes — position changes go
 * through the stage store into the engine's spatial section (ramped).
 */

const mixer = useMixerStore()
const stage = useStageStore()
const meters = useMeters()

const container = ref<HTMLDivElement | null>(null)
const dragReadout = ref<string | null>(null)

const presetEntries = Object.entries(ROOM_PRESETS) as [
  RoomPreset,
  (typeof ROOM_PRESETS)[RoomPreset],
][]

const roomHint = computed(() => {
  switch (stage.roomPreset) {
    case 'club':
      return 'Small, damped room — short reverb, highs die fast. Mud stacks up quickly.'
    case 'hall':
      return 'Big reflective hall — long tail. Distance and low-end discipline matter.'
    case 'openair':
      return 'Open-air stage — almost no room sound. What you mix is what they hear.'
  }
})

onMounted(() => {
  if (!container.value) return
  const host: HTMLDivElement = container.value

  const disposables: { dispose(): void }[] = []
  function track<T extends { dispose(): void }>(o: T): T {
    disposables.push(o)
    return o
  }
  function mat(opts: THREE.MeshStandardMaterialParameters) {
    return track(new THREE.MeshStandardMaterial(opts))
  }
  function box(w: number, h: number, d: number, m: THREE.Material) {
    return new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)), m)
  }

  const renderer = track(new THREE.WebGLRenderer({ antialias: true, alpha: true }))
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0x09090b, 24, 55)
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 120)
  camera.position.set(0, 10, 17)

  scene.add(new THREE.AmbientLight(0xffffff, 0.5))
  const key = new THREE.DirectionalLight(0xffffff, 1.4)
  key.position.set(6, 12, 6)
  scene.add(key)
  const stageWash = new THREE.PointLight(0x8899ff, 30, 30)
  stageWash.position.set(0, 6, -2)
  scene.add(stageWash)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.target.set(0, 0.5, 0)
  controls.minDistance = 6
  controls.maxDistance = 40
  controls.maxPolarAngle = Math.PI * 0.49

  // ---- venue ----
  const stageFloor = box(11, 0.4, 6.4, mat({ color: 0x27272e, roughness: 0.85 }))
  stageFloor.position.set(0, -0.2, -1)
  scene.add(stageFloor)

  const grid = track(new THREE.GridHelper(10, 10, 0x3f3f46, 0x2c2c33))
  grid.position.set(0, 0.01, -1)
  scene.add(grid)

  const audienceFloor = box(30, 0.1, 18, mat({ color: 0x141417, roughness: 1 }))
  audienceFloor.position.set(0, -0.5, 11)
  scene.add(audienceFloor)

  // FOH desk marker (the fixed listening position)
  const foh = new THREE.Group()
  const fohDesk = box(1.6, 0.5, 0.8, mat({ color: 0x3f3f46, roughness: 0.6 }))
  fohDesk.position.y = 0.25 - 0.45
  foh.add(fohDesk)
  const fohLight = new THREE.Mesh(
    track(new THREE.SphereGeometry(0.12, 12, 12)),
    mat({ color: 0x34d399, emissive: 0x34d399, emissiveIntensity: 1.2 }),
  )
  fohLight.position.y = 0.15
  foh.add(fohLight)
  foh.position.set(FOH_POS.x, 0, FOH_POS.z)
  scene.add(foh)

  // Room walls: scale with room size, hidden for open-air.
  const wallMat = mat({
    color: 0x3b3b46,
    roughness: 0.9,
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
  })
  const walls = new THREE.Group()
  const backWall = box(1, 6, 0.3, wallMat)
  const leftWall = box(0.3, 6, 1, wallMat)
  const rightWall = box(0.3, 6, 1, wallMat)
  walls.add(backWall, leftWall, rightWall)
  scene.add(walls)

  function syncRoomVisual() {
    const size = stage.roomSize
    walls.visible = stage.roomPreset !== 'openair'
    const halfW = 7 + 4 * size
    const backZ = -(5 + 3.5 * size)
    const depth = 16 + 6 * size
    backWall.scale.x = halfW * 2
    backWall.position.set(0, 3, backZ)
    leftWall.scale.z = depth
    leftWall.position.set(-halfW, 3, backZ + depth / 2)
    rightWall.scale.z = depth
    rightWall.position.set(halfW, 3, backZ + depth / 2)
  }
  syncRoomVisual()
  const stopRoomSync = watch(() => [stage.roomPreset, stage.roomSize], syncRoomVisual)

  // ---- performers ----
  function labelSprite(text: string, color: string): THREE.Sprite {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 96
    const g = canvas.getContext('2d')!
    g.font = 'bold 44px system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = color
    g.fillText(text, 128, 48)
    const tex = track(new THREE.CanvasTexture(canvas))
    tex.colorSpace = THREE.SRGBColorSpace
    const m = track(new THREE.SpriteMaterial({ map: tex, transparent: true }))
    const sprite = new THREE.Sprite(m)
    sprite.scale.set(2.4, 0.9, 1)
    return sprite
  }

  interface Performer {
    id: string
    group: THREE.Group
    ringMat: THREE.MeshStandardMaterial
    body: THREE.Mesh
  }
  const performers: Performer[] = []
  const pickable: THREE.Object3D[] = []

  for (const ch of mixer.channels) {
    const color = new THREE.Color(ch.color)
    const group = new THREE.Group()

    const body = new THREE.Mesh(
      track(new THREE.CapsuleGeometry(0.35, 0.9, 6, 14)),
      mat({ color, roughness: 0.45 }),
    )
    body.position.y = 1.0
    body.userData.channelId = ch.id
    pickable.push(body)
    group.add(body)

    const ringMat = mat({
      color,
      emissive: color,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: 0.85,
    })
    const ring = new THREE.Mesh(track(new THREE.CylinderGeometry(0.7, 0.7, 0.06, 28)), ringMat)
    ring.position.y = 0.03
    ring.userData.channelId = ch.id
    pickable.push(ring)
    group.add(ring)

    const label = labelSprite(ch.name, ch.color)
    label.position.y = 2.3
    group.add(label)

    scene.add(group)
    performers.push({ id: ch.id, group, ringMat, body })
  }

  function syncPositions() {
    for (const p of performers) {
      const pos = stage.positions[p.id]
      if (pos) p.group.position.set(pos.x, 0, pos.z)
    }
  }
  syncPositions()
  const stopPosSync = watch(() => JSON.stringify(stage.positions), syncPositions)

  // ---- drag interaction ----
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const hitPoint = new THREE.Vector3()
  let dragId: string | null = null

  function setNdc(ev: PointerEvent) {
    const rect = renderer.domElement.getBoundingClientRect()
    ndc.set(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    )
  }

  function describe(id: string): string {
    const pos = stage.positions[id]
    const name = mixer.channels.find((c) => c.id === id)?.name ?? id
    if (!pos) return name
    const lr = pos.x < -0.3 ? `${(-pos.x).toFixed(1)}m left` : pos.x > 0.3 ? `${pos.x.toFixed(1)}m right` : 'center'
    const fb = pos.z < -0.3 ? `${(-pos.z).toFixed(1)}m back` : pos.z > 0.3 ? `${pos.z.toFixed(1)}m front` : 'mid-stage'
    return `${name}: ${lr} · ${fb}`
  }

  function onPointerDown(ev: PointerEvent) {
    setNdc(ev)
    raycaster.setFromCamera(ndc, camera)
    const hit = raycaster.intersectObjects(pickable, false)[0]
    const id = hit?.object.userData.channelId as string | undefined
    if (!id) return
    ev.preventDefault()
    dragId = id
    dragReadout.value = describe(id)
    controls.enabled = false
    renderer.domElement.setPointerCapture(ev.pointerId)
  }

  function onPointerMove(ev: PointerEvent) {
    if (!dragId) return
    setNdc(ev)
    raycaster.setFromCamera(ndc, camera)
    if (!raycaster.ray.intersectPlane(floorPlane, hitPoint)) return
    stage.setPosition(dragId, {
      x: clamp(hitPoint.x, STAGE_BOUNDS.minX, STAGE_BOUNDS.maxX),
      z: clamp(hitPoint.z, STAGE_BOUNDS.minZ, STAGE_BOUNDS.maxZ),
    })
    dragReadout.value = describe(dragId)
  }

  function onPointerUp(ev: PointerEvent) {
    if (!dragId) return
    dragId = null
    dragReadout.value = null
    controls.enabled = true
    renderer.domElement.releasePointerCapture(ev.pointerId)
  }

  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('pointerup', onPointerUp)
  renderer.domElement.addEventListener('pointercancel', onPointerUp)

  // ---- sizing / render loop ----
  function resize() {
    const w = host.clientWidth
    const h = host.clientHeight
    if (w === 0 || h === 0) return
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(host)
  resize()

  let raf = 0
  function loop() {
    // Performer rings pulse with their channel's live level.
    for (const p of performers) {
      const peak = meters.channels[p.id]?.peak ?? 0
      const norm = clamp((linToDb(peak) + 60) / 60, 0, 1)
      p.ringMat.emissiveIntensity = 0.25 + norm * 1.6
      const s = 1 + norm * 0.35
      p.body.scale.set(1, s, 1)
    }
    controls.update()
    renderer.render(scene, camera)
    raf = requestAnimationFrame(loop)
  }
  loop()

  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__stage3d = {
      project(channelId: string) {
        const p = performers.find((x) => x.id === channelId)
        if (!p) return null
        const v = new THREE.Vector3()
        p.body.getWorldPosition(v)
        v.project(camera)
        const rect = renderer.domElement.getBoundingClientRect()
        return {
          x: rect.left + ((v.x + 1) / 2) * rect.width,
          y: rect.top + ((1 - v.y) / 2) * rect.height,
        }
      },
    }
  }

  onUnmounted(() => {
    cancelAnimationFrame(raf)
    stopPosSync()
    stopRoomSync()
    ro.disconnect()
    renderer.domElement.removeEventListener('pointerdown', onPointerDown)
    renderer.domElement.removeEventListener('pointermove', onPointerMove)
    renderer.domElement.removeEventListener('pointerup', onPointerUp)
    renderer.domElement.removeEventListener('pointercancel', onPointerUp)
    controls.dispose()
    for (const d of disposables) d.dispose()
    host.removeChild(renderer.domElement)
    if (import.meta.env.DEV) {
      delete (window as unknown as Record<string, unknown>).__stage3d
    }
  })
})
</script>

<template>
  <div>
    <div class="relative">
      <div
        ref="container"
        class="h-[480px] w-full touch-none overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 [&>canvas]:block"
      />
      <div
        v-if="dragReadout"
        class="pointer-events-none absolute left-3 top-3 rounded bg-zinc-950/90 px-3 py-1.5 font-mono text-sm text-emerald-300"
      >
        {{ dragReadout }}
      </div>
    </div>

    <div
      class="mt-3 flex flex-wrap items-end gap-4 rounded-lg border border-zinc-800 bg-zinc-900 p-3"
    >
      <div>
        <p class="mb-1.5 text-[10px] uppercase tracking-wide text-zinc-500">Venue</p>
        <div class="flex overflow-hidden rounded-md border border-zinc-700 text-xs font-semibold">
          <button
            v-for="[preset, def] in presetEntries"
            :key="preset"
            class="px-3 py-1.5 transition-colors"
            :class="
              stage.roomPreset === preset
                ? 'bg-emerald-500 text-black'
                : 'bg-zinc-950 text-zinc-500 hover:bg-zinc-800'
            "
            @click="stage.setRoomPreset(preset)"
          >
            {{ def.label }}
          </button>
        </div>
      </div>

      <div class="w-48" :class="stage.roomPreset === 'openair' ? 'opacity-40' : ''">
        <ParamSlider
          label="Room size"
          unit="×"
          :min="ROOM_SIZE_RANGE.min"
          :max="ROOM_SIZE_RANGE.max"
          :step="0.05"
          :decimals="2"
          :model-value="stage.roomSize"
          @update:model-value="stage.setRoomSize($event)"
        />
      </div>

      <p class="min-w-40 flex-1 text-[11px] leading-snug text-zinc-500">
        {{ roomHint }}
      </p>
    </div>

    <p class="mt-2 text-[11px] text-zinc-600">
      Drag performers around the stage — position changes pan, level, and how
      much room you hear. The green marker is FOH: your ears stay there while
      the camera orbits (drag empty space · scroll to zoom).
    </p>
  </div>
</template>
