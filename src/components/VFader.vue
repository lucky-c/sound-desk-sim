<script setup lang="ts">
import { computed, ref } from 'vue'
import { clamp } from '../lib/units'

/** A vertical fader, desk-style: drag the cap (or click the track) up/down. */

const props = withDefaults(
  defineProps<{
    modelValue: number
    min: number
    max: number
    unit?: string
    decimals?: number
    /** Tailwind height class for the track. */
    heightClass?: string
  }>(),
  { unit: 'dB', decimals: 1, heightClass: 'h-36' },
)

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const track = ref<HTMLDivElement | null>(null)

const norm = computed(() =>
  clamp((props.modelValue - props.min) / (props.max - props.min), 0, 1),
)
/** Where the unity (0) mark sits, if 0 is inside the range. */
const zeroPct = computed(() =>
  props.min < 0 && props.max > 0
    ? ((0 - props.min) / (props.max - props.min)) * 100
    : null,
)

function applyFromY(clientY: number) {
  const el = track.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const n = clamp(1 - (clientY - rect.top) / rect.height, 0, 1)
  emit('update:modelValue', props.min + n * (props.max - props.min))
}

function onPointerDown(ev: PointerEvent) {
  ev.preventDefault()
  ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
  applyFromY(ev.clientY)
}
function onPointerMove(ev: PointerEvent) {
  if ((ev.buttons & 1) === 0) return
  applyFromY(ev.clientY)
}

const display = computed(() => {
  const text = props.modelValue.toFixed(props.decimals)
  return props.unit ? `${text}` : text
})
</script>

<template>
  <div class="flex select-none flex-col items-center gap-1">
    <div
      ref="track"
      class="relative w-8 cursor-ns-resize touch-none rounded-md border border-zinc-800 bg-zinc-950"
      :class="heightClass"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
    >
      <!-- slot -->
      <div class="absolute left-1/2 top-1.5 bottom-1.5 w-0.5 -translate-x-1/2 rounded bg-zinc-800" />
      <!-- unity mark -->
      <div
        v-if="zeroPct !== null"
        class="absolute inset-x-1 border-t border-zinc-600"
        :style="{ bottom: `${zeroPct}%` }"
      />
      <!-- cap -->
      <div
        class="pointer-events-none absolute left-1/2 h-5 w-7 -translate-x-1/2 rounded-sm border border-zinc-500 bg-gradient-to-b from-zinc-200 via-zinc-400 to-zinc-300 shadow"
        :style="{ bottom: `calc(${norm * 100}% - 10px)` }"
      >
        <div class="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t border-zinc-700" />
      </div>
    </div>
    <span class="font-mono text-[9px] tabular-nums leading-none text-zinc-300">
      {{ display }}<span class="text-zinc-600"> {{ unit }}</span>
    </span>
  </div>
</template>
