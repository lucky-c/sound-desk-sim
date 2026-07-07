<script setup lang="ts">
import { computed } from 'vue'
import { useMixerStore } from '../stores/mixer'
import { useMeters } from '../composables/useMeters'
import { uiState } from '../composables/uiState'
import { engineState } from '../audio/engine'
import type { ChannelConfig, NumericParamKey } from '../types'
import RotaryKnob from './RotaryKnob.vue'
import VFader from './VFader.vue'
import LevelMeter from './LevelMeter.vue'

/** The full M32R-inspired strip — knobs + a vertical fader, like the desk. */

const props = defineProps<{ channel: ChannelConfig }>()

const store = useMixerStore()
const meters = useMeters()

const peak = computed(() => meters.channels[props.channel.id]?.peak ?? 0)
const stemSource = computed(() => engineState.stemSources[props.channel.id])

/** Compressor gain reduction, shown as a positive dB amount. */
const compGr = computed(() =>
  Math.max(0, -(meters.channels[props.channel.id]?.compGrDb ?? 0)),
)
const gateClosed = computed(
  () => (meters.channels[props.channel.id]?.gateGain ?? 1) < 0.5,
)

function set(key: NumericParamKey, value: number) {
  store.setParam(props.channel.id, key, value)
}
</script>

<template>
  <div
    class="flex w-[13.5rem] shrink-0 flex-col gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 p-2"
  >
    <div class="flex items-center justify-between">
      <h2 class="truncate text-sm font-semibold" :style="{ color: channel.color }">
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
          >{{ stemSource }}</span
        >
      </div>
    </div>

    <!-- input + gate -->
    <div class="rounded-md bg-zinc-950/60 p-1.5">
      <p class="mb-1 flex items-center gap-1.5 text-[9px] uppercase tracking-wide text-zinc-500">
        Input · Gate
        <span
          class="inline-block h-1.5 w-1.5 rounded-full"
          :class="gateClosed ? 'bg-red-500' : 'bg-emerald-500/60'"
          :title="gateClosed ? 'Gate closed' : 'Gate open'"
        />
      </p>
      <div class="flex flex-wrap justify-between gap-y-1">
        <RotaryKnob label="Gain" unit="dB" :min="-24" :max="24" :decimals="0"
          :model-value="channel.params.gainDb" @update:model-value="set('gainDb', $event)" />
        <RotaryKnob label="Lo cut" unit="Hz" log :min="20" :max="1000" :decimals="0"
          :model-value="channel.params.hpfHz" @update:model-value="set('hpfHz', $event)" />
        <RotaryKnob label="G thr" unit="dB" :min="-80" :max="0" :decimals="0"
          :model-value="channel.params.gateThresholdDb" @update:model-value="set('gateThresholdDb', $event)" />
        <RotaryKnob label="G rng" unit="dB" :min="0" :max="60" :decimals="0"
          :model-value="channel.params.gateRangeDb" @update:model-value="set('gateRangeDb', $event)" />
      </div>
    </div>

    <!-- EQ -->
    <div class="rounded-md bg-zinc-950/60 p-1.5">
      <p class="mb-1 flex items-center justify-between text-[9px] uppercase tracking-wide text-zinc-500">
        EQ
        <button
          class="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400 hover:bg-zinc-700"
          @click="uiState.eqChannelId = channel.id"
        >
          curve view
        </button>
      </p>
      <div class="flex flex-wrap justify-between gap-y-1">
        <RotaryKnob label="Low F" unit="Hz" log :min="40" :max="600" :decimals="0"
          :model-value="channel.params.eqLowFreq" @update:model-value="set('eqLowFreq', $event)" />
        <RotaryKnob label="Low G" unit="dB" :min="-15" :max="15"
          :model-value="channel.params.eqLowGainDb" @update:model-value="set('eqLowGainDb', $event)" />
        <RotaryKnob label="LM F" unit="Hz" log :min="100" :max="2000" :decimals="0"
          :model-value="channel.params.eqLoMidFreq" @update:model-value="set('eqLoMidFreq', $event)" />
        <RotaryKnob label="LM G" unit="dB" :min="-15" :max="15"
          :model-value="channel.params.eqLoMidGainDb" @update:model-value="set('eqLoMidGainDb', $event)" />
        <RotaryKnob label="LM Q" unit="" log :min="0.3" :max="10"
          :model-value="channel.params.eqLoMidQ" @update:model-value="set('eqLoMidQ', $event)" />
        <RotaryKnob label="HM F" unit="Hz" log :min="400" :max="8000" :decimals="0"
          :model-value="channel.params.eqHiMidFreq" @update:model-value="set('eqHiMidFreq', $event)" />
        <RotaryKnob label="HM G" unit="dB" :min="-15" :max="15"
          :model-value="channel.params.eqHiMidGainDb" @update:model-value="set('eqHiMidGainDb', $event)" />
        <RotaryKnob label="HM Q" unit="" log :min="0.3" :max="10"
          :model-value="channel.params.eqHiMidQ" @update:model-value="set('eqHiMidQ', $event)" />
        <RotaryKnob label="Hi F" unit="Hz" log :min="2000" :max="16000" :decimals="0"
          :model-value="channel.params.eqHighFreq" @update:model-value="set('eqHighFreq', $event)" />
        <RotaryKnob label="Hi G" unit="dB" :min="-15" :max="15"
          :model-value="channel.params.eqHighGainDb" @update:model-value="set('eqHighGainDb', $event)" />
      </div>
    </div>

    <!-- dynamics -->
    <div class="rounded-md bg-zinc-950/60 p-1.5">
      <p class="mb-1 text-[9px] uppercase tracking-wide text-zinc-500">Compressor</p>
      <div class="flex flex-wrap justify-between gap-y-1">
        <RotaryKnob label="Thr" unit="dB" :min="-60" :max="0" :decimals="0"
          :model-value="channel.params.compThresholdDb" @update:model-value="set('compThresholdDb', $event)" />
        <RotaryKnob label="Ratio" unit=":1" :min="1" :max="20"
          :model-value="channel.params.compRatio" @update:model-value="set('compRatio', $event)" />
        <RotaryKnob label="Att" unit="ms" log :min="1" :max="100" :decimals="0"
          :model-value="channel.params.compAttackMs" @update:model-value="set('compAttackMs', $event)" />
        <RotaryKnob label="Rel" unit="ms" log :min="20" :max="1000" :decimals="0"
          :model-value="channel.params.compReleaseMs" @update:model-value="set('compReleaseMs', $event)" />
        <RotaryKnob label="Make" unit="dB" :min="0" :max="18"
          :model-value="channel.params.compMakeupDb" @update:model-value="set('compMakeupDb', $event)" />
      </div>
      <div class="mt-1 flex items-center gap-1.5 text-[9px] text-zinc-500">
        <span>GR</span>
        <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
          <div
            class="h-full bg-amber-400 transition-[width] duration-75 ease-linear"
            :style="{ width: `${Math.min((compGr / 20) * 100, 100)}%` }"
          />
        </div>
        <span class="w-9 text-right font-mono tabular-nums text-zinc-400">
          -{{ compGr.toFixed(1) }}
        </span>
      </div>
    </div>

    <!-- pan / fx / dca + fader -->
    <div class="flex gap-2">
      <div class="flex flex-col items-center gap-1.5 rounded-md bg-zinc-950/60 p-1.5">
        <RotaryKnob label="Pan" unit="" :min="-1" :max="1" :decimals="2"
          :model-value="channel.params.pan" @update:model-value="set('pan', $event)" />
        <RotaryKnob label="FX dly" unit="dB" :min="-60" :max="0" :decimals="0"
          :model-value="channel.params.fxSendDb" @update:model-value="set('fxSendDb', $event)" />
        <div class="flex items-center gap-0.5">
          <button
            v-for="i in 4"
            :key="i"
            class="h-4 w-4 rounded text-[8px] font-bold leading-none transition-colors"
            :class="
              (channel.params.dcaMask >> (i - 1)) & 1
                ? 'bg-emerald-600 text-white'
                : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'
            "
            :title="`DCA ${i}`"
            @click="store.toggleDcaAssign(channel.id, i - 1)"
          >
            {{ i }}
          </button>
        </div>
      </div>

      <div class="flex flex-1 items-end justify-center gap-2 rounded-md bg-zinc-950/60 p-1.5">
        <VFader
          height-class="h-36"
          :min="-60"
          :max="6"
          :model-value="channel.params.faderDb"
          @update:model-value="set('faderDb', $event)"
        />
        <LevelMeter :peak="peak" size-class="h-36 w-2" />
        <div class="flex flex-col gap-1 self-end">
          <button
            class="rounded px-1.5 py-1 text-[10px] font-bold transition-colors"
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
            class="rounded px-1.5 py-1 text-[10px] font-bold transition-colors"
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
