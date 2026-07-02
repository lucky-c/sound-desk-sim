import { onMounted, onUnmounted, reactive } from 'vue'
import {
  engineState,
  getChannelAnalysers,
  getLimiterReductionDb,
  getMasterAnalyser,
} from '../audio/engine'

export interface Level {
  /** Linear peak amplitude of the last analysis frame (0..~1). */
  peak: number
}

interface MeterState {
  channels: Record<string, Level>
  master: Level & { reductionDb: number; clip: boolean }
}

/** Peak level approaching 0 dBFS pre-limiter counts as a clip. */
const CLIP_THRESHOLD = 0.99
const CLIP_HOLD_MS = 1500

const meters = reactive<MeterState>({
  channels: {},
  master: { peak: 0, reductionDb: 0, clip: false },
})

const scratch = new Map<AnalyserNode, Float32Array<ArrayBuffer>>()
let rafId = 0
let consumers = 0
let clipUntil = 0

function peakOf(analyser: AnalyserNode): number {
  let buf = scratch.get(analyser)
  if (!buf || buf.length !== analyser.fftSize) {
    buf = new Float32Array(analyser.fftSize)
    scratch.set(analyser, buf)
  }
  analyser.getFloatTimeDomainData(buf)
  let peak = 0
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i] ?? 0)
    if (v > peak) peak = v
  }
  return peak
}

function tick(): void {
  if (engineState.built) {
    for (const [id, analyser] of getChannelAnalysers()) {
      const level = meters.channels[id] ?? (meters.channels[id] = { peak: 0 })
      level.peak = peakOf(analyser)
    }
    const master = getMasterAnalyser()
    if (master) {
      meters.master.peak = peakOf(master)
      meters.master.reductionDb = getLimiterReductionDb()
      const now = performance.now()
      if (meters.master.peak >= CLIP_THRESHOLD) clipUntil = now + CLIP_HOLD_MS
      meters.master.clip = now < clipUntil
    }
  }
  rafId = requestAnimationFrame(tick)
}

/**
 * Reactive VU/peak levels driven by a single shared requestAnimationFrame
 * loop reading the engine's AnalyserNodes.
 */
export function useMeters(): MeterState {
  onMounted(() => {
    if (consumers++ === 0) rafId = requestAnimationFrame(tick)
  })
  onUnmounted(() => {
    if (--consumers === 0) cancelAnimationFrame(rafId)
  })
  return meters
}
