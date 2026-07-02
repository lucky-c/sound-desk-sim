import { describe, expect, test } from 'bun:test'
import { validateChallenge } from '../src/challenges/validate'
import type { Challenge } from '../src/challenges/types'
import type { ChannelParams, MixSnapshot } from '../src/types'

function params(overrides: Partial<ChannelParams> = {}): ChannelParams {
  return {
    gainDb: 0,
    hpfHz: 100,
    eqHz: 1000,
    eqGainDb: 0,
    compThresholdDb: -20,
    compRatio: 4,
    faderDb: -6,
    mute: false,
    solo: false,
    ...overrides,
  }
}

function snapshot(vocal: Partial<ChannelParams> = {}, masterDb = 0): MixSnapshot {
  return {
    channels: { vocal: params(vocal) },
    master: { faderDb: masterDb },
  }
}

const bandChallenge: Challenge = {
  id: 'band',
  title: 'Band test',
  description: 'range-only condition',
  targets: [
    {
      channel: 'vocal',
      param: 'eqGainDb',
      label: 'Vocal EQ gain',
      range: { min: -6, max: -2 },
    },
  ],
}

describe('tolerance-band validation (never exact-match)', () => {
  test('passes anywhere inside the band, not just at one value', () => {
    for (const v of [-6, -5.1, -4, -2.7, -2]) {
      const result = validateChallenge(bandChallenge, snapshot({ eqGainDb: v }), snapshot())
      expect(result.solved).toBe(true)
    }
  })

  test('fails when the value is outside the band, with directional guidance', () => {
    const tooHigh = validateChallenge(bandChallenge, snapshot({ eqGainDb: 3 }), snapshot())
    expect(tooHigh.solved).toBe(false)
    expect(tooHigh.targets[0]?.met).toBe(false)
    expect(tooHigh.targets[0]?.guidance).toContain('down')

    const tooLow = validateChallenge(bandChallenge, snapshot({ eqGainDb: -12 }), snapshot())
    expect(tooLow.solved).toBe(false)
    expect(tooLow.targets[0]?.guidance).toContain('up')
  })

  test('band edges are inclusive; just outside fails', () => {
    const atMin = validateChallenge(bandChallenge, snapshot({ eqGainDb: -6 }), snapshot())
    expect(atMin.solved).toBe(true)

    const atMax = validateChallenge(bandChallenge, snapshot({ eqGainDb: -2 }), snapshot())
    expect(atMax.solved).toBe(true)

    const belowMin = validateChallenge(bandChallenge, snapshot({ eqGainDb: -6.01 }), snapshot())
    expect(belowMin.solved).toBe(false)

    const aboveMax = validateChallenge(bandChallenge, snapshot({ eqGainDb: -1.99 }), snapshot())
    expect(aboveMax.solved).toBe(false)
  })
})

describe('anyOf groups (multiple valid solutions)', () => {
  const anyOfChallenge: Challenge = {
    id: 'anyof',
    title: 'AnyOf test',
    description: 'either fix works',
    targets: [
      {
        label: 'Clean the low end',
        anyOf: [
          { channel: 'vocal', param: 'hpfHz', label: 'HPF', range: { min: 150, max: 400 } },
          { channel: 'vocal', param: 'eqGainDb', label: 'EQ cut', range: { max: -3 } },
        ],
      },
    ],
  }

  test('passes when only the first alternative is met', () => {
    const result = validateChallenge(
      anyOfChallenge,
      snapshot({ hpfHz: 200, eqGainDb: 5 }),
      snapshot(),
    )
    expect(result.solved).toBe(true)
  })

  test('passes when only the second alternative is met', () => {
    const result = validateChallenge(
      anyOfChallenge,
      snapshot({ hpfHz: 40, eqGainDb: -4 }),
      snapshot(),
    )
    expect(result.solved).toBe(true)
  })

  test('fails when no alternative is met, exposing each branch result', () => {
    const result = validateChallenge(
      anyOfChallenge,
      snapshot({ hpfHz: 40, eqGainDb: 5 }),
      snapshot(),
    )
    expect(result.solved).toBe(false)
    expect(result.targets[0]?.branches).toHaveLength(2)
    expect(result.targets[0]?.branches?.every((b) => !b.met)).toBe(true)
  })
})

describe('multiple ANDed targets', () => {
  const andChallenge: Challenge = {
    id: 'and',
    title: 'AND test',
    description: 'both must pass',
    targets: [
      { channel: 'vocal', param: 'faderDb', label: 'Vocal level', range: { min: -10, max: 0 } },
      { channel: 'master', param: 'faderDb', label: 'Master level', range: { max: 0 } },
    ],
  }

  test('solved only when every target passes', () => {
    const half = validateChallenge(andChallenge, snapshot({ faderDb: -5 }, 3), snapshot())
    expect(half.solved).toBe(false)
    expect(half.targets.map((t) => t.met)).toEqual([true, false])

    const both = validateChallenge(andChallenge, snapshot({ faderDb: -5 }, -1), snapshot())
    expect(both.solved).toBe(true)
  })
})

describe('direction conditions (relative to the initial state)', () => {
  const directionChallenge: Challenge = {
    id: 'dir',
    title: 'Direction test',
    description: 'must reduce from initial',
    targets: [
      {
        channel: 'vocal',
        param: 'eqGainDb',
        label: 'EQ boost',
        direction: 'decrease',
        minDelta: 6,
      },
    ],
  }
  const initial = snapshot({ eqGainDb: 9 })

  test('unmet until reduced by at least minDelta from initial', () => {
    const barelyMoved = validateChallenge(directionChallenge, snapshot({ eqGainDb: 5 }), initial)
    expect(barelyMoved.solved).toBe(false)
    expect(barelyMoved.targets[0]?.guidance).toBeTruthy()

    const enough = validateChallenge(directionChallenge, snapshot({ eqGainDb: 3 }), initial)
    expect(enough.solved).toBe(true)
  })
})

describe('robustness', () => {
  test('unknown channel or parameter never crashes, just fails the condition', () => {
    const bad: Challenge = {
      id: 'bad',
      title: 'Bad ref',
      description: 'points at nothing',
      targets: [
        { channel: 'nope', param: 'eqGainDb', label: 'Ghost', range: { max: 0 } },
        { channel: 'master', param: 'eqGainDb', label: 'Master has no EQ', range: { max: 0 } },
      ],
    }
    const result = validateChallenge(bad, snapshot(), snapshot())
    expect(result.solved).toBe(false)
    expect(result.targets.every((t) => !t.met)).toBe(true)
  })
})
