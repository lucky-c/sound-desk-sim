/**
 * Continuous (automatable) per-channel parameters — an M32R-inspired strip:
 * preamp gain, low-cut, 4-band EQ (low shelf, two parametric mids with
 * width/Q, high shelf), full compressor (threshold/ratio/attack/release +
 * makeup), pan, and fader.
 */
export interface ChannelParams {
  /** Input (preamp) gain in dB, applied before the processing chain. */
  gainDb: number
  /** Low-cut (high-pass) frequency in Hz. */
  hpfHz: number

  /** Low shelf. */
  eqLowFreq: number
  eqLowGainDb: number
  /** Low-mid parametric bell. */
  eqLoMidFreq: number
  eqLoMidGainDb: number
  eqLoMidQ: number
  /** High-mid parametric bell. */
  eqHiMidFreq: number
  eqHiMidGainDb: number
  eqHiMidQ: number
  /** High shelf. */
  eqHighFreq: number
  eqHighGainDb: number

  /** Compressor. */
  compThresholdDb: number
  compRatio: number
  compAttackMs: number
  compReleaseMs: number
  compMakeupDb: number

  /**
   * PA pan, -1 (hard left) .. +1 (hard right) — the desk's pan knob. Works
   * on top of (and dominates) the performer's natural stage-position pan.
   */
  pan: number

  /** Channel fader in dB (post-processing, pre-master). */
  faderDb: number
  mute: boolean
  solo: boolean
}

/** Keys of the numeric (automatable) channel parameters. */
export type NumericParamKey = {
  [K in keyof ChannelParams]: ChannelParams[K] extends number ? K : never
}[keyof ChannelParams]

/** Runtime list of the numeric parameter keys (for snapshot iteration). */
export const NUMERIC_PARAM_KEYS = [
  'gainDb',
  'hpfHz',
  'eqLowFreq',
  'eqLowGainDb',
  'eqLoMidFreq',
  'eqLoMidGainDb',
  'eqLoMidQ',
  'eqHiMidFreq',
  'eqHiMidGainDb',
  'eqHiMidQ',
  'eqHighFreq',
  'eqHighGainDb',
  'compThresholdDb',
  'compRatio',
  'compAttackMs',
  'compReleaseMs',
  'compMakeupDb',
  'pan',
  'faderDb',
] as const satisfies readonly NumericParamKey[]

/** Neutral strip settings — how an unplugged/new channel comes up. */
export function neutralParams(): ChannelParams {
  return {
    gainDb: 0,
    hpfHz: 20,
    eqLowFreq: 100,
    eqLowGainDb: 0,
    eqLoMidFreq: 400,
    eqLoMidGainDb: 0,
    eqLoMidQ: 1,
    eqHiMidFreq: 2500,
    eqHiMidGainDb: 0,
    eqHiMidQ: 1,
    eqHighFreq: 8000,
    eqHighGainDb: 0,
    compThresholdDb: -24,
    compRatio: 2,
    compAttackMs: 10,
    compReleaseMs: 150,
    compMakeupDb: 0,
    pan: 0,
    faderDb: -8,
    mute: false,
    solo: false,
  }
}

/**
 * A console channel: a fixed slot (like a desk's channel number) that an
 * instrument can be plugged into. `name`/`color` mirror the plugged
 * instrument (or a neutral placeholder when empty).
 */
export interface ChannelConfig {
  /** Slot id, 'ch01'..'ch16'. */
  id: string
  /** 1-based channel number. */
  num: number
  /** Plugged instrument id from the library, or null when empty. */
  instrumentId: string | null
  name: string
  color: string
  params: ChannelParams
}

export interface MasterState {
  faderDb: number
}

export interface TransportState {
  playing: boolean
  looping: boolean
}

/**
 * A plain-data snapshot of every mix parameter, keyed by channel id.
 * Used by the challenge layer for A/B comparison and validation —
 * always restored through the store's ramped setters, never applied
 * to AudioParams directly.
 */
export interface MixSnapshot {
  channels: Record<string, ChannelParams>
  master: MasterState
}
