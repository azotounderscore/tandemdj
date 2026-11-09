import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { LocalTrack } from '../types'

interface StoredBlob {
  id: string
  blob: Blob
  savedAt: number
}

interface TandemDB extends DBSchema {
  tracks: {
    key: string
    value: LocalTrack
    indexes: { 'by-addedAt': number }
  }
  blobs: {
    key: string
    value: StoredBlob
  }
}

let databasePromise: Promise<IDBPDatabase<TandemDB>> | null = null

function getDatabase(): Promise<IDBPDatabase<TandemDB>> {
  if (!databasePromise) {
    databasePromise = openDB<TandemDB>('tandem-dj', 1, {
      upgrade(db) {
        const trackStore = db.createObjectStore('tracks', { keyPath: 'id' })
        trackStore.createIndex('by-addedAt', 'addedAt')
        db.createObjectStore('blobs', { keyPath: 'id' })
      },
    })
  }
  return databasePromise
}

export async function listLocalTracks(): Promise<LocalTrack[]> {
  const db = await getDatabase()
  const tracks = await db.getAllFromIndex('tracks', 'by-addedAt')
  return tracks.reverse()
}

export async function saveLocalTrack(track: LocalTrack): Promise<void> {
  const db = await getDatabase()
  await db.put('tracks', track)
}

export async function saveTrackBlob(id: string, blob: Blob): Promise<void> {
  const db = await getDatabase()
  await db.put('blobs', { id, blob, savedAt: Date.now() })
}

export async function getTrackBlob(id: string): Promise<Blob | null> {
  const db = await getDatabase()
  const record = await db.get('blobs', id)
  return record?.blob ?? null
}

export async function hasTrackBlob(id: string): Promise<boolean> {
  const db = await getDatabase()
  return (await db.getKey('blobs', id)) !== undefined
}

export async function deleteLocalTrack(id: string): Promise<void> {
  const db = await getDatabase()
  const transaction = db.transaction(['tracks', 'blobs'], 'readwrite')
  await Promise.all([
    transaction.objectStore('tracks').delete(id),
    transaction.objectStore('blobs').delete(id),
    transaction.done,
  ])
}

export async function clearAllTracks(): Promise<void> {
  const db = await getDatabase()
  const transaction = db.transaction(['tracks', 'blobs'], 'readwrite')
  await Promise.all([
    transaction.objectStore('tracks').clear(),
    transaction.objectStore('blobs').clear(),
    transaction.done,
  ])
}

export async function getStoredAudioBytes(): Promise<number> {
  const db = await getDatabase()
  let total = 0
  let cursor = await db.transaction('blobs').store.openCursor()
  while (cursor) {
    total += cursor.value.blob.size
    cursor = await cursor.continue()
  }
  return total
}

export interface StorageEstimate {
  usage: number
  quota: number
  persisted: boolean
}

export async function getStorageEstimate(): Promise<StorageEstimate> {
  if (!navigator.storage?.estimate) {
    return { usage: 0, quota: 0, persisted: false }
  }
  try {
    const estimate = await navigator.storage.estimate()
    let persisted = false
    if (navigator.storage.persisted) {
      persisted = await navigator.storage.persisted()
    }
    return {
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? 0,
      persisted,
    }
  } catch {
    return { usage: 0, quota: 0, persisted: false }
  }
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  try {
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
