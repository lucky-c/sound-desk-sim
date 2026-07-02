<script setup lang="ts">
import { computed } from 'vue'
import { useMixerStore } from '../stores/mixer'
import { useMeters } from '../composables/useMeters'
import { engineState } from '../audio/engine'
import type { ChannelConfig, NumericParamKey } from '../types'
import ParamSlider from './ParamSlider.vue'
import LevelMeter from './LevelMeter.vue'

const props = defineProps<{ channel: ChannelConfig }>()

const store = useMixerStore()
const meters = useMeters()

const peak = computed(() => meters.channels[props.channel.id]?.peak ?? 0)
const stemSource = computed(() => engineState.stemSources[props.channel.id])

function set(key: NumericParamKey, value: number) {
  store.setParam(props.channel.id, key, value)
}
</script>

<template>
  <div
    class="flex w-40 shrink-0 flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3"
  >
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold" :style="{ color: channel.color }">
        {{ channel.name }}
      </h2>
      <span
        v-if="stemSource"
        class="rounded bg-zinc-800 px-1 text-[9px] uppercase tracking-wide text-zinc-500"
        :title="stemSource === 'file' ? 'Playing a file from /stems/' : 'Playing the built-in synthesized stem'"
        >{{ stemSource }}</span
      >
    </div>

    <ParamSlider
      label="Gain"
      unit="dB"
      :min="-24"
      :max="24"
      :model-value="channel.params.gainDb"
      @update:model-value="set('gainDb', $event)"
    />
    <ParamSlider
      label="HPF"
      unit="Hz"
      log
      :min="20"
      :max="1000"
      :decimals="0"
      :model-value="channel.params.hpfHz"
      @update:model-value="set('hpfHz', $event)"
    />

    <div class="border-t border-zinc-800 pt-2">
      <p class="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">EQ (peaking)</p>
      <ParamSlider
        label="Freq"
        unit="Hz"
        log
        :min="60"
        :max="12000"
        :decimals="0"
        :model-value="channel.params.eqHz"
        @update:model-value="set('eqHz', $event)"
      />
      <ParamSlider
        label="Gain"
        unit="dB"
        :min="-15"
        :max="15"
        :model-value="channel.params.eqGainDb"
        @update:model-value="set('eqGainDb', $event)"
      />
    </div>

    <div class="border-t border-zinc-800 pt-2">
      <p class="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">Compressor</p>
      <ParamSlider
        label="Thresh"
        unit="dB"
        :min="-60"
        :max="0"
        :model-value="channel.params.compThresholdDb"
        @update:model-value="set('compThresholdDb', $event)"
      />
      <ParamSlider
        label="Ratio"
        unit=":1"
        :min="1"
        :max="20"
        :model-value="channel.params.compRatio"
        @update:model-value="set('compRatio', $event)"
      />
    </div>

    <div class="flex items-end gap-3 border-t border-zinc-800 pt-2">
      <LevelMeter :peak="peak" />
      <div class="flex-1">
        <ParamSlider
          label="Fader"
          unit="dB"
          :min="-60"
          :max="6"
          :model-value="channel.params.faderDb"
          @update:model-value="set('faderDb', $event)"
        />
        <div class="mt-2 flex gap-2">
          <button
            class="flex-1 rounded px-2 py-1 text-xs font-bold transition-colors"
            :class="
              channel.params.mute
                ? 'bg-red-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            "
            @click="store.toggleMute(channel.id)"
          >
            M
          </button>
          <button
            class="flex-1 rounded px-2 py-1 text-xs font-bold transition-colors"
            :class="
              channel.params.solo
                ? 'bg-yellow-500 text-black'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            "
            @click="store.toggleSolo(channel.id)"
          >
            S
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
