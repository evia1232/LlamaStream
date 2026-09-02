import fs from 'fs';
import path from 'path';
import prisma from '../lib/prisma';
import { config } from '../config';

function unlinkSafe(filePath: string | null | undefined) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error(`[Storage] Failed to delete ${filePath}:`, err);
  }
}

export function getCacheMaxAgeHours(): number {
  return config.cacheMaxAgeHours;
}

export function getCacheAudioDir(): string {
  const dir = path.join(config.cachePath, 'audio');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getLibraryAudioDir(): string {
  fs.mkdirSync(config.musicStoragePath, { recursive: true });
  return config.musicStoragePath;
}

/** True when the track is liked or appears in any playlist — kept permanently on disk. */
export async function isTrackPinned(trackId: string): Promise<boolean> {
  const [liked, inPlaylist] = await Promise.all([
    prisma.likedTrack.count({ where: { trackId } }),
    prisma.playlistTrack.count({ where: { trackId } }),
  ]);
  return liked > 0 || inPlaylist > 0;
}

export async function getDownloadDirForTrack(trackId: string | null): Promise<string> {
  if (trackId && await isTrackPinned(trackId)) return getLibraryAudioDir();
  return getCacheAudioDir();
}

export function moveFileToDir(filePath: string, targetDir: string): string {
  if (path.resolve(path.dirname(filePath)) === path.resolve(targetDir)) return filePath;
  fs.mkdirSync(targetDir, { recursive: true });
  const dest = path.join(targetDir, path.basename(filePath));
  try {
    fs.renameSync(filePath, dest);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // Separate Docker volumes (cache vs music) cannot use rename across devices
    if (code === 'EXDEV') {
      fs.copyFileSync(filePath, dest);
      fs.unlinkSync(filePath);
    } else {
      throw err;
    }
  }
  return dest;
}

/** Move an on-disk file to library storage and mark tier (liked / playlist). */
export async function promoteTrackToLibrary(trackId: string): Promise<void> {
  const track = await prisma.track.findUnique({ where: { id: trackId } });
  if (!track) return;

  let filePath = track.filePath;
  if (track.isDownloaded && filePath && fs.existsSync(filePath)) {
    filePath = moveFileToDir(filePath, getLibraryAudioDir());
  }

  await prisma.track.update({
    where: { id: trackId },
    data: {
      storageTier: 'LIBRARY',
      ...(filePath && filePath !== track.filePath ? { filePath } : {}),
    },
  });
}

/**
 * Unpinned track: move file back to temp cache (if on disk) but keep playing metadata.
 * File is deleted later by evictStaleCache once CACHE_MAX_AGE_HOURS passes without access.
 */
export async function demoteTrackToCache(trackId: string): Promise<void> {
  if (await isTrackPinned(trackId)) {
    await promoteTrackToLibrary(trackId);
    return;
  }

  const track = await prisma.track.findUnique({ where: { id: trackId } });
  if (!track) return;

  if (!track.isDownloaded || !track.filePath || !fs.existsSync(track.filePath)) {
    if (track.storageTier !== 'CACHE') {
      await prisma.track.update({
        where: { id: trackId },
        data: { storageTier: 'CACHE' },
      });
    }
    return;
  }

  const filePath = moveFileToDir(track.filePath, getCacheAudioDir());
  await prisma.track.update({
    where: { id: trackId },
    data: {
      storageTier: 'CACHE',
      filePath,
      lastAccessedAt: new Date(),
    },
  });
}

/** Delete cache file when TTL expired and track is not pinned (keeps DB metadata). */
export async function evictTrackIfUnpinned(trackId: string): Promise<void> {
  if (await isTrackPinned(trackId)) return;

  const track = await prisma.track.findUnique({ where: { id: trackId } });
  if (!track?.filePath) {
    if (track && track.storageTier !== 'CACHE') {
      await prisma.track.update({
        where: { id: trackId },
        data: { storageTier: 'CACHE' },
      });
    }
    return;
  }

  unlinkSafe(track.filePath);
  await prisma.track.update({
    where: { id: trackId },
    data: {
      filePath: null,
      isDownloaded: false,
      storageTier: 'CACHE',
    },
  });
}

export async function touchTrackAccess(trackId: string): Promise<void> {
  await prisma.track.update({
    where: { id: trackId },
    data: { lastAccessedAt: new Date() },
  }).catch(() => { /* ignore */ });
}

/** Resolve final file path and tier after download completes. */
export async function finalizeFileStorage(
  trackId: string,
  filePath: string,
): Promise<{ filePath: string; storageTier: 'CACHE' | 'LIBRARY' }> {
  const pinned = await isTrackPinned(trackId);
  const targetDir = pinned ? getLibraryAudioDir() : getCacheAudioDir();
  const finalPath = moveFileToDir(filePath, targetDir);
  return { filePath: finalPath, storageTier: pinned ? 'LIBRARY' : 'CACHE' };
}

/** Evict stale unpinned cache files (startup + periodic). */
export async function evictStaleCache(maxAgeHours = getCacheMaxAgeHours()): Promise<number> {
  const since = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  const tracks = await prisma.track.findMany({
    where: {
      storageTier: 'CACHE',
      isDownloaded: true,
      filePath: { not: null },
    },
    select: { id: true, lastAccessedAt: true, downloadedAt: true },
  });

  let evicted = 0;
  for (const track of tracks) {
    if (await isTrackPinned(track.id)) {
      await promoteTrackToLibrary(track.id);
      continue;
    }
    const accessed = track.lastAccessedAt ?? track.downloadedAt;
    if (accessed && accessed >= since) continue;
    await evictTrackIfUnpinned(track.id);
    evicted++;
  }

  // Safety: unpinned files that ended up in library storage
  const strayLibrary = await prisma.track.findMany({
    where: {
      storageTier: 'LIBRARY',
      isDownloaded: true,
      filePath: { not: null },
    },
    select: { id: true },
  });
  for (const track of strayLibrary) {
    if (await isTrackPinned(track.id)) continue;
    await demoteTrackToCache(track.id);
  }

  return evicted;
}

let evictionTimer: ReturnType<typeof setInterval> | null = null;

/** Run cache eviction on an interval (unpinned temp downloads). */
export function startCacheEvictionScheduler(): void {
  if (evictionTimer) return;
  const intervalMs = config.cacheEvictionIntervalMinutes * 60 * 1000;
  evictionTimer = setInterval(() => {
    void evictStaleCache()
      .then((n) => {
        if (n > 0) console.log(`[Storage] Evicted ${n} stale cache track(s)`);
      })
      .catch(console.error);
  }, intervalMs);
  if (typeof evictionTimer === 'object' && 'unref' in evictionTimer) {
    evictionTimer.unref();
  }
}

/** After playlist delete / unlike — promote pinned, demote unpinned to temp cache. */
export async function syncTracksAfterUnpin(trackIds: string[]): Promise<void> {
  for (const trackId of trackIds) {
    if (await isTrackPinned(trackId)) {
      await promoteTrackToLibrary(trackId);
    } else {
      await demoteTrackToCache(trackId);
    }
  }
}
