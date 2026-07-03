import { reactive } from 'vue'
import type { ChannelConfig, NumericParamKey } from '../types'
import { clamp, dbToLin } from '../lib/units'
import { getInstrument, renderInstrument } from './instruments'

/**
 * The audio engine: one shared AudioContext and the full node graph.
 *
 * Per-channel chain (built-in nodes only, M32R-inspired strip order):
 *   GainNode (input) → BiquadFilter (low-cut) → BiquadFilter (low shelf)
 *   → BiquadFilter (lo-mid bell) → BiquadFilter (hi-mid bell)
 *   → BiquadFilter (high shelf) → DynamicsCompressor → GainNode (makeup)
 *   → GainNode (fader) → spatial section → master bus
 *
 * Spatial section (stage positioning + the desk's pan knob):
 *   analyser → StereoPannerNode (knob pan + stage pan) → GainNode (distance)
 *   → master bus                                                       [dry]
 *   analyser → GainNode (reverb send) → shared room bus                [wet]
 *   room bus: GainNode → ConvolverNode (synthesized IR) → GainNode (wet)
 *   → master bus
 *
 * Master bus:
 *   masterFader (GainNode) → masterAnalyser (pre-limiter metering/clip tap)
 *   → SAFETY LIMITER (DynamicsCompressorNode as brickwall) → destination
 *
 * The limiter is always on and independent of every user control.
 */

interface ChannelNodes {
  input: GainNode
  hpf: BiquadFilterNode
  eqLow: BiquadFilterNode
  eqLoMid: BiquadFilterNode
  eqHiMid: BiquadFilterNode
  eqHigh: BiquadFilterNode
  comp: DynamicsCompressorNode
  makeup: GainNode
  fader: GainNode
  analyser: AnalyserNode
  panner: StereoPannerNode
  dryGain: GainNode
  sendGain: GainNode
  /** Desk pan knob and stage-position pan, combined into panner.pan. */
  knobPan: number
  stagePan: number
  buffer: AudioBuffer | null
  source: AudioBufferSourceNode | null
}

/** Time constant for all user-driven parameter ramps (avoids zipper noise). */
const RAMP_TC = 0.02
/** How strongly the performer's stage position pans, under the knob. */
const STAGE_PAN_WEIGHT = 0.6

let ctx: AudioContext | null = null
let masterFader: GainNode | null = null
let masterAnalyser: AnalyserNode | null = null
let limiter: DynamicsCompressorNode | null = null
let reverbInput: GainNode | null = null
let convolver: ConvolverNode | null = null
let reverbWet: GainNode | null = null
let currentWet = 0
const channelNodes = new Map<string, ChannelNodes>()

let sourcesActive = false
let looping = true
let loopStartedAt = 0
const liveSources = new Set<AudioBufferSourceNode>()
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

  // Shared room-reverb bus. Feeds the master PRE-limiter, so the safety
  // limiter also protects against reverb build-up. Silent until a room
  // impulse response is applied (setRoom).
  reverbInput = c.createGain()
  convolver = c.createConvolver()
  reverbWet = c.createGain()
  reverbWet.gain.value = 0
  reverbInput.connect(convolver)
  convolver.connect(reverbWet)
  reverbWet.connect(masterFader)
}

