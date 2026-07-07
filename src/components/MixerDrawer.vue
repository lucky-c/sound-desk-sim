<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useMixerStore } from '../stores/mixer'
import { useChallengeStore } from '../stores/challenges'
import { useMeters } from '../composables/useMeters'
import { uiState } from '../composables/uiState'
import { clamp, linToDb } from '../lib/units'
import { INSTRUMENTS } from '../audio/instruments'
import { useSoundLibraryStore } from '../stores/soundLibrary'
import type { ChannelConfig } from '../types'
import ChannelStrip from './ChannelStrip.vue'
import SoundLibraryPanel from './SoundLibraryPanel.vue'
import ParamSlider from './ParamSlider.vue'
import RotaryKnob from './RotaryKnob.vue'
import VFader from './VFader.vue'
import LevelMeter from './LevelMeter.vue'
import AnalyzerPanel from './AnalyzerPanel.vue'
import EqEditor from './EqEditor.vue'

/**
 * The FOH console drawer: a 16-channel M32R-style desk over the stage view —
 * vertical faders, rotary pans, per-channel EQ view, DCA group faders, and
 * an always-visible master fader strip.
 */

const mixer = useMixerStore()
const challenges = useChallengeStore()
const library = useSoundLibraryStore()
const meters = useMeters()

const expanded = reactive<Record<string, boolean>>({})

// ---- resizable console height (persisted) ----
const MIN_H = 180
const maxH = () => Math.round(window.innerHeight * 0.8)
function loadHeight(): number {
  const saved = Number(localStorage.getItem('sds.consoleHeight'))
  return saved >= MIN_H ? Math.min(saved, maxH()) : 440
}
const bodyHeight = ref(loadHeight())
watch(bodyHeight, (h) => localStorage.setItem('sds.consoleHeight', String(h)))

let resizeStartY = 0
let resizeStartH = 0
function onResizeDown(ev: PointerEvent) {
  ev.preventDefault()
  resizeStartY = ev.clientY
  resizeStartH = bodyHeight.value
  ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
}
function onResizeMove(ev: PointerEvent) {
  if ((ev.buttons & 1) === 0) return
  // Bottom-anchored: dragging up (smaller clientY) grows the console.
  bodyHeight.value = clamp(resizeStartH + (resizeStartY - ev.clientY), MIN_H, maxH())
  if (!uiState.consoleOpen) uiState.consoleOpen = true
}

