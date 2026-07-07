import { onMounted, onUnmounted } from 'vue'
import { useMixerStore } from '../stores/mixer'
import { uiState, closePanels } from './uiState'

/**
 * Global keyboard shortcuts. Mounted once (in App). Typing in a text field
 * suppresses everything but Escape, so scene names etc. aren't hijacked.
 *
 *   Space  play / pause        C  console        M  mute focused channel
 *   L      loop on/off         R  RTA            S  solo focused channel
 *   1–4    recall scene        Esc close panels  F  recenter camera
 *   ⇧1–4   save scene          ?  this help
 */
export function useHotkeys() {
  const mixer = useMixerStore()

  function isEditable(el: EventTarget | null): boolean {
    const node = el as HTMLElement | null
    if (!node) return false
    const tag = node.tagName
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      node.isContentEditable
    )
  }

  function onKeyDown(ev: KeyboardEvent) {
    // Let the browser handle modifier combos (copy/paste, devtools, etc.).
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return

    if (ev.key === 'Escape') {
      closePanels()
      return
    }
    if (isEditable(ev.target) || ev.repeat) return

    switch (ev.code) {
      case 'Space':
        ev.preventDefault()
        if (mixer.transport.playing) void mixer.pause()
        else void mixer.play()
        return
      case 'KeyL':
        mixer.toggleLoop()
        return
      case 'KeyC':
        uiState.consoleOpen = !uiState.consoleOpen
        return
      case 'KeyR':
        uiState.rtaOpen = !uiState.rtaOpen
        return
      case 'KeyF':
        uiState.cameraResetNonce++
        return
      case 'KeyM':
        if (uiState.focusedChannelId) mixer.toggleMute(uiState.focusedChannelId)
        return
      case 'KeyS':
        // Over the stage, S is WASD "move back" (handled in Stage3D).
        if (uiState.stageActive) return
        if (uiState.focusedChannelId) mixer.toggleSolo(uiState.focusedChannelId)
        return
    }

    // Scenes: 1–4 recall, Shift+1–4 save.
    const digit = /^Digit([1-4])$/.exec(ev.code)
    if (digit) {
      const slot = Number(digit[1]) - 1
      if (ev.shiftKey) mixer.saveScene(slot)
      else mixer.recallScene(slot)
      return
    }

    if (ev.key === '?') uiState.helpOpen = !uiState.helpOpen
  }

  onMounted(() => window.addEventListener('keydown', onKeyDown))
  onUnmounted(() => window.removeEventListener('keydown', onKeyDown))
}
