<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { useMixerStore } from '../stores/mixer'
import { useMeters } from '../composables/useMeters'
import { clamp, linToDb, logToPos, posToLog } from '../lib/units'
import type { NumericParamKey } from '../types'

/**
 * The 3D console: a purely additive visual skin over the SAME Pinia store
 * the 2D desk uses. It never touches the audio engine — every interaction
 * goes through the store's existing actions, and all visuals are derived
 * from store state + the shared meter loop.
 */

const store = useMixerStore()
const meters = useMeters()

const container = ref<HTMLDivElement | null>(null)

/** Same ranges as the 2D sliders — one control surface, two skins. */
interface ParamSpec {
  min: number
  max: number
  log?: boolean
  label: string
  unit: string
}
const PARAM_SPECS: Record<NumericParamKey, ParamSpec> = {
  gainDb: { min: -24, max: 24, label: 'Gain', unit: 'dB' },
  hpfHz: { min: 20, max: 1000, log: true, label: 'HPF', unit: 'Hz' },
  eqHz: { min: 60, max: 12000, log: true, label: 'EQ freq', unit: 'Hz' },
  eqGainDb: { min: -15, max: 15, label: 'EQ gain', unit: 'dB' },
  compThresholdDb: { min: -60, max: 0, label: 'Comp thresh', unit: 'dB' },
  compRatio: { min: 1, max: 20, label: 'Comp ratio', unit: ':1' },
  faderDb: { min: -60, max: 6, label: 'Fader', unit: 'dB' },
}
const KNOB_ORDER: NumericParamKey[] = [
  'gainDb',
  'hpfHz',
  'eqHz',
  'eqGainDb',
  'compThresholdDb',
  'compRatio',
]

function toNorm(spec: ParamSpec, value: number): number {
  return spec.log
    ? logToPos(value, spec.min, spec.max)
    : clamp((value - spec.min) / (spec.max - spec.min), 0, 1)
}
function fromNorm(spec: ParamSpec, norm: number): number {
  const n = clamp(norm, 0, 1)
  return spec.log ? posToLog(n, spec.min, spec.max) : spec.min + n * (spec.max - spec.min)
}

// ---- layout constants (panel-local units) ----
const STRIP_W = 1.2
const STRIP_GAP = 0.12
const FADER_LEN = 1.1
const FADER_BOTTOM = -1.9
const KNOB_R = 0.13

interface ControlData {
  kind: 'knob' | 'fader' | 'mute' | 'solo'
  channelId: string // channel id or 'master'
  param?: NumericParamKey
}

interface StripVisual {
  faderCap: THREE.Mesh
  meterFill: THREE.Mesh
  meterMat: THREE.MeshStandardMaterial
  knobSpinners: Partial<Record<NumericParamKey, THREE.Group>>
  muteMat?: THREE.MeshStandardMaterial
  soloMat?: THREE.MeshStandardMaterial
}

