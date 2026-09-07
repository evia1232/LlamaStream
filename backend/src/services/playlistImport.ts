import prisma from '../lib/prisma';
import { resolveAndDownload } from './downloader';
import { addTrackToPlaylist } from '../lib/playlistTracks';
import { promoteTrackToLibrary } from './trackStorage';
import { parseSpotifyUrl, isSpotifyUrl, isYouTubeUrl } from './spotify';
import { runYtDlp } from './ytdlp';
import { sanitizeSearchText } from '../lib/trackMatch';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ImportTrackItem {
  name: string;
  artist: string;
  album?: string;
  duration?: number;
  url?: string;
}

/** Structured failed import entry — keeps Spotify/YouTube playlist index for retry insert. */
export interface FailedImportItem {
  position: number;
  name: string;
  artist: string;
  album?: string;
  duration?: number;
  url?: string;
  error: string;
}

export function isFailedImportItem(value: unknown): value is FailedImportItem {
  return !!value
    && typeof value === 'object'
    && typeof (value as FailedImportItem).position === 'number'
    && typeof (value as FailedImportItem).name === 'string'
    && typeof (value as FailedImportItem).artist === 'string';
}

/** Normalize job.errors + missing positions into FailedImportItem[]. */
export function buildFailedImportItems(
  trackData: ImportTrackItem[],
  errors: unknown,
  occupiedPositions: Set<number>,
  opts?: { attemptedUntil?: number },
): FailedImportItem[] {
  const attemptedUntil = opts?.attemptedUntil ?? trackData.length;
  const raw = Array.isArray(errors) ? errors : [];

  const structured = raw.filter(isFailedImportItem);
  if (structured.length > 0) {
    return structured
      .filter((f) => !occupiedPositions.has(f.position))
      .sort((a, b) => a.position - b.position);
  }

  // Legacy string errors / holes after completed import
  const out: FailedImportItem[] = [];
  for (let i = 0; i < Math.min(trackData.length, attemptedUntil); i++) {
    if (occupiedPositions.has(i)) continue;
    const item = trackData[i];
    const errStr = raw.find(
      (e): e is string => typeof e === 'string' && (e.includes(item.name) || e.includes(item.artist)),
    );
    out.push({
      position: i,
      name: item.name,
      artist: item.artist,
      album: item.album,
      duration: item.duration,
      url: item.url,
      error: errStr
        ? (errStr.includes(': ') ? errStr.slice(errStr.indexOf(': ') + 2) : errStr)
        : 'Import failed',
    });
  }
  return out;
}

function parseJsonLines<T>(output: string): T[] {
  const items: T[] = [];
  for (const line of output.split('\n').filter(Boolean)) {
    try {
      items.push(JSON.parse(line));
    } catch { /* skip */ }
  }
  return items;
}

function extractArtistFromTitle(title: string, uploader?: string): string {
  const match = title.match(/^(.+?)\s[-–—]\s(.+)$/);
  if (match) return match[1].trim();
  return uploader || 'Unknown Artist';
}

function extractTrackTitle(title: string): string {
  const match = title.match(/^(.+?)\s[-–—]\s(.+)$/);
  if (match) return match[2].trim();
  return title;
}

export async function parseYouTubePlaylist(url: string): Promise<{ name: string; tracks: ImportTrackItem[] }> {
  const result = await runYtDlp([
    '--flat-playlist',
    '--dump-json',
    '--skip-download',
    url,
  ], 120000);

  const entries = parseJsonLines<{
    id: string;
    title: string;
    duration?: number;
    uploader?: string;
    channel?: string;
    url?: string;
    webpage_url?: string;
  }>(result.stdout);

  if (entries.length === 0) throw new Error('No tracks found in YouTube playlist');

  const tracks: ImportTrackItem[] = entries.map((e) => ({
    name: extractTrackTitle(e.title),
    artist: extractArtistFromTitle(e.title, e.uploader || e.channel),
    duration: e.duration,
    url: e.webpage_url || e.url || `https://www.youtube.com/watch?v=${e.id}`,
  }));

  return { name: 'Imported from YouTube', tracks };
}