function buildChannel(c: AudioContext, cfg: ChannelConfig): void {
  const p = cfg.params

  const input = c.createGain()
  input.gain.value = dbToLin(p.gainDb)

  const hpf = c.createBiquadFilter()
  hpf.type = 'highpass'
  hpf.frequency.value = p.hpfHz
  hpf.Q.value = 0.707

  const eqLow = c.createBiquadFilter()
  eqLow.type = 'lowshelf'
  eqLow.frequency.value = p.eqLowFreq
  eqLow.gain.value = p.eqLowGainDb

  const eqLoMid = c.createBiquadFilter()
  eqLoMid.type = 'peaking'
  eqLoMid.frequency.value = p.eqLoMidFreq
  eqLoMid.gain.value = p.eqLoMidGainDb
  eqLoMid.Q.value = p.eqLoMidQ

  const eqHiMid = c.createBiquadFilter()
  eqHiMid.type = 'peaking'
  eqHiMid.frequency.value = p.eqHiMidFreq
  eqHiMid.gain.value = p.eqHiMidGainDb
  eqHiMid.Q.value = p.eqHiMidQ

  const eqHigh = c.createBiquadFilter()
  eqHigh.type = 'highshelf'
  eqHigh.frequency.value = p.eqHighFreq
  eqHigh.gain.value = p.eqHighGainDb

  const comp = c.createDynamicsCompressor()
  comp.threshold.value = p.compThresholdDb
  comp.ratio.value = p.compRatio
  comp.knee.value = 6
  comp.attack.value = p.compAttackMs / 1000
  comp.release.value = p.compReleaseMs / 1000

  const makeup = c.createGain()
  makeup.gain.value = dbToLin(p.compMakeupDb)

  const fader = c.createGain()
  fader.gain.value = dbToLin(p.faderDb)

  const analyser = c.createAnalyser()
  analyser.fftSize = 2048

  const panner = c.createStereoPanner()
  panner.pan.value = clamp(p.pan, -1, 1)
  const dryGain = c.createGain()
  const sendGain = c.createGain()
  sendGain.gain.value = 0

  input.connect(hpf)
  hpf.connect(eqLow)
  eqLow.connect(eqLoMid)
  eqLoMid.connect(eqHiMid)
  eqHiMid.connect(eqHigh)
  eqHigh.connect(comp)
  comp.connect(makeup)
  makeup.connect(fader)
  fader.connect(analyser)
  analyser.connect(panner)
  panner.connect(dryGain)
  dryGain.connect(masterFader!)
  analyser.connect(sendGain)
  sendGain.connect(reverbInput!)

  channelNodes.set(cfg.id, {
    input,
    hpf,
    eqLow,
    eqLoMid,
    eqHiMid,
    eqHigh,
    comp,
    makeup,
    fader,
    analyser,
    panner,
    dryGain,
    sendGain,
    knobPan: p.pan,
    stagePan: 0,
    buffer: null,
    source: null,
  })
}

/** Combine the desk pan knob with the (weaker) stage-position pan. */
function applyPan(nodes: ChannelNodes): void {
  ramp(nodes.panner.pan, clamp(nodes.knobPan + nodes.stagePan * STAGE_PAN_WEIGHT, -1, 1))
}

/** Try real files from /public/stems/ first; fall back to the synth build. */
async function loadBuffer(c: AudioContext, instrumentId: string): Promise<AudioBuffer | null> {
  for (const ext of ['wav', 'mp3']) {
    try {
      const res = await fetch(`/stems/${instrumentId}.${ext}`)
      const type = res.headers.get('content-type') ?? ''
      if (!res.ok || type.includes('text/html')) continue
      const bytes = await res.arrayBuffer()
      return await c.decodeAudioData(bytes)
    } catch {
      // Missing or undecodable — try the next candidate.
    }
  }
  return null
}

async function loadChannelBuffer(c: AudioContext, cfg: ChannelConfig): Promise<void> {
  const nodes = channelNodes.get(cfg.id)
  if (!nodes || !cfg.instrumentId) return
  const fileBuf = await loadBuffer(c, cfg.instrumentId)
  if (fileBuf) {
    nodes.buffer = fileBuf
    engineState.stemSources[cfg.id] = 'file'
  } else {
    // Never hardcode a sample rate: render at whatever the live context runs at.
    nodes.buffer = await renderInstrument(cfg.instrumentId, c.sampleRate)
    engineState.stemSources[cfg.id] = 'synth'
  }
}

function startSource(c: AudioContext, nodes: ChannelNodes, when: number, offset: number): void {
  if (!nodes.buffer) return
  const src = c.createBufferSource()
  src.buffer = nodes.buffer
  src.loop = looping
  src.connect(nodes.input)
  src.onended = () => {
    liveSources.delete(src)
    if (nodes.source === src) nodes.source = null
    if (liveSources.size === 0) {
      sourcesActive = false
      onAllEnded?.()
    }
  }
  src.start(when, offset % nodes.buffer.duration)
  nodes.source = src
  liveSources.add(src)
}

function startAllSources(c: AudioContext): void {
  loopStartedAt = c.currentTime + 0.05 // one shared start time keeps stems in sync
  for (const nodes of channelNodes.values()) {
    if (nodes.buffer) startSource(c, nodes, loopStartedAt, 0)
  }
  sourcesActive = liveSources.size > 0
}

/** Stop one channel's source without triggering the all-ended callback. */
function stopSource(nodes: ChannelNodes): void {
  if (!nodes.source) return
  const src = nodes.source
  src.onended = null
  liveSources.delete(src)
  try {
    src.stop()
  } catch {
    // never started / already stopped
  }
  nodes.source = null
}

/**
 * Start (or resume) playback. MUST be called from a user gesture handler —
 * this is where the suspended AudioContext gets resumed.
 */
