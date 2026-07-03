<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useMixerStore } from '../stores/mixer'
import { useChallengeStore } from '../stores/challenges'
import { useMeters } from '../composables/useMeters'
import { clamp, linToDb } from '../lib/units'
import ChannelStrip from './ChannelStrip.vue'
import MasterStrip from './MasterStrip.vue'
import ParamSlider from './ParamSlider.vue'
import LevelMeter from './LevelMeter.vue'

/**
 * The FOH console drawer: slides up over the stage view. The handle bar
 * (always visible) carries transport + master monitoring; the body shows a
 * compact strip per channel, each expandable to the full 2D strip.
 */

const mixer = useMixerStore()
const challenges = useChallengeStore()
const meters = useMeters()

const open = ref(true)
const expanded = reactive<Record<string, boolean>>({})

// While auditioning the A (original) state of a challenge, freeze the
// console so edits can't land in a parameter set about to be restored.
const frozen = computed(
  () => challenges.activeId !== null && challenges.abState === 'A',
)

function togglePlay() {
  if (mixer.transport.playing) void mixer.pause()
  // The Play click is the user gesture that resumes the AudioContext.
  else void mixer.play()
}

const masterPct = computed(
  () => clamp((linToDb(meters.master.peak) + 60) / 60, 0, 1) * 100,
)
const limiting = computed(() => meters.master.reductionDb < -0.5)
</script>

<template>
  <div class="absolute inset-x-0 bottom-0 z-10 flex flex-col">
    <!-- handle bar -->
    <div
      class="flex items-center gap-2 border-t border-zinc-800 bg-zinc-950/95 px-3 py-2 backdrop-blur"
    >
      <button
        class="flex items-center gap-1.5 rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:bg-zinc-700"
        @click="open = !open"
      >
        <span class="text-[10px]">{{ open ? '▼' : '▲' }}</span>
        Console
      </button>

      <button
        class="w-20 rounded-md px-3 py-1.5 text-xs font-bold transition-colors"
        :class="
          mixer.transport.playing
            ? 'bg-zinc-200 text-zinc-900 hover:bg-white'
            : 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400'
        "
        @click="togglePlay"
      >
        {{ mixer.transport.playing ? 'Pause' : 'Play' }}
      </button>

      <button
        class="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors"
        :class="
          mixer.transport.looping
            ? 'bg-emerald-900 text-emerald-300'
            : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'
        "
        @click="mixer.toggleLoop()"
      >
        Loop {{ mixer.transport.looping ? 'on' : 'off' }}
      </button>

      <!-- master monitoring -->
      <div class="ml-auto flex items-center gap-3">
        <span
          class="flex items-center gap-1 text-[10px] font-semibold"
          :class="meters.master.clip ? 'text-red-400' : 'text-zinc-600'"
        >
          <span
            class="inline-block h-2 w-2 rounded-full"
            :class="meters.master.clip ? 'bg-red-500' : 'bg-zinc-700'"
          />
          CLIP
        </span>
        <span
          class="flex items-center gap-1 text-[10px] font-semibold"
          :class="limiting ? 'text-amber-400' : 'text-zinc-600'"
          title="Always-on safety limiter"
        >
          <span
            class="inline-block h-2 w-2 rounded-full"
            :class="limiting ? 'bg-amber-400' : 'bg-zinc-700'"
          />
          LIM
        </span>
        <div class="hidden h-1.5 w-28 overflow-hidden rounded-full bg-zinc-800 sm:block">
          <div
            class="h-full transition-[width] duration-75 ease-linear"
            :class="masterPct > 95 ? 'bg-red-500' : masterPct > 80 ? 'bg-yellow-400' : 'bg-emerald-400'"
            :style="{ width: `${masterPct}%` }"
          />
        </div>
      </div>
    </div>

    <!-- console body -->
    <div
      v-show="open"
      class="max-h-[400px] overflow-y-auto border-t border-zinc-800/60 bg-zinc-950/90 backdrop-blur transition-opacity"
      :class="frozen ? 'pointer-events-none opacity-50' : ''"
    >
      <div class="flex items-end gap-2 overflow-x-auto p-2">
        <div v-for="ch in mixer.channels" :key="ch.id" class="flex shrink-0 flex-col gap-1">
          <button
            class="self-start rounded bg-zinc-800/80 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-700"
            @click="expanded[ch.id] = !expanded[ch.id]"
          >
            {{ expanded[ch.id] ? '− less' : '+ EQ / comp' }}
          </button>

          <ChannelStrip v-if="expanded[ch.id]" :channel="ch" />

          <div
            v-else
            class="flex w-36 flex-col gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 p-2"
          >
            <span class="text-xs font-semibold" :style="{ color: ch.color }">
              {{ ch.name }}
            </span>
            <div class="flex items-end gap-2">
              <LevelMeter
                :peak="meters.channels[ch.id]?.peak ?? 0"
                size-class="h-16 w-2"
              />
              <div class="min-w-0 flex-1">
                <ParamSlider
                  label="Fader"
                  unit="dB"
                  :min="-60"
                  :max="6"
                  :model-value="ch.params.faderDb"
                  @update:model-value="mixer.setParam(ch.id, 'faderDb', $event)"
                />
                <div class="mt-1.5 flex gap-1.5">
                  <button
                    class="flex-1 rounded px-1.5 py-0.5 text-[11px] font-bold transition-colors"
                    :class="
                      ch.params.mute
                        ? 'bg-red-600 text-white'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                    "
                    @click="mixer.toggleMute(ch.id)"
                  >
                    M
                  </button>
                  <button
                    class="flex-1 rounded px-1.5 py-0.5 text-[11px] font-bold transition-colors"
                    :class="
                      ch.params.solo
                        ? 'bg-yellow-500 text-black'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                    "
                    @click="mixer.toggleSolo(ch.id)"
                  >
                    S
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- master -->
        <div class="ml-2 flex shrink-0 flex-col gap-1 border-l border-zinc-800 pl-3">
          <button
            class="self-start rounded bg-zinc-800/80 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-700"
            @click="expanded.master = !expanded.master"
          >
            {{ expanded.master ? '− less' : '+ details' }}
          </button>

          <MasterStrip v-if="expanded.master" />

          <div
            v-else
            class="flex w-36 flex-col gap-1.5 rounded-lg border border-emerald-900 bg-zinc-900 p-2"
          >
            <span class="text-xs font-semibold text-emerald-400">Master</span>
            <div class="flex items-end gap-2">
              <LevelMeter :peak="meters.master.peak" size-class="h-16 w-2" />
              <div class="min-w-0 flex-1">
                <ParamSlider
                  label="Fader"
                  unit="dB"
                  :min="-60"
                  :max="6"
                  :model-value="mixer.master.faderDb"
                  @update:model-value="mixer.setMasterFader($event)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
