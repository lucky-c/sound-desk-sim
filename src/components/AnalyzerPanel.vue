<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useMixerStore } from '../stores/mixer'
import { usePanelResize } from '../composables/usePanelResize'
import {
  engineState,
  getChannelAnalysers,
  getChannelEqResponse,
  getMasterAnalyser,
  getSampleRate,
} from '../audio/engine'

/**
 * RTA: a real-time spectrum analyzer fed by the engine's AnalyserNodes,
 * with the selected channel's live EQ curve (low cut + 4 bands, computed
 * from the actual BiquadFilterNodes) overlaid — move a knob, watch the
 * curve bend into the spectrum.
 */

const mixer = useMixerStore()

/** 'master' or a channel id. */
const selected = ref<string>('master')
const canvas = ref<HTMLCanvasElement | null>(null)

const W = 540
const H = 210
const { scale, onResizeDown, onResizeMove } = usePanelResize('sds.rtaScale', W)
const FMIN = 20
const FMAX = 20000
const SPEC_MIN_DB = -100
/** ± range of the EQ-curve scale (centered on the middle of the plot). */
const CURVE_DB = 18

const options = computed(() => [
  { id: 'master', label: 'Master bus' },
  ...mixer.pluggedChannels.map((ch) => ({ id: ch.id, label: `${ch.num} · ${ch.name}` })),
])

const GRID_FREQS = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

function fToX(f: number): number {
  return (Math.log(f / FMIN) / Math.log(FMAX / FMIN)) * W
}

const RESP_N = 200
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

  function drawGrid() {
    g.fillStyle = '#09090b'
    g.fillRect(0, 0, W, H)
    g.strokeStyle = '#27272a'
    g.fillStyle = '#52525b'
    g.font = '9px system-ui, sans-serif'
    g.textAlign = 'center'
    g.lineWidth = 1
    for (const f of GRID_FREQS) {
      const x = fToX(f)
      g.beginPath()
      g.moveTo(x, 0)
      g.lineTo(x, H - 12)
      g.stroke()
      g.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x, H - 3)
    }
    // EQ 0 dB reference (mid-height, dashed)
    g.setLineDash([3, 4])
    g.strokeStyle = '#3f3f46'
    g.beginPath()
    g.moveTo(0, H / 2)
    g.lineTo(W, H / 2)
    g.stroke()
    g.setLineDash([])
  }

  function drawSpectrum() {
    const analyser =
      selected.value === 'master'
        ? getMasterAnalyser()
        : getChannelAnalysers().get(selected.value)
    if (!analyser) return
    if (!specData || specData.length !== analyser.frequencyBinCount) {
      specData = new Float32Array(analyser.frequencyBinCount)
    }
    analyser.getFloatFrequencyData(specData)
    const nyquist = (getSampleRate() ?? 48000) / 2
    const bins = specData.length

    g.beginPath()
    g.moveTo(0, H)
    for (let x = 0; x <= W; x += 2) {
      const f = FMIN * Math.pow(FMAX / FMIN, x / W)
      const bin = Math.min(bins - 1, Math.round((f / nyquist) * bins))
      const db = specData[bin] ?? SPEC_MIN_DB
      const y = ((0 - db) / (0 - SPEC_MIN_DB)) * (H - 12)
      g.lineTo(x, Math.max(0, Math.min(H - 12, y)))
    }
    g.lineTo(W, H)
    g.closePath()
    g.fillStyle = 'rgba(52, 211, 153, 0.18)'
    g.fill()
    g.strokeStyle = 'rgba(52, 211, 153, 0.7)'
    g.lineWidth = 1
    g.stroke()
  }

  function drawEqCurve() {
    if (selected.value === 'master') return
    if (!getChannelEqResponse(selected.value, respFreqs, respOut)) return
    g.beginPath()
    for (let i = 0; i < RESP_N; i++) {
      const db = 20 * Math.log10(Math.max(respOut[i]!, 1e-6))
      const y = H / 2 - (db / CURVE_DB) * (H / 2 - 8)
      const x = fToX(respFreqs[i]!)
      if (i === 0) g.moveTo(x, Math.max(2, Math.min(H - 12, y)))
      else g.lineTo(x, Math.max(2, Math.min(H - 12, y)))
    }
    g.strokeStyle = '#f59e0b'
    g.lineWidth = 2
    g.stroke()
  }

  function loop() {
    drawGrid()
    if (engineState.built) {
      drawSpectrum()
      drawEqCurve()
    } else {
      g.fillStyle = '#52525b'
      g.font = '12px system-ui, sans-serif'
      g.textAlign = 'center'
      g.fillText('Press Play to feed the analyzer', W / 2, H / 2 - 10)
    }
    raf = requestAnimationFrame(loop)
  }
  loop()
})

onUnmounted(() => cancelAnimationFrame(raf))
</script>

<template>
  <div
    class="relative w-fit max-w-[92vw] rounded-lg border border-zinc-800 bg-zinc-950/95 p-3 backdrop-blur"
  >
    <div class="mb-2 flex items-center gap-2">
      <p class="text-[10px] uppercase tracking-wide text-zinc-500">
        RTA · spectrum
      </p>
      <select
        v-model="selected"
        class="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300"
      >
        <option v-for="opt in options" :key="opt.id" :value="opt.id">
          {{ opt.label }}
        </option>
      </select>
      <p v-if="selected !== 'master'" class="ml-auto text-[10px] text-amber-500">
        — EQ curve (±{{ CURVE_DB }} dB, 0 at center line)
      </p>
    </div>
    <canvas
      ref="canvas"
      class="block"
      :style="{ width: `${W * scale}px`, height: `${H * scale}px` }"
    />
    <!-- resize handle -->
    <div
      class="absolute bottom-1 right-1 h-3 w-3 cursor-nwse-resize rounded-sm border-b-2 border-r-2 border-zinc-600 hover:border-emerald-500"
      title="Drag to resize"
      @pointerdown="onResizeDown"
      @pointermove="onResizeMove"
    />
  </div>
</template>
