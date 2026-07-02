<script setup lang="ts">
import { useMixerStore } from '../stores/mixer'

const store = useMixerStore()

function togglePlay() {
  if (store.transport.playing) {
    void store.pause()
  } else {
    // The Play click is the user gesture that resumes the AudioContext.
    void store.play()
  }
}
</script>

<template>
  <div
    class="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"
  >
    <button
      class="w-24 rounded-md px-4 py-2 text-sm font-bold transition-colors"
      :class="
        store.transport.playing
          ? 'bg-zinc-200 text-zinc-900 hover:bg-white'
          : 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400'
      "
      @click="togglePlay"
    >
      {{ store.transport.playing ? 'Pause' : 'Play' }}
    </button>

    <button
      class="rounded-md px-4 py-2 text-sm font-semibold transition-colors"
      :class="
        store.transport.looping
          ? 'bg-emerald-900 text-emerald-300'
          : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'
      "
      @click="store.toggleLoop()"
    >
      Loop {{ store.transport.looping ? 'on' : 'off' }}
    </button>

    <p class="ml-auto hidden text-xs text-zinc-500 sm:block">
      Turn your volume down before the first Play.
    </p>
  </div>
</template>
