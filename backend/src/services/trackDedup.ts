import fs from 'fs';
import prisma from '../lib/prisma';

function extractYouTubeVideoId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
  return m?.[1] ?? null;
}

/** Stable key for coalescing parallel downloads of the same source. */
export function downloadKey(sourceId?: string | null, sourceUrl?: string | null): string | null {
  if (sourceId) return `sid:${sourceId}`;
  const vid = sourceUrl ? extractYouTubeVideoId(sourceUrl) : null;
  if (vid) return `sid:${vid}`;
  if (sourceUrl) return `url:${sourceUrl}`;
  return null;
}

/** Find any track row that already has a downloaded file for this source. */
export async function findCanonicalDownloadedTrack(
  sourceId?: string | null,
  sourceUrl?: string | null,
) {
  const ids = new Set<string>();
  if (sourceId) ids.add(sourceId);
  const fromUrl = sourceUrl ? extractYouTubeVideoId(sourceUrl) : null;
  if (fromUrl) ids.add(fromUrl);

  if (ids.size > 0) {
    const bySourceId = await prisma.track.findFirst({
      where: {
        sourceId: { in: [...ids] },
        isDownloaded: true,
        filePath: { not: null },
      },
      orderBy: { downloadedAt: 'desc' },
      include: { artist: true, album: true },
    });
    if (bySourceId?.filePath && fs.existsSync(bySourceId.filePath)) return bySourceId;
  }

  if (sourceUrl) {
    const byUrl = await prisma.track.findFirst({
      where: {
        sourceUrl,
        isDownloaded: true,
        filePath: { not: null },
      },
      orderBy: { downloadedAt: 'desc' },
      include: { artist: true, album: true },
    });
    if (byUrl?.filePath && fs.existsSync(byUrl.filePath)) return byUrl;
  }

  return null;
}

/** Point a track row at an existing on-disk file (skip re-download). */
export async function linkTrackToCanonical(
  trackId: string,
  canonical: {
    filePath: string | null;
    sourceUrl: string | null;
    sourceId: string | null;
    downloadedAt: Date | null;
    storageTier: string;
    quality: string;
    duration: number;
    thumbnailUrl: string | null;
  },
) {
  if (!canonical.filePath || !fs.existsSync(canonical.filePath)) return;

  await prisma.track.update({
    where: { id: trackId },
    data: {
      filePath: canonical.filePath,
      sourceUrl: canonical.sourceUrl,
      sourceId: canonical.sourceId,
      isDownloaded: true,
      downloadedAt: canonical.downloadedAt ?? new Date(),
      storageTier: canonical.storageTier as 'CACHE' | 'LIBRARY',
      quality: canonical.quality as 'LOW' | 'NORMAL' | 'HIGH',
      duration: canonical.duration,
      thumbnailUrl: canonical.thumbnailUrl ?? undefined,
      lastAccessedAt: new Date(),
    },
  });
}

/** After a fresh download, share the file with all duplicate track rows. */
export async function propagateDownloadToSourceId(
  sourceId: string,
  data: {
    filePath: string;
    sourceUrl: string;
    downloadedAt: Date;
    storageTier: 'CACHE' | 'LIBRARY';
    quality: 'LOW' | 'NORMAL' | 'HIGH';
    duration: number;
    thumbnailUrl?: string | null;
  },
  excludeTrackId: string,
) {
  await prisma.track.updateMany({
    where: {
      sourceId,
      id: { not: excludeTrackId },
      OR: [{ isDownloaded: false }, { filePath: null }],
    },
    data: {
      filePath: data.filePath,
      sourceUrl: data.sourceUrl,
      isDownloaded: true,
      downloadedAt: data.downloadedAt,
      storageTier: data.storageTier,
      quality: data.quality,
      duration: data.duration,
      thumbnailUrl: data.thumbnailUrl ?? undefined,
      lastAccessedAt: new Date(),
    },
  });
}
