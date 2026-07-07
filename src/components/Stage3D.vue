<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { useMixerStore } from '../stores/mixer'
import { useStageStore } from '../stores/stage'
import { useMeters } from '../composables/useMeters'
import { uiState } from '../composables/uiState'
import { clamp, linToDb } from '../lib/units'
import {
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

  // Default framing, restored by the camera-reset (F) hotkey.
  const HOME_CAM = camera.position.clone()
  const HOME_TARGET = controls.target.clone()
  function resetCamera() {
    camera.position.copy(HOME_CAM)
    controls.target.copy(HOME_TARGET)
    controls.update()
  }
  const stopCamReset = watch(() => uiState.cameraResetNonce, resetCamera)

  // ---- WASD movement: truck the camera + its target across the ground,
  // relative to where the camera is looking. Active only while the pointer is
  // over the stage (so S doesn't also fire the solo hotkey). ----
  const heldKeys = new Set<string>()
  function isTyping(el: EventTarget | null): boolean {
    const n = el as HTMLElement | null
    return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable)
  }
  function onKeyDown(e: KeyboardEvent) {
    if (isTyping(e.target) || !uiState.stageActive) return
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) heldKeys.add(e.code)
  }
  function onKeyUp(e: KeyboardEvent) {
    heldKeys.delete(e.code)
  }
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  const panForward = new THREE.Vector3()
  const panRight = new THREE.Vector3()
  const panDelta = new THREE.Vector3()
  function applyMovement() {
    if (heldKeys.size === 0) return
    // Ground-plane forward (camera look direction flattened) and right.
    camera.getWorldDirection(panForward)
    panForward.y = 0
    if (panForward.lengthSq() < 1e-6) return
    panForward.normalize()
    panRight.crossVectors(panForward, camera.up).normalize()
    const speed = 0.22
    panDelta.set(0, 0, 0)
    if (heldKeys.has('KeyW')) panDelta.add(panForward)
    if (heldKeys.has('KeyS')) panDelta.sub(panForward)
    if (heldKeys.has('KeyD')) panDelta.add(panRight)
    if (heldKeys.has('KeyA')) panDelta.sub(panRight)
    if (panDelta.lengthSq() === 0) return
    panDelta.normalize().multiplyScalar(speed)
    camera.position.add(panDelta)
    controls.target.add(panDelta)
  }

  // ---- venue ----
  // Objects the raycaster can grab (performers, PA stacks, FOH desk, stage).
  let pickable: THREE.Object3D[] = []

  // The stage deck: floor + grid + performers + a drag handle all ride in one
  // group, so sliding it moves the whole band together (audience, PA and FOH
  // stay fixed in the world).
  const stageGroup = new THREE.Group()
  const stageFloor = box(11, 0.4, 6.4, mat({ color: 0x27272e, roughness: 0.85 }))
  stageFloor.position.set(0, -0.2, -1)
  stageGroup.add(stageFloor)

  const grid = track(new THREE.GridHelper(10, 10, 0x3f3f46, 0x2c2c33))
  grid.position.set(0, 0.01, -1)
  stageGroup.add(grid)

  // "Move stage" handle — a distinct puck at the downstage edge you grab to
  // slide the whole deck. Kept separate from the floor so dragging the floor
  // still orbits the camera.
  const stageHandle = new THREE.Group()
  const handlePuck = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.45, 0.55, 0.28, 24)),
    mat({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 0.45, roughness: 0.5 }),
  )
  handlePuck.position.y = 0.14
  handlePuck.userData.stageHandle = true
  pickable.push(handlePuck)
  stageHandle.add(handlePuck)
  const handleLabel = labelSprite('◆ MOVE STAGE', '#fbbf24')
  handleLabel.position.y = 0.95
  stageHandle.add(handleLabel)
  stageHandle.position.set(0, 0, 2.4)
  stageGroup.add(stageHandle)

  scene.add(stageGroup)
  stageGroup.position.set(stage.stageOffset.x, 0, stage.stageOffset.z)
  function syncStageOffset() {
    stageGroup.position.set(stage.stageOffset.x, 0, stage.stageOffset.z)
  }
  const stopStageSync = watch(
    () => [stage.stageOffset.x, stage.stageOffset.z],
    syncStageOffset,
  )

  const audienceFloor = box(30, 0.1, 18, mat({ color: 0x141417, roughness: 1 }))
  audienceFloor.position.set(0, -0.5, 11)
  scene.add(audienceFloor)

  // FOH desk marker — the listening position, now draggable.
  const foh = new THREE.Group()
  const fohDesk = box(1.6, 0.5, 0.8, mat({ color: 0x3f3f46, roughness: 0.6 }))
  fohDesk.position.y = 0.25 - 0.45
  fohDesk.userData.foh = true
  pickable.push(fohDesk)
  foh.add(fohDesk)
  const fohLight = new THREE.Mesh(
    track(new THREE.SphereGeometry(0.12, 12, 12)),
    mat({ color: 0x34d399, emissive: 0x34d399, emissiveIntensity: 1.2 }),
  )
  fohLight.position.y = 0.15
  fohLight.userData.foh = true
  pickable.push(fohLight)
  foh.add(fohLight)
  const fohLabel = labelSprite('FOH', '#34d399')
  fohLabel.position.y = 0.9
  foh.add(fohLabel)
  foh.position.set(stage.fohPos.x, 0, stage.fohPos.z)
  scene.add(foh)
  function syncFoh() {
    foh.position.set(stage.fohPos.x, 0, stage.fohPos.z)
  }
  const stopFohSync = watch(() => [stage.fohPos.x, stage.fohPos.z], syncFoh)

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
    instrumentId: string
    group: THREE.Group
    ringMat: THREE.MeshStandardMaterial
    body: THREE.Mesh
  }
  const performers = new Map<string, Performer>()

  function addPerformer(id: string, instrumentId: string, name: string, colorHex: string) {
    const color = new THREE.Color(colorHex)
    const group = new THREE.Group()

    const body = new THREE.Mesh(
      track(new THREE.CapsuleGeometry(0.35, 0.9, 6, 14)),
      mat({ color, roughness: 0.45 }),
    )
    body.position.y = 1.0
    body.userData.channelId = id
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
    ring.userData.channelId = id
    pickable.push(ring)
    group.add(ring)

    const label = labelSprite(name, colorHex)
    label.position.y = 2.3
    group.add(label)

    // Parented to the stage deck: on-deck position is local, so sliding the
    // whole stage translates every performer with it.
    stageGroup.add(group)
    performers.set(id, { id, instrumentId, group, ringMat, body })
  }

  function removePerformer(id: string) {
    const p = performers.get(id)
    if (!p) return
    stageGroup.remove(p.group)
    pickable = pickable.filter((o) => o.userData.channelId !== id)
    performers.delete(id)
  }

  /** Add/remove/swap performers to mirror the console's plugging. */
  function syncPerformers() {
    for (const ch of mixer.channels) {
      const existing = performers.get(ch.id)
      if (ch.instrumentId && existing?.instrumentId !== ch.instrumentId) {
        if (existing) removePerformer(ch.id)
        addPerformer(ch.id, ch.instrumentId, ch.name, ch.color)
      } else if (!ch.instrumentId && existing) {
        removePerformer(ch.id)
      }
    }
    syncPositions()
  }

  function syncPositions() {
    for (const p of performers.values()) {
      const pos = stage.positions[p.id]
      if (pos) p.group.position.set(pos.x, 0, pos.z)
    }
  }
  syncPerformers()
  const stopPosSync = watch(() => JSON.stringify(stage.positions), syncPositions)
  const stopPlugSync = watch(
    () => mixer.channels.map((ch) => `${ch.id}:${ch.instrumentId ?? ''}`).join(','),
    syncPerformers,
  )

  // ---- PA speaker stacks (draggable) ----
  const paMeshes = {} as Record<'left' | 'right', THREE.Group>
  for (const side of ['left', 'right'] as const) {
    const group = new THREE.Group()
    const cab = box(0.9, 1.5, 0.7, mat({ color: 0x18181c, roughness: 0.8 }))
    cab.position.y = 0.75
    cab.userData.paSide = side
    pickable.push(cab)
    group.add(cab)
    const horn = box(0.7, 0.45, 0.55, mat({ color: 0x26262c, roughness: 0.6 }))
    horn.position.y = 1.75
    horn.userData.paSide = side
    pickable.push(horn)
    group.add(horn)
    const led = new THREE.Mesh(
      track(new THREE.SphereGeometry(0.06, 10, 10)),
      mat({ color: 0x34d399, emissive: 0x34d399, emissiveIntensity: 1.2 }),
    )
    led.position.set(0, 1.35, 0.36)
    group.add(led)
    const label = labelSprite(side === 'left' ? 'PA L' : 'PA R', '#a1a1aa')
    label.position.y = 2.4
    group.add(label)
    scene.add(group)
    paMeshes[side] = group
  }
  function syncPaMeshes() {
    for (const side of ['left', 'right'] as const) {
      const pos = stage.paSpeakers[side]
      paMeshes[side].position.set(pos.x, 0, pos.z)
    }
  }
  syncPaMeshes()
  const stopPaSync = watch(() => JSON.stringify(stage.paSpeakers), syncPaMeshes)

  // ---- drag interaction ----
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const hitPoint = new THREE.Vector3()
  let dragId: string | null = null
  let dragPa: 'left' | 'right' | null = null
  let dragFoh = false
  let dragStage = false
  const stageDragStartHit = new THREE.Vector3()
  const stageDragStartOffset = { x: 0, z: 0 }

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
    const pa = hit?.object.userData.paSide as 'left' | 'right' | undefined
    const isFoh = hit?.object.userData.foh === true
    const isStage = hit?.object.userData.stageHandle === true
    if (!id && !pa && !isFoh && !isStage) return
    ev.preventDefault()
    dragId = id ?? null
    dragPa = pa ?? null
    dragFoh = isFoh
    dragStage = isStage
    if (isStage && raycaster.ray.intersectPlane(floorPlane, hitPoint)) {
      stageDragStartHit.copy(hitPoint)
      stageDragStartOffset.x = stage.stageOffset.x
      stageDragStartOffset.z = stage.stageOffset.z
    }
    dragReadout.value = id
      ? describe(id)
      : pa
        ? `PA ${pa} stack`
        : isFoh
          ? 'FOH desk (your ears)'
          : 'Stage — move the whole band'
    controls.enabled = false
    renderer.domElement.setPointerCapture(ev.pointerId)
  }

  function onPointerMove(ev: PointerEvent) {
    if (!dragId && !dragPa && !dragFoh && !dragStage) return
    setNdc(ev)
    raycaster.setFromCamera(ndc, camera)
    if (!raycaster.ray.intersectPlane(floorPlane, hitPoint)) return
    if (dragStage) {
      // Slide the whole deck by the drag delta since grabbing the handle.
      stage.setStageOffset({
        x: stageDragStartOffset.x + (hitPoint.x - stageDragStartHit.x),
        z: stageDragStartOffset.z + (hitPoint.z - stageDragStartHit.z),
      })
      const o = stage.stageOffset
      dragReadout.value = `Stage: ${o.x.toFixed(1)}m · ${o.z.toFixed(1)}m`
    } else if (dragFoh) {
      stage.setFohPos({ x: hitPoint.x, z: hitPoint.z })
      const p = stage.fohPos
      dragReadout.value = `FOH: ${p.x.toFixed(1)}m · ${p.z.toFixed(1)}m from stage`
    } else if (dragId) {
      // Convert the world hit back to an on-deck (stage-local) position.
      stage.setPosition(dragId, {
        x: clamp(hitPoint.x - stage.stageOffset.x, STAGE_BOUNDS.minX, STAGE_BOUNDS.maxX),
        z: clamp(hitPoint.z - stage.stageOffset.z, STAGE_BOUNDS.minZ, STAGE_BOUNDS.maxZ),
      })
      dragReadout.value = describe(dragId)
    } else if (dragPa) {
      stage.setPaSpeaker(dragPa, { x: hitPoint.x, z: hitPoint.z })
      const pos = stage.paSpeakers[dragPa]
      dragReadout.value = `PA ${dragPa}: ${pos.x.toFixed(1)}m · ${pos.z.toFixed(1)}m`
    }
  }

  function onPointerUp(ev: PointerEvent) {
    if (!dragId && !dragPa && !dragFoh && !dragStage) return
    dragId = null
    dragPa = null
    dragFoh = false
    dragStage = false
    dragReadout.value = null
    controls.enabled = true
    renderer.domElement.releasePointerCapture(ev.pointerId)
  }

  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('pointerup', onPointerUp)
  renderer.domElement.addEventListener('pointercancel', onPointerUp)

  // Track whether the pointer is over the stage, to arm WASD movement.
  function onEnter() {
    uiState.stageActive = true
  }
  function onLeave() {
    uiState.stageActive = false
    heldKeys.clear()
  }
  host.addEventListener('pointerenter', onEnter)
  host.addEventListener('pointerleave', onLeave)

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
    for (const p of performers.values()) {
      const peak = meters.channels[p.id]?.peak ?? 0
      const norm = clamp((linToDb(peak) + 60) / 60, 0, 1)
      p.ringMat.emissiveIntensity = 0.25 + norm * 1.6
      const s = 1 + norm * 0.35
      p.body.scale.set(1, s, 1)
    }
    applyMovement()
    controls.update()
    renderer.render(scene, camera)
    raf = requestAnimationFrame(loop)
  }
  loop()

  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__stageStore = stage
    ;(window as unknown as Record<string, unknown>).__stage3d = {
      projectPa(side: 'left' | 'right') {
        const g = paMeshes[side]
        const v = new THREE.Vector3()
        g.getWorldPosition(v)
        v.y = 1
        v.project(camera)
        const rect = renderer.domElement.getBoundingClientRect()
        return {
          x: rect.left + ((v.x + 1) / 2) * rect.width,
          y: rect.top + ((1 - v.y) / 2) * rect.height,
        }
      },
      project(channelId: string) {
        const p = performers.get(channelId)
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
    stopPlugSync()
    stopRoomSync()
    stopPaSync()
    stopFohSync()
    stopStageSync()
    stopCamReset()
    ro.disconnect()
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    host.removeEventListener('pointerenter', onEnter)
    host.removeEventListener('pointerleave', onLeave)
    uiState.stageActive = false
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
  <div class="relative h-full w-full">
    <div ref="container" class="absolute inset-0 touch-none [&>canvas]:block" />

    <div
      v-if="dragReadout"
      class="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded bg-zinc-950/90 px-3 py-1.5 font-mono text-sm text-emerald-300"
    >
      {{ dragReadout }}
    </div>

    <!-- venue controls overlay (below the app's header chip) -->
    <div
      class="absolute left-3 top-14 flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-950/85 p-2.5 backdrop-blur"
      :title="roomHint"
    >
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
      <div class="w-44" :class="stage.roomPreset === 'openair' ? 'opacity-40' : ''">
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
      <div
        class="w-44"
        title="How much each performer leaks into the other mics on stage, by distance. Gates exist because of this."
      >
        <ParamSlider
          label="Mic bleed"
          unit="%"
          :min="0"
          :max="100"
          :step="1"
          :decimals="0"
          :model-value="stage.bleedAmount * 100"
          @update:model-value="stage.setBleedAmount($event / 100)"
        />
      </div>
      <div
        class="w-44"
        title="The band's own acoustic stage sound (drums, amps, horns) heard at FOH without the PA. DI instruments are near-silent. You mix the PA around this."
      >
        <ParamSlider
          label="Backline"
          unit="%"
          :min="0"
          :max="100"
          :step="1"
          :decimals="0"
          :model-value="stage.backlineAmount * 100"
          @update:model-value="stage.setBacklineAmount($event / 100)"
        />
      </div>
      <button
        class="self-start rounded bg-zinc-800 px-2 py-1 text-[10px] font-semibold text-zinc-300 hover:bg-zinc-700"
        title="Put both PA stacks back at the stage edges"
        @click="stage.resetPaSpeakers()"
      >
        Reset PA position
      </button>
      <p class="max-w-44 text-[10px] leading-snug text-zinc-500">{{ roomHint }}</p>
      <p class="max-w-44 border-t border-zinc-800 pt-1.5 text-[10px] leading-snug text-zinc-600">
        Drag performers, the PA stacks, or the green FOH desk (your ears) to
        move them; positions change pan, level, and room. Grab the amber ◆
        handle to slide the whole stage — the band moves together. Drag empty
        space to orbit · scroll to zoom · WASD to move · F to recenter.
      </p>
    </div>
  </div>
</template>
