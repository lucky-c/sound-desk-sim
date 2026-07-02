<script setup lang="ts">
import { useMixerStore } from './stores/mixer'
import TransportBar from './components/TransportBar.vue'
import ChannelStrip from './components/ChannelStrip.vue'
import MasterStrip from './components/MasterStrip.vue'

const store = useMixerStore()
</script>

<template>
  <div class="min-h-screen bg-zinc-950 text-zinc-100">
    <div class="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <header class="flex items-baseline gap-3">
        <h1 class="text-xl font-bold tracking-tight">Sound Desk Sim</h1>
        <p class="text-sm text-zinc-500">
          a live-sound-mixing learning tool — phase 1–2
        </p>
      </header>

      <TransportBar />

      <main class="flex gap-3 overflow-x-auto pb-2">
        <ChannelStrip
          v-for="channel in store.channels"
          :key="channel.id"
          :channel="channel"
        />
        <MasterStrip />
      </main>

      <footer class="text-xs text-zinc-600">
        Signal chain per channel: input gain → high-pass → peaking EQ →
        compressor → fader → master bus → safety limiter. Drop your own stems
        into <code class="text-zinc-500">/public/stems/</code> (see its README).
      </footer>
    </div>
  </div>
</template>
