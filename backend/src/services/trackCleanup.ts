import fs from 'fs';
import path from 'path';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { config } from '../config';

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

function buildRecentFilter(days: number): Prisma.TrackWhereInput {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return {
    isDownloaded: true,
    OR: [
      { downloadedAt: { gte: since } },
      { downloadedAt: null, updatedAt: { gte: since } },
    ],
  };
}

export async function getLibraryStats() {
  const [downloadedCount, totalCount, tracks] = await Promise.all([
    prisma.track.count({ where: { isDownloaded: true } }),
    prisma.track.count(),
    prisma.track.findMany({
      where: { isDownloaded: true, filePath: { not: null } },
      select: { filePath: true },
    }),
  ]);

  let totalBytes = 0;
  for (const t of tracks) {
    if (t.filePath && fs.existsSync(t.filePath)) {
      try {
        totalBytes += fs.statSync(t.filePath).size;
      } catch { /* ignore */ }
    }
  }

  return { downloadedCount, totalCount, totalBytes };
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
  mode: 'all' | 'recent';
  days?: number;
}): Promise<{ deleted: number; filesRemoved: number }> {
  const where: Prisma.TrackWhereInput =
    opts.mode === 'all'
      ? {}
      : buildRecentFilter(Math.max(1, opts.days ?? 1));

  const tracks = await prisma.track.findMany({
    where,
    select: { id: true, filePath: true },
  });

  let filesRemoved = 0;
  for (const track of tracks) {
    if (track.filePath && fs.existsSync(track.filePath)) {
      unlinkSafe(track.filePath);
      filesRemoved++;
    }
  }

  if (tracks.length > 0) {
    await prisma.userPlayback.updateMany({
      where: { trackId: { in: tracks.map((t) => t.id) } },
      data: { trackId: null, position: 0, isPlaying: false },
    });
    await prisma.track.deleteMany({ where: { id: { in: tracks.map((t) => t.id) } } });
  }

  await cleanupOrphanMetadata();

  // Remove empty cache dirs (best effort)
  try {
    const musicDir = config.musicStoragePath;
    if (fs.existsSync(musicDir)) {
      for (const entry of fs.readdirSync(musicDir)) {
        const full = path.join(musicDir, entry);
        if (fs.statSync(full).isDirectory() && fs.readdirSync(full).length === 0) {
          fs.rmdirSync(full);
        }
      }
    }
  } catch { /* ignore */ }

  return { deleted: tracks.length, filesRemoved };
}
