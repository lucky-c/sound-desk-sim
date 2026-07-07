/**
 * Scene persistence: the console's snapshot slots survive reloads by living
 * in IndexedDB (same rationale as the Sound Library — no backend needed).
 *
 * A scene is plain JSON data (a mix snapshot plus the plugging map), keyed by
 * its slot number, so it stores and restores without any special handling.
 */

import type { Scene } from '../stores/mixer'

const DB_NAME = 'sound-desk-sim-scenes'
const STORE = 'scenes'
const DB_VERSION = 1

/** One stored record: the slot index and its scene payload. */
interface SceneRecord {
  slot: number
  scene: Scene
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'slot' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = run(db.transaction(STORE, mode).objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

/** Load every saved scene into a fixed-length slot array (nulls for empty). */
export async function loadScenes(slots: number): Promise<(Scene | null)[]> {
  const out: (Scene | null)[] = Array.from({ length: slots }, () => null)
  try {
    const records = await tx<SceneRecord[]>('readonly', (s) => s.getAll())
    for (const rec of records) {
      if (rec.slot >= 0 && rec.slot < slots) out[rec.slot] = rec.scene
    }
  } catch {
    // No IndexedDB (or blocked) — fall back to session-only scenes.
  }
  return out
}

/** Persist one slot's scene (structured-clone of the plain data). */
export async function saveScene(slot: number, scene: Scene): Promise<void> {
  try {
    const record: SceneRecord = {
      slot,
      scene: JSON.parse(JSON.stringify(scene)) as Scene,
    }
    await tx('readwrite', (s) => s.put(record))
  } catch {
    // Best-effort: a failed persist still leaves the in-memory scene usable.
  }
}

/** Remove one slot's persisted scene. */
export async function deleteScene(slot: number): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(slot))
  } catch {
    // ignore
  }
}
