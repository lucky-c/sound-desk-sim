import { ref, watch } from 'vue'
import { clamp } from '../lib/units'

/**
 * A persisted, aspect-preserving scale for a fixed-resolution canvas panel.
 * The canvas keeps drawing at its base width/height; we only scale how big it
 * is displayed, so the drawing math (and rect-based interaction) is untouched.
 * A corner handle drives `scale` between 0.7× and 2×.
 */
export function usePanelResize(storageKey: string, baseWidth: number) {
  const MIN = 0.7
  const MAX = 2

  function load(): number {
    const saved = Number(localStorage.getItem(storageKey))
    return saved >= MIN && saved <= MAX ? saved : 1
  }
  const scale = ref(load())
  watch(scale, (s) => localStorage.setItem(storageKey, String(s)))

  let startX = 0
  let startScale = 1
  function onResizeDown(ev: PointerEvent) {
    ev.preventDefault()
    ev.stopPropagation()
    startX = ev.clientX
    startScale = scale.value
    ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
  }
  function onResizeMove(ev: PointerEvent) {
    if ((ev.buttons & 1) === 0) return
    scale.value = clamp(startScale + (ev.clientX - startX) / baseWidth, MIN, MAX)
  }

  return { scale, onResizeDown, onResizeMove }
}
