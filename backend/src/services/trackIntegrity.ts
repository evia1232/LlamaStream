import fs from 'fs';
import prisma from '../lib/prisma';

export function trackFileExists(track: { filePath: string | null | undefined }): boolean {
  return !!(track.filePath && fs.existsSync(track.filePath));
}

/** True when the track can be streamed (local file, YouTube source, or title for search stream). */
export function isTrackPlayable(track: {
  isDownloaded: boolean;
  filePath: string | null | undefined;
  sourceUrl: string | null | undefined;
  title?: string;
  artist?: { name: string } | null;
}): boolean {
  if (trackFileExists(track)) return true;
  if (track.sourceUrl) return true;
  return !!(track.title && track.artist?.name);
}

/** Mark DB row stale when isDownloaded but the MP3 is missing. */
export async function reconcileTrackRecord(trackId: string): Promise<boolean> {
  const track = await prisma.track.findUnique({
    where: { id: trackId },
    select: { id: true, isDownloaded: true, filePath: true },
  });
  if (!track?.isDownloaded) return false;
  if (trackFileExists(track)) return false;

  await prisma.track.update({
    where: { id: trackId },
    data: { isDownloaded: false, filePath: null },
  });
  console.log(`[Integrity] Cleared stale download flag for track ${trackId}`);
  return true;
}

/** Scan library for missing files (startup / after manual deletes). */
export async function reconcileAllStaleTracks(): Promise<number> {
  const tracks = await prisma.track.findMany({
    where: { isDownloaded: true },
    select: { id: true, filePath: true },
  });

  let fixed = 0;
  for (const track of tracks) {
    if (!trackFileExists(track)) {
      await prisma.track.update({
        where: { id: track.id },
        data: { isDownloaded: false, filePath: null },
      });
      fixed++;
    }
  }

  if (fixed > 0) {
    console.log(`[Integrity] Reconciled ${fixed} track(s) with missing files`);
  }
  return fixed;
}

export function effectiveDownloadedFlag(track: {
  isDownloaded: boolean;
  filePath: string | null | undefined;
}): boolean {
  return track.isDownloaded && trackFileExists(track);
}
