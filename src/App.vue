<script setup lang="ts">
import { computed } from 'vue'
import { useMixerStore } from './stores/mixer'
import { useChallengeStore } from './stores/challenges'
import TransportBar from './components/TransportBar.vue'
import ChannelStrip from './components/ChannelStrip.vue'
import MasterStrip from './components/MasterStrip.vue'
import ChallengePanel from './components/ChallengePanel.vue'

const store = useMixerStore()
const challengeStore = useChallengeStore()

// While auditioning the A (original) state, freeze the desk so edits can't
// silently land in a parameter set that's about to be restored.
const deskFrozen = computed(
  () => challengeStore.activeId !== null && challengeStore.abState === 'A',
)
</script>

<template>
  <div class="min-h-screen bg-zinc-950 text-zinc-100">
    <div class="mx-auto flex max-w-7xl flex-col gap-4 p-4">
      <header class="flex items-baseline gap-3">
        <h1 class="text-xl font-bold tracking-tight">Sound Desk Sim</h1>
        <p class="text-sm text-zinc-500">
          a live-sound-mixing learning tool — phase 1–3
        </p>
      </header>

      <div class="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div class="flex min-w-0 flex-1 flex-col gap-4">
          <TransportBar />

          <main
            class="flex gap-3 overflow-x-auto pb-2 transition-opacity"
            :class="deskFrozen ? 'pointer-events-none opacity-50' : ''"
          >
            <ChannelStrip
              v-for="channel in store.channels"
              :key="channel.id"
              :channel="channel"
            />
            <MasterStrip />
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
