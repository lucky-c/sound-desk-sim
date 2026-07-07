<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useMixerStore } from '../stores/mixer'
import { uiState } from '../composables/uiState'
import { usePanelResize } from '../composables/usePanelResize'
import { clamp, logToPos, posToLog } from '../lib/units'
import type { NumericParamKey } from '../types'
import {
  engineState,
  getChannelAnalysers,
  getChannelEqResponse,
  getSampleRate,
} from '../audio/engine'

/**
 * Graphical channel EQ (M32-screen style): the channel's live spectrum with
 * the combined EQ curve on top, and draggable handles for the low cut and
 * all four bands. Drag = frequency/gain, mouse wheel on a mid handle = Q.
 * Everything writes through the store, so the strip knobs stay in sync.
 */

const mixer = useMixerStore()

const channel = computed(() =>
  mixer.channels.find((ch) => ch.id === uiState.eqChannelId),
)

const canvas = ref<HTMLCanvasElement | null>(null)

const W = 560
const H = 240
const { scale, onResizeDown, onResizeMove } = usePanelResize('sds.eqScale', W)
const FMIN = 20
const FMAX = 20000
const GAIN_DB = 18 // ± y-range of the curve/handles
const SPEC_MIN_DB = -100

interface BandDef {
  name: string
  fKey: NumericParamKey
  gKey: NumericParamKey | null
  qKey: NumericParamKey | null
  fMin: number
  fMax: number
  color: string
}
const BANDS: BandDef[] = [
  { name: 'Low cut', fKey: 'hpfHz', gKey: null, qKey: null, fMin: 20, fMax: 1000, color: '#a78bfa' },
  { name: 'Low', fKey: 'eqLowFreq', gKey: 'eqLowGainDb', qKey: null, fMin: 40, fMax: 600, color: '#f59e0b' },
  { name: 'Lo mid', fKey: 'eqLoMidFreq', gKey: 'eqLoMidGainDb', qKey: 'eqLoMidQ', fMin: 100, fMax: 2000, color: '#34d399' },
  { name: 'Hi mid', fKey: 'eqHiMidFreq', gKey: 'eqHiMidGainDb', qKey: 'eqHiMidQ', fMin: 400, fMax: 8000, color: '#22d3ee' },
  { name: 'High', fKey: 'eqHighFreq', gKey: 'eqHighGainDb', qKey: null, fMin: 2000, fMax: 16000, color: '#f472b6' },
]

const activeBand = ref<BandDef | null>(null)

function fToX(f: number): number {
  return logToPos(f, FMIN, FMAX) * W
}
function xToF(x: number): number {
  return posToLog(clamp(x / W, 0, 1), FMIN, FMAX)
}
function gainToY(db: number): number {
  return H / 2 - (db / GAIN_DB) * (H / 2 - 14)
}
function yToGain(y: number): number {
  return clamp(((H / 2 - y) / (H / 2 - 14)) * GAIN_DB, -15, 15)
}

function handlePos(band: BandDef): { x: number; y: number } {
  const p = channel.value!.params
  const x = fToX(p[band.fKey] as number)
  const y = band.gKey ? gainToY(p[band.gKey] as number) : H - 18
  return { x, y }
}

// ---- interaction ----
function canvasPoint(ev: MouseEvent): { x: number; y: number } {
  const rect = canvas.value!.getBoundingClientRect()
  return {
    x: ((ev.clientX - rect.left) / rect.width) * W,
    y: ((ev.clientY - rect.top) / rect.height) * H,
  }
}

function nearestBand(x: number, y: number): BandDef | null {
  let best: BandDef | null = null
  let bestDist = 18
  for (const band of BANDS) {
    const h = handlePos(band)
    const d = Math.hypot(h.x - x, h.y - y)
    if (d < bestDist) {
      bestDist = d
      best = band
    }
  }
  return best
}

function onPointerDown(ev: PointerEvent) {
  if (!channel.value) return
  const { x, y } = canvasPoint(ev)
  const band = nearestBand(x, y)
  if (!band) return
  ev.preventDefault()
  activeBand.value = band
  ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
  onPointerMove(ev)
}

function onPointerMove(ev: PointerEvent) {
  if (!activeBand.value || !channel.value || (ev.buttons & 1) === 0) return
  const band = activeBand.value
  const { x, y } = canvasPoint(ev)
  mixer.setParam(channel.value.id, band.fKey, clamp(xToF(x), band.fMin, band.fMax))
  if (band.gKey) mixer.setParam(channel.value.id, band.gKey, yToGain(y))
}

function onPointerUp() {
  activeBand.value = null
}

function onWheel(ev: WheelEvent) {
  if (!channel.value) return
  const { x, y } = canvasPoint(ev)
  const band = activeBand.value ?? nearestBand(x, y)
  if (!band?.qKey) return
  ev.preventDefault()
  const q = channel.value.params[band.qKey] as number
  mixer.setParam(
    channel.value.id,
    band.qKey,
    clamp(q * Math.exp(-ev.deltaY * 0.002), 0.3, 10),
  )
}

// ---- drawing ----
const GRID_FREQS = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
const RESP_N = 220
const respFreqs = new Float32Array(RESP_N)
for (let i = 0; i < RESP_N; i++) {
  respFreqs[i] = FMIN * Math.pow(FMAX / FMIN, i / (RESP_N - 1))
}
const respOut = new Float32Array(RESP_N)
let specData: Float32Array<ArrayBuffer> | null = null
let raf = 0

