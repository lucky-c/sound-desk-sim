import { defineStore } from 'pinia'
import type {
  ChannelConfig,
  MasterState,
  MixSnapshot,
  NumericParamKey,
  TransportState,
} from '../types'
import { NUMERIC_PARAM_KEYS } from '../types'
import * as engine from '../audio/engine'

/**
 * Single source of truth for every audio parameter. Components mutate ONLY
 * through these actions; each action mirrors the change into the engine,
 * which applies it with AudioParam automation.
 *
 * Channels are data: add an entry here and the mixer grows a strip —
 * no component changes needed.
 */
function defaultChannels(): ChannelConfig[] {
  return [
    {
      id: 'kick',
      name: 'Kick',
      color: '#f59e0b',
      source: { synth: 'kick', files: ['kick.wav', 'kick.mp3'] },
      params: {
        gainDb: 0,
        hpfHz: 30,
        eqHz: 80,
        eqGainDb: 0,
        compThresholdDb: -18,
        compRatio: 4,
        faderDb: -6,
        mute: false,
        solo: false,
      },
    },
    {
      id: 'bass',
      name: 'Bass',
      color: '#22d3ee',
      source: { synth: 'bass', files: ['bass.wav', 'bass.mp3'] },
      params: {
        gainDb: 0,
        hpfHz: 40,
        eqHz: 250,
        eqGainDb: 0,
        compThresholdDb: -24,
        compRatio: 4,
        faderDb: -8,
        mute: false,
        solo: false,
      },
    },
    {
      id: 'pad',
      name: 'Pad / Vox',
      color: '#a78bfa',
      source: { synth: 'pad', files: ['pad.wav', 'pad.mp3'] },
      params: {
        gainDb: 0,
        hpfHz: 150,
        eqHz: 2000,
        eqGainDb: 0,
        compThresholdDb: -30,
        compRatio: 3,
        faderDb: -10,
        mute: false,
        solo: false,
      },
    },
  ]
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
  },

  actions: {
    channel(id: string): ChannelConfig | undefined {
      return this.channels.find((ch) => ch.id === id)
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
