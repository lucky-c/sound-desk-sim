<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { useMixerStore } from './stores/mixer'
import MixerDrawer from './components/MixerDrawer.vue'
import ChallengePanel from './components/ChallengePanel.vue'

// Lazy-loaded so the three.js chunk downloads in parallel with first paint.
const Stage3D = defineAsyncComponent(() => import('./components/Stage3D.vue'))

const store = useMixerStore()

if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__mixerStore = store
}
</script>

<template>
  <div class="min-h-screen bg-zinc-950 text-zinc-100">
    <div class="mx-auto flex max-w-7xl flex-col gap-4 p-4">
      <header class="flex flex-wrap items-baseline gap-3">
        <h1 class="text-xl font-bold tracking-tight">Sound Desk Sim</h1>
        <p class="text-sm text-zinc-500">
          a live-sound-mixing learning tool — you're at FOH
        </p>
      </header>

      <div class="flex flex-col gap-4 lg:flex-row lg:items-start">
        <!-- the live view: stage with the console drawer over it -->
        <main
          class="relative h-[620px] min-w-0 flex-1 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900"
        >
          <Stage3D />
          <MixerDrawer />
        </main>

        <ChallengePanel class="w-full shrink-0 lg:w-80" />
      </div>

      <footer class="text-xs text-zinc-600">
        Turn your volume down before the first Play. Signal chain per channel:
        gain → low cut → 4-band EQ → compressor (+ makeup) → fader → pan +
        stage position (distance · room send) → master bus → safety limiter.
        Drop your own stems into
        <code class="text-zinc-500">/public/stems/</code> (see its README).
      </footer>
    </div>
  </div>
</template>
