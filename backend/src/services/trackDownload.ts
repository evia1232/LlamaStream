import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import { Response } from 'express';
import prisma from '../lib/prisma';
import type { DownloadResult } from './downloader';
import { fetchLyricsForTrack } from './lyrics';
import { lastLines, ytDlpAudioExtractArgs, ytDlpAuthArgs } from './ytdlp';
import { finalizeFileStorage, getDownloadDirForTrack, touchTrackAccess } from './trackStorage';
import {
  downloadKey,
  findCanonicalDownloadedTrack,
  linkTrackToCanonical,
  propagateDownloadToSourceId,
} from './trackDedup';

const activeDownloads = new Map<string, Promise<void>>();
const trackToDownloadKey = new Map<string, string>();

const YTDLP_BASE = [
  '--no-warnings',
  '--no-playlist',
  '--retries', '5',
  '--fragment-retries', '5',
  '--socket-timeout', '30',
  '--js-runtimes', 'deno,node',
  '--remote-components', 'ejs:github',
  '--extractor-args', 'youtube:player_client=android,web',
];

function ytdlpArgs(...extra: string[]): string[] {
  return [...YTDLP_BASE, ...ytDlpAuthArgs(), ...extra];
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

  await prisma.track.update({
    where: { id: trackId },
    data: {
      title: trackTitle,
      duration: download.duration || track.duration,
      filePath,
      sourceUrl: download.sourceUrl,
      sourceId: download.sourceId,
      thumbnailUrl: download.thumbnailUrl || track.thumbnailUrl,
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
        thumbnailUrl: download.thumbnailUrl || track.thumbnailUrl,
      },
      trackId,
    );
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

  const pendingKey = `tid:${trackId}`;
  trackToDownloadKey.set(trackId, pendingKey);

  const runDownload = async () => {
    const track = await prisma.track.findUnique({ where: { id: trackId } });
    if (track?.isDownloaded && track.filePath && fs.existsSync(track.filePath)) return;

    const { downloadFromYouTube } = await import('./downloader');
    console.log(`[Download] Background save started for track ${trackId}`);
    const outputDir = await getDownloadDirForTrack(trackId);
    const download = await downloadFromYouTube(sourceUrl, quality, undefined, outputDir);
    await finalizeTrackDownload(trackId, download, quality, meta);
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
          shared = runDownload().finally(() => activeDownloads.delete(sourceKey));
          activeDownloads.set(sourceKey, shared);
        }
        trackToDownloadKey.set(trackId, sourceKey);
        activeDownloads.delete(pendingKey);
        await shared.catch(() => { /* ignore */ });
        const after = await findCanonicalDownloadedTrack(track?.sourceId, sourceUrl);
        if (after) await linkTrackToCanonical(trackId, after);
        return;
      }

      await runDownload();
    } catch (err) {
      console.error(`[Download] Background save failed for track ${trackId}:`, (err as Error).message);
    } finally {
      const key = trackToDownloadKey.get(trackId);
      if (key) activeDownloads.delete(key);
      trackToDownloadKey.delete(trackId);
    }
  })();

  activeDownloads.set(pendingKey, job);
  return job;
}

export function pipeYouTubeAudio(
  sourceUrl: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH',
  req: { on: (event: string, cb: () => void) => void },
  res: Response,
  startSec = 0
): ChildProcess {
  const proc = spawn('yt-dlp', ytdlpArgs(
    ...ytDlpAudioExtractArgs(quality),
    '-o', '-',
    sourceUrl,
  ), { stdio: ['ignore', 'pipe', 'pipe'] });

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('Accept-Ranges', 'none');

  proc.stdout.pipe(res);

  let stderr = '';
  proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

  proc.on('error', (err) => {
    console.error('[Stream] Pipe error:', err.message);
    if (!res.headersSent) res.status(502).end();
    else if (!res.writableEnded) res.end();
  });

  proc.on('close', (code) => {
    if (code !== 0) {
      console.error('[Stream] Pipe closed with error:', lastLines(stderr));
    }
    if (!res.writableEnded) res.end();
  });

  req.on('close', () => {
    if (!proc.killed) proc.kill('SIGKILL');
  });

  return proc;
}

/** Stream audio via yt-dlp search — starts quickly without a resolved source URL. */
export function pipeYouTubeSearch(
  searchQuery: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH',
  req: { on: (event: string, cb: () => void) => void },
  res: Response,
): ChildProcess {
  const proc = spawn('yt-dlp', ytdlpArgs(
    ...ytDlpAudioExtractArgs(quality),
    '-o', '-',
    `ytsearch1:${searchQuery}`,
  ), { stdio: ['ignore', 'pipe', 'pipe'] });

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('Accept-Ranges', 'none');

  proc.stdout.pipe(res);

  let stderr = '';
  proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

  proc.on('error', (err) => {
    console.error('[Stream] Search pipe error:', err.message);
    if (!res.headersSent) res.status(502).end();
    else if (!res.writableEnded) res.end();
  });

  proc.on('close', (code) => {
    if (code !== 0) {
      console.error('[Stream] Search pipe closed with error:', lastLines(stderr));
    }
    if (!res.writableEnded) res.end();
  });

  req.on('close', () => {
    if (!proc.killed) proc.kill('SIGKILL');
  });

  return proc;
}
