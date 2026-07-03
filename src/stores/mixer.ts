import { defineStore } from 'pinia'
import type {
  ChannelConfig,
  ChannelParams,
  MasterState,
  MixSnapshot,
  NumericParamKey,
  TransportState,
} from '../types'
import { NUMERIC_PARAM_KEYS, neutralParams } from '../types'
import { getInstrument } from '../audio/instruments'
import * as engine from '../audio/engine'

/**
 * Single source of truth for every audio parameter. Components mutate ONLY
 * through these actions; each action mirrors the change into the engine,
 * which applies it with AudioParam automation.
 *
 * The console has 16 fixed channel slots (M32R-style). Channels 1–4 come
 * pre-plugged; the rest are empty until the user plugs an instrument.
 */

export const CHANNEL_COUNT = 16

export const DEFAULT_PLUGGING: Record<string, string> = {
  ch01: 'kick',
  ch02: 'snare',
  ch03: 'bass',
  ch04: 'keys',
}

/** Strip presets for the default-plugged channels. */
const DEFAULT_PARAM_TWEAKS: Record<string, Partial<ChannelParams>> = {
  ch01: { hpfHz: 25, compThresholdDb: -18, compRatio: 4, faderDb: -6 },
  ch02: { hpfHz: 80, compThresholdDb: -22, compRatio: 3, faderDb: -9 },
  ch03: { hpfHz: 30, compThresholdDb: -24, compRatio: 4, faderDb: -8 },
  ch04: { hpfHz: 100, faderDb: -10 },
}

function slotId(num: number): string {
  return `ch${String(num).padStart(2, '0')}`
}

function defaultChannels(): ChannelConfig[] {
  return Array.from({ length: CHANNEL_COUNT }, (_, i) => {
    const num = i + 1
    const id = slotId(num)
    const instrumentId = DEFAULT_PLUGGING[id] ?? null
    const inst = getInstrument(instrumentId)
    return {
      id,
      num,
      instrumentId,
      name: inst ? inst.name : `Ch ${num}`,
      color: inst ? inst.color : '#71717a',
      params: { ...neutralParams(), ...DEFAULT_PARAM_TWEAKS[id] },
    }
  })
}

/** The out-of-the-box mix as a snapshot — the base challenges build on. */
export function defaultMixSnapshot(): MixSnapshot {
  return {
    channels: Object.fromEntries(
      defaultChannels().map((ch) => [ch.id, { ...ch.params }]),
    ),
    master: { faderDb: 0 },
  }
}

interface MixerState {
  channels: ChannelConfig[]
  master: MasterState
  transport: TransportState
}

export const useMixerStore = defineStore('mixer', {
  state: (): MixerState => ({
    channels: defaultChannels(),
    master: { faderDb: 0 },
    transport: { playing: false, looping: true },
  }),

  getters: {
    anySolo: (state) => state.channels.some((ch) => ch.params.solo),
    pluggedChannels: (state) => state.channels.filter((ch) => ch.instrumentId),
    usedInstrumentIds: (state) =>
      new Set(state.channels.map((ch) => ch.instrumentId).filter(Boolean) as string[]),
  },

  actions: {
    channel(id: string): ChannelConfig | undefined {
      return this.channels.find((ch) => ch.id === id)
    },

    /** Plug an instrument into a slot (null unplugs). One channel per instrument. */
    plugInstrument(channelId: string, instrumentId: string | null) {
      const ch = this.channel(channelId)
      if (!ch) return
      if (
        instrumentId &&
        this.channels.some((c) => c.id !== channelId && c.instrumentId === instrumentId)
      ) {
        return // already plugged elsewhere
      }
      const inst = getInstrument(instrumentId)
      ch.instrumentId = inst ? inst.id : null
      ch.name = inst ? inst.name : `Ch ${ch.num}`
      ch.color = inst ? inst.color : '#71717a'
      void engine.plugChannel(channelId, ch.instrumentId)
    },

    /** Current plugging as plain data (for save/restore around challenges). */
    plugMap(): Record<string, string | null> {
      return Object.fromEntries(this.channels.map((ch) => [ch.id, ch.instrumentId]))
    },

    applyPlugMap(map: Record<string, string | null>) {
      for (const ch of this.channels) {
        const want = map[ch.id] ?? null
        if (ch.instrumentId !== want) this.plugInstrument(ch.id, want)
      }
    },

    resetPluggingToDefault() {
      this.applyPlugMap(DEFAULT_PLUGGING)
    },

    setParam(id: string, key: NumericParamKey, value: number) {
      const ch = this.channel(id)
      if (!ch) return
      ch.params[key] = value
      if (key === 'faderDb') {
        engine.updateMixGains(this.channels)
      } else {
        engine.setChannelParam(id, key, value)
      }
    },

    toggleMute(id: string) {
      const ch = this.channel(id)
      if (!ch) return
      ch.params.mute = !ch.params.mute
      engine.updateMixGains(this.channels)
    },

    toggleSolo(id: string) {
      const ch = this.channel(id)
      if (!ch) return
      ch.params.solo = !ch.params.solo
      engine.updateMixGains(this.channels)
    },

    setMasterFader(db: number) {
      this.master.faderDb = db
      engine.setMasterFaderDb(db)
    },

    /** The Play gesture — this is what resumes the suspended AudioContext. */
    async play() {
      this.transport.playing = true
      await engine.startPlayback(
        this.channels,
        this.master.faderDb,
        this.transport.looping,
        () => {
          // All (non-looping) sources reached their end.
          this.transport.playing = false
        },
      )
    },

    async pause() {
      this.transport.playing = false
      await engine.pause()
    },

    toggleLoop() {
      this.transport.looping = !this.transport.looping
      engine.setLooping(this.transport.looping)
    },

    /** Plain-data copy of every mix parameter (for A/B and validation). */
    snapshot(): MixSnapshot {
      return {
        channels: Object.fromEntries(
          this.channels.map((ch) => [ch.id, { ...ch.params }]),
        ),
        master: { ...this.master },
      }
    },

    /**
     * Restore a snapshot entirely through the existing ramped setters —
     * smooth transitions, no graph teardown.
     */
    applySnapshot(snap: MixSnapshot) {
      for (const ch of this.channels) {
        const params = snap.channels[ch.id]
        if (!params) continue
        for (const key of NUMERIC_PARAM_KEYS) {
          if (ch.params[key] !== params[key]) this.setParam(ch.id, key, params[key])
        }
        if (ch.params.mute !== params.mute) this.toggleMute(ch.id)
        if (ch.params.solo !== params.solo) this.toggleSolo(ch.id)
      }
      this.setMasterFader(snap.master.faderDb)
    },
  },
})
