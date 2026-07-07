<script setup lang="ts">
import { computed } from 'vue'
import { useChallengeStore } from '../stores/challenges'

const store = useChallengeStore()

const hints = computed(() => store.active?.hints ?? [])
const hintsLeft = computed(() => hints.value.length - store.revealedHints)
const listeningToA = computed(() => store.abState === 'A')
</script>

<template>
  <aside
    class="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950/90 p-4 backdrop-blur"
  >
    <!-- Picker (free-mix mode) -->
    <template v-if="!store.active">
      <h2 class="text-sm font-semibold text-zinc-200">Challenges</h2>
      <p class="text-xs leading-relaxed text-zinc-500">
        Pick a scenario: it sets up a broken mix, and you fix it by ear. Any
        settings inside the acceptable ranges count — there's more than one
        right answer.
      </p>
      <button
        v-for="challenge in store.allChallenges"
        :key="challenge.id"
        class="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-left transition-colors hover:border-emerald-800 hover:bg-zinc-900"
        @click="store.load(challenge.id)"
      >
        <span class="block text-sm font-semibold text-zinc-200">
          {{ challenge.title }}
        </span>
        <span class="mt-1 block text-xs leading-snug text-zinc-500">
          {{ challenge.description }}
        </span>
      </button>
      <p class="text-[11px] text-zinc-600">
        You're in free-mix mode — the desk is all yours.
      </p>
    </template>

    <!-- Active challenge -->
    <template v-else>
      <div class="flex items-start justify-between gap-2">
        <h2 class="text-sm font-semibold text-zinc-200">{{ store.active.title }}</h2>
        <button
          class="rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-700"
          @click="store.exit()"
        >
          Exit
        </button>
      </div>

      <p class="text-xs leading-relaxed text-zinc-400">
        {{ store.active.description }}
      </p>

      <!-- A/B comparison -->
      <div class="rounded-md border border-zinc-800 bg-zinc-950 p-2">
        <p class="mb-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
          A/B compare
        </p>
        <div class="flex overflow-hidden rounded-md border border-zinc-700 text-xs font-semibold">
          <button
            class="flex-1 px-2 py-1.5 transition-colors"
            :class="listeningToA ? 'bg-amber-500 text-black' : 'bg-zinc-900 text-zinc-500 hover:bg-zinc-800'"
            @click="listeningToA || store.toggleAB()"
          >
            A · original
          </button>
          <button
            class="flex-1 px-2 py-1.5 transition-colors"
            :class="!listeningToA ? 'bg-emerald-500 text-black' : 'bg-zinc-900 text-zinc-500 hover:bg-zinc-800'"
            @click="listeningToA && store.toggleAB()"
          >
            B · your mix
          </button>
        </div>
        <p v-if="listeningToA" class="mt-1.5 text-[11px] text-amber-400">
          Listening to the original problem state — the desk is frozen until
          you switch back to B.
        </p>
      </div>

      <!-- Success -->
      <div
        v-if="store.solved && !listeningToA"
        class="rounded-md border border-emerald-700 bg-emerald-950 p-3 text-sm font-semibold text-emerald-300"
      >
        Solved — nice ears. A/B it against the original to hear what you fixed,
        or exit and try another one.
      </div>

      <!-- Targets -->
      <div class="flex flex-col gap-2">
        <p class="text-[10px] uppercase tracking-wide text-zinc-500">Goals</p>
        <div
          v-for="(target, i) in store.result?.targets ?? []"
          :key="i"
          class="rounded-md border p-2"
          :class="target.met ? 'border-emerald-900 bg-emerald-950/40' : 'border-zinc-800 bg-zinc-950'"
        >
          <div class="flex items-center gap-2 text-xs">
            <span
              class="flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold"
              :class="target.met ? 'bg-emerald-500 text-black' : 'bg-zinc-800 text-zinc-500'"
            >
              {{ target.met ? '✓' : '·' }}
            </span>
            <span :class="target.met ? 'text-emerald-300' : 'text-zinc-300'">
              {{ target.label }}
            </span>
          </div>

          <!-- Directional guidance for an unmet single condition -->
          <p
            v-if="!target.met && target.guidance"
            class="mt-1.5 pl-6 text-[11px] leading-snug text-zinc-500"
          >
            {{ target.guidance }}
          </p>

          <!-- anyOf group: show each alternative -->
          <ul
            v-if="!target.met && target.branches"
            class="mt-1.5 flex flex-col gap-1 pl-6"
          >
            <li
              v-for="(branch, j) in target.branches"
              :key="j"
              class="text-[11px] leading-snug text-zinc-500"
            >
              <span v-if="j > 0" class="font-semibold text-zinc-600">or </span>
              {{ branch.guidance ?? branch.label }}
            </li>
          </ul>
        </div>
      </div>

      <!-- Hints -->
      <div class="mt-1 flex flex-col gap-1.5">
        <p
          v-for="(hint, i) in hints.slice(0, store.revealedHints)"
          :key="i"
          class="rounded-md bg-zinc-800/60 p-2 text-[11px] leading-snug text-zinc-400"
        >
          {{ hint }}
        </p>
        <button
          v-if="hintsLeft > 0"
          class="self-start rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-700"
          @click="store.revealHint()"
        >
          Show a hint ({{ hintsLeft }} left)
        </button>
      </div>

      <button
        class="mt-auto self-start rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-700"
        @click="store.reset()"
      >
        Reset to the problem state
      </button>
    </template>
  </aside>
</template>
