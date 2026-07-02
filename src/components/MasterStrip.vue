<script setup lang="ts">
import { computed } from 'vue'
import { useMixerStore } from '../stores/mixer'
import { useMeters } from '../composables/useMeters'
import ParamSlider from './ParamSlider.vue'
import LevelMeter from './LevelMeter.vue'

const store = useMixerStore()
const meters = useMeters()

const limiting = computed(() => meters.master.reductionDb < -0.5)
</script>

<template>
  <div
    class="flex w-44 shrink-0 flex-col gap-2 rounded-lg border border-emerald-900 bg-zinc-900 p-3"
  >
    <h2 class="text-sm font-semibold text-emerald-400">Master</h2>

    <div class="flex flex-col gap-1.5">
      <div
        class="flex items-center gap-2 rounded px-2 py-1 text-[11px]"
        :class="meters.master.clip ? 'bg-red-950 text-red-300' : 'bg-zinc-800 text-zinc-500'"
      >
        <span
          class="inline-block h-2 w-2 rounded-full"
          :class="meters.master.clip ? 'bg-red-500' : 'bg-zinc-600'"
        />
        CLIP
      </div>
      <div
        class="flex items-center gap-2 rounded px-2 py-1 text-[11px]"
        :class="limiting ? 'bg-amber-950 text-amber-300' : 'bg-zinc-800 text-zinc-500'"
        title="Always-on safety limiter (brickwall at -3 dB) protecting your ears"
      >
        <span
          class="inline-block h-2 w-2 rounded-full"
          :class="limiting ? 'bg-amber-400' : 'bg-zinc-600'"
        />
        <span class="flex-1">LIMITER</span>
        <span class="font-mono tabular-nums">
          {{ meters.master.reductionDb.toFixed(1) }} dB
        </span>
      </div>
    </div>

    <div class="mt-auto flex items-end gap-3 border-t border-zinc-800 pt-2">
      <LevelMeter :peak="meters.master.peak" />
      <div class="flex-1">
        <ParamSlider
          label="Fader"
          unit="dB"
          :min="-60"
          :max="6"
          :model-value="store.master.faderDb"
          @update:model-value="store.setMasterFader($event)"
        />
      </div>
    </div>

    <p class="text-[10px] leading-snug text-zinc-600">
      Meter and clip light read pre-limiter, so you can see when you're pushing
      into it.
    </p>
  </div>
</template>
