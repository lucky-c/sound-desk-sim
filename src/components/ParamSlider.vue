<script setup lang="ts">
import { computed } from 'vue'
import { logToPos, posToLog } from '../lib/units'

const props = withDefaults(
  defineProps<{
    label: string
    modelValue: number
    min: number
    max: number
    step?: number
    /** Log-spaced mapping — use for frequency controls. */
    log?: boolean
    unit?: string
    /** Fixed decimals for the value readout. */
    decimals?: number
  }>(),
  { step: 0.1, log: false, unit: '', decimals: 1 },
)

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const LOG_STEPS = 500

const sliderValue = computed(() =>
  props.log
    ? Math.round(logToPos(props.modelValue, props.min, props.max) * LOG_STEPS)
    : props.modelValue,
)

function onInput(event: Event) {
  const raw = Number((event.target as HTMLInputElement).value)
  const value = props.log ? posToLog(raw / LOG_STEPS, props.min, props.max) : raw
  emit('update:modelValue', value)
}

const display = computed(() => {
  const v = props.modelValue
  const text =
    props.log && v >= 1000
      ? `${(v / 1000).toFixed(1)}k`
      : v.toFixed(props.decimals)
  return props.unit ? `${text} ${props.unit}` : text
})
</script>

<template>
  <label class="block">
    <span class="flex items-baseline justify-between text-[11px] leading-4">
      <span class="text-zinc-400">{{ label }}</span>
      <span class="font-mono text-zinc-200 tabular-nums">{{ display }}</span>
    </span>
    <input
      type="range"
      class="w-full accent-emerald-400"
      :min="log ? 0 : min"
      :max="log ? LOG_STEPS : max"
      :step="log ? 1 : step"
      :value="sliderValue"
      @input="onInput"
    />
  </label>
</template>
