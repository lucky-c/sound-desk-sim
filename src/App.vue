<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import { useMixerStore } from './stores/mixer'
import { useSoundLibraryStore } from './stores/soundLibrary'
import MixerDrawer from './components/MixerDrawer.vue'
import ChallengePanel from './components/ChallengePanel.vue'

// Lazy-loaded so the three.js chunk downloads in parallel with first paint.
const Stage3D = defineAsyncComponent(() => import('./components/Stage3D.vue'))

const store = useMixerStore()

// Restore uploaded sounds from IndexedDB so they show up in the picker.
void useSoundLibraryStore().init()

const challengesOpen = ref(true)
const infoOpen = ref(false)

if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__mixerStore = store
}
</script>

<template>
  <!-- The stage IS the app: fullscreen 3D with the rest of the UI floating inside. -->
  <div class="fixed inset-0 overflow-hidden bg-zinc-950 text-zinc-100">
    <div class="absolute inset-0">
      <Stage3D />
    </div>

    <!-- header chip -->
    <div class="absolute left-3 top-3 z-20 flex items-center gap-2">
      <div
        class="flex items-baseline gap-2 rounded-lg border border-zinc-800 bg-zinc-950/85 px-3 py-1.5 backdrop-blur"
      >
        <h1 class="text-sm font-bold tracking-tight">Sound Desk Sim</h1>
        <p class="hidden text-[11px] text-zinc-500 sm:block">you're at FOH</p>
      </div>
      <button
        class="rounded-lg border border-zinc-800 bg-zinc-950/85 px-2.5 py-1.5 text-xs font-semibold text-zinc-400 backdrop-blur transition-colors hover:bg-zinc-800"
        title="About the signal chain"
        @click="infoOpen = !infoOpen"
      >
        i
      </button>
    </div>

    <!-- info popover -->
    <div
      v-if="infoOpen"
      class="absolute left-3 top-14 z-30 max-w-md rounded-lg border border-zinc-800 bg-zinc-950/95 p-3 text-xs leading-relaxed text-zinc-400 backdrop-blur"
    >
      <p>
        Turn your volume down before the first Play. Signal chain per channel:
        gain → low cut → 4-band EQ → compressor (+ makeup) → fader → pan +
        stage position (distance · room send) → master bus → safety limiter.
      </p>
      <p class="mt-2">
        Drop your own stems into
        <code class="text-zinc-500">/public/stems/</code> (see its README) to
        replace the synthesized instruments.
      </p>
      <button
        class="mt-2 rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-700"
        @click="infoOpen = false"
      >
        Close
      </button>
    </div>

    <!-- challenges toggle + panel -->
    <button
      class="absolute right-3 top-3 z-20 rounded-lg border border-zinc-800 bg-zinc-950/85 px-3 py-1.5 text-xs font-semibold backdrop-blur transition-colors"
      :class="challengesOpen ? 'text-emerald-300' : 'text-zinc-400 hover:bg-zinc-800'"
      @click="challengesOpen = !challengesOpen"
    >
      Challenges {{ challengesOpen ? '▸' : '◂' }}
    </button>
    <ChallengePanel
      v-show="challengesOpen"
      class="absolute right-3 top-14 z-20 max-h-[calc(100dvh-8.5rem)] w-80 max-w-[85vw] overflow-y-auto"
    />

    <MixerDrawer />
  </div>
</template>