/** Readout shown while dragging a control. */
const dragReadout = ref<string | null>(null)

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

  // ---- renderer / scene / camera ----
  const renderer = track(new THREE.WebGLRenderer({ antialias: true, alpha: true }))
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
  camera.position.set(0, 2.6, 7.2)

  scene.add(new THREE.AmbientLight(0xffffff, 0.55))
  const key = new THREE.DirectionalLight(0xffffff, 1.6)
  key.position.set(2, 6, 4)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0x88aaff, 0.4)
  fill.position.set(-4, 2, -2)
  scene.add(fill)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.target.set(0, -0.2, 0)
  controls.minDistance = 3.5
  controls.maxDistance = 14
  controls.maxPolarAngle = Math.PI * 0.55

  // ---- desk ----
  const desk = new THREE.Group()
  desk.rotation.x = -0.5
  scene.add(desk)

  const stripCount = store.channels.length + 1 // + master
  const totalW = stripCount * (STRIP_W + STRIP_GAP) + 0.35 // extra gap before master
  const bodyMat = mat({ color: 0x1c1c22, roughness: 0.85 })
  const body = box(totalW + 0.5, 4.6, 0.25, bodyMat)
  body.position.z = -0.14
  desk.add(body)

  const plateMat = mat({ color: 0x26262e, roughness: 0.7 })
  const trackMat = mat({ color: 0x0c0c10, roughness: 0.4 })
  const capMat = mat({ color: 0xd4d4d8, roughness: 0.35 })
  const knobMat = mat({ color: 0x3f3f46, roughness: 0.5 })
  const pointerMat = mat({ color: 0x34d399, emissive: 0x34d399, emissiveIntensity: 0.35 })

  const interactive: THREE.Object3D[] = []
  const visuals = new Map<string, StripVisual>()

  function labelPlane(text: string, color: string, w = 1.0, h = 0.26): THREE.Mesh {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 64
    const g = canvas.getContext('2d')!
    g.fillStyle = '#18181f'
    g.fillRect(0, 0, 256, 64)
    g.font = 'bold 34px system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = color
    g.fillText(text, 128, 34)
    const tex = track(new THREE.CanvasTexture(canvas))
    tex.colorSpace = THREE.SRGBColorSpace
    const m = track(new THREE.MeshBasicMaterial({ map: tex }))
    return new THREE.Mesh(track(new THREE.PlaneGeometry(w, h)), m)
  }

  function makeKnob(data: ControlData): { group: THREE.Group; spinner: THREE.Group } {
    const group = new THREE.Group()
    const body = new THREE.Mesh(
      track(new THREE.CylinderGeometry(KNOB_R, KNOB_R, 0.09, 24)),
      knobMat,
    )
    body.rotation.x = Math.PI / 2
    body.userData.control = data
    interactive.push(body)
    group.add(body)
    const spinner = new THREE.Group()
    const pointer = box(0.03, KNOB_R * 0.85, 0.03, pointerMat)
    pointer.position.set(0, KNOB_R * 0.55, 0.06)
    pointer.userData.control = data
    interactive.push(pointer)
    spinner.add(pointer)
    group.add(spinner)
    return { group, spinner }
  }

  function buildStrip(
    id: string,
    name: string,
    color: string,
    x: number,
    withKnobs: boolean,
  ): StripVisual {
    const strip = new THREE.Group()
    strip.position.set(x, 0, 0)
    desk.add(strip)

    const plate = box(STRIP_W, 4.4, 0.06, plateMat)
    plate.position.z = 0.03
    strip.add(plate)

    const label = labelPlane(name, color)
    label.position.set(0, 1.95, 0.07)
    strip.add(label)

    const visual: StripVisual = {
      faderCap: new THREE.Mesh(),
      meterFill: new THREE.Mesh(),
      meterMat: mat({ color: 0x34d399, emissive: 0x34d399, emissiveIntensity: 0.7 }),
      knobSpinners: {},
    }

    if (withKnobs) {
      KNOB_ORDER.forEach((param, i) => {
        const col = i % 2
        const row = Math.floor(i / 2)
        const { group, spinner } = makeKnob({ kind: 'knob', channelId: id, param })
        group.position.set(col === 0 ? -0.28 : 0.28, 1.45 - row * 0.48, 0.08)
        strip.add(group)
        visual.knobSpinners[param] = spinner
      })

      const muteMat = mat({ color: 0x33333a, roughness: 0.6 })
      const soloMat = mat({ color: 0x33333a, roughness: 0.6 })
      const mute = box(0.34, 0.22, 0.1, muteMat)
      mute.position.set(-0.28, -0.15, 0.08)
      mute.userData.control = { kind: 'mute', channelId: id } satisfies ControlData
      const solo = box(0.34, 0.22, 0.1, soloMat)
      solo.position.set(0.28, -0.15, 0.08)
      solo.userData.control = { kind: 'solo', channelId: id } satisfies ControlData
      interactive.push(mute, solo)
      strip.add(mute, solo)
      visual.muteMat = muteMat
      visual.soloMat = soloMat
    }

    // fader track + cap
    const track3 = box(0.1, FADER_LEN, 0.04, trackMat)
    track3.position.set(-0.22, FADER_BOTTOM + FADER_LEN / 2, 0.07)
    strip.add(track3)
    const cap = box(0.3, 0.14, 0.14, capMat)
    cap.position.set(-0.22, FADER_BOTTOM, 0.12)
    cap.userData.control = { kind: 'fader', channelId: id, param: 'faderDb' } satisfies ControlData
    interactive.push(cap)
    strip.add(cap)
    visual.faderCap = cap

    // meter: dark well + emissive fill (scaled from the bottom)
    const well = box(0.14, FADER_LEN, 0.03, trackMat)
    well.position.set(0.24, FADER_BOTTOM + FADER_LEN / 2, 0.065)
    strip.add(well)
    const fillBar = box(0.12, 1, 0.05, visual.meterMat)
    fillBar.position.set(0.24, FADER_BOTTOM, 0.08)
    fillBar.scale.y = 0.001
    strip.add(fillBar)
    visual.meterFill = fillBar

    visuals.set(id, visual)
    return visual
  }

  const startX = -totalW / 2 + STRIP_W / 2
  store.channels.forEach((ch, i) => {
    buildStrip(ch.id, ch.name, ch.color, startX + i * (STRIP_W + STRIP_GAP), true)
  })
  const masterX = startX + store.channels.length * (STRIP_W + STRIP_GAP) + 0.35
  buildStrip('master', 'MASTER', '#34d399', masterX, false)

  // master clip + limiter lights
  const clipMat = mat({ color: 0x3a1113, emissive: 0xef4444, emissiveIntensity: 0 })
  const limMat = mat({ color: 0x3a2a08, emissive: 0xf59e0b, emissiveIntensity: 0 })
  const master = visuals.get('master')!
  const masterStrip = master.faderCap.parent!
  const clipLight = new THREE.Mesh(track(new THREE.SphereGeometry(0.09, 16, 16)), clipMat)
  clipLight.position.set(-0.25, 1.4, 0.1)
  const limLight = new THREE.Mesh(track(new THREE.SphereGeometry(0.09, 16, 16)), limMat)
  limLight.position.set(0.25, 1.4, 0.1)
  masterStrip.add(clipLight, limLight)
  masterStrip.add(labelPlane('CLIP · LIM', '#71717a', 0.9, 0.2).translateY(1.1).translateZ(0.07))

  // ---- store → visuals ----
  function syncFromStore() {
    for (const ch of store.channels) {
      const v = visuals.get(ch.id)
      if (!v) continue
      for (const param of KNOB_ORDER) {
        const spinner = v.knobSpinners[param]
        if (!spinner) continue
        const norm = toNorm(PARAM_SPECS[param], ch.params[param])
        spinner.rotation.z = (0.5 - norm) * (Math.PI * 1.5)
      }
      const faderNorm = toNorm(PARAM_SPECS.faderDb, ch.params.faderDb)
      v.faderCap.position.y = FADER_BOTTOM + faderNorm * FADER_LEN
      v.muteMat?.color.set(ch.params.mute ? 0xdc2626 : 0x33333a)
      v.muteMat?.emissive.set(ch.params.mute ? 0xdc2626 : 0x000000)
      v.soloMat?.color.set(ch.params.solo ? 0xeab308 : 0x33333a)
      v.soloMat?.emissive.set(ch.params.solo ? 0xeab308 : 0x000000)
    }
    const m = visuals.get('master')!
    const masterNorm = toNorm(PARAM_SPECS.faderDb, store.master.faderDb)
    m.faderCap.position.y = FADER_BOTTOM + masterNorm * FADER_LEN
  }
  syncFromStore()
  const stopSync = watch(
    () => JSON.stringify([store.channels, store.master]),
    syncFromStore,
  )

  // ---- meters → visuals (every frame) ----
  function meterNorm(peak: number): number {
    return clamp((linToDb(peak) + 60) / 60, 0, 1)
  }
  function updateMeters() {
    for (const [id, v] of visuals) {
      const peak = id === 'master' ? meters.master.peak : (meters.channels[id]?.peak ?? 0)
      const norm = meterNorm(peak)
      v.meterFill.scale.y = Math.max(norm * FADER_LEN, 0.001)
      v.meterFill.position.y = FADER_BOTTOM + (norm * FADER_LEN) / 2
      const db = linToDb(peak)
      v.meterMat.color.set(db > -3 ? 0xef4444 : db > -12 ? 0xfacc15 : 0x34d399)
      v.meterMat.emissive.set(db > -3 ? 0xef4444 : db > -12 ? 0xfacc15 : 0x34d399)
    }
    clipMat.emissiveIntensity = meters.master.clip ? 1.6 : 0
    limMat.emissiveIntensity = meters.master.reductionDb < -0.5 ? 1.4 : 0
  }

  // ---- interaction: raycast + drag ----
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  let drag: {
    control: ControlData
    startClientY: number
    startNorm: number
  } | null = null

  function pick(ev: PointerEvent): ControlData | null {
    const rect = renderer.domElement.getBoundingClientRect()
    ndc.set(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    )
    raycaster.setFromCamera(ndc, camera)
    const hit = raycaster.intersectObjects(interactive, false)[0]
    return (hit?.object.userData.control as ControlData | undefined) ?? null
  }

  function currentValue(c: ControlData): number {
    if (c.channelId === 'master') return store.master.faderDb
    const ch = store.channels.find((x) => x.id === c.channelId)
    return ch && c.param ? ch.params[c.param] : 0
  }

  function applyValue(c: ControlData, value: number) {
    if (c.channelId === 'master') store.setMasterFader(value)
    else if (c.param) store.setParam(c.channelId, c.param, value)
  }

  function readout(c: ControlData, value: number): string {
    const spec = c.param ? PARAM_SPECS[c.param] : PARAM_SPECS.faderDb
    const name = c.channelId === 'master' ? 'Master' : (store.channels.find((x) => x.id === c.channelId)?.name ?? '')
    const num = spec.log && value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(1)
    return `${name} ${spec.label}: ${num} ${spec.unit}`
  }

  function onPointerDown(ev: PointerEvent) {
    const control = pick(ev)
    if (!control) return
    ev.preventDefault()
    if (control.kind === 'mute') {
      store.toggleMute(control.channelId)
      return
    }
    if (control.kind === 'solo') {
      store.toggleSolo(control.channelId)
      return
    }
    const spec = control.param ? PARAM_SPECS[control.param] : PARAM_SPECS.faderDb
    drag = {
      control,
      startClientY: ev.clientY,
      startNorm: toNorm(spec, currentValue(control)),
    }
    dragReadout.value = readout(control, currentValue(control))
    controls.enabled = false
    renderer.domElement.setPointerCapture(ev.pointerId)
  }

  function onPointerMove(ev: PointerEvent) {
    if (!drag) return
    const spec = drag.control.param ? PARAM_SPECS[drag.control.param] : PARAM_SPECS.faderDb
    const norm = drag.startNorm + (drag.startClientY - ev.clientY) / 240
    const value = fromNorm(spec, norm)
    applyValue(drag.control, value)
    dragReadout.value = readout(drag.control, value)
  }

  function onPointerUp(ev: PointerEvent) {
    if (!drag) return
    drag = null
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
    updateMeters()
    controls.update()
    renderer.render(scene, camera)
    raf = requestAnimationFrame(loop)
  }
  loop()

  // DEV-only hook so automated tests can find controls on screen.
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__desk3d = {
      project(channelId: string, kind: string, param?: string) {
        const obj = interactive.find((o) => {
          const c = o.userData.control as ControlData
          return c.channelId === channelId && c.kind === kind && (!param || c.param === param)
        })
        if (!obj) return null
        const p = new THREE.Vector3()
        obj.getWorldPosition(p)
        p.project(camera)
        const rect = renderer.domElement.getBoundingClientRect()
        return {
          x: rect.left + ((p.x + 1) / 2) * rect.width,
          y: rect.top + ((1 - p.y) / 2) * rect.height,
        }
      },
    }
  }

  onUnmounted(() => {
    cancelAnimationFrame(raf)
    stopSync()
    ro.disconnect()
    renderer.domElement.removeEventListener('pointerdown', onPointerDown)
    renderer.domElement.removeEventListener('pointermove', onPointerMove)
    renderer.domElement.removeEventListener('pointerup', onPointerUp)
    renderer.domElement.removeEventListener('pointercancel', onPointerUp)
    controls.dispose()
    for (const d of disposables) d.dispose()
    host.removeChild(renderer.domElement)
    if (import.meta.env.DEV) {
      delete (window as unknown as Record<string, unknown>).__desk3d
    }
  })
})
</script>

<template>
  <div class="relative">
    <div
      ref="container"
      class="h-[520px] w-full touch-none overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 [&>canvas]:block"
    />
    <div
      v-if="dragReadout"
      class="pointer-events-none absolute left-3 top-3 rounded bg-zinc-950/90 px-3 py-1.5 font-mono text-sm text-emerald-300"
    >
      {{ dragReadout }}
    </div>
    <p class="mt-2 text-[11px] text-zinc-600">
      Drag faders and knobs vertically · click M/S buttons · drag empty space to
      orbit, scroll to zoom. Knobs per strip: gain · HPF | EQ freq · EQ gain |
      comp thresh · ratio. Same desk, same state — switch to 2D anytime.
    </p>
  </div>
</template>
