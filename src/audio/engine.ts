import { reactive } from 'vue'
import type { ChannelConfig, NumericParamKey } from '../types'
import { dbToLin } from '../lib/units'
import { renderSynthStem } from './synthStems'

/**
 * The audio engine: one shared AudioContext and the full node graph.
 *
 * Per-channel chain (built-in nodes only, strictly in this order):
 *   GainNode (input) → BiquadFilterNode (highpass) → BiquadFilterNode (peaking)
 *   → DynamicsCompressorNode → GainNode (fader) → master bus
 *
 * Master bus:
 *   masterFader (GainNode) → masterAnalyser (pre-limiter metering/clip tap)
 *   → SAFETY LIMITER (DynamicsCompressorNode as brickwall) → destination
 *
 * The limiter is always on and independent of every user control — it exists
 * to protect hearing, not to sound good.
 *
 * Phase 3 note: custom AudioWorklet DSP will later be inserted between the
 * peaking EQ and the compressor (see README roadmap); the chain is built in
 * one place (buildChannel) precisely so that insertion is a one-line change.
 */

interface ChannelNodes {
  input: GainNode
  hpf: BiquadFilterNode
  eq: BiquadFilterNode
  comp: DynamicsCompressorNode
  fader: GainNode
  analyser: AnalyserNode
  buffer: AudioBuffer | null
  source: AudioBufferSourceNode | null
}

/** Time constant for all user-driven parameter ramps (avoids zipper noise). */
const RAMP_TC = 0.02

let ctx: AudioContext | null = null
let masterFader: GainNode | null = null
let masterAnalyser: AnalyserNode | null = null
let limiter: DynamicsCompressorNode | null = null
const channelNodes = new Map<string, ChannelNodes>()

let buffersLoaded = false
let sourcesActive = false
let stoppingManually = false
let onAllEnded: (() => void) | null = null

/** Reactive engine info for the UI (read-only outside this module). */
export const engineState = reactive({
  built: false,
  /** Per channel id: did we load a real file or fall back to synth? */
  stemSources: {} as Record<string, 'file' | 'synth'>,
})

function ensureContext(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  return ctx
}

/** Smoothly move an AudioParam — never assign .value for user-driven changes. */
function ramp(param: AudioParam, value: number): void {
  const c = ensureContext()
  param.setTargetAtTime(value, c.currentTime, RAMP_TC)
}

function buildMaster(c: AudioContext): void {
  masterFader = c.createGain()

  masterAnalyser = c.createAnalyser()
  masterAnalyser.fftSize = 2048

  limiter = c.createDynamicsCompressor()
  limiter.threshold.value = -3
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.003
  limiter.release.value = 0.1

  masterFader.connect(masterAnalyser)
  masterAnalyser.connect(limiter)
  limiter.connect(c.destination)
}

function buildChannel(c: AudioContext, cfg: ChannelConfig): void {
  const p = cfg.params

  const input = c.createGain()
  input.gain.value = dbToLin(p.gainDb)

  const hpf = c.createBiquadFilter()
  hpf.type = 'highpass'
  hpf.frequency.value = p.hpfHz
  hpf.Q.value = 0.707

  const eq = c.createBiquadFilter()
  eq.type = 'peaking'
  eq.frequency.value = p.eqHz
  eq.gain.value = p.eqGainDb
  eq.Q.value = 1.0

  const comp = c.createDynamicsCompressor()
  comp.threshold.value = p.compThresholdDb
  comp.ratio.value = p.compRatio
  comp.knee.value = 6
  comp.attack.value = 0.005
  comp.release.value = 0.15

  const fader = c.createGain()
  fader.gain.value = dbToLin(p.faderDb)

  const analyser = c.createAnalyser()
  analyser.fftSize = 2048

  input.connect(hpf)
  hpf.connect(eq)
  eq.connect(comp)
  comp.connect(fader)
  fader.connect(analyser)
  analyser.connect(masterFader!)

  channelNodes.set(cfg.id, {
    input,
    hpf,
    eq,
    comp,
    fader,
    analyser,
    buffer: null,
    source: null,
  })
}

/** Try real files from /public/stems/ first; fall back to the synth stem. */
async function loadBuffer(c: AudioContext, cfg: ChannelConfig): Promise<AudioBuffer> {
  for (const file of cfg.source.files) {
    try {
      const res = await fetch(`/stems/${file}`)
      const type = res.headers.get('content-type') ?? ''
      if (!res.ok || type.includes('text/html')) continue
      const bytes = await res.arrayBuffer()
      const buf = await c.decodeAudioData(bytes)
      engineState.stemSources[cfg.id] = 'file'
      return buf
    } catch {
      // Missing or undecodable — try the next candidate.
    }
  }
  engineState.stemSources[cfg.id] = 'synth'
  // Never hardcode a sample rate: render at whatever the live context runs at.
  return renderSynthStem(cfg.source.synth, c.sampleRate)
}

