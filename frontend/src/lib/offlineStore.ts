/** Client-side offline library metadata + audio cache (max 8GB). */

const DB_NAME = 'llamastream-offline';
const DB_VERSION = 1;
const META_STORE = 'snapshots';
const AUDIO_META_STORE = 'audioMeta';
export const AUDIO_CACHE_NAME = 'audio-stream-cache';
export const IMAGE_CACHE_NAME = 'image-cache-v2';
export const MAX_AUDIO_CACHE_BYTES = 8 * 1024 * 1024 * 1024;
const ENABLED_KEY = 'llamastream_offline_cache_enabled';

// Drop poisoned v1 entries (opaque no-cors responses that broke <img>)
if (typeof caches !== 'undefined') {
  void caches.delete('image-cache');
}

export type OfflineSnapshotKey = 'playlists' | 'liked' | 'library' | 'recent' | 'home' | `playlist:${string}`;

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
    void cacheImagesFromSnapshot(data);
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

export async function listCachedTrackIds(): Promise<Set<string>> {
  try {
    const db = await openDb();
    const metas = await listAudioMeta(db);
    db.close();
    return new Set(metas.map((m) => m.trackId));
  } catch {
    return new Set();
  }
}

export async function isTrackCachedLocally(trackId: string): Promise<boolean> {
  if (!trackId) return false;
  try {
    const db = await openDb();
    const tx = db.transaction(AUDIO_META_STORE, 'readonly');
    const row = await idbReq(tx.objectStore(AUDIO_META_STORE).get(trackId));
    db.close();
    return !!row;
  } catch {
    return false;
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
    try {
      window.dispatchEvent(new CustomEvent('ls-audio-cache-changed'));
    } catch { /* ignore */ }
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
      await caches.delete(IMAGE_CACHE_NAME);
    }
    const db = await openDb();
    const tx = db.transaction(AUDIO_META_STORE, 'readwrite');
    await idbReq(tx.objectStore(AUDIO_META_STORE).clear());
    db.close();
    try {
      window.dispatchEvent(new CustomEvent('ls-audio-cache-changed'));
    } catch { /* ignore */ }
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

function collectImageUrls(data: unknown, out: Set<string>, depth = 0): void {
  if (!data || depth > 6) return;
  if (typeof data === 'string') {
    if (/^https?:\/\//i.test(data) || data.startsWith('/api/media/')) out.add(data);
    return;
  }
  if (Array.isArray(data)) {
    for (const item of data) collectImageUrls(item, out, depth + 1);
    return;
  }
  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const key of ['thumbnailUrl', 'coverUrl', 'imageUrl', 'coverImages']) {
      const v = obj[key];
      if (typeof v === 'string') out.add(v);
      else if (Array.isArray(v)) {
        for (const u of v) if (typeof u === 'string') out.add(u);
      }
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') collectImageUrls(v, out, depth + 1);
    }
  }
}

/** Best-effort cache of cover art for offline UI. Never store opaque no-cors responses. */
export async function cacheImageUrl(url: string): Promise<void> {
  if (!isOfflineCacheEnabled() || !url || typeof caches === 'undefined') return;
  if (url.startsWith('blob:') || url.startsWith('data:')) return;
  try {
    const absolute = url.startsWith('http') ? url : new URL(url, window.location.origin).href;
    const cache = await caches.open(IMAGE_CACHE_NAME);
    const hit = await cache.match(absolute);
    if (hit?.ok) {
      const ct = hit.headers.get('content-type') || '';
      if (ct.startsWith('image/') || !ct) return;
    }
    const sameOrigin = absolute.startsWith(window.location.origin);
    const res = await fetch(absolute, {
      mode: 'cors',
      credentials: sameOrigin ? 'include' : 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!res.ok || res.type === 'opaque') return;
    const ct = res.headers.get('content-type') || '';
    if (ct && !ct.startsWith('image/')) return;
    await cache.put(absolute, res.clone());
  } catch {
    /* Cross-origin CDNs without CORS — skip caching; display still uses original URL online */
  }
}

export async function cacheImagesFromSnapshot(data: unknown): Promise<void> {
  const urls = new Set<string>();
  collectImageUrls(data, urls);
  let n = 0;
  for (const url of urls) {
    if (n++ > 80) break;
    void cacheImageUrl(url);
  }
}

/** Resolve a displayable URL for an image, preferring Cache API when offline. */
export async function resolveCachedImageSrc(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    void cacheImageUrl(url);
    return url;
  }
  if (typeof caches === 'undefined') return url;
  try {
    const absolute = url.startsWith('http') ? url : new URL(url, window.location.origin).href;
    const cache = await caches.open(IMAGE_CACHE_NAME);
    const hit = await cache.match(absolute);
    if (!hit || !hit.ok) return url;
    const blob = await hit.blob();
    if (!blob || blob.size < 32) return url;
    // Opaque / empty-type blobs often fail in <img>
    if (blob.type && !blob.type.startsWith('image/') && blob.type !== 'application/octet-stream') {
      return url;
    }
    return URL.createObjectURL(blob);
  } catch {
    return url;
  }
}

export function formatCacheBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
