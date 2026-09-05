/** Client-side offline library metadata + audio cache (max 8GB). */

const DB_NAME = 'llamastream-offline';
const DB_VERSION = 1;
const META_STORE = 'snapshots';
const AUDIO_META_STORE = 'audioMeta';
export const AUDIO_CACHE_NAME = 'audio-stream-cache';
export const MAX_AUDIO_CACHE_BYTES = 8 * 1024 * 1024 * 1024;
const ENABLED_KEY = 'llamastream_offline_cache_enabled';

export type OfflineSnapshotKey = 'playlists' | 'liked' | 'library' | 'recent' | `playlist:${string}`;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
      if (!db.objectStoreNames.contains(AUDIO_META_STORE)) {
        db.createObjectStore(AUDIO_META_STORE, { keyPath: 'trackId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IDB open failed'));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IDB request failed'));
  });
}

export function isOfflineCacheEnabled(): boolean {
  try {
    const v = localStorage.getItem(ENABLED_KEY);
    return v !== 'false';
  } catch {
    return true;
  }
}

export function setOfflineCacheEnabled(enabled: boolean): void {
  localStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false');
}

export async function saveOfflineSnapshot(key: OfflineSnapshotKey | string, data: unknown): Promise<void> {
  if (!isOfflineCacheEnabled()) return;
  try {
    const db = await openDb();
    const tx = db.transaction(META_STORE, 'readwrite');
    await idbReq(tx.objectStore(META_STORE).put({ data, savedAt: Date.now() }, key));
    db.close();
  } catch {
    /* ignore */
  }
}

export async function loadOfflineSnapshot<T>(key: OfflineSnapshotKey | string): Promise<T | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(META_STORE, 'readonly');
    const row = await idbReq(tx.objectStore(META_STORE).get(key)) as { data: T; savedAt: number } | undefined;
    db.close();
    return row?.data ?? null;
  } catch {
    return null;
  }
}

type AudioMeta = { trackId: string; size: number; lastAccess: number };

async function listAudioMeta(db: IDBDatabase): Promise<AudioMeta[]> {
  const tx = db.transaction(AUDIO_META_STORE, 'readonly');
  const all = await idbReq(tx.objectStore(AUDIO_META_STORE).getAll()) as AudioMeta[];
  return all || [];
}

export async function getAudioCacheStats(): Promise<{ bytes: number; count: number }> {
  try {
    const db = await openDb();
    const metas = await listAudioMeta(db);
    db.close();
    return {
      bytes: metas.reduce((s, m) => s + (m.size || 0), 0),
      count: metas.length,
    };
  } catch {
    return { bytes: 0, count: 0 };
  }
}

async function evictUntilUnderLimit(db: IDBDatabase, neededBytes: number): Promise<void> {
  let metas = await listAudioMeta(db);
  let total = metas.reduce((s, m) => s + (m.size || 0), 0);
  if (total + neededBytes <= MAX_AUDIO_CACHE_BYTES) return;

  metas = [...metas].sort((a, b) => a.lastAccess - b.lastAccess);
  const cache = typeof caches !== 'undefined' ? await caches.open(AUDIO_CACHE_NAME) : null;

  for (const meta of metas) {
    if (total + neededBytes <= MAX_AUDIO_CACHE_BYTES) break;
    if (cache) {
      const keys = await cache.keys();
      for (const req of keys) {
        if (req.url.includes(`/tracks/${meta.trackId}/stream`)) {
          await cache.delete(req);
        }
      }
    }
    const tx = db.transaction(AUDIO_META_STORE, 'readwrite');
    await idbReq(tx.objectStore(AUDIO_META_STORE).delete(meta.trackId));
    total -= meta.size || 0;
  }
}

/** Remember a cached stream size and evict LRU over 8GB. */
export async function rememberCachedTrack(trackId: string, sizeBytes: number): Promise<void> {
  if (!isOfflineCacheEnabled() || !trackId || sizeBytes <= 0) return;
  try {
    const db = await openDb();
    await evictUntilUnderLimit(db, sizeBytes);
    const tx = db.transaction(AUDIO_META_STORE, 'readwrite');
    await idbReq(tx.objectStore(AUDIO_META_STORE).put({
      trackId,
      size: sizeBytes,
      lastAccess: Date.now(),
    }));
    db.close();
  } catch {
    /* ignore */
  }
}

export async function touchCachedTrack(trackId: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(AUDIO_META_STORE, 'readwrite');
    const store = tx.objectStore(AUDIO_META_STORE);
    const existing = await idbReq(store.get(trackId)) as AudioMeta | undefined;
    if (existing) {
      existing.lastAccess = Date.now();
      await idbReq(store.put(existing));
    }
    db.close();
  } catch {
    /* ignore */
  }
}

export async function clearAudioCache(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') {
      await caches.delete(AUDIO_CACHE_NAME);
    }
    const db = await openDb();
    const tx = db.transaction(AUDIO_META_STORE, 'readwrite');
    await idbReq(tx.objectStore(AUDIO_META_STORE).clear());
    db.close();
  } catch {
    /* ignore */
  }
}

/** Prefetch track stream into Cache API (best-effort). */
export async function prefetchTrackStream(trackId: string, url: string): Promise<void> {
  if (!isOfflineCacheEnabled() || typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME);
    const existing = await cache.match(url, { ignoreSearch: true });
    if (existing?.ok) {
      await touchCachedTrack(trackId);
      return;
    }
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return;
    const buf = await res.clone().arrayBuffer();
    await evictThenPut(trackId, url, res, buf.byteLength);
  } catch {
    /* ignore */
  }
}

async function evictThenPut(trackId: string, url: string, res: Response, size: number): Promise<void> {
  const db = await openDb();
  await evictUntilUnderLimit(db, size);
  db.close();
  const cache = await caches.open(AUDIO_CACHE_NAME);
  await cache.put(url, res);
  await rememberCachedTrack(trackId, size);
}