onMounted(() => {
  const el = canvas.value
  if (!el) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  el.width = W * dpr
  el.height = H * dpr
  const g = el.getContext('2d')!
  g.scale(dpr, dpr)

  function loop() {
    g.fillStyle = '#09090b'
    g.fillRect(0, 0, W, H)

    // grid
    g.strokeStyle = '#26262b'
    g.fillStyle = '#52525b'
    g.font = '9px system-ui, sans-serif'
    g.textAlign = 'center'
    for (const f of GRID_FREQS) {
      const x = fToX(f)
      g.beginPath()
      g.moveTo(x, 0)
      g.lineTo(x, H - 11)
      g.stroke()
      g.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x, H - 2)
    }
    for (const db of [-12, -6, 6, 12]) {
      g.strokeStyle = '#1c1c21'
      g.beginPath()
      g.moveTo(0, gainToY(db))
      g.lineTo(W, gainToY(db))
      g.stroke()
    }
    g.setLineDash([3, 4])
    g.strokeStyle = '#3f3f46'
    g.beginPath()
    g.moveTo(0, H / 2)
    g.lineTo(W, H / 2)
    g.stroke()
    g.setLineDash([])

    const ch = channel.value
    if (ch && engineState.built) {
      // live spectrum (channel analyser)
      const analyser = getChannelAnalysers().get(ch.id)
      if (analyser) {
        if (!specData || specData.length !== analyser.frequencyBinCount) {
          specData = new Float32Array(analyser.frequencyBinCount)
        }
        analyser.getFloatFrequencyData(specData)
        const nyquist = (getSampleRate() ?? 48000) / 2
        g.beginPath()
        g.moveTo(0, H)
        for (let x = 0; x <= W; x += 2) {
          const bin = Math.min(
            specData.length - 1,
            Math.round((xToF(x) / nyquist) * specData.length),
          )
          const db = specData[bin] ?? SPEC_MIN_DB
          const y = ((0 - db) / (0 - SPEC_MIN_DB)) * (H - 11)
          g.lineTo(x, clamp(y, 0, H - 11))
        }
        g.lineTo(W, H)
        g.closePath()
        g.fillStyle = 'rgba(52, 211, 153, 0.12)'
        g.fill()
      }

      // combined EQ curve
      if (getChannelEqResponse(ch.id, respFreqs, respOut)) {
        g.beginPath()
        for (let i = 0; i < RESP_N; i++) {
          const db = 20 * Math.log10(Math.max(respOut[i]!, 1e-6))
          const y = clamp(gainToY(db), 2, H - 11)
          if (i === 0) g.moveTo(fToX(respFreqs[i]!), y)
          else g.lineTo(fToX(respFreqs[i]!), y)
        }
        g.strokeStyle = '#e4e4e7'
        g.lineWidth = 2
        g.stroke()
        g.lineWidth = 1
      }

      // handles
      for (const band of BANDS) {
        const h = handlePos(band)
        g.beginPath()
        g.arc(h.x, h.y, activeBand.value === band ? 8 : 6, 0, Math.PI * 2)
        g.fillStyle = band.color
        g.globalAlpha = 0.9
        g.fill()
        g.globalAlpha = 1
        g.strokeStyle = '#09090b'
        g.stroke()
      }
    }
    raf = requestAnimationFrame(loop)
  }
  loop()
})

onUnmounted(() => cancelAnimationFrame(raf))
</script>

<template>
  <div
    class="relative w-fit max-w-[94vw] rounded-lg border border-zinc-800 bg-zinc-950/95 p-3 backdrop-blur"
  >
    <div class="mb-2 flex items-center gap-2">
      <p class="text-[10px] uppercase tracking-wide text-zinc-500">Channel EQ</p>
      <span
        v-if="channel"
        class="text-xs font-semibold"
        :style="{ color: channel.color }"
      >
        {{ channel.num }} · {{ channel.name }}
      </span>
      <span class="text-[10px] text-zinc-600">
        drag handles · wheel = Q on the mids
      </span>
      <button
        class="ml-auto rounded bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-700"
        @click="uiState.eqChannelId = null"
      >
        Close
      </button>
    </div>
    <div class="relative w-fit">
      <canvas
        ref="canvas"
        class="block cursor-crosshair touch-none"
        :style="{ width: `${W * scale}px`, height: `${H * scale}px` }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @wheel="onWheel"
      />
      <!-- resize handle -->
      <div
        class="absolute bottom-1 right-1 h-3 w-3 cursor-nwse-resize rounded-sm border-b-2 border-r-2 border-zinc-600 hover:border-emerald-500"
        title="Drag to resize"
        @pointerdown="onResizeDown"
        @pointermove="onResizeMove"
      />
    </div>
    <div class="mt-1.5 flex gap-3">
      <span
        v-for="band in BANDS"
        :key="band.name"
        class="flex items-center gap-1 text-[9px] uppercase tracking-wide text-zinc-500"
      >
        <span class="inline-block h-2 w-2 rounded-full" :style="{ background: band.color }" />
        {{ band.name }}
      </span>
    </div>
  </div>
</template>
