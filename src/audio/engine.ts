import { reactive } from 'vue'
import type { ChannelConfig, DcaState, NumericParamKey } from '../types'
import { defaultDcas } from '../types'
import { clamp, dbToLin } from '../lib/units'
import { getInstrument, renderInstrument } from './instruments'
import { createGateNode, ensureGateModule } from './gateWorklet'

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
 * Master (PA) bus:
 *   masterFader (GainNode) → masterAnalyser (pre-limiter metering/clip tap)
 *   → SAFETY LIMITER (DynamicsCompressorNode as brickwall)
 *   → PA speaker section (per-side gain + pan from the draggable PA stacks)
 *   → destination
 *
 * Acoustic (backline) path — the band's own stage sound, console-free:
 *   srcTap → acGain (instrument loudness × distance × backline control)
 *   → acPanner (stage azimuth) → acoustic bus → analyser
 *   → its own SAFETY LIMITER → destination
 *
 * Both paths end in an always-on brickwall limiter, independent of every
 * user control.
 */

interface ChannelNodes {
  /** Pre-preamp tap: the raw source signal, also feeding other mics' bleed. */
  srcTap: GainNode
  input: GainNode
  polarity: GainNode
  hpf: BiquadFilterNode
  /** Noise gate worklet, or a pass-through GainNode when unsupported. */
  gate: AudioWorkletNode | GainNode
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
  fxSend: GainNode
  /** Acoustic (backline) path: raw source heard directly from the stage. */
  acGain: GainNode
  acPanner: StereoPannerNode
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
let fxInput: GainNode | null = null
let paSpeakerNodes: { gain: GainNode; panner: StereoPannerNode }[] = []
let acousticBus: GainNode | null = null
let acousticAnalyser: AnalyserNode | null = null
let gateAvailable = false
let dcas: DcaState[] = defaultDcas()
const channelNodes = new Map<string, ChannelNodes>()
/** Latest gate gain (linear) reported by each channel's gate worklet. */
const gateGains = new Map<string, number>()
/** Mic-bleed gains, keyed `${fromChannel}->${toChannel}`. */
const bleedGains = new Map<string, GainNode>()
/** The active monitor-feedback loop (challenge feature), if any. */
let feedbackLoop: {
  channelId: string
  bp: BiquadFilterNode
  tail: WaveShaperNode
} | null = null

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

  // PA speaker section (post-limiter): the limited mix leaves through the
  // two draggable PA stacks. Each side gets distance gain + azimuth pan
  // from its stack's stage position; defaults reproduce plain stereo.
  const paSplit = c.createChannelSplitter(2)
  limiter.connect(paSplit)
  paSpeakerNodes = [0, 1].map((side) => {
    const gain = c.createGain()
    const panner = c.createStereoPanner()
    panner.pan.value = side === 0 ? -1 : 1
    paSplit.connect(gain, side)
    gain.connect(panner)
    panner.connect(c.destination)
    return { gain, panner }
  })

  // Acoustic (backline) bus: the band's own stage sound, bypassing the
  // console entirely — with its own always-on safety limiter.
  acousticBus = c.createGain()
  acousticAnalyser = c.createAnalyser()
  acousticAnalyser.fftSize = 2048
  const acLimiter = c.createDynamicsCompressor()
  acLimiter.threshold.value = -3
  acLimiter.knee.value = 0
  acLimiter.ratio.value = 20
  acLimiter.attack.value = 0.003
  acLimiter.release.value = 0.1
  acousticBus.connect(acousticAnalyser)
  acousticAnalyser.connect(acLimiter)
  acLimiter.connect(c.destination)

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

  // FX bus: a tempo-matched feedback delay (dotted eighth at the loop's
  // 112 BPM), fed by each channel's FX send knob. Also pre-limiter.
  fxInput = c.createGain()
  const delay = c.createDelay(2)
  delay.delayTime.value = (60 / 112 / 2) * 1.5
  const feedback = c.createGain()
  feedback.gain.value = 0.35
  const damp = c.createBiquadFilter()
  damp.type = 'lowpass'
  damp.frequency.value = 3500
  const fxWet = c.createGain()
  fxWet.gain.value = 0.8
  fxInput.connect(delay)
  delay.connect(damp)
  damp.connect(fxWet)
  damp.connect(feedback)
  feedback.connect(delay)
  fxWet.connect(masterFader)
}

