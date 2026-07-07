import { describe, expect, test } from 'bun:test'
import {
  FOH_POS,
  ROOM_SIZE_RANGE,
  STAGE_BOUNDS,
  computeBleedGain,
  computeSpatial,
  roomSpec,
} from '../src/audio/spatial'

describe('computeSpatial: position → pan / dry / send', () => {
  test('center stage is centered and full level', () => {
    const s = computeSpatial({ x: 0, z: STAGE_BOUNDS.maxZ })
    expect(s.pan).toBe(0)
    expect(s.dry).toBeCloseTo(1, 5)
  })

  test('stage left pans left, stage right pans right (audience view)', () => {
    const left = computeSpatial({ x: -4, z: 0 })
    const right = computeSpatial({ x: 4, z: 0 })
    expect(left.pan).toBeLessThan(-0.3)
    expect(right.pan).toBeGreaterThan(0.3)
    expect(left.pan).toBeCloseTo(-right.pan, 5)
  })

  test('moving away from FOH monotonically lowers dry and raises send', () => {
    const near = computeSpatial({ x: 0, z: STAGE_BOUNDS.maxZ })
    const mid = computeSpatial({ x: 0, z: -1 })
    const far = computeSpatial({ x: 0, z: STAGE_BOUNDS.minZ })
    expect(near.dry).toBeGreaterThan(mid.dry)
    expect(mid.dry).toBeGreaterThan(far.dry)
    expect(near.send).toBeLessThan(mid.send)
    expect(mid.send).toBeLessThan(far.send)
  })

  test('outputs stay within audio-safe ranges everywhere on stage', () => {
    for (const x of [-4.5, -2, 0, 2, 4.5]) {
      for (const z of [-3.5, -1, 1.5]) {
        const s = computeSpatial({ x, z })
        expect(s.pan).toBeGreaterThanOrEqual(-1)
        expect(s.pan).toBeLessThanOrEqual(1)
        expect(s.dry).toBeGreaterThan(0)
        expect(s.dry).toBeLessThanOrEqual(1)
        expect(s.send).toBeGreaterThanOrEqual(0)
        expect(s.send).toBeLessThanOrEqual(1)
      }
    }
  })

  test('degenerate position (at the listener) does not produce NaN', () => {
    const s = computeSpatial({ x: FOH_POS.x, z: FOH_POS.z })
    expect(Number.isFinite(s.pan)).toBe(true)
    expect(Number.isFinite(s.dry)).toBe(true)
    expect(Number.isFinite(s.send)).toBe(true)
  })
})

describe('computeBleedGain: mic bleed by distance', () => {
  test('closer performers bleed more (monotonic decrease)', () => {
    const near = computeBleedGain(0.6, 1)
    const mid = computeBleedGain(1.5, 1)
    const far = computeBleedGain(3, 1)
    expect(near).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(far)
  })

  test('bleed is always well below unity and never negative', () => {
    for (const d of [0.1, 0.5, 1, 2, 5, 10]) {
      const g = computeBleedGain(d, 1)
      expect(g).toBeGreaterThanOrEqual(0)
      expect(g).toBeLessThan(0.5)
    }
  })

  test('inaudible contributions round to exactly zero', () => {
    expect(computeBleedGain(20, 1)).toBe(0)
  })

  test('the amount control scales linearly and 0 disables', () => {
    expect(computeBleedGain(1, 0)).toBe(0)
    expect(computeBleedGain(1, 0.5)).toBeCloseTo(computeBleedGain(1, 1) / 2, 6)
  })
})

describe('roomSpec: presets × size', () => {
  test('bigger rooms decay longer and are wetter', () => {
    const small = roomSpec('hall', ROOM_SIZE_RANGE.min)
    const big = roomSpec('hall', ROOM_SIZE_RANGE.max)
    expect(big.decaySeconds).toBeGreaterThan(small.decaySeconds)
    expect(big.wet).toBeGreaterThan(small.wet)
  })

  test('size is clamped to the slider range', () => {
    expect(roomSpec('club', 100).decaySeconds).toBe(
      roomSpec('club', ROOM_SIZE_RANGE.max).decaySeconds,
    )
    expect(roomSpec('club', 0).decaySeconds).toBe(
      roomSpec('club', ROOM_SIZE_RANGE.min).decaySeconds,
    )
  })

  test('open-air is drier and shorter than any indoor preset at equal size', () => {
    const open = roomSpec('openair', 1)
    const club = roomSpec('club', 1)
    const hall = roomSpec('hall', 1)
    expect(open.wet).toBeLessThan(club.wet)
    expect(open.wet).toBeLessThan(hall.wet)
    expect(open.decaySeconds).toBeLessThan(club.decaySeconds)
  })
})
