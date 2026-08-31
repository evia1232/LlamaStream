import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import { Response } from 'express';
import prisma from '../lib/prisma';
import type { DownloadResult } from './downloader';
import { fetchLyricsForTrack } from './lyrics';
import { lastLines, ytDlpAudioExtractArgs } from './ytdlp';
import { finalizeFileStorage, getDownloadDirForTrack, touchTrackAccess } from './trackStorage';

const activeDownloads = new Map<string, Promise<void>>();

const YTDLP_BASE = [
  '--no-warnings',
  '--no-playlist',
  '--retries', '5',
  '--fragment-retries', '5',
  '--socket-timeout', '30',
  '--extractor-args', 'youtube:player_client=android,web',
];

export function isDownloadInProgress(trackId: string): boolean {
  return activeDownloads.has(trackId);
}

export function cancelBackgroundDownload(trackId: string): void {
  activeDownloads.delete(trackId);
}

export function trackStreamUrl(track: { id: string; isDownloaded: boolean }): string | null {
  if (track.isDownloaded) {
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
  const artistName = meta.artist || download.artist;
  const trackTitle = meta.title || download.title;

  const { filePath, storageTier } = await finalizeFileStorage(trackId, download.filePath);

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
      downloadedAt: new Date(),
      storageTier,
      lastAccessedAt: new Date(),
    },
  });

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
  if (activeDownloads.has(trackId)) return activeDownloads.get(trackId);

  const job = (async () => {
    try {
      const track = await prisma.track.findUnique({ where: { id: trackId } });
      if (track?.isDownloaded && track.filePath && fs.existsSync(track.filePath)) return;

      const { downloadFromYouTube } = await import('./downloader');
      console.log(`[Download] Background save started for track ${trackId}`);
      const outputDir = await getDownloadDirForTrack(trackId);
      const download = await downloadFromYouTube(sourceUrl, quality, undefined, outputDir);
      await finalizeTrackDownload(trackId, download, quality, meta);
      console.log(`[Download] Background save complete for track ${trackId}`);
    } catch (err) {
      console.error(`[Download] Background save failed for track ${trackId}:`, (err as Error).message);
    } finally {
      activeDownloads.delete(trackId);
    }
  })();

  activeDownloads.set(trackId, job);
  return job;
}

export function pipeYouTubeAudio(
  sourceUrl: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH',
  req: { on: (event: string, cb: () => void) => void },
  res: Response,
  startSec = 0
): ChildProcess {
  const proc = spawn('yt-dlp', [
    ...YTDLP_BASE,
    ...ytDlpAudioExtractArgs(quality),
    '-o', '-',
    sourceUrl,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
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
