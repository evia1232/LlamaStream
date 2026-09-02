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

  const errors = Array.isArray(job.errors) ? [...(job.errors as string[])] : [];
  let position = job.completedTracks + job.failedTracks;
  let completed = job.completedTracks;
  let failed = job.failedTracks;

  for (let i = position; i < tracks.length; i++) {
    const item = tracks[i];
    const cleanArtist = sanitizeSearchText(item.artist);
    const cleanTitle = sanitizeSearchText(item.name);
    try {
      const track = await resolveAndDownload(
        item.url || `${cleanArtist} - ${cleanTitle}`,
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

      await addTrackToPlaylist(job.playlistId, track.id, position);
      await promoteTrackToLibrary(track.id);
      position++;
      completed++;
    } catch (err) {
      failed++;
      errors.push(`${cleanArtist} - ${cleanTitle}: ${(err as Error).message}`);
      position++;
    }

    await prisma.playlistImportJob.update({
      where: { id: jobId },
      data: { completedTracks: completed, failedTracks: failed, errors },
    });

    // Avoid YouTube search rate limits during bulk import
    await sleep(800);
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
      errors,
    },
  });

  console.log(`[Import] Job ${jobId} done: ${completed}/${tracks.length} tracks`);
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
