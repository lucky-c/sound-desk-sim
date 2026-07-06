import { reactive, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { RoomPreset, StagePosition } from '../audio/spatial'
import {
  STAGE_BOUNDS,
  computeBleedGain,
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

/** Where each instrument naturally stands when plugged in. */
const INSTRUMENT_POSITIONS: Record<string, StagePosition> = {
  kick: { x: 0, z: -3 },
  snare: { x: 0.8, z: -3 },
  hats: { x: -0.8, z: -3 },
  shaker: { x: -1.8, z: -2.6 },
  cowbell: { x: 1.8, z: -3.2 },
  bass: { x: -2.6, z: -1.8 },
  guitar: { x: 3.2, z: -1 },
  'guitar-lead': { x: 2.6, z: 0.6 },
  keys: { x: -3.2, z: -0.4 },
  pad: { x: 3.9, z: -2.6 },
  brass: { x: 1.4, z: -2 },
  lead: { x: 0, z: 0.9 },
}

/**
 * Stage state: where each performer stands and what room they play in.
 * Purely additive over the mixer — positions and room feed the engine's
 * spatial section (pan / distance / reverb) through ramped setters.
 * Positions are keyed by channel slot; a slot gets its instrument's natural
 * spot when something is plugged into it.
 */
export const useStageStore = defineStore('stage', () => {
  const mixer = useMixerStore()

  const positions = reactive<Record<string, StagePosition>>({})

  function defaultPositionFor(instrumentId: string, index: number): StagePosition {
    return (
      INSTRUMENT_POSITIONS[instrumentId] ?? {
        x: -4 + (index % 8),
        z: -1.5,
      }
    )
  }

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
    scheduleBleeds()
  }

  // ---- mic bleed ----
  /** Global bleed amount, 0..1: how leaky the stage mics are. */
  const bleedAmount = ref(0.5)

  let bleedTimer: ReturnType<typeof setTimeout> | undefined
  function scheduleBleeds() {
    clearTimeout(bleedTimer)
    bleedTimer = setTimeout(updateAllBleeds, 80)
  }

  /** Push the full pairwise bleed matrix into the engine (plugged mics only). */
  function updateAllBleeds() {
    if (!engineState.built) return
    const plugged = mixer.channels.filter((ch) => ch.instrumentId)
    for (const to of plugged) {
      const pTo = positions[to.id]
      if (!pTo) continue
      for (const from of plugged) {
        if (from.id === to.id) continue
        const pFrom = positions[from.id]
        if (!pFrom) continue
        const dist = Math.hypot(pFrom.x - pTo.x, pFrom.z - pTo.z)
        engine.setBleed(from.id, to.id, computeBleedGain(dist, bleedAmount.value))
      }
    }
  }

  function setBleedAmount(v: number) {
    bleedAmount.value = clamp(v, 0, 1)
    scheduleBleeds()
  }

  // Give newly-plugged channels their instrument's natural stage spot —
  // without touching positions the user already moved.
  const lastPlug: Record<string, string | null> = {}
  watch(
    () => mixer.channels.map((ch) => `${ch.id}:${ch.instrumentId ?? ''}`).join(','),
    () => {
      mixer.channels.forEach((ch, i) => {
        if (ch.instrumentId === (lastPlug[ch.id] ?? null)) return
        lastPlug[ch.id] = ch.instrumentId
        if (ch.instrumentId) {
          setPosition(ch.id, defaultPositionFor(ch.instrumentId, i))
        } else {
          delete positions[ch.id]
        }
      })
      scheduleBleeds()
    },
    { immediate: true },
  )

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
      updateAllBleeds()
    },
    { immediate: true },
  )

  return {
    positions,
    roomPreset,
    roomSize,
    bleedAmount,
    setPosition,
    setRoomPreset,
    setRoomSize,
    setBleedAmount,
  }
})
