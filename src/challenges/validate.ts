import type { MixSnapshot } from '../types'
import type {
  Challenge,
  ChannelRef,
  ConditionResult,
  ParamCondition,
  TargetResult,
  ValidationResult,
} from './types'
import { isAnyOf } from './types'

/**
 * Pure tolerance-band validation. No DOM, no audio, no store access —
 * plain data in, plain data out, so it's trivially unit-testable.
 *
 * A condition is met anywhere INSIDE its inclusive range. Exact-match
 * comparison is deliberately absent from this module.
 */

function readParam(
  snap: MixSnapshot,
  channel: ChannelRef,
  param: ParamCondition['param'],
): number | undefined {
  if (channel === 'master') {
    return param === 'faderDb' ? snap.master.faderDb : undefined
  }
  return snap.channels[channel]?.[param]
}

function evaluateCondition(
  c: ParamCondition,
  current: MixSnapshot,
  initial: MixSnapshot,
): ConditionResult {
  const value = readParam(current, c.channel, c.param)
  if (value === undefined) {
    return { label: c.label, met: false, guidance: null }
  }

  // 'low' = value sits below the acceptable band, 'high' = above it.
  let off: 'low' | 'high' | null = null

  if (c.range) {
    if (c.range.min !== undefined && value < c.range.min) off = 'low'
    else if (c.range.max !== undefined && value > c.range.max) off = 'high'
  }

  if (off === null && c.direction) {
    const start = readParam(initial, c.channel, c.param)
    if (start !== undefined) {
      const delta = c.minDelta ?? 1
      if (c.direction === 'decrease' && value > start - delta) off = 'high'
      if (c.direction === 'increase' && value < start + delta) off = 'low'
    }
  }

  if (off === null) return { label: c.label, met: true, guidance: null }

  const guidance =
    off === 'low'
      ? (c.guidance?.tooLow ?? `${c.label} is too low — bring it up.`)
      : (c.guidance?.tooHigh ?? `${c.label} is too high — bring it down.`)
  return { label: c.label, met: false, guidance }
}

export function validateChallenge(
  challenge: Challenge,
  current: MixSnapshot,
  initial: MixSnapshot,
): ValidationResult {
  const targets: TargetResult[] = challenge.targets.map((target) => {
    if (isAnyOf(target)) {
      const branches = target.anyOf.map((c) => evaluateCondition(c, current, initial))
      const met = branches.some((b) => b.met)
      return { label: target.label, met, guidance: null, branches }
    }
    const result = evaluateCondition(target, current, initial)
    return { label: target.label, met: result.met, guidance: result.guidance }
  })

  return { targets, solved: targets.every((t) => t.met) }
}
