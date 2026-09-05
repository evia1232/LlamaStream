import { streamUrl } from './apiUrl';
import { rememberCachedTrack, touchCachedTrack, AUDIO_CACHE_NAME } from './offlineStore';

export const AUDIO_STREAM_CACHE = AUDIO_CACHE_NAME;

function streamPath(trackId: string): string {
  return `/api/tracks/${trackId}/stream`;
}

function streamUrls(trackId: string): string[] {
  const path = streamPath(trackId);
  const full = streamUrl(trackId, null);
  if (full !== path) return [full, path];
  return [path];
}

/** Return a blob URL if the service worker cached this track (offline replay). */
export async function getCachedStreamBlobUrl(trackId: string): Promise<string | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(AUDIO_STREAM_CACHE);
    for (const url of streamUrls(trackId)) {
      const hit = await cache.match(url, { ignoreSearch: true });
      if (!hit?.ok) continue;
      const blob = await hit.blob();
      if (blob.size > 0) {
        void touchCachedTrack(trackId);
        void rememberCachedTrack(trackId, blob.size);
        return URL.createObjectURL(blob);
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function revokeBlobUrl(url: string | null | undefined): void {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
}