export async function parsePlaylistUrl(url: string, userId?: string): Promise<{ name: string; tracks: ImportTrackItem[]; sourceType: 'spotify' | 'youtube' }> {
  if (isSpotifyUrl(url)) {
    const parsed = await parseSpotifyUrl(url, userId);
    return {
      name: parsed.name,
      sourceType: 'spotify',
      tracks: parsed.tracks.map((t) => ({
        name: t.name,
        artist: t.artist,
        album: t.album,
        duration: t.duration,
        url: t.spotifyUrl,
      })),
    };
  }
  if (isYouTubeUrl(url)) {
    const parsed = await parseYouTubePlaylist(url);
    return { ...parsed, sourceType: 'youtube' };
  }
  throw new Error('Unsupported URL — paste a Spotify or YouTube playlist link');
}

export async function startSpotifyPlaylistsImport(
  playlistIds: string[],
  userId: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH' = 'HIGH',
) {
  if (!playlistIds.length) {
    throw new Error('No playlists selected');
  }

  const imports = [];
  for (const playlistId of playlistIds) {
    const url = `https://open.spotify.com/playlist/${playlistId}`;
    const result = await startPlaylistImport(url, userId, quality);
    imports.push(result);
  }

  return { imports, count: imports.length };
}

export async function startPlaylistImport(
  url: string,
  userId: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH' = 'HIGH'
) {
  if (!isSpotifyUrl(url) && !isYouTubeUrl(url)) {
    throw new Error('Unsupported URL — paste a Spotify or YouTube playlist link');
  }

  const playlist = await prisma.playlist.create({
    data: {
      name: 'Importing playlist...',
      description: `Import started: ${url}`,
      userId,
      visibility: 'PRIVATE',
    },
  });

  const job = await prisma.playlistImportJob.create({
    data: {
      playlistId: playlist.id,
      userId,
      sourceUrl: url,
      sourceType: isSpotifyUrl(url) ? 'spotify' : 'youtube',
      status: 'parsing',
      totalTracks: 0,
      trackData: [],
      quality,
      errors: [],
    },
  });

  setImmediate(() => {
    runPlaylistImport(job.id, url, userId).catch((err) => {
      console.error(`[Import] Job ${job.id} failed:`, err);
    });
  });

  return {
    playlist: { id: playlist.id, name: playlist.name, trackCount: 0 },
    jobId: job.id,
    totalTracks: 0,
    status: 'parsing',
  };
}

async function runPlaylistImport(jobId: string, url: string, userId?: string) {
  const job = await prisma.playlistImportJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  try {
    const { name, tracks, sourceType } = await parsePlaylistUrl(url, userId ?? job.userId);

    await prisma.playlist.update({
      where: { id: job.playlistId },
      data: {
        name,
        description: `Importing from ${sourceType}: ${url}`,
      },
    });

    await prisma.playlistImportJob.update({
      where: { id: jobId },
      data: {
        sourceType,
        totalTracks: tracks.length,
        trackData: tracks as unknown as Parameters<typeof prisma.playlistImportJob.update>[0]['data']['trackData'],
        status: 'pending',
      },
    });

    await processPlaylistImport(jobId);
  } catch (err) {
    await prisma.playlistImportJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        errors: [(err as Error).message],
      },
    });
    throw err;
  }
}

export async function resumePendingImports() {
  const jobs = await prisma.playlistImportJob.findMany({
    where: { status: { in: ['parsing', 'pending', 'running'] } },
  });
  for (const job of jobs) {
    if (job.status === 'parsing') {
      setImmediate(() => {
        runPlaylistImport(job.id, job.sourceUrl, job.userId).catch(console.error);
      });
    } else {
      setImmediate(() => {
        processPlaylistImport(job.id).catch(console.error);
      });
    }
  }
  if (jobs.length > 0) {
    console.log(`[Import] Resuming ${jobs.length} import job(s)`);
  }
}