function buildChannel(c: AudioContext, cfg: ChannelConfig): void {
  const p = cfg.params

  const srcTap = c.createGain()

  const input = c.createGain()
  input.gain.value = dbToLin(p.gainDb)

  const polarity = c.createGain()
  polarity.gain.value = p.polarity ? -1 : 1

  const hpf = c.createBiquadFilter()
  hpf.type = 'highpass'
  hpf.frequency.value = p.hpfHz
  hpf.Q.value = 0.707

  const gate = createGateNode(c, gateAvailable)
  if (gate instanceof AudioWorkletNode) {
    gate.parameters.get('threshold')!.value = p.gateThresholdDb
    gate.parameters.get('range')!.value = p.gateRangeDb
    gate.port.onmessage = (e: MessageEvent) => {
      gateGains.set(cfg.id, e.data as number)
    }
  }

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
  const fxSend = c.createGain()
  fxSend.gain.value = p.fxSendDb <= -59 ? 0 : dbToLin(p.fxSendDb)

  // Acoustic path: raw source → level (set by the stage store) → azimuth pan.
  const acGain = c.createGain()
  acGain.gain.value = 0
  const acPanner = c.createStereoPanner()
  srcTap.connect(acGain)
  acGain.connect(acPanner)
  acPanner.connect(acousticBus!)

  srcTap.connect(input)
  input.connect(polarity)
  polarity.connect(hpf)
  hpf.connect(gate)
  gate.connect(eqLow)
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
  analyser.connect(fxSend)
  fxSend.connect(fxInput!)

  channelNodes.set(cfg.id, {
    srcTap,
    input,
    polarity,
    hpf,
    gate,
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
    fxSend,
    acGain,
    acPanner,
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
  src.connect(nodes.srcTap)
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
    gateAvailable = await ensureGateModule(c)
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
    case 'gateThresholdDb':
      if (nodes.gate instanceof AudioWorkletNode)
        ramp(nodes.gate.parameters.get('threshold')!, value)
      break
    case 'gateRangeDb':
      if (nodes.gate instanceof AudioWorkletNode)
        ramp(nodes.gate.parameters.get('range')!, value)
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
    case 'fxSendDb':
      ramp(nodes.fxSend.gain, value <= -59 ? 0 : dbToLin(value))
      break
    case 'dcaMask':
    case 'faderDb':
      // Effective level depends on mute/solo/DCA state — see updateMixGains.
      break
  }
}

/** Flip a channel's polarity (ø). Ramped through zero, so click-free. */
export function setPolarity(id: string, inverted: boolean): void {
  const nodes = channelNodes.get(id)
  if (!nodes) return
  ramp(nodes.polarity.gain, inverted ? -1 : 1)
}

/** Update the DCA group states (fader/mute per group). */
export function setDcas(next: DcaState[]): void {
  dcas = next.map((d) => ({ ...d }))
}

/**
 * Recompute every channel's effective fader gain from fader + mute + solo
 * + DCA groups. Solo on any channel silences all non-soloed channels; a
 * muted DCA silences its members; DCA faders offset member levels in dB.
 */
export function updateMixGains(configs: ChannelConfig[]): void {
  if (!engineState.built) return
  const anySolo = configs.some((cfg) => cfg.params.solo)
  for (const cfg of configs) {
    const nodes = channelNodes.get(cfg.id)
    if (!nodes) continue
    let dcaDb = 0
    let dcaMuted = false
    dcas.forEach((dca, i) => {
      if ((cfg.params.dcaMask >> i) & 1) {
        dcaDb += dca.faderDb
        dcaMuted = dcaMuted || dca.mute
      }
    })
    const audible = !cfg.params.mute && !dcaMuted && (!anySolo || cfg.params.solo)
    ramp(nodes.fader.gain, audible ? dbToLin(cfg.params.faderDb + dcaDb) : 0)
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

/** Live dynamics readouts for a channel's GR meters. */
export function getChannelDynamics(
  id: string,
): { compGrDb: number; gateGain: number } | null {
  const nodes = channelNodes.get(id)
  if (!nodes) return null
  return {
    compGrDb: nodes.comp.reduction,
    gateGain: gateGains.get(id) ?? 1,
  }
}

// Scratch buffers for getFrequencyResponse (reused across calls).
let respMag: Float32Array<ArrayBuffer> | null = null
let respPhase: Float32Array<ArrayBuffer> | null = null

/**
 * Combined magnitude response of a channel's filter section (low cut +
 * 4 EQ bands) at the given frequencies — the strip's live EQ curve.
 * Writes linear magnitudes into `out`; returns false if unavailable.
 */
export function getChannelEqResponse(
  id: string,
  freqs: Float32Array<ArrayBuffer>,
  out: Float32Array<ArrayBuffer>,
): boolean {
  const nodes = channelNodes.get(id)
  if (!nodes) return false
  if (!respMag || respMag.length !== freqs.length) {
    respMag = new Float32Array(freqs.length)
    respPhase = new Float32Array(freqs.length)
  }
  out.fill(1)
  for (const filter of [nodes.hpf, nodes.eqLow, nodes.eqLoMid, nodes.eqHiMid, nodes.eqHigh]) {
    filter.getFrequencyResponse(freqs, respMag, respPhase!)
    for (let i = 0; i < out.length; i++) out[i]! *= respMag[i]!
  }
  return true
}

// ---- mic bleed ----

/**
 * Set how much of `from`'s raw source leaks into `to`'s mic (pre-preamp,
 * so the bleed rides through the receiving channel's whole strip — gate
 * included). Gain nodes are created lazily per audible pair and ramped.
 */
export function setBleed(from: string, to: string, gain: number): void {
  const src = channelNodes.get(from)
  const dst = channelNodes.get(to)
  if (!src || !dst || !ctx) return
  const key = `${from}->${to}`
  let g = bleedGains.get(key)
  if (!g) {
    if (gain <= 0.0001) return
    g = ctx.createGain()
    g.gain.value = 0
    src.srcTap.connect(g)
    g.connect(dst.input)
    bleedGains.set(key, g)
  }
  ramp(g.gain, gain)
}

// ---- monitor feedback (challenge feature) ----

/**
 * Simulate a monitor wedge feeding back into a channel's mic: a narrow
 * bandpass + short delay + gain looped from the channel's post-fader
 * signal back into its input. When the loop gain exceeds unity at the
 * ring frequency, it howls — and cutting that frequency on the channel's
 * own EQ genuinely brings the loop back under control. A tanh soft-clip
 * bounds the loop; the master safety limiter protects ears as always.
 */
export function enableMonitorFeedback(
  channelId: string,
  freqHz: number,
  loopGainDb: number,
): void {
  disableMonitorFeedback()
  const nodes = channelNodes.get(channelId)
  if (!nodes || !ctx) return

  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = freqHz
  bp.Q.value = 12

  const delay = ctx.createDelay(0.1)
  delay.delayTime.value = 0.012

  const loopGain = ctx.createGain()
  loopGain.gain.value = dbToLin(loopGainDb)

  const clip = ctx.createWaveShaper()
  const curve = new Float32Array(1024)
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    curve[i] = 0.4 * Math.tanh(x / 0.4)
  }
  clip.curve = curve

  nodes.analyser.connect(bp)
  bp.connect(delay)
  delay.connect(loopGain)
  loopGain.connect(clip)
  clip.connect(nodes.input)

  feedbackLoop = { channelId, bp, tail: clip }
}

export function disableMonitorFeedback(): void {
  if (!feedbackLoop) return
  const nodes = channelNodes.get(feedbackLoop.channelId)
  try {
    nodes?.analyser.disconnect(feedbackLoop.bp)
    feedbackLoop.tail.disconnect()
  } catch {
    // already disconnected
  }
  feedbackLoop = null
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
 * Position one PA stack (0 = left, 1 = right): distance gain + azimuth pan
 * of the limited master mix leaving that side.
 */
export function setPaSpeaker(side: 0 | 1, s: { pan: number; gain: number }): void {
  const nodes = paSpeakerNodes[side]
  if (!nodes) return
  ramp(nodes.panner.pan, s.pan)
  ramp(nodes.gain.gain, s.gain)
}

/**
 * Set a channel's acoustic (backline) contribution at FOH: level from
 * instrument loudness × distance × the global backline control, panned by
 * the performer's stage azimuth. Bypasses the console by design.
 */
export function setAcoustic(id: string, gain: number, pan: number): void {
  const nodes = channelNodes.get(id)
  if (!nodes) return
  ramp(nodes.acGain.gain, gain)
  ramp(nodes.acPanner.pan, pan)
}

/** Analyser on the acoustic bus (for verification/metering). */
export function getAcousticAnalyser(): AnalyserNode | null {
  return acousticAnalyser
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

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__engine = {
    getMasterAnalyser,
    getChannelAnalysers,
    getAcousticAnalyser,
    getSampleRate,
    enableMonitorFeedback,
    disableMonitorFeedback,
    feedbackActive: () => feedbackLoop !== null,
  }
}
