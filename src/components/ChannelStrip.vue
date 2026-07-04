<script setup lang="ts">
import { computed } from 'vue'
import { useMixerStore } from '../stores/mixer'
import { useMeters } from '../composables/useMeters'
import { engineState } from '../audio/engine'
import type { ChannelConfig, NumericParamKey } from '../types'
import ParamSlider from './ParamSlider.vue'
import LevelMeter from './LevelMeter.vue'

/** The full M32R-inspired strip — rendered when a drawer channel is expanded. */

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
    class="flex w-44 shrink-0 flex-col gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 p-2.5"
  >
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold" :style="{ color: channel.color }">
        <span class="mr-1 text-[10px] text-zinc-600">{{ channel.num }}</span>
        {{ channel.name }}
      </h2>
      <div class="flex items-center gap-1">
        <button
          class="rounded px-1.5 text-[11px] font-bold transition-colors"
          :class="
            channel.params.polarity
              ? 'bg-amber-500 text-black'
              : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'
          "
          title="Polarity invert"
          @click="store.togglePolarity(channel.id)"
        >
          ø
        </button>
        <span
          v-if="stemSource"
          class="rounded bg-zinc-800 px-1 text-[9px] uppercase tracking-wide text-zinc-500"
          :title="stemSource === 'file' ? 'Playing a file from /stems/' : 'Playing the built-in synthesized stem'"
          >{{ stemSource }}</span
        >
      </div>
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
      label="Low cut"
      unit="Hz"
      log
      :min="20"
      :max="1000"
      :decimals="0"
      :model-value="channel.params.hpfHz"
      @update:model-value="set('hpfHz', $event)"
    />

    <div class="border-t border-zinc-800 pt-1.5">
      <p class="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">Gate</p>
      <ParamSlider label="Thresh" unit="dB" :min="-80" :max="0"
        :model-value="channel.params.gateThresholdDb" @update:model-value="set('gateThresholdDb', $event)" />
      <ParamSlider label="Range" unit="dB" :min="0" :max="60"
        :model-value="channel.params.gateRangeDb" @update:model-value="set('gateRangeDb', $event)" />
    </div>

    <div class="border-t border-zinc-800 pt-1.5">
      <p class="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">EQ · low shelf</p>
      <ParamSlider label="Freq" unit="Hz" log :min="40" :max="600" :decimals="0"
        :model-value="channel.params.eqLowFreq" @update:model-value="set('eqLowFreq', $event)" />
      <ParamSlider label="Gain" unit="dB" :min="-15" :max="15"
        :model-value="channel.params.eqLowGainDb" @update:model-value="set('eqLowGainDb', $event)" />
    </div>

    <div class="border-t border-zinc-800 pt-1.5">
      <p class="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">EQ · lo mid</p>
      <ParamSlider label="Freq" unit="Hz" log :min="100" :max="2000" :decimals="0"
        :model-value="channel.params.eqLoMidFreq" @update:model-value="set('eqLoMidFreq', $event)" />
      <ParamSlider label="Gain" unit="dB" :min="-15" :max="15"
        :model-value="channel.params.eqLoMidGainDb" @update:model-value="set('eqLoMidGainDb', $event)" />
      <ParamSlider label="Width Q" unit="" log :min="0.3" :max="10"
        :model-value="channel.params.eqLoMidQ" @update:model-value="set('eqLoMidQ', $event)" />
    </div>

    <div class="border-t border-zinc-800 pt-1.5">
      <p class="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">EQ · hi mid</p>
      <ParamSlider label="Freq" unit="Hz" log :min="400" :max="8000" :decimals="0"
        :model-value="channel.params.eqHiMidFreq" @update:model-value="set('eqHiMidFreq', $event)" />
      <ParamSlider label="Gain" unit="dB" :min="-15" :max="15"
        :model-value="channel.params.eqHiMidGainDb" @update:model-value="set('eqHiMidGainDb', $event)" />
      <ParamSlider label="Width Q" unit="" log :min="0.3" :max="10"
        :model-value="channel.params.eqHiMidQ" @update:model-value="set('eqHiMidQ', $event)" />
    </div>

    <div class="border-t border-zinc-800 pt-1.5">
      <p class="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">EQ · high shelf</p>
      <ParamSlider label="Freq" unit="Hz" log :min="2000" :max="16000" :decimals="0"
        :model-value="channel.params.eqHighFreq" @update:model-value="set('eqHighFreq', $event)" />
      <ParamSlider label="Gain" unit="dB" :min="-15" :max="15"
        :model-value="channel.params.eqHighGainDb" @update:model-value="set('eqHighGainDb', $event)" />
    </div>

    <div class="border-t border-zinc-800 pt-1.5">
      <p class="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">Compressor</p>
      <ParamSlider label="Thresh" unit="dB" :min="-60" :max="0"
        :model-value="channel.params.compThresholdDb" @update:model-value="set('compThresholdDb', $event)" />
      <ParamSlider label="Ratio" unit=":1" :min="1" :max="20"
        :model-value="channel.params.compRatio" @update:model-value="set('compRatio', $event)" />
      <ParamSlider label="Attack" unit="ms" log :min="1" :max="100" :decimals="0"
        :model-value="channel.params.compAttackMs" @update:model-value="set('compAttackMs', $event)" />
      <ParamSlider label="Release" unit="ms" log :min="20" :max="1000" :decimals="0"
        :model-value="channel.params.compReleaseMs" @update:model-value="set('compReleaseMs', $event)" />
      <ParamSlider label="Makeup" unit="dB" :min="0" :max="18"
        :model-value="channel.params.compMakeupDb" @update:model-value="set('compMakeupDb', $event)" />
    </div>

    <div class="border-t border-zinc-800 pt-1.5">
      <ParamSlider label="Pan (PA)" unit="" :min="-1" :max="1" :step="0.01" :decimals="2"
        :model-value="channel.params.pan" @update:model-value="set('pan', $event)" />
      <ParamSlider label="FX (delay)" unit="dB" :min="-60" :max="0"
        :model-value="channel.params.fxSendDb" @update:model-value="set('fxSendDb', $event)" />
      <div class="mt-1 flex items-center gap-1">
        <span class="text-[10px] text-zinc-500">DCA</span>
        <button
          v-for="i in 4"
          :key="i"
          class="flex-1 rounded px-1 py-0.5 text-[10px] font-bold transition-colors"
          :class="
            (channel.params.dcaMask >> (i - 1)) & 1
              ? 'bg-emerald-600 text-white'
              : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'
          "
          @click="store.toggleDcaAssign(channel.id, i - 1)"
        >
          {{ i }}
        </button>
      </div>
    </div>

    <div class="flex items-end gap-3 border-t border-zinc-800 pt-1.5">
      <LevelMeter :peak="peak" size-class="h-28 w-3" />
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
