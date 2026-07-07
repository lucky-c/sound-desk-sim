<script setup lang="ts">
import { computed } from 'vue'
import { clamp, linToDb } from '../lib/units'

const props = withDefaults(
  defineProps<{
    /** Linear peak amplitude (0..~1). */
    peak: number
    /** Tailwind sizing for the meter well (height + width). */
    sizeClass?: string
  }>(),
  { sizeClass: 'h-40 w-3' },
)

/** Meter range: -60 dBFS at the bottom, 0 dBFS at the top. */
const heightPct = computed(() => {
  const db = linToDb(props.peak)
  return clamp((db + 60) / 60, 0, 1) * 100
})

const barColor = computed(() => {
  const db = linToDb(props.peak)
  if (db > -3) return 'bg-red-500'
  if (db > -12) return 'bg-yellow-400'
  return 'bg-emerald-400'
})
</script>

<template>
  <div class="relative overflow-hidden rounded-sm bg-zinc-800" :class="sizeClass">
    <!-- -12 dB and -3 dB tick marks -->
    <div class="absolute inset-x-0 border-t border-zinc-600" style="top: 5%" />
    <div class="absolute inset-x-0 border-t border-zinc-600" style="top: 20%" />
    <div
      class="absolute bottom-0 w-full transition-[height] duration-75 ease-linear"
      :class="barColor"
      :style="{ height: `${heightPct}%` }"
    />
  </div>
</template>
