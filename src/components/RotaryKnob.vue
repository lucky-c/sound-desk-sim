<script setup lang="ts">
import { computed } from 'vue'
import { clamp, logToPos, posToLog } from '../lib/units'

/** A desk-style rotary knob: drag vertically to turn (-135°..+135°). */

const props = withDefaults(
  defineProps<{
    label: string
    modelValue: number
    min: number
    max: number
    /** Log-spaced mapping — use for frequency/Q/time controls. */
    log?: boolean
    unit?: string
    decimals?: number
  }>(),
  { log: false, unit: '', decimals: 1 },
)

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const norm = computed(() =>
  props.log
    ? logToPos(props.modelValue, props.min, props.max)
    : clamp((props.modelValue - props.min) / (props.max - props.min), 0, 1),
)
const angle = computed(() => -135 + norm.value * 270)

let startY = 0
let startNorm = 0

function onPointerDown(ev: PointerEvent) {
  ev.preventDefault()
  startY = ev.clientY
  startNorm = norm.value
  ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
}
function onPointerMove(ev: PointerEvent) {
  if ((ev.buttons & 1) === 0) return
  const n = clamp(startNorm + (startY - ev.clientY) / 150, 0, 1)
  const value = props.log
    ? posToLog(n, props.min, props.max)
    : props.min + n * (props.max - props.min)
  emit('update:modelValue', value)
}

const display = computed(() => {
  const v = props.modelValue
  const text =
    props.log && v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(props.decimals)
  return props.unit ? `${text}${props.unit}` : text
})
</script>

<template>
  <div class="flex w-11 select-none flex-col items-center gap-0.5">
    <span class="text-[8px] uppercase leading-none tracking-wide text-zinc-500">
      {{ label }}
    </span>
    <div
      class="relative h-8 w-8 cursor-ns-resize touch-none rounded-full border border-zinc-600 bg-gradient-to-b from-zinc-700 to-zinc-800 shadow-inner"
      :title="`${label}: drag up/down`"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
    >
      <!-- min/max end marks -->
      <div class="absolute -bottom-0.5 -left-0.5 h-1 w-1 rounded-full bg-zinc-700" />
      <div class="absolute -bottom-0.5 -right-0.5 h-1 w-1 rounded-full bg-zinc-700" />
      <!-- pointer -->
      <div class="absolute inset-0" :style="{ transform: `rotate(${angle}deg)` }">
        <div class="absolute left-1/2 top-0.5 h-2.5 w-0.5 -translate-x-1/2 rounded bg-emerald-400" />
      </div>
    </div>
    <span class="font-mono text-[9px] tabular-nums leading-none text-zinc-300">
      {{ display }}
    </span>
  </div>
</template>
