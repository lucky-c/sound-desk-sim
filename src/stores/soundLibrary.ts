import { defineStore } from 'pinia'
import {
  addUserSound,
  deleteUserSound,
  loadUserSounds,
  type UserSound,
} from '../audio/soundLibrary'
import { useMixerStore } from './mixer'

/**
 * Reactive view of the user's uploaded sounds. The audio-level module owns
 * IndexedDB persistence and the synchronous registry the engine reads; this
 * store just keeps a reactive copy for the picker and library panel.
 */
export const useSoundLibraryStore = defineStore('soundLibrary', {
  state: () => ({
    sounds: [] as UserSound[],
    loaded: false,
  }),

  actions: {
    /** Load persisted uploads once, at startup. */
    async init() {
      if (this.loaded) return
      this.sounds = await loadUserSounds()
      this.loaded = true
    },

    async add(input: { name: string; beats: number; file: File }) {
      const sound = await addUserSound(input)
      this.sounds = [...this.sounds, sound].sort((a, b) => a.name.localeCompare(b.name))
      return sound
    },

    async remove(id: string) {
      // Free any channel currently playing this sound before it disappears.
      const mixer = useMixerStore()
      for (const ch of mixer.channels) {
        if (ch.instrumentId === id) mixer.plugInstrument(ch.id, null)
      }
      await deleteUserSound(id)
      this.sounds = this.sounds.filter((s) => s.id !== id)
    },
  },
})
