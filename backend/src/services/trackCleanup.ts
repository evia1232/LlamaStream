import fs from 'fs';
import path from 'path';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { config } from '../config';
import { evictTrackIfUnpinned, isTrackPinned } from './trackStorage';

function unlinkSafe(filePath: string | null | undefined) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error(`Failed to delete file ${filePath}:`, err);
  }
}

async function cleanupOrphanMetadata() {
  await prisma.album.deleteMany({ where: { tracks: { none: {} } } });
  await prisma.artist.deleteMany({
    where: { tracks: { none: {} }, albums: { none: {} } },
  });
}

function buildRecentCacheFilter(days: number): Prisma.TrackWhereInput {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return {
    storageTier: 'CACHE',
    isDownloaded: true,
    OR: [
      { downloadedAt: { gte: since } },
      { downloadedAt: null, updatedAt: { gte: since } },
    ],
  };
}

export async function getLibraryStats() {
  const [libraryCount, cacheCount, totalCount, tracks] = await Promise.all([
    prisma.track.count({ where: { storageTier: 'LIBRARY', isDownloaded: true } }),
    prisma.track.count({ where: { storageTier: 'CACHE', isDownloaded: true } }),
    prisma.track.count(),
    prisma.track.findMany({
      where: { isDownloaded: true, filePath: { not: null } },
      select: { filePath: true, storageTier: true },
    }),
  ]);

  let totalBytes = 0;
  let libraryBytes = 0;
  let cacheBytes = 0;
  for (const t of tracks) {
    if (t.filePath && fs.existsSync(t.filePath)) {
      try {
        const size = fs.statSync(t.filePath).size;
        totalBytes += size;
        if (t.storageTier === 'LIBRARY') libraryBytes += size;
        else cacheBytes += size;
      } catch { /* ignore */ }
    }
  }

  return {
    downloadedCount: libraryCount + cacheCount,
    libraryCount,
    cacheCount,
    totalCount,
    totalBytes,
    libraryBytes,
    cacheBytes,
  };
}

export async function deleteTrackById(trackId: string): Promise<boolean> {
  const track = await prisma.track.findUnique({ where: { id: trackId } });
  if (!track) return false;

  unlinkSafe(track.filePath);

  await prisma.userPlayback.updateMany({
    where: { trackId },
    data: { trackId: null, position: 0, isPlaying: false },
  });

  await prisma.track.delete({ where: { id: trackId } });
  await cleanupOrphanMetadata();
  return true;
}

export async function cleanupLibrary(opts: {
  mode: 'all' | 'recent' | 'cache';
  days?: number;
}): Promise<{ deleted: number; filesRemoved: number }> {
  const where: Prisma.TrackWhereInput =
    opts.mode === 'all'
      ? { storageTier: 'CACHE', isDownloaded: true }
      : opts.mode === 'cache'
        ? { storageTier: 'CACHE', isDownloaded: true }
        : buildRecentCacheFilter(Math.max(1, opts.days ?? 1));

  const tracks = await prisma.track.findMany({
    where,
    select: { id: true, filePath: true },
  });

  let filesRemoved = 0;
  let deleted = 0;
  for (const track of tracks) {
    if (await isTrackPinned(track.id)) continue;
    if (track.filePath && fs.existsSync(track.filePath)) {
      unlinkSafe(track.filePath);
      filesRemoved++;
    }
    await prisma.track.update({
      where: { id: track.id },
      data: { filePath: null, isDownloaded: false, storageTier: 'CACHE' },
    });
    deleted++;
  }

  await cleanupOrphanMetadata();

  try {
    const cacheDir = path.join(config.cachePath, 'audio');
    if (fs.existsSync(cacheDir)) {
      for (const entry of fs.readdirSync(cacheDir)) {
        const full = path.join(cacheDir, entry);
        if (fs.statSync(full).isFile() && entry.endsWith('.mp3')) {
          // orphan cache files without DB row
          const referenced = tracks.some((t) => t.filePath === full);
          if (!referenced) unlinkSafe(full);
        }
      }
    }
  } catch { /* ignore */ }

  return { deleted, filesRemoved };
}
