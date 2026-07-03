<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import { useMixerStore } from './stores/mixer'
import { useChallengeStore } from './stores/challenges'
import TransportBar from './components/TransportBar.vue'
import ChannelStrip from './components/ChannelStrip.vue'
import MasterStrip from './components/MasterStrip.vue'
import ChallengePanel from './components/ChallengePanel.vue'

// Lazy-loaded so three.js is only fetched when the 3D view is opened.
const Console3D = defineAsyncComponent(() => import('./components/Console3D.vue'))

const store = useMixerStore()
const challengeStore = useChallengeStore()

const viewMode = ref<'2d' | '3d'>('2d')

// While auditioning the A (original) state, freeze the desk so edits can't
// silently land in a parameter set that's about to be restored.
const deskFrozen = computed(
  () => challengeStore.activeId !== null && challengeStore.abState === 'A',
)

if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__mixerStore = store
}
</script>

<template>
  <div class="min-h-screen bg-zinc-950 text-zinc-100">
    <div class="mx-auto flex max-w-7xl flex-col gap-4 p-4">
      <header class="flex flex-wrap items-baseline gap-3">
        <h1 class="text-xl font-bold tracking-tight">Sound Desk Sim</h1>
        <p class="text-sm text-zinc-500">a live-sound-mixing learning tool</p>
        <div
          class="ml-auto flex overflow-hidden rounded-md border border-zinc-700 text-xs font-semibold"
        >
          <button
            class="px-3 py-1.5 transition-colors"
            :class="viewMode === '2d' ? 'bg-zinc-200 text-zinc-900' : 'bg-zinc-900 text-zinc-500 hover:bg-zinc-800'"
            @click="viewMode = '2d'"
          >
            2D desk
          </button>
          <button
            class="px-3 py-1.5 transition-colors"
            :class="viewMode === '3d' ? 'bg-zinc-200 text-zinc-900' : 'bg-zinc-900 text-zinc-500 hover:bg-zinc-800'"
            @click="viewMode = '3d'"
          >
            3D desk
          </button>
        </div>
      </header>

      <div class="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div class="flex min-w-0 flex-1 flex-col gap-4">
          <TransportBar />

          <main
            class="transition-opacity"
            :class="deskFrozen ? 'pointer-events-none opacity-50' : ''"
          >
            <div v-if="viewMode === '2d'" class="flex gap-3 overflow-x-auto pb-2">
              <ChannelStrip
                v-for="channel in store.channels"
                :key="channel.id"
                :channel="channel"
              />
              <MasterStrip />
            </div>
            <Console3D v-else />
          </main>
        </div>

        <ChallengePanel class="w-full shrink-0 lg:w-80" />
      </div>

      <footer class="text-xs text-zinc-600">
        Signal chain per channel: input gain → high-pass → peaking EQ →
        compressor → fader → master bus → safety limiter. Drop your own stems
        into <code class="text-zinc-500">/public/stems/</code> (see its README).
      </footer>
    </div>
  </div>
</template>
