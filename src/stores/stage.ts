import { reactive, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { RoomPreset, StagePosition } from '../audio/spatial'
import {
  STAGE_BOUNDS,
  computeSpatial,
  renderRoomIR,
  roomSpec,
} from '../audio/spatial'
import * as engine from '../audio/engine'
import { engineState } from '../audio/engine'
import { clamp } from '../lib/units'
import { useMixerStore } from './mixer'

/** Debounce for room-IR re-renders while the size slider moves. */
const IR_DEBOUNCE_MS = 250

/** Default band layout; unknown (data-added) channels get spread across stage. */
const DEFAULT_POSITIONS: Record<string, StagePosition> = {
  kick: { x: 0, z: -3 }, // drummer, back center
  bass: { x: -2.5, z: -1.5 }, // bassist, mid left
  pad: { x: 2.5, z: 0.5 }, // pad/vox, front right
}

/**
 * Stage state: where each performer stands and what room they play in.
 * Purely additive over the mixer — positions and room feed the engine's
 * spatial section (pan / distance / reverb) through ramped setters.
 */
export const useStageStore = defineStore('stage', () => {
  const mixer = useMixerStore()

  const positions = reactive<Record<string, StagePosition>>({})
  mixer.channels.forEach((ch, i) => {
    positions[ch.id] = DEFAULT_POSITIONS[ch.id] ?? {
      x: -3 + (i * 6) / Math.max(mixer.channels.length - 1, 1),
      z: -1,
    }
  })

  const roomPreset = ref<RoomPreset>('club')
  const roomSize = ref(1)

  function pushSpatial(id: string) {
    const pos = positions[id]
    if (pos) engine.setSpatial(id, computeSpatial(pos))
  }

  function setPosition(id: string, pos: StagePosition) {
    positions[id] = {
      x: clamp(pos.x, STAGE_BOUNDS.minX, STAGE_BOUNDS.maxX),
      z: clamp(pos.z, STAGE_BOUNDS.minZ, STAGE_BOUNDS.maxZ),
    }
    pushSpatial(id)
  }

  let irTimer: ReturnType<typeof setTimeout> | undefined
  let irGeneration = 0
  async function applyRoom() {
    const sampleRate = engine.getSampleRate()
    if (!sampleRate) return
    const generation = ++irGeneration
    const spec = roomSpec(roomPreset.value, roomSize.value)
    const ir = await renderRoomIR(sampleRate, spec)
    // A newer render superseded this one while it was rendering.
    if (generation !== irGeneration) return
    engine.setRoom(ir, spec.wet)
  }
  function scheduleRoom() {
    clearTimeout(irTimer)
    irTimer = setTimeout(() => void applyRoom(), IR_DEBOUNCE_MS)
  }

  function setRoomPreset(preset: RoomPreset) {
    roomPreset.value = preset
    scheduleRoom()
  }
  function setRoomSize(size: number) {
    roomSize.value = size
    scheduleRoom()
  }

  // The engine graph is (re)built lazily on first Play — push the whole
  // stage state once it exists.
  watch(
    () => engineState.built,
    (built) => {
      if (!built) return
      for (const id of Object.keys(positions)) pushSpatial(id)
      void applyRoom()
    },
    { immediate: true },
  )

  return {
    positions,
    roomPreset,
    roomSize,
    setPosition,
    setRoomPreset,
    setRoomSize,
  }
})
