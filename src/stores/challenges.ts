import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { MixSnapshot } from '../types'
import type { Challenge, ValidationResult } from '../challenges/types'
import { challenges } from '../challenges/data'
import { validateChallenge } from '../challenges/validate'
import { defaultMixSnapshot, useMixerStore } from './mixer'

/** Debounce so validation doesn't thrash on every slider tick. */
const VALIDATE_DEBOUNCE_MS = 200

/**
 * The challenge layer. It never touches audio directly: every state change
 * goes through the mixer store's ramped setters, and validation reads plain
 * snapshots of the same store. Free-mix mode is simply "no active challenge".
 */
export const useChallengeStore = defineStore('challenges', () => {
  const mixer = useMixerStore()

  const activeId = ref<string | null>(null)
  const active = computed<Challenge | null>(
    () => challenges.find((c) => c.id === activeId.value) ?? null,
  )

  /** The learner's free mix, restored when leaving challenge mode. */
  const freeMixSnapshot = ref<MixSnapshot | null>(null)
  /** The learner's channel plugging, restored when leaving challenge mode. */
  const freePlugging = ref<Record<string, string | null> | null>(null)
  /** The challenge's starting state (defaults + initialState) — the A reference. */
  const initialSnapshot = ref<MixSnapshot | null>(null)
  /** The learner's mix (B), parked while listening to A. */
  const parkedMix = ref<MixSnapshot | null>(null)

  /** Which parameter set is audible: A = original/problem, B = your mix. */
  const abState = ref<'A' | 'B'>('B')

  const revealedHints = ref(0)
  const result = ref<ValidationResult | null>(null)
  const solved = computed(() => result.value?.solved ?? false)

  function runValidation() {
    if (!active.value || !initialSnapshot.value) return
    result.value = validateChallenge(
      active.value,
      mixer.snapshot(),
      initialSnapshot.value,
    )
  }

  let debounce: ReturnType<typeof setTimeout> | undefined
  watch(
    () => JSON.stringify([mixer.channels, mixer.master]),
    () => {
      if (!active.value || abState.value === 'A') return
      clearTimeout(debounce)
      debounce = setTimeout(runValidation, VALIDATE_DEBOUNCE_MS)
    },
  )

  function load(id: string) {
    // Entering from free mix: remember it. Switching challenges: keep the
    // original free mix as the thing to eventually return to.
    if (!activeId.value) {
      freeMixSnapshot.value = mixer.snapshot()
      freePlugging.value = mixer.plugMap()
    }

    const challenge = challenges.find((c) => c.id === id)
    if (!challenge) return

    activeId.value = id
    abState.value = 'B'
    revealedHints.value = 0
    parkedMix.value = null

    // Challenges are authored against the default band on ch 1–4.
    mixer.resetPluggingToDefault()

    // Build the problem: default mix + the challenge's overrides,
    // all through ramped setters (no graph rebuild, no clicks).
    const start = defaultMixSnapshot()
    for (const o of challenge.initialState ?? []) {
      if (o.channel === 'master') {
        if (o.param === 'faderDb') start.master.faderDb = o.value
        continue
      }
      const params = start.channels[o.channel]
      if (params) params[o.param] = o.value
    }
    mixer.applySnapshot(start)
    initialSnapshot.value = start
    runValidation()
  }

  function exit() {
    activeId.value = null
    result.value = null
    initialSnapshot.value = null
    parkedMix.value = null
    abState.value = 'B'
    if (freePlugging.value) mixer.applyPlugMap(freePlugging.value)
    if (freeMixSnapshot.value) mixer.applySnapshot(freeMixSnapshot.value)
  }

  /** Back to the challenge's starting point (the problem state). */
  function reset() {
    if (!activeId.value || !initialSnapshot.value) return
    abState.value = 'B'
    parkedMix.value = null
    mixer.applySnapshot(initialSnapshot.value)
    runValidation()
  }

  /** A/B: flip between the original problem state (A) and your mix (B). */
  function toggleAB() {
    if (!activeId.value || !initialSnapshot.value) return
    if (abState.value === 'B') {
      parkedMix.value = mixer.snapshot()
      mixer.applySnapshot(initialSnapshot.value)
      abState.value = 'A'
    } else {
      if (parkedMix.value) mixer.applySnapshot(parkedMix.value)
      parkedMix.value = null
      abState.value = 'B'
      runValidation()
    }
  }

  function revealHint() {
    const total = active.value?.hints?.length ?? 0
    if (revealedHints.value < total) revealedHints.value++
  }

  return {
    allChallenges: challenges,
    activeId,
    active,
    abState,
    revealedHints,
    result,
    solved,
    load,
    exit,
    reset,
    toggleAB,
    revealHint,
  }
})
