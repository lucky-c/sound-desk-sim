/**
 * The Sound Library: user-uploaded audio that plugs into the console
 * alongside the built-in synth instruments. Files live in IndexedDB (raw
 * audio blobs — far past what localStorage could hold), so they survive
 * reloads without any backend.
 *
 * Uploaded sounds are ADDED as new pluggable instruments; the 12 synths are
 * never touched. Each carries a user-set loop length in beats so it can be
 * grid-aligned to the desk's 112 BPM groove (see `startSource` in engine.ts).
 */

/** Metadata for one uploaded sound (everything but the audio bytes). */
export interface UserSound {
  id: string
  name: string
  color: string
  /** Acoustic stage level, dB. Uploads default to DI (PA-only, no backline). */
  acousticDb: number
  /** Loop length in beats, used to grid-align playback to the 112 BPM groove. */
  beats: number
}

/** The stored record adds the raw audio bytes and their MIME type. */
interface UserSoundRecord extends UserSound {
  mime: string
  data: ArrayBuffer
}

const DB_NAME = 'sound-desk-sim'
const STORE = 'sounds'
const DB_VERSION = 1

/** DI level for uploads: audible through the PA, silent as stage backline. */
export const UPLOAD_ACOUSTIC_DB = -60

/** Palette cycled through when assigning a color to a new upload. */
const PALETTE = [
  '#34d399', '#60a5fa', '#f472b6', '#fbbf24',
  '#a78bfa', '#2dd4bf', '#fb923c', '#e879f9',
]

/** In-memory metadata cache for synchronous lookups (name/color/beats). */
const registry = new Map<string, UserSound>()

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = run(db.transaction(STORE, mode).objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

function meta({ id, name, color, acousticDb, beats }: UserSoundRecord): UserSound {
  return { id, name, color, acousticDb, beats }
}

/** Load all uploads from IndexedDB and prime the in-memory registry. */
export async function loadUserSounds(): Promise<UserSound[]> {
  let records: UserSoundRecord[] = []
  try {
    records = (await tx<UserSoundRecord[]>('readonly', (s) => s.getAll())) ?? []
  } catch {
    return [] // no IndexedDB (private mode, etc.) — the library is just empty.
  }
  registry.clear()
  for (const r of records) registry.set(r.id, meta(r))
  return records.map(meta).sort((a, b) => a.name.localeCompare(b.name))
}

/** Persist a new upload and register it. Returns its metadata. */
export async function addUserSound(input: {
  name: string
  beats: number
  file: File
}): Promise<UserSound> {
  const id = `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const record: UserSoundRecord = {
    id,
    name: input.name,
    color: PALETTE[registry.size % PALETTE.length],
    acousticDb: UPLOAD_ACOUSTIC_DB,
    beats: input.beats,
    mime: input.file.type || 'audio/*',
    data: await input.file.arrayBuffer(),
  }
  await tx('readwrite', (s) => s.put(record))
  const m = meta(record)
  registry.set(id, m)
  return m
}

/** Delete an upload from storage and the registry. */
export async function deleteUserSound(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id))
  registry.delete(id)
}

/** Synchronous metadata lookup (registry must be loaded first). */
export function getUserSound(id: string | null): UserSound | null {
  return id ? registry.get(id) ?? null : null
}

export function isUserSound(id: string | null): boolean {
  return !!id && registry.has(id)
}

/** Fetch the raw audio bytes for decoding into an AudioBuffer. */
export async function getUserSoundData(id: string): Promise<ArrayBuffer | null> {
  const rec = await tx<UserSoundRecord | undefined>('readonly', (s) => s.get(id))
  return rec?.data ?? null
}
