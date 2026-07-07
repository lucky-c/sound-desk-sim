import { reactive } from 'vue'

/** Tiny cross-component UI state (no persistence, no audio). */
export const uiState = reactive({
  /** Channel id whose graphical EQ editor is open, or null. */
  eqChannelId: null as string | null,

  // Panel open/close flags, lifted here so hotkeys can toggle them.
  consoleOpen: true,
  rtaOpen: false,
  scenesOpen: false,
  soundsOpen: false,
  /** Keyboard-shortcut help overlay. */
  helpOpen: false,

  /** Channel targeted by the M/S (mute/solo) hotkeys — set by clicking a strip. */
  focusedChannelId: null as string | null,

  /** Bumped by the camera-reset hotkey; Stage3D watches it to recenter. */
  cameraResetNonce: 0,

  /** True while the pointer is over the 3D stage. When set, WASD drives the
   *  camera (so its S doesn't also trigger the solo hotkey). */
  stageActive: false,
})

/** Close every floating panel (the Escape hotkey). */
export function closePanels() {
  uiState.eqChannelId = null
  uiState.rtaOpen = false
  uiState.scenesOpen = false
  uiState.soundsOpen = false
  uiState.helpOpen = false
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__uiState = uiState
}