export async function processPlaylistImport(jobId: string) {
  const job = await prisma.playlistImportJob.findUnique({ where: { id: jobId } });
  if (!job || job.status === 'completed' || job.status === 'failed') return;

  const tracks = job.trackData as unknown as ImportTrackItem[];
  if (tracks.length === 0) return;

  await prisma.playlistImportJob.update({
    where: { id: jobId },
    data: { status: 'running' },
  });

  const rawErrors = Array.isArray(job.errors) ? [...(job.errors as unknown[])] : [];
  const errors: FailedImportItem[] = rawErrors.filter(isFailedImportItem);
  // Drop legacy string-only bag when we start writing structured failures
  let completed = job.completedTracks;
  let failed = job.failedTracks;
  let startIndex = completed + failed;

  for (let i = startIndex; i < tracks.length; i++) {
    // Respect YouTube hourly ban — pause import instead of burning the rest
    try {
      const { isYouTubeRateLimited, youtubeRateLimitRemainingMs } = await import('./ytdlp');
      if (isYouTubeRateLimited()) {
        const mins = Math.ceil(youtubeRateLimitRemainingMs() / 60000);
        await prisma.playlistImportJob.update({
          where: { id: jobId },
          data: {
            status: 'pending',
            completedTracks: completed,
            failedTracks: failed,
            errors: errors as unknown as object[],
          },
        });
        console.warn(`[Import] Job ${jobId} paused — YouTube rate-limited (~${mins}m). Will resume on restart.`);
        return;
      }
    } catch { /* ignore */ }

    const item = tracks[i];
    const cleanArtist = sanitizeSearchText(item.artist);
    const cleanTitle = sanitizeSearchText(item.name).replace(/_/g, ' ');
    try {
      const track = await resolveAndDownload(
        item.url || `${cleanArtist.split(/[,;&]/)[0].trim()} - ${cleanTitle}`,
        job.quality as 'LOW' | 'NORMAL' | 'HIGH',
        {
          title: cleanTitle,
          artist: cleanArtist,
          duration: item.duration,
          album: item.album,
          url: item.url?.includes('youtube') ? item.url : undefined,
          spotifyUrl: item.url?.includes('spotify') ? item.url : undefined,
          relaxed: true,
        }
      );

      await addTrackToPlaylist(job.playlistId, track.id, i);
      await promoteTrackToLibrary(track.id);
      completed++;
    } catch (err) {
      failed++;
      errors.push({
        position: i,
        name: cleanTitle,
        artist: cleanArtist,
        album: item.album,
        duration: item.duration,
        url: item.url,
        error: (err as Error).message,
      });
    }

    await prisma.playlistImportJob.update({
      where: { id: jobId },
      data: {
        completedTracks: completed,
        failedTracks: failed,
        errors: errors as unknown as object[],
      },
    });

    // Pace yt-dlp during bulk import (rate-limit protection)
    await sleep(1500);
  }

  await prisma.playlist.update({
    where: { id: job.playlistId },
    data: {
      description: `Imported from ${job.sourceType} (${completed}/${tracks.length} tracks)`,
    },
  });

  await prisma.playlistImportJob.update({
    where: { id: jobId },
    data: {
      status: failed === tracks.length ? 'failed' : 'completed',
      completedTracks: completed,
      failedTracks: failed,
      errors: errors as unknown as object[],
    },
  });

  console.log(`[Import] Job ${jobId} done: ${completed}/${tracks.length} tracks`);
}

