import { reactive } from 'vue'

/** Tiny cross-component UI state (no persistence, no audio). */
export const uiState = reactive({
  /** Channel id whose graphical EQ editor is open, or null. */
  eqChannelId: null as string | null,
})

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__uiState = uiState
}
