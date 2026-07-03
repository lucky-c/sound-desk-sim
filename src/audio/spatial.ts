import { clamp } from '../lib/units'

/**
 * Stage spatialization: pure math mapping a performer's stage position to
 * audible parameters (stereo pan, dry level, reverb send), plus synthesized
 * room impulse responses so the venue needs zero external files.
 *
 * Coordinates are meters. The stage is centered on the origin: x+ is stage
 * left-to-right AS THE AUDIENCE SEES IT (positive = right), z+ points toward
 * the audience. The listener (mix position) is fixed at front-of-house.
 */

export interface StagePosition {
  x: number
  z: number
}

/** The fixed front-of-house listening position, out in the audience. */
export const FOH_POS: Readonly<StagePosition> = { x: 0, z: 8 }

/** Playable stage area (drag clamps to this). */
export const STAGE_BOUNDS = { minX: -4.5, maxX: 4.5, minZ: -3.5, maxZ: 1.5 }

/** Distance from FOH to the front-center of the stage — the 0 dB reference. */
const REF_DIST = Math.hypot(FOH_POS.x, FOH_POS.z - STAGE_BOUNDS.maxZ)

export interface SpatialParams {
  /** Stereo pan, -1 (hard left) .. 1 (hard right). */
  pan: number
  /** Dry-path gain (distance attenuation), 0..1. */
  dry: number
  /** Reverb-send gain: farther performers sound wetter. */
  send: number
}

export function computeSpatial(
  pos: StagePosition,
  foh: Readonly<StagePosition> = FOH_POS,
): SpatialParams {
  const dx = pos.x - foh.x
  const dz = pos.z - foh.z
  const dist = Math.max(Math.hypot(dx, dz), 0.001)

  // Pan follows the azimuth from the listener, slightly widened so the
  // stage edges reach a convincing (not hard) pan.
  const pan = clamp((dx / dist) * 1.4, -1, 1)

  // Inverse-distance attenuation referenced to the stage front.
  const dry = clamp(REF_DIST / dist, 0.2, 1)

  // Farther into the stage = proportionally more room in the sound.
  const send = clamp(0.15 + 0.4 * ((dist - REF_DIST) / REF_DIST), 0.1, 0.7)

  return { pan, dry, send }
}

// ---- rooms ----

export type RoomPreset = 'club' | 'hall' | 'openair'

export interface RoomSpec {
  /** Reverb tail length in seconds (before the size multiplier). */
  decaySeconds: number
  /** Lowpass on the tail — smaller rooms/soft walls damp highs harder. */
  dampHz: number
  /** Wet-bus gain into the master. */
  wet: number
}

export const ROOM_PRESETS: Record<RoomPreset, { label: string; base: RoomSpec }> = {
  club: {
    label: 'Club',
    base: { decaySeconds: 0.7, dampHz: 2800, wet: 0.22 },
  },
  hall: {
    label: 'Hall',
    base: { decaySeconds: 2.0, dampHz: 5000, wet: 0.32 },
  },
  openair: {
    label: 'Open air',
    base: { decaySeconds: 0.25, dampHz: 6000, wet: 0.07 },
  },
}

/** Size multiplier range for the room-size slider. */
export const ROOM_SIZE_RANGE = { min: 0.5, max: 2 }

/** Scale a preset by the room-size slider. */
export function roomSpec(preset: RoomPreset, size: number): RoomSpec {
  const s = clamp(size, ROOM_SIZE_RANGE.min, ROOM_SIZE_RANGE.max)
  const base = ROOM_PRESETS[preset].base
  return {
    decaySeconds: base.decaySeconds * s,
    dampHz: base.dampHz,
    wet: base.wet * (0.7 + 0.3 * s),
  }
}

/**
 * Synthesize a stereo room impulse response: exponentially decaying noise
 * through a damping lowpass, rendered offline at the LIVE context's sample
 * rate (never hardcoded).
 */
export async function renderRoomIR(
  sampleRate: number,
  spec: RoomSpec,
): Promise<AudioBuffer> {
  const dur = Math.max(0.08, spec.decaySeconds * 1.4)
  const length = Math.round(dur * sampleRate)
  const off = new OfflineAudioContext(2, length, sampleRate)

  const noiseBuf = off.createBuffer(2, length, sampleRate)
  for (let c = 0; c < 2; c++) {
    const data = noiseBuf.getChannelData(c)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  const src = off.createBufferSource()
  src.buffer = noiseBuf

  const damp = off.createBiquadFilter()
  damp.type = 'lowpass'
  damp.frequency.value = spec.dampHz
  damp.Q.value = 0.5

  const env = off.createGain()
  env.gain.setValueAtTime(1, 0)
  env.gain.exponentialRampToValueAtTime(0.001, dur)

  src.connect(damp)
  damp.connect(env)
  env.connect(off.destination)
  src.start(0)
  return off.startRendering()
}