async function loadAllBuffers(c: AudioContext, configs: ChannelConfig[]): Promise<void> {
  const buffers = await Promise.all(configs.map((cfg) => loadBuffer(c, cfg)))
  configs.forEach((cfg, i) => {
    const nodes = channelNodes.get(cfg.id)
    if (nodes) nodes.buffer = buffers[i] ?? null
  })
  buffersLoaded = true
}

function startSources(c: AudioContext, looping: boolean): void {
  stoppingManually = false
  const startAt = c.currentTime + 0.05 // one shared start time keeps stems in sync
  let live = 0

  for (const nodes of channelNodes.values()) {
    if (!nodes.buffer) continue
    const src = c.createBufferSource()
    src.buffer = nodes.buffer
    src.loop = looping
    src.connect(nodes.input)
    src.onended = () => {
      live--
      if (live === 0 && !stoppingManually) {
        sourcesActive = false
        onAllEnded?.()
      }
    }
    src.start(startAt)
    nodes.source = src
    live++
  }
  sourcesActive = live > 0
}

/**
 * Start (or resume) playback. MUST be called from a user gesture handler —
 * this is where the suspended AudioContext gets resumed.
 */
export async function startPlayback(
  configs: ChannelConfig[],
  masterFaderDb: number,
  looping: boolean,
  handleAllEnded: () => void,
): Promise<void> {
  const c = ensureContext()
  onAllEnded = handleAllEnded
  await c.resume()

  if (!engineState.built) {
    buildMaster(c)
    for (const cfg of configs) buildChannel(c, cfg)
    masterFader!.gain.value = dbToLin(masterFaderDb)
    engineState.built = true
    updateMixGains(configs)
  }

  if (!buffersLoaded) await loadAllBuffers(c, configs)
  if (!sourcesActive) startSources(c, looping)
}

/** Pause by suspending the context — cheap, and playback position is kept. */
export async function pause(): Promise<void> {
  if (ctx) await ctx.suspend()
}

export function setLooping(looping: boolean): void {
  for (const nodes of channelNodes.values()) {
    if (nodes.source) nodes.source.loop = looping
  }
}

/** Route a continuous parameter change to its AudioParam (smoothed). */
export function setChannelParam(id: string, key: NumericParamKey, value: number): void {
  const nodes = channelNodes.get(id)
  if (!nodes) return
  switch (key) {
    case 'gainDb':
      ramp(nodes.input.gain, dbToLin(value))
      break
    case 'hpfHz':
      ramp(nodes.hpf.frequency, value)
      break
    case 'eqHz':
      ramp(nodes.eq.frequency, value)
      break
    case 'eqGainDb':
      ramp(nodes.eq.gain, value)
      break
    case 'compThresholdDb':
      ramp(nodes.comp.threshold, value)
      break
    case 'compRatio':
      ramp(nodes.comp.ratio, value)
      break
    case 'faderDb':
      // Fader level depends on mute/solo state — handled by updateMixGains.
      break
  }
}

/**
 * Recompute every channel's effective fader gain from fader + mute + solo.
 * Solo on any channel silences all non-soloed channels.
 */
export function updateMixGains(configs: ChannelConfig[]): void {
  if (!engineState.built) return
  const anySolo = configs.some((cfg) => cfg.params.solo)
  for (const cfg of configs) {
    const nodes = channelNodes.get(cfg.id)
    if (!nodes) continue
    const audible = !cfg.params.mute && (!anySolo || cfg.params.solo)
    ramp(nodes.fader.gain, audible ? dbToLin(cfg.params.faderDb) : 0)
  }
}

export function setMasterFaderDb(db: number): void {
  if (masterFader) ramp(masterFader.gain, dbToLin(db))
}

/** Metering taps for the rAF meter loop. */
export function getChannelAnalysers(): ReadonlyMap<string, AnalyserNode> {
  const map = new Map<string, AnalyserNode>()
  for (const [id, nodes] of channelNodes) map.set(id, nodes.analyser)
  return map
}

export function getMasterAnalyser(): AnalyserNode | null {
  return masterAnalyser
}

/** Current limiter gain reduction in dB (negative = limiting). */
export function getLimiterReductionDb(): number {
  return limiter ? limiter.reduction : 0
}