/** Retry one failed import slot and insert at the original Spotify/YouTube position. */
export async function retryFailedImportTrack(
  playlistId: string,
  userId: string,
  position: number,
) {
  const playlist = await prisma.playlist.findUnique({
    where: { id: playlistId },
    include: {
      importJob: true,
      tracks: { select: { position: true, trackId: true } },
    },
  });
  if (!playlist || playlist.userId !== userId) throw new Error('Playlist not found');
  const job = playlist.importJob;
  if (!job) throw new Error('No import job for this playlist');

  const trackData = (job.trackData as unknown as ImportTrackItem[]) || [];
  const occupied = new Set(playlist.tracks.map((t) => t.position));
  if (occupied.has(position)) {
    throw new Error('A track already exists at this playlist position');
  }

  const failedItems = buildFailedImportItems(
    trackData,
    job.errors,
    occupied,
    { attemptedUntil: trackData.length },
  );
  const failed = failedItems.find((f) => f.position === position);
  const item = trackData[position] || (failed
    ? {
        name: failed.name,
        artist: failed.artist,
        album: failed.album,
        duration: failed.duration,
        url: failed.url,
      }
    : null);

  if (!item) throw new Error('No failed track at this position');

  const cleanArtist = sanitizeSearchText(item.artist);
  const cleanTitle = sanitizeSearchText(item.name).replace(/_/g, ' ');
  const quality = (job.quality as 'LOW' | 'NORMAL' | 'HIGH') || 'HIGH';

  const { clearDownloadCooldown } = await import('./trackDownload');
  const { isYouTubeRateLimited, youtubeRateLimitRemainingMs } = await import('./ytdlp');

  if (isYouTubeRateLimited()) {
    const mins = Math.ceil(youtubeRateLimitRemainingMs() / 60000);
    throw new Error(`YouTube rate-limited (~${mins} min left). Wait, then retry.`);
  }

  const track = await Promise.race([
    resolveAndDownload(
      item.url || `${cleanArtist.split(/[,;&]/)[0].trim()} - ${cleanTitle}`,
      quality,
      {
        title: cleanTitle,
        artist: cleanArtist,
        duration: item.duration,
        album: item.album,
        url: item.url?.includes('youtube') ? item.url : undefined,
        spotifyUrl: item.url?.includes('spotify') ? item.url : undefined,
        relaxed: true,
      },
    ),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Retry timed out after 90s — YouTube may be slow or rate-limited')), 90000);
    }),
  ]);

  clearDownloadCooldown(track.id, track.sourceUrl || undefined);
  await addTrackToPlaylist(playlistId, track.id, position);
  await promoteTrackToLibrary(track.id);

  const remaining = failedItems.filter((f) => f.position !== position);
  await prisma.playlistImportJob.update({
    where: { id: job.id },
    data: {
      failedTracks: remaining.length,
      completedTracks: Math.max(0, (job.totalTracks || trackData.length) - remaining.length),
      errors: remaining as unknown as object[],
      status: remaining.length === 0 ? 'completed' : job.status === 'failed' ? 'completed' : job.status,
    },
  });

  const full = await prisma.track.findUniqueOrThrow({
    where: { id: track.id },
    include: { artist: true, album: true },
  });

  return {
    track: full,
    position,
    remainingFailed: remaining.length,
  };
}

const restoreInFlight = new Set<string>();

/**
 * Re-try every failed import slot in ascending Spotify/YouTube order.
 * Runs in the background so the HTTP request returns immediately.
 */
