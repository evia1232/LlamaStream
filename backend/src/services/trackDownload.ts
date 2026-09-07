import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import { Response } from 'express';
import prisma from '../lib/prisma';
import type { DownloadResult } from './downloader';
import { fetchLyricsForTrack } from './lyrics';
import {
  lastLines,
  ytDlpAudioExtractAttempts,
  ytDlpAuthArgs,
  ytDlpCommand,
  isYouTubeRateLimited,
  youtubeRateLimitRemainingMs,
} from './ytdlp';
import { finalizeFileStorage, getDownloadDirForTrack, touchTrackAccess, assertDiskSpaceForDownload } from './trackStorage';
import {
  downloadKey,
  findCanonicalDownloadedTrack,
  linkTrackToCanonical,
  propagateDownloadToSourceId,
} from './trackDedup';

const activeDownloads = new Map<string, Promise<void>>();
const trackToDownloadKey = new Map<string, string>();

/** After a hard failure, don't restart background download for a while (stream retries were looping). */
const downloadFailUntil = new Map<string, number>();
const DOWNLOAD_FAIL_COOLDOWN_MS = 3 * 60 * 1000;

/** Shared yt-dlp flags for live pipes — no hardcoded player_client (attempts set their own). */
const YTDLP_PIPE_BASE = [
  '--no-warnings',
  '--no-playlist',
  '--retries', '5',
  '--fragment-retries', '5',
  '--socket-timeout', '30',
  '--js-runtimes', 'node',
  '--remote-components', 'ejs:github',
];

function ytdlpPipeArgs(...extra: string[]): string[] {
  return [...YTDLP_PIPE_BASE, ...ytDlpAuthArgs(), ...extra];
}

export function isDownloadInProgress(trackId: string): boolean {
  const key = trackToDownloadKey.get(trackId);
  if (key && activeDownloads.has(key)) return true;
  return activeDownloads.has(`tid:${trackId}`);
}

export function getActiveDownload(trackId: string): Promise<void> | undefined {
  const key = trackToDownloadKey.get(trackId);
  if (key) return activeDownloads.get(key);
  return activeDownloads.get(`tid:${trackId}`);
}

export function isDownloadCoolingDown(trackId: string, sourceUrl?: string): boolean {
  const now = Date.now();
  const keys = [`tid:${trackId}`, sourceUrl ? `url:${sourceUrl}` : ''].filter(Boolean);
  for (const k of keys) {
    const until = downloadFailUntil.get(k);
    if (until && until > now) return true;
  }
  return false;
}

export function clearDownloadCooldown(trackId: string, sourceUrl?: string): void {
  downloadFailUntil.delete(`tid:${trackId}`);
  if (sourceUrl) downloadFailUntil.delete(`url:${sourceUrl}`);
}

