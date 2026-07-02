/** The three built-in synthesized stems. */
export type SynthStem = 'kick' | 'bass' | 'pad'

/**
 * Where a channel's audio comes from.
 * `files` lists candidate paths under /public/stems/ tried in order;
 * if none loads/decodes, the engine falls back to the synthesized stem.
 */
export interface ChannelSource {
  synth: SynthStem
  files: string[]
}

/** Continuous (automatable) per-channel parameters. */
export interface ChannelParams {
  /** Input gain in dB, applied before the processing chain. */
  gainDb: number
  /** High-pass filter cutoff in Hz. */
  hpfHz: number
  /** Peaking EQ center frequency in Hz. */
  eqHz: number
  /** Peaking EQ boost/cut in dB. */
  eqGainDb: number
  /** Compressor threshold in dB. */
  compThresholdDb: number
  /** Compressor ratio (1 = off, 20 = near-limiting). */
  compRatio: number
  /** Channel fader in dB (post-processing, pre-master). */
  faderDb: number
  mute: boolean
  solo: boolean
}

/** Keys of the numeric (automatable) channel parameters. */
export type NumericParamKey = {
  [K in keyof ChannelParams]: ChannelParams[K] extends number ? K : never
}[keyof ChannelParams]

/** A full channel definition — the store holds an array of these. */
export interface ChannelConfig {
  id: string
  name: string
  /** Tailwind-compatible accent color (hex) used in the UI. */
  color: string
  source: ChannelSource
  params: ChannelParams
}

export interface MasterState {
  faderDb: number
}

export interface TransportState {
  playing: boolean
  looping: boolean
}
