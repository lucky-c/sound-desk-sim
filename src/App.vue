<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import { useMixerStore } from './stores/mixer'
import { useSoundLibraryStore } from './stores/soundLibrary'
import { uiState } from './composables/uiState'
import { useHotkeys } from './composables/useHotkeys'
import MixerDrawer from './components/MixerDrawer.vue'
import ChallengePanel from './components/ChallengePanel.vue'

// Lazy-loaded so the three.js chunk downloads in parallel with first paint.
const Stage3D = defineAsyncComponent(() => import('./components/Stage3D.vue'))

const store = useMixerStore()

// Restore uploaded sounds and saved scenes from IndexedDB.
void useSoundLibraryStore().init()
void store.initScenes()

// Global keyboard shortcuts.
useHotkeys()

const HOTKEYS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['L', 'Loop on / off'],
  ['C', 'Toggle console'],
  ['R', 'Toggle RTA'],
  ['M / N', 'Mute / solo focused channel'],
  ['F', 'Recenter camera'],
  ['W A S D', 'Move camera'],
  ['1–4', 'Recall scene'],
  ['⇧ 1–4', 'Save scene'],
  ['Esc', 'Close panels'],
  ['?', 'This help'],
]

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
      <button
        class="rounded-lg border border-zinc-800 bg-zinc-950/85 px-2.5 py-1.5 text-xs font-semibold backdrop-blur transition-colors"
        :class="uiState.helpOpen ? 'text-emerald-300' : 'text-zinc-400 hover:bg-zinc-800'"
        title="Keyboard shortcuts (?)"
        @click="uiState.helpOpen = !uiState.helpOpen"
      >
        ?
      </button>
    </div>

    <!-- keyboard shortcuts overlay -->
    <div
      v-if="uiState.helpOpen"
      class="absolute left-1/2 top-1/2 z-40 w-72 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-700 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur"
    >
      <div class="mb-2 flex items-center justify-between">
        <p class="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Keyboard shortcuts
        </p>
        <button
          class="rounded bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-700"
          @click="uiState.helpOpen = false"
        >
          Close
        </button>
      </div>
      <dl class="space-y-1">
        <div
          v-for="[key, desc] in HOTKEYS"
          :key="key"
          class="flex items-center justify-between text-[11px]"
        >
          <dt class="text-zinc-400">{{ desc }}</dt>
          <dd
            class="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300"
          >
            {{ key }}
          </dd>
        </div>
      </dl>
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