function markDownloadFailed(trackId: string, sourceUrl: string, err: unknown): void {
  const rateLimited = /rate-?limited/i.test(err instanceof Error ? err.message : String(err));
  const until = Date.now() + (rateLimited
    ? Math.max(DOWNLOAD_FAIL_COOLDOWN_MS, youtubeRateLimitRemainingMs() || 50 * 60 * 1000)
    : DOWNLOAD_FAIL_COOLDOWN_MS);
  downloadFailUntil.set(`tid:${trackId}`, until);
  if (sourceUrl) downloadFailUntil.set(`url:${sourceUrl}`, until);
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[Download] Background save failed for track ${trackId} — cooling down ${Math.round((until - Date.now()) / 1000)}s:`, msg.split('\n')[0]);
}

/** Fail fast when the music/cache volume is critically low (common after Docker overlay fills the disk). */
export { assertDiskSpaceForDownload } from './trackStorage';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait until a track finishes downloading (or timeout). */
export async function waitForTrackDownload(trackId: string, timeoutMs = 180000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const track = await prisma.track.findUnique({ where: { id: trackId } });
    if (track?.isDownloaded && track.filePath && fs.existsSync(track.filePath)) return;

    const job = getActiveDownload(trackId);
    if (job) {
      await Promise.race([job.catch(() => { /* ignore */ }), sleep(1500)]);
      continue;
    }

    if (track && !track.isDownloaded) {
      await sleep(400);
      continue;
    }

    throw new Error('Download not in progress');
  }
  throw new Error('Download timed out');
}

export function cancelBackgroundDownload(trackId: string): void {
  const key = trackToDownloadKey.get(trackId);
  if (key) activeDownloads.delete(key);
  activeDownloads.delete(`tid:${trackId}`);
  trackToDownloadKey.delete(trackId);
}

export function trackStreamUrl(track: {
  id: string;
  isDownloaded: boolean;
  sourceUrl?: string | null;
  title?: string;
  artist?: { name: string } | null;
}): string | null {
  if (track.isDownloaded || track.sourceUrl) {
    return `/api/tracks/${track.id}/stream`;
  }
  if (track.title && track.artist?.name) {
    return `/api/tracks/${track.id}/stream`;
  }
  return null;
}

async function finalizeTrackDownload(
  trackId: string,
  download: DownloadResult,
  quality: 'LOW' | 'NORMAL' | 'HIGH',
  meta: { title?: string; artist?: string; album?: string }
) {
  const track = await prisma.track.findUnique({
    where: { id: trackId },
    include: { artist: true, album: true },
  });
  if (!track) return;
  if (track.sourceUrl && track.sourceUrl !== download.sourceUrl) {
    console.log(`[Download] Skipping stale finalize for track ${trackId}`);
    return;
  }

  const canonical = await findCanonicalDownloadedTrack(download.sourceId, download.sourceUrl);
  if (canonical && canonical.id !== trackId && canonical.filePath && fs.existsSync(canonical.filePath)) {
    await linkTrackToCanonical(trackId, canonical);
    console.log(`[Download] Reused existing file for track ${trackId} (source ${download.sourceId})`);
    return;
  }

  const artistName = meta.artist || download.artist;
  const trackTitle = meta.title || download.title;

  const { filePath, storageTier } = await finalizeFileStorage(trackId, download.filePath);
  const downloadedAt = new Date();

  const { needsBetterAlbumArt, resolveAlbumArt, upgradeTrackAlbumArtInBackground } = await import('./albumArt');
  let thumbnailUrl = track.thumbnailUrl;
  if (needsBetterAlbumArt(thumbnailUrl)) {
    thumbnailUrl = await resolveAlbumArt({
      title: trackTitle,
      artist: artistName,
      album: meta.album || track.album?.title,
      preferredUrl: track.thumbnailUrl || download.thumbnailUrl,
    }) || download.thumbnailUrl || track.thumbnailUrl;
  }

  await prisma.track.update({
    where: { id: trackId },
    data: {
      title: trackTitle,
      duration: download.duration || track.duration,
      filePath,
      sourceUrl: download.sourceUrl,
      sourceId: download.sourceId,
      thumbnailUrl,
      quality,
      isDownloaded: true,
      downloadedAt,
      storageTier,
      lastAccessedAt: new Date(),
    },
  });

  if (download.sourceId) {
    await propagateDownloadToSourceId(
      download.sourceId,
      {
        filePath,
        sourceUrl: download.sourceUrl,
        downloadedAt,
        storageTier,
        quality,
        duration: download.duration || track.duration,
        thumbnailUrl: thumbnailUrl || download.thumbnailUrl || track.thumbnailUrl,
      },
      trackId,
    );
  }

  if (needsBetterAlbumArt(thumbnailUrl)) {
    upgradeTrackAlbumArtInBackground(trackId, {
      title: trackTitle,
      artist: artistName,
      album: meta.album || track.album?.title,
      preferredUrl: thumbnailUrl,
    });
  }

  fetchLyricsForTrack({
    trackId,
    title: trackTitle,
    artist: artistName,
    duration: download.duration,
    album: meta.album ?? track.album?.title ?? null,
  }).catch(console.error);
}

export function ensureBackgroundDownload(
  trackId: string,
  sourceUrl: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH',
  meta: { title?: string; artist?: string; album?: string }
) {
  if (isDownloadInProgress(trackId)) return getActiveDownload(trackId);
  if (isDownloadCoolingDown(trackId, sourceUrl)) {
    console.warn(`[Download] Skipping restart for ${trackId} — recent failure cooldown`);
    return;
  }

  if (isYouTubeRateLimited()) {
    const mins = Math.ceil(youtubeRateLimitRemainingMs() / 60000);
    console.warn(`[Download] Skipping ${trackId} — YouTube rate-limited (~${mins}m left)`);
    return;
  }

  const pendingKey = `tid:${trackId}`;
  trackToDownloadKey.set(trackId, pendingKey);

  const runDownload = async () => {
    const track = await prisma.track.findUnique({ where: { id: trackId } });
    if (track?.isDownloaded && track.filePath && fs.existsSync(track.filePath)) return;

    const { downloadFromYouTube } = await import('./downloader');
    console.log(`[Download] Background save started for track ${trackId}`);
    const outputDir = await getDownloadDirForTrack(trackId);
    assertDiskSpaceForDownload(outputDir);
    const download = await downloadFromYouTube(sourceUrl, quality, undefined, outputDir);
    await finalizeTrackDownload(trackId, download, quality, meta);
    downloadFailUntil.delete(`tid:${trackId}`);
    downloadFailUntil.delete(`url:${sourceUrl}`);
    console.log(`[Download] Background save complete for track ${trackId}`);
  };

  const job = (async () => {
    try {
      const track = await prisma.track.findUnique({ where: { id: trackId } });
      if (track?.isDownloaded && track.filePath && fs.existsSync(track.filePath)) return;

      const canonical = await findCanonicalDownloadedTrack(track?.sourceId, sourceUrl);
      if (canonical) {
        await linkTrackToCanonical(trackId, canonical);
        console.log(`[Download] Linked track ${trackId} to existing file (${canonical.id})`);
        return;
      }

      const sourceKey = downloadKey(track?.sourceId, sourceUrl);
      if (sourceKey) {
        let shared = activeDownloads.get(sourceKey);
        if (!shared) {
          shared = runDownload()
            .catch((err) => {
              markDownloadFailed(trackId, sourceUrl, err);
              throw err;
            })
            .finally(() => activeDownloads.delete(sourceKey));
          activeDownloads.set(sourceKey, shared);
        }
        trackToDownloadKey.set(trackId, sourceKey);
        activeDownloads.delete(pendingKey);
        await shared.catch(() => { /* already logged */ });
        const after = await findCanonicalDownloadedTrack(track?.sourceId, sourceUrl);
        if (after) await linkTrackToCanonical(trackId, after);
        return;
      }

      await runDownload();
    } catch (err) {
      markDownloadFailed(trackId, sourceUrl, err);
    } finally {
      const key = trackToDownloadKey.get(trackId);
      if (key) activeDownloads.delete(key);
      trackToDownloadKey.delete(trackId);
    }
  })();

  activeDownloads.set(pendingKey, job);
  return job;
}

/**
 * Live-stream YouTube audio to the HTTP response.
 * Retries client/format attempts until the first audio byte arrives (same ladder as downloads).
 */
function pipeYtDlpWithFallback(
  target: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH',
  req: { on: (event: string, cb: () => void) => void },
  res: Response,
  logLabel: string,
): ChildProcess {
  const attempts = ytDlpAudioExtractAttempts(quality);
  let attemptIndex = 0;
  let current: ChildProcess | null = null;
  let headersSent = false;
  let clientGone = false;

  const fail = (stderr: string) => {
    console.error(`[Stream] ${logLabel} failed:`, lastLines(stderr));
    if (!res.headersSent) res.status(502).end();
    else if (!res.writableEnded) res.end();
  };

  const start = (): ChildProcess => {
    if (clientGone || res.writableEnded) {
      return current!;
    }
    if (attemptIndex >= attempts.length) {
      fail('all format attempts exhausted');
      return current!;
    }

    const attempt = attempts[attemptIndex++];
    const proc = spawn(ytDlpCommand(), ytdlpPipeArgs(
      ...attempt.args,
      '-o', '-',
      target,
    ), { stdio: ['ignore', 'pipe', 'pipe'] });
    current = proc;

    let stderr = '';
    let gotData = false;

    proc.stdout.on('data', (chunk: Buffer) => {
      if (clientGone) return;
      if (!gotData) {
        gotData = true;
        if (!headersSent && !res.headersSent) {
          headersSent = true;
          res.setHeader('Content-Type', 'audio/mpeg');
          res.setHeader('Cache-Control', 'private, max-age=86400');
          res.setHeader('Accept-Ranges', 'none');
        }
      }
      if (!res.writableEnded) {
        res.write(chunk);
      }
    });

    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('error', (err) => {
      console.error(`[Stream] ${logLabel} spawn error:`, err.message);
      if (!gotData && attemptIndex < attempts.length && !clientGone) {
        console.warn(`[Stream] ${logLabel} retry after spawn fail (${attempt.label})`);
        start();
        return;
      }
      fail(err.message);
    });

    proc.on('close', (code) => {
      if (clientGone) return;
      if (code === 0) {
        if (!res.writableEnded) res.end();
        return;
      }
      if (!gotData && attemptIndex < attempts.length) {
        console.warn(`[Stream] ${logLabel} retry after ${attempt.label}: ${lastLines(stderr, 2)}`);
        start();
        return;
      }
      fail(stderr || `exit ${code}`);
    });

    return proc;
  };

  req.on('close', () => {
    clientGone = true;
    if (current && !current.killed) current.kill('SIGKILL');
  });

  return start();
}

export function pipeYouTubeAudio(
  sourceUrl: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH',
  req: { on: (event: string, cb: () => void) => void },
  res: Response,
  _startSec = 0,
): ChildProcess {
  return pipeYtDlpWithFallback(sourceUrl, quality, req, res, 'Pipe');
}

/** Stream audio via yt-dlp search — starts quickly without a resolved source URL. */
export function pipeYouTubeSearch(
  searchQuery: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH',
  req: { on: (event: string, cb: () => void) => void },
  res: Response,
): ChildProcess {
  return pipeYtDlpWithFallback(`ytsearch1:${searchQuery}`, quality, req, res, 'Search pipe');
}
