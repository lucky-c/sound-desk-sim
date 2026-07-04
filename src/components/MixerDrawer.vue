<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useMixerStore } from '../stores/mixer'
import { useChallengeStore } from '../stores/challenges'
import { useMeters } from '../composables/useMeters'
import { clamp, linToDb } from '../lib/units'
import { INSTRUMENTS } from '../audio/instruments'
import type { ChannelConfig } from '../types'
import ChannelStrip from './ChannelStrip.vue'
import MasterStrip from './MasterStrip.vue'
import ParamSlider from './ParamSlider.vue'
import LevelMeter from './LevelMeter.vue'

/**
 * The FOH console drawer: a 16-channel M32R-style desk over the stage view.
 * The handle bar (always visible) carries transport, master volume, and
 * master monitoring; the body shows a compact strip per channel — empty
 * slots offer an instrument picker; plugged slots expand to the full strip.
 */

const mixer = useMixerStore()
const challenges = useChallengeStore()
const meters = useMeters()

const open = ref(true)
const expanded = reactive<Record<string, boolean>>({})
const scenesOpen = ref(false)

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

function availableFor(ch: ChannelConfig) {
  return INSTRUMENTS.filter(
    (inst) => inst.id === ch.instrumentId || !mixer.usedInstrumentIds.has(inst.id),
  )
}

function onPlugSelect(ch: ChannelConfig, event: Event) {
  const value = (event.target as HTMLSelectElement).value
  mixer.plugInstrument(ch.id, value || null)
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

      <!-- scenes -->
      <div class="relative">
        <button
          class="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors"
          :class="scenesOpen ? 'bg-zinc-700 text-zinc-200' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'"
          @click="scenesOpen = !scenesOpen"
        >
          Scenes
        </button>
        <div
          v-if="scenesOpen"
          class="absolute bottom-full left-0 z-30 mb-2 w-52 rounded-lg border border-zinc-800 bg-zinc-950/95 p-2 backdrop-blur"
        >
          <p class="mb-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
            Scenes (session only)
          </p>
          <div
            v-for="(scene, i) in mixer.scenes"
            :key="i"
            class="mb-1 flex items-center gap-2"
          >
            <span class="w-14 text-[11px]" :class="scene ? 'text-zinc-300' : 'text-zinc-600'">
              Scene {{ i + 1 }}
            </span>
            <button
              class="flex-1 rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700"
              @click="mixer.saveScene(i)"
            >
              Save
            </button>
            <button
              class="flex-1 rounded px-2 py-0.5 text-[10px]"
              :class="
                scene
                  ? 'bg-emerald-800 text-emerald-200 hover:bg-emerald-700'
                  : 'cursor-default bg-zinc-900 text-zinc-700'
              "
              :disabled="!scene"
              @click="mixer.recallScene(i)"
            >
              Recall
            </button>
          </div>
        </div>
      </div>

      <!-- master volume + monitoring -->
      <div class="ml-auto flex items-center gap-3">
        <div class="hidden w-36 sm:block">
          <ParamSlider
            label="Master"
            unit="dB"
            :min="-60"
            :max="6"
            :model-value="mixer.master.faderDb"
            @update:model-value="mixer.setMasterFader($event)"
          />
        </div>
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
        <div class="hidden h-1.5 w-24 overflow-hidden rounded-full bg-zinc-800 md:block">
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
      class="max-h-[420px] overflow-y-auto border-t border-zinc-800/60 bg-zinc-950/90 backdrop-blur transition-opacity"
      :class="frozen ? 'pointer-events-none opacity-50' : ''"
    >
      <div class="flex items-start gap-1.5 overflow-x-auto p-2">
        <div v-for="ch in mixer.channels" :key="ch.id" class="flex shrink-0 flex-col gap-1">
          <!-- slot header: expand + instrument picker -->
          <div class="flex items-center gap-1">
            <button
              v-if="ch.instrumentId"
              class="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-700"
              @click="expanded[ch.id] = !expanded[ch.id]"
            >
              {{ expanded[ch.id] ? '−' : '+' }}
            </button>
            <select
              class="w-full min-w-0 rounded bg-zinc-800/80 px-1 py-0.5 text-[10px] text-zinc-400"
              :value="ch.instrumentId ?? ''"
              @change="onPlugSelect(ch, $event)"
            >
              <option value="">— empty —</option>
              <option v-for="inst in availableFor(ch)" :key="inst.id" :value="inst.id">
                {{ inst.name }}
              </option>
            </select>
          </div>

          <ChannelStrip v-if="ch.instrumentId && expanded[ch.id]" :channel="ch" />

          <!-- compact plugged strip -->
          <div
            v-else-if="ch.instrumentId"
            class="flex w-32 flex-col gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-2"
          >
            <span class="truncate text-xs font-semibold" :style="{ color: ch.color }">
              <span class="mr-1 text-[9px] text-zinc-600">{{ ch.num }}</span>
              {{ ch.name }}
            </span>
            <ParamSlider
              label="Pan"
              unit=""
              :min="-1"
              :max="1"
              :step="0.01"
              :decimals="2"
              :model-value="ch.params.pan"
              @update:model-value="mixer.setParam(ch.id, 'pan', $event)"
            />
            <div class="flex items-end gap-1.5">
              <LevelMeter
                :peak="meters.channels[ch.id]?.peak ?? 0"
                size-class="h-14 w-1.5"
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
                <div class="mt-1 flex gap-1">
                  <button
                    class="flex-1 rounded px-1 py-0.5 text-[10px] font-bold transition-colors"
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
                    class="flex-1 rounded px-1 py-0.5 text-[10px] font-bold transition-colors"
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

          <!-- empty slot -->
          <div
            v-else
            class="flex h-[104px] w-32 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-800 bg-zinc-900/40 p-2"
          >
            <span class="text-[10px] font-semibold text-zinc-600">Ch {{ ch.num }}</span>
            <span class="text-[9px] text-zinc-700">plug an instrument ↑</span>
          </div>
        </div>

        <!-- DCA groups -->
        <div class="ml-2 flex shrink-0 items-start gap-1.5 border-l border-zinc-800 pl-3">
          <div
            v-for="(dca, i) in mixer.dcas"
            :key="i"
            class="flex w-24 flex-col gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-2"
          >
            <span class="text-[10px] font-semibold text-zinc-400">DCA {{ i + 1 }}</span>
            <ParamSlider
              label="Fader"
              unit="dB"
              :min="-40"
              :max="10"
              :model-value="dca.faderDb"
              @update:model-value="mixer.setDcaFader(i, $event)"
            />
            <button
              class="rounded px-1 py-0.5 text-[10px] font-bold transition-colors"
              :class="
                dca.mute
                  ? 'bg-red-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              "
              @click="mixer.toggleDcaMute(i)"
            >
              MUTE
            </button>
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
              <LevelMeter :peak="meters.master.peak" size-class="h-14 w-2" />
              <div class="min-w-0 flex-1">
                <ParamSlider
                  label="Volume"
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