export async function startPlayback(
  configs: ChannelConfig[],
  masterFaderDb: number,
  loop: boolean,
  handleAllEnded: () => void,
): Promise<void> {
  const c = ensureContext()
  onAllEnded = handleAllEnded
  looping = loop
  await c.resume()

  if (!engineState.built) {
    buildMaster(c)
    for (const cfg of configs) buildChannel(c, cfg)
    masterFader!.gain.value = dbToLin(masterFaderDb)
    engineState.built = true
    updateMixGains(configs)
  }

  const missing = configs.filter(
    (cfg) => cfg.instrumentId && !channelNodes.get(cfg.id)?.buffer,
  )
  if (missing.length > 0) {
    await Promise.all(missing.map((cfg) => loadChannelBuffer(c, cfg)))
  }
  if (!sourcesActive) startAllSources(c)
}

/** Pause by suspending the context — cheap, and playback position is kept. */
export async function pause(): Promise<void> {
  if (ctx) await ctx.suspend()
}

export function setLooping(loop: boolean): void {
  looping = loop
  for (const nodes of channelNodes.values()) {
    if (nodes.source) nodes.source.loop = loop
  }
}

/**
 * Plug an instrument into a channel (or unplug with null). If playback is
 * running, the new source starts loop-aligned with everything else.
 */
export async function plugChannel(
  channelId: string,
  instrumentId: string | null,
): Promise<void> {
  const nodes = channelNodes.get(channelId)
  if (!nodes || !engineState.built || !ctx) return
  stopSource(nodes)
  nodes.buffer = null
  delete engineState.stemSources[channelId]
  if (!instrumentId || !getInstrument(instrumentId)) return

  const cfg = { id: channelId, instrumentId } as ChannelConfig
  await loadChannelBuffer(ctx, cfg)
  // Someone re-plugged while we were rendering — that call wins.
  if (!nodes.buffer) return
  if (sourcesActive) {
    const offset = Math.max(0, ctx.currentTime - loopStartedAt)
    startSource(ctx, nodes, ctx.currentTime, offset)
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
    case 'eqLowFreq':
      ramp(nodes.eqLow.frequency, value)
      break
    case 'eqLowGainDb':
      ramp(nodes.eqLow.gain, value)
      break
    case 'eqLoMidFreq':
      ramp(nodes.eqLoMid.frequency, value)
      break
    case 'eqLoMidGainDb':
      ramp(nodes.eqLoMid.gain, value)
      break
    case 'eqLoMidQ':
      ramp(nodes.eqLoMid.Q, value)
      break
    case 'eqHiMidFreq':
      ramp(nodes.eqHiMid.frequency, value)
      break
    case 'eqHiMidGainDb':
      ramp(nodes.eqHiMid.gain, value)
      break
    case 'eqHiMidQ':
      ramp(nodes.eqHiMid.Q, value)
      break
    case 'eqHighFreq':
      ramp(nodes.eqHigh.frequency, value)
      break
    case 'eqHighGainDb':
      ramp(nodes.eqHigh.gain, value)
      break
    case 'compThresholdDb':
      ramp(nodes.comp.threshold, value)
      break
    case 'compRatio':
      ramp(nodes.comp.ratio, value)
      break
    case 'compAttackMs':
      ramp(nodes.comp.attack, value / 1000)
      break
    case 'compReleaseMs':
      ramp(nodes.comp.release, value / 1000)
      break
    case 'compMakeupDb':
      ramp(nodes.makeup.gain, dbToLin(value))
      break
    case 'pan':
      nodes.knobPan = clamp(value, -1, 1)
      applyPan(nodes)
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

// ---- stage spatialization ----

/** Sample rate of the live context (for offline IR rendering), if built. */
export function getSampleRate(): number | null {
  return ctx ? ctx.sampleRate : null
}

/** Apply a channel's stage position as pan / distance / reverb-send (smoothed). */
export function setSpatial(
  id: string,
  s: { pan: number; dry: number; send: number },
): void {
  const nodes = channelNodes.get(id)
  if (!nodes) return
  nodes.stagePan = s.pan
  applyPan(nodes)
  ramp(nodes.dryGain.gain, s.dry)
  ramp(nodes.sendGain.gain, s.send)
}

/**
 * Swap the room impulse response. The wet gain is ducked around the buffer
 * swap (a ConvolverNode buffer change is instantaneous) to avoid a click.
 */
export function setRoom(ir: AudioBuffer, wet: number): void {
  if (!ctx || !convolver || !reverbWet) return
  currentWet = wet
  reverbWet.gain.setTargetAtTime(0, ctx.currentTime, 0.01)
  setTimeout(() => {
    if (!ctx || !convolver || !reverbWet) return
    convolver.buffer = ir
    reverbWet.gain.setTargetAtTime(currentWet, ctx.currentTime, 0.05)
  }, 60)
}
