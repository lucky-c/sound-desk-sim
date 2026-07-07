import type { NumericParamKey } from '../types'

/**
 * Declarative challenge schema. Challenges are pure data — adding one is a
 * data change in `data.ts`, never a component change.
 *
 * Core principle: validation is TOLERANCE-BAND based. A condition passes
 * anywhere inside its range (inclusive). Exact-match validation is forbidden.
 */

/** A channel id from the mixer store, or 'master' for the master bus. */
export type ChannelRef = string | 'master'

/** One tolerance-band condition on a single parameter. */
export interface ParamCondition {
  /** Which strip the parameter lives on ('master' supports faderDb only). */
  channel: ChannelRef
  param: NumericParamKey
  /** Short human name shown in the feedback panel, e.g. "Pad EQ gain". */
  label: string
  /**
   * The acceptable band (inclusive on both ends). Omit min or max for a
   * one-sided band. At least one of range/direction must be present.
   */
  range?: { min?: number; max?: number }
  /**
   * Optional relative requirement against the challenge's initial state:
   * the value must have moved down ('decrease') or up ('increase') by at
   * least `minDelta` (default 1) from where the challenge started.
   */
  direction?: 'decrease' | 'increase'
  minDelta?: number
  /**
   * Directional feedback shown while unmet. `tooLow` when the value sits
   * below the band, `tooHigh` when above. Guide toward the range — never
   * reveal exact target numbers.
   */
  guidance?: { tooLow?: string; tooHigh?: string }
}

/**
 * A group satisfied by ANY ONE of its conditions — this is how a challenge
 * admits multiple valid solutions (e.g. "high-pass it OR cut the EQ").
 */
export interface AnyOfTarget {
  label: string
  anyOf: ParamCondition[]
}

/** Top-level targets are ANDed; an entry is a single condition or an anyOf group. */
export type ChallengeTarget = ParamCondition | AnyOfTarget

export function isAnyOf(target: ChallengeTarget): target is AnyOfTarget {
  return 'anyOf' in target
}

/** A parameter override applied when a challenge loads, to CREATE the problem. */
export interface ParamOverride {
  channel: ChannelRef
  param: NumericParamKey
  value: number
}

/**
 * A simulated monitor-feedback loop: while the challenge is active, the
 * channel's post-fader signal loops back into its mic through a narrow
 * bandpass at `freqHz`. If the loop gain exceeds unity it audibly howls —
 * and an EQ cut at the ring frequency genuinely tames it.
 */
export interface FeedbackSpec {
  channel: string
  freqHz: number
  loopGainDb: number
}

export interface Challenge {
  id: string
  title: string
  /** Plain-language problem description, e.g. "The pad sounds muddy and buried". */
  description: string
  /** Applied on load via the store's ramped setters (on top of the default mix). */
  initialState?: ParamOverride[]
  /** Optional live feedback loop that creates the problem physically. */
  feedback?: FeedbackSpec
  targets: ChallengeTarget[]
  /** Ordered, progressively more specific nudges. */
  hints?: string[]
}

/** Per-condition outcome with directional guidance when unmet. */
export interface ConditionResult {
  label: string
  met: boolean
  /** Which way to move: null when met (or indeterminate). */
  guidance: string | null
}

/** Outcome of one top-level target (a condition, or an anyOf group). */
export interface TargetResult {
  label: string
  met: boolean
  guidance: string | null
  /** Present for anyOf groups: each alternative's own result. */
  branches?: ConditionResult[]
}

export interface ValidationResult {
  targets: TargetResult[]
  solved: boolean
}