export async function startRestoreFailedImports(playlistId: string, userId: string) {
  const playlist = await prisma.playlist.findUnique({
    where: { id: playlistId },
    include: {
      importJob: true,
      tracks: { select: { position: true } },
    },
  });
  if (!playlist || playlist.userId !== userId) throw new Error('Playlist not found');
  const job = playlist.importJob;
  if (!job) throw new Error('No import job for this playlist');

  if (restoreInFlight.has(playlistId) || job.status === 'running' || job.status === 'parsing') {
    return {
      started: false,
      alreadyRunning: true,
      totalFailed: job.failedTracks || 0,
    };
  }

  const trackData = (job.trackData as unknown as ImportTrackItem[]) || [];
  const occupied = new Set(playlist.tracks.map((t) => t.position));
  const failedItems = buildFailedImportItems(
    trackData,
    job.errors,
    occupied,
    { attemptedUntil: trackData.length },
  ).sort((a, b) => a.position - b.position);

  if (failedItems.length === 0) {
    return { started: false, alreadyRunning: false, totalFailed: 0 };
  }

  restoreInFlight.add(playlistId);
  await prisma.playlistImportJob.update({
    where: { id: job.id },
    data: { status: 'running' },
  });

  void (async () => {
    try {
      console.log(`[Import] Restore started for playlist ${playlistId}: ${failedItems.length} failed slots`);
      let consecutiveFails = 0;
      for (const item of failedItems) {
        try {
          const { isYouTubeRateLimited, youtubeRateLimitRemainingMs, noteYouTubeRateLimit } = await import('./ytdlp');
          if (isYouTubeRateLimited()) {
            const mins = Math.ceil(youtubeRateLimitRemainingMs() / 60000);
            console.warn(`[Import] Restore paused — YouTube rate-limited (~${mins} min)`);
            await prisma.playlistImportJob.update({
              where: { id: job.id },
              data: { status: 'pending' },
            });
            return;
          }
          await retryFailedImportTrack(playlistId, userId, item.position);
          consecutiveFails = 0;
          await sleep(4000);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[Import] Restore skip pos ${item.position}: ${msg.split('\n')[0]}`);
          consecutiveFails += 1;
          if (/rate-?limited|empty yt-dlp search|403|Forbidden|bot/i.test(msg) || consecutiveFails >= 3) {
            const { noteYouTubeRateLimit } = await import('./ytdlp');
            if (/empty yt-dlp search|403|Forbidden|bot/i.test(msg) || consecutiveFails >= 3) {
              noteYouTubeRateLimit('restore-storm');
            }
            await prisma.playlistImportJob.update({
              where: { id: job.id },
              data: { status: 'pending' },
            });
            console.warn(`[Import] Restore paused after failures (protect proxy IP)`);
            return;
          }
          await sleep(2500);
        }
      }

      const fresh = await prisma.playlistImportJob.findUnique({ where: { id: job.id } });
      const remaining = fresh?.failedTracks ?? 0;
      await prisma.playlistImportJob.update({
        where: { id: job.id },
        data: { status: remaining > 0 ? 'completed' : 'completed' },
      });
      console.log(`[Import] Restore finished for playlist ${playlistId}; remaining failed=${remaining}`);
    } catch (err) {
      console.error(`[Import] Restore crashed for playlist ${playlistId}:`, err);
      await prisma.playlistImportJob.update({
        where: { id: job.id },
        data: { status: 'failed' },
      }).catch(() => null);
    } finally {
      restoreInFlight.delete(playlistId);
    }
  })();

  return { started: true, alreadyRunning: false, totalFailed: failedItems.length };
}

export async function listActiveImportJobs(userId: string) {
  const jobs = await prisma.playlistImportJob.findMany({
    where: {
      userId,
      status: { in: ['parsing', 'pending', 'running'] },
    },
    include: { playlist: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return jobs.map((job) => ({
    id: job.id,
    status: job.status,
    totalTracks: job.totalTracks,
    completedTracks: job.completedTracks,
    failedTracks: job.failedTracks,
    playlist: job.playlist,
    errors: job.errors,
    createdAt: job.createdAt,
  }));
}

export async function getImportJobStatus(jobId: string, userId: string) {
  const job = await prisma.playlistImportJob.findUnique({
    where: { id: jobId },
    include: { playlist: { select: { id: true, name: true } } },
  });
  if (!job || job.userId !== userId) return null;
  return {
    id: job.id,
    status: job.status,
    totalTracks: job.totalTracks,
    completedTracks: job.completedTracks,
    failedTracks: job.failedTracks,
    playlist: job.playlist,
    errors: job.errors,
  };
}

/** @deprecated Use startPlaylistImport — kept for sync callers */
export async function importSpotifyPlaylist(
  url: string,
  userId: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH' = 'HIGH',
  onProgress?: (current: number, total: number, trackName: string) => void
) {
  const { name, tracks, sourceType } = await parsePlaylistUrl(url, userId);

  const playlist = await prisma.playlist.create({
    data: { name, description: `Imported from ${sourceType}: ${url}`, userId, visibility: 'PRIVATE' },
  });

  let position = 0;
  let imported = 0;
  const errors: string[] = [];
  const skipped: string[] = [];

  for (const item of tracks) {
    try {
      onProgress?.(position, tracks.length, item.name);
      const track = await resolveAndDownload(
        `${item.artist} - ${item.name}`,
        quality,
        { title: item.name, artist: item.artist, duration: item.duration, album: item.album, url: item.url }
      );
      const { added } = await addTrackToPlaylist(playlist.id, track.id, position);
      if (added) {
        await promoteTrackToLibrary(track.id);
        imported++;
      }
      else skipped.push(item.name);
      position++;
    } catch (err) {
      errors.push(`${item.name}: ${(err as Error).message}`);
      position++;
    }
  }

  return { playlist, imported, skipped: skipped.length, total: tracks.length, errors };
}