/** Click a channel strip to target it with the M/S mute/solo hotkeys. */
function focusChannel(id: string) {
  uiState.focusedChannelId = id
}

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
  const free = (id: string) => id === ch.instrumentId || !mixer.usedInstrumentIds.has(id)
  return {
    synths: INSTRUMENTS.filter((inst) => free(inst.id)),
    uploads: library.sounds.filter((s) => free(s.id)),
  }
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
    <!-- floating panels, anchored above the console -->
    <AnalyzerPanel v-if="uiState.rtaOpen" class="absolute bottom-full left-3 z-30 mb-2" />
    <EqEditor v-if="uiState.eqChannelId" class="absolute bottom-full right-3 z-30 mb-2" />

    <!-- resize grip: drag to set console height -->
    <div
      class="group flex h-2 w-full cursor-ns-resize items-center justify-center bg-zinc-950/95"
      title="Drag to resize the console"
      @pointerdown="onResizeDown"
      @pointermove="onResizeMove"
    >
      <div class="h-0.5 w-10 rounded-full bg-zinc-700 group-hover:bg-emerald-500" />
    </div>

    <!-- handle bar -->
    <div
      class="flex items-center gap-2 border-t border-zinc-800 bg-zinc-950/95 px-3 py-2 backdrop-blur"
    >
      <button
        class="flex items-center gap-1.5 rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:bg-zinc-700"
        title="Toggle console (C)"
        @click="uiState.consoleOpen = !uiState.consoleOpen"
      >
        <span class="text-[10px]">{{ uiState.consoleOpen ? '▼' : '▲' }}</span>
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

      <button
        class="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors"
        :class="uiState.rtaOpen ? 'bg-emerald-900 text-emerald-300' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'"
        title="Real-time spectrum analyzer with EQ curve overlay (R)"
        @click="uiState.rtaOpen = !uiState.rtaOpen"
      >
        RTA
      </button>

      <!-- scenes -->
      <div class="relative">
        <button
          class="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors"
          :class="uiState.scenesOpen ? 'bg-zinc-700 text-zinc-200' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'"
          @click="uiState.scenesOpen = !uiState.scenesOpen"
        >
          Scenes
        </button>
        <div
          v-if="uiState.scenesOpen"
          class="absolute bottom-full left-0 z-30 mb-2 w-52 rounded-lg border border-zinc-800 bg-zinc-950/95 p-2 backdrop-blur"
        >
          <p class="mb-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
            Scenes (saved on this device)
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

      <!-- sound library -->
      <div class="relative">
        <button
          class="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors"
          :class="uiState.soundsOpen ? 'bg-zinc-700 text-zinc-200' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'"
          title="Upload your own audio into the console"
          @click="uiState.soundsOpen = !uiState.soundsOpen"
        >
          Sounds
        </button>
        <SoundLibraryPanel v-if="uiState.soundsOpen" class="absolute bottom-full left-0 z-30 mb-2" />
      </div>

      <!-- master monitoring -->
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

    <!-- console body (height-animated open/close) -->
    <div
      class="overflow-hidden border-t border-zinc-800/60 bg-zinc-950/90 backdrop-blur transition-[height,opacity] duration-300 ease-out"
      :style="{ height: uiState.consoleOpen ? bodyHeight + 'px' : '0px', opacity: uiState.consoleOpen ? 1 : 0 }"
      :class="frozen ? 'pointer-events-none opacity-50' : ''"
    >
      <div
        class="flex items-start gap-1.5 overflow-x-auto overflow-y-auto p-2"
        :style="{ height: bodyHeight + 'px' }"
      >
        <div
          v-for="ch in mixer.channels"
          :key="ch.id"
          class="flex shrink-0 flex-col gap-1 rounded-lg"
          :class="
            uiState.focusedChannelId === ch.id && ch.instrumentId
              ? 'ring-1 ring-emerald-500/70'
              : ''
          "
          @pointerdown="ch.instrumentId && focusChannel(ch.id)"
        >
          <!-- slot header: expand + instrument picker -->
          <div class="flex items-center gap-1">
            <button
              v-if="ch.instrumentId"
              class="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-700"
              :title="expanded[ch.id] ? 'Collapse strip' : 'Full strip (gate, EQ, comp…)'"
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
              <optgroup label="Instruments">
                <option v-for="inst in availableFor(ch).synths" :key="inst.id" :value="inst.id">
                  {{ inst.name }}
                </option>
              </optgroup>
              <optgroup v-if="availableFor(ch).uploads.length" label="Sound Library">
                <option v-for="s in availableFor(ch).uploads" :key="s.id" :value="s.id">
                  {{ s.name }}
                </option>
              </optgroup>
            </select>
          </div>

          <ChannelStrip v-if="ch.instrumentId && expanded[ch.id]" :channel="ch" />

          <!-- compact plugged strip: desk-style -->
          <div
            v-else-if="ch.instrumentId"
            class="flex w-24 flex-col items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1.5"
          >
            <span
              class="w-full truncate text-center text-[10px] font-semibold"
              :style="{ color: ch.color }"
            >
              <span class="mr-0.5 text-[8px] text-zinc-600">{{ ch.num }}</span>
              {{ ch.name }}
            </span>
            <RotaryKnob
              label="Pan"
              unit=""
              :min="-1"
              :max="1"
              :decimals="2"
              :model-value="ch.params.pan"
              @update:model-value="mixer.setParam(ch.id, 'pan', $event)"
            />
            <div class="flex items-end gap-1">
              <VFader
                height-class="h-28"
                :min="-60"
                :max="6"
                :model-value="ch.params.faderDb"
                @update:model-value="mixer.setParam(ch.id, 'faderDb', $event)"
              />
              <LevelMeter
                :peak="meters.channels[ch.id]?.peak ?? 0"
                size-class="h-28 w-1.5"
              />
            </div>
            <div class="flex w-full gap-1">
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
              <button
                class="flex-1 rounded bg-zinc-800 px-1 py-0.5 text-[9px] font-semibold text-emerald-400 hover:bg-zinc-700"
                title="Graphical EQ"
                @click="uiState.eqChannelId = ch.id"
              >
                EQ
              </button>
            </div>
          </div>

          <!-- empty slot -->
          <div
            v-else
            class="flex h-[13.5rem] w-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-800 bg-zinc-900/40 p-2"
          >
            <span class="text-[10px] font-semibold text-zinc-600">Ch {{ ch.num }}</span>
            <span class="text-center text-[9px] text-zinc-700">plug an instrument ↑</span>
          </div>
        </div>

        <!-- DCA groups -->
        <div class="ml-2 flex shrink-0 items-start gap-1.5 border-l border-zinc-800 pl-3">
          <div
            v-for="(dca, i) in mixer.dcas"
            :key="i"
            class="mt-6 flex w-16 flex-col items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1.5"
          >
            <span class="text-[10px] font-semibold text-zinc-400">DCA {{ i + 1 }}</span>
            <VFader
              height-class="h-24"
              :min="-40"
              :max="10"
              :model-value="dca.faderDb"
              @update:model-value="mixer.setDcaFader(i, $event)"
            />
            <button
              class="w-full rounded px-1 py-0.5 text-[9px] font-bold transition-colors"
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

        <!-- master fader strip (always visible) -->
        <div class="ml-2 flex shrink-0 flex-col border-l border-zinc-800 pl-3">
          <div
            class="mt-6 flex w-24 flex-col items-center gap-1 rounded-lg border border-emerald-900 bg-zinc-900 p-1.5"
          >
            <span class="text-[10px] font-semibold text-emerald-400">MASTER</span>
            <div class="flex w-full items-center justify-center gap-2 text-[8px] font-semibold">
              <span :class="meters.master.clip ? 'text-red-400' : 'text-zinc-600'">● CLIP</span>
              <span :class="limiting ? 'text-amber-400' : 'text-zinc-600'">● LIM</span>
            </div>
            <div class="flex items-end gap-1">
              <VFader
                height-class="h-32"
                :min="-60"
                :max="6"
                :model-value="mixer.master.faderDb"
                @update:model-value="mixer.setMasterFader($event)"
              />
              <LevelMeter :peak="meters.master.peak" size-class="h-32 w-2" />
            </div>
            <span class="font-mono text-[8px] tabular-nums text-zinc-500">
              LIM {{ meters.master.reductionDb.toFixed(1) }} dB
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
