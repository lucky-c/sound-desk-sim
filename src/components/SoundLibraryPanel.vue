<script setup lang="ts">
import { ref } from 'vue'
import { useSoundLibraryStore } from '../stores/soundLibrary'
import { SPB } from '../audio/instruments'

/**
 * Upload and manage Sound Library entries. Files are decoded once here just
 * to suggest a loop length in beats (so the sound can grid-align to the 112
 * BPM groove), then stored in IndexedDB via the store.
 */

const library = useSoundLibraryStore()

/** Cap uploads so a stray huge file can't exhaust the browser's storage
 *  quota or stall decoding. Loops/stems are comfortably under this. */
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024

const name = ref('')
const beats = ref(16)
const durationSec = ref<number | null>(null)
const file = ref<File | null>(null)
const busy = ref(false)
const error = ref('')

// A throwaway context is enough to decode for duration — no playback, no
// user gesture needed.
let decodeCtx: OfflineAudioContext | null = null
function ctx(): OfflineAudioContext {
  return (decodeCtx ??= new OfflineAudioContext(1, 1, 44100))
}

async function onPick(event: Event) {
  error.value = ''
  const picked = (event.target as HTMLInputElement).files?.[0] ?? null
  durationSec.value = null
  if (!picked) {
    file.value = null
    return
  }
  if (picked.size > MAX_UPLOAD_BYTES) {
    error.value = `That file is too large (${(picked.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`
    file.value = null
    return
  }
  file.value = picked
  name.value = picked.name.replace(/\.[^.]+$/, '')
  try {
    const buf = await ctx().decodeAudioData(await picked.slice().arrayBuffer())
    durationSec.value = buf.duration
    beats.value = Math.max(1, Math.round(buf.duration / SPB))
  } catch {
    error.value = "Couldn't decode that file — try WAV or MP3."
    file.value = null
  }
}

async function submit() {
  if (!file.value || !name.value.trim() || beats.value < 1) return
  busy.value = true
  error.value = ''
  try {
    await library.add({ name: name.value.trim(), beats: beats.value, file: file.value })
    reset()
  } catch {
    error.value = 'Save failed — storage may be full or blocked.'
  } finally {
    busy.value = false
  }
}

function reset() {
  name.value = ''
  beats.value = 16
  durationSec.value = null
  file.value = null
}
</script>

<template>
  <div class="w-72 rounded-lg border border-zinc-800 bg-zinc-950/95 p-3 backdrop-blur">
    <p class="mb-2 text-[10px] uppercase tracking-wide text-zinc-500">Sound Library</p>

    <!-- upload form -->
    <label class="mb-2 block cursor-pointer rounded border border-dashed border-zinc-700 px-2 py-2 text-center text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-300">
      {{ file ? file.name : 'Choose an audio file…' }}
      <input type="file" accept="audio/*" class="hidden" @change="onPick" />
    </label>

    <div v-if="file" class="mb-2 space-y-1.5">
      <input
        v-model="name"
        placeholder="Name"
        class="w-full rounded bg-zinc-800/80 px-2 py-1 text-[11px] text-zinc-200 placeholder:text-zinc-600"
      />
      <div class="flex items-center gap-2">
        <label class="text-[11px] text-zinc-400">Loop length</label>
        <input
          v-model.number="beats"
          type="number"
          min="1"
          class="w-16 rounded bg-zinc-800/80 px-2 py-1 text-[11px] text-zinc-200"
        />
        <span class="text-[11px] text-zinc-500">beats</span>
      </div>
      <p v-if="durationSec != null" class="text-[10px] text-zinc-600">
        {{ durationSec.toFixed(2) }}s at 112 BPM ≈ {{ (durationSec / SPB).toFixed(1) }} beats
      </p>
      <button
        class="w-full rounded bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-zinc-950 hover:bg-emerald-500 disabled:opacity-50"
        :disabled="busy || !name.trim() || beats < 1"
        @click="submit"
      >
        {{ busy ? 'Saving…' : 'Add to library' }}
      </button>
    </div>

    <p v-if="error" class="mb-2 text-[10px] text-red-400">{{ error }}</p>

    <!-- existing sounds -->
    <div v-if="library.sounds.length" class="space-y-1 border-t border-zinc-800/70 pt-2">
      <div
        v-for="s in library.sounds"
        :key="s.id"
        class="flex items-center gap-2 text-[11px]"
      >
        <span class="inline-block h-2 w-2 shrink-0 rounded-full" :style="{ background: s.color }" />
        <span class="flex-1 truncate text-zinc-300">{{ s.name }}</span>
        <span class="text-zinc-600">{{ s.beats }}b</span>
        <button
          class="rounded px-1 text-zinc-600 hover:text-red-400"
          title="Delete"
          @click="library.remove(s.id)"
        >
          ✕
        </button>
      </div>
    </div>
    <p v-else class="text-[10px] text-zinc-600">
      No uploads yet. Add a stem or loop — it appears in every channel's picker.
    </p>
  </div>
</template>
