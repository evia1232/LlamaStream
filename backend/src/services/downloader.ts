import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config, qualityBitrates } from '../config';
import prisma from '../lib/prisma';
import { runYtDlp, findFileByPrefix, lastLines } from './ytdlp';
import { buildSearchQueries, rankYouTubeResults } from '../lib/trackMatch';

export interface SearchResult {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnailUrl: string;
  url: string;
  source: 'youtube';
}

export interface DownloadResult {
  filePath: string;
  title: string;
  artist: string;
  duration: number;
  thumbnailUrl: string;
  sourceId: string;
  sourceUrl: string;
}

function parseJsonLines<T>(output: string): T[] {
  const items: T[] = [];
  for (const line of output.split('\n').filter(Boolean)) {
    try {
      items.push(JSON.parse(line));
    } catch {
      // skip
    }
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

export async function searchYouTube(query: string, limit = 15): Promise<SearchResult[]> {
  const result = await runYtDlp([
    '--flat-playlist',
    '--dump-json',
    '--skip-download',
    `ytsearch${limit}:${query}`,
  ], 60000);

  if (result.code !== 0) {
    throw new Error(lastLines(result.stderr) || 'YouTube search failed');
  }

  return parseJsonLines<Record<string, unknown>>(result.stdout).map((data) => ({
    id: String(data.id),
    title: String(data.title || 'Unknown'),
    artist: String(data.uploader || data.channel || extractArtistFromTitle(String(data.title || ''))),
    duration: Number(data.duration || 0),
    thumbnailUrl: String(data.thumbnail || (data.thumbnails as { url: string }[])?.[0]?.url || ''),
    url: String(data.url || data.webpage_url || `https://www.youtube.com/watch?v=${data.id}`),
    source: 'youtube' as const,
  }));
}

export async function downloadFromYouTube(
  sourceUrl: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH' = 'HIGH',
  onProgress?: (progress: number) => void
): Promise<DownloadResult> {
  const outputDir = config.musicStoragePath;
  fs.mkdirSync(outputDir, { recursive: true });

  const fileId = uuidv4();
  const outputTemplate = path.join(outputDir, `${fileId}.%(ext)s`);
  const bitrate = qualityBitrates[quality] || '192';

  // Fetch metadata
  const metaResult = await runYtDlp(['--dump-single-json', '--skip-download', sourceUrl], 60000);
  if (metaResult.code !== 0) {
    throw new Error(lastLines(metaResult.stderr) || 'Failed to fetch video metadata');
  }

  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(metaResult.stdout);
  } catch {
    throw new Error('Invalid metadata from yt-dlp');
  }

  const downloadResult = await new Promise<YtDlpDownloadResult>((resolve, reject) => {
    const args = [
      '--no-warnings', '--no-playlist', '--retries', '5', '--fragment-retries', '5',
      '--socket-timeout', '30',
      '--extractor-args', 'youtube:player_client=android,web',
      '-f', 'bestaudio/best',
      '-x', '--audio-format', 'mp3',
      '--postprocessor-args', `ffmpeg:-b:a ${bitrate}k`,
      '-o', outputTemplate,
      '--newline',
      '--progress',
      sourceUrl,
    ];

    const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    proc.stderr.on('data', (d: Buffer) => {
      const line = d.toString();
      stderr += line;
      const match = line.match(/(\d+\.?\d*)%/);
      if (match && onProgress) onProgress(parseFloat(match[1]));
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve({ stderr });
      else reject(new Error(lastLines(stderr) || `Download failed (exit ${code})`));
    });
  });

  void downloadResult;

  const filePath = findFileByPrefix(outputDir, fileId);
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('Download completed but audio file was not found');
  }

  const rawTitle = String(meta.title || 'Unknown');
  const artist = String(meta.uploader || meta.channel || meta.artist || extractArtistFromTitle(rawTitle));

  return {
    filePath,
    title: extractTrackTitle(rawTitle),
    artist,
    duration: Math.round(Number(meta.duration || 0)),
    thumbnailUrl: String(meta.thumbnail || ''),
    sourceId: String(meta.id || ''),
    sourceUrl: String(meta.webpage_url || sourceUrl),
  };
}

interface YtDlpDownloadResult { stderr: string }

export async function saveTrackRecord(
  download: DownloadResult,
  quality: 'LOW' | 'NORMAL' | 'HIGH',
  preferredTitle?: string,
  preferredArtist?: string
) {
  const artistName = preferredArtist || download.artist;
  const trackTitle = preferredTitle || download.title;

  let artist = await prisma.artist.findUnique({ where: { name: artistName } });
  if (!artist) artist = await prisma.artist.create({ data: { name: artistName } });

  const existing = download.sourceId
    ? await prisma.track.findFirst({ where: { sourceId: download.sourceId } })
    : null;

  const data = {
    title: trackTitle,
    artistId: artist.id,
    duration: download.duration,
    filePath: download.filePath,
    sourceUrl: download.sourceUrl,
    sourceId: download.sourceId,
    thumbnailUrl: download.thumbnailUrl,
    quality,
    isDownloaded: true,
  };

  const track = existing
    ? await prisma.track.update({
        where: { id: existing.id },
        data,
        include: { artist: true, album: true, lyrics: true },
      })
    : await prisma.track.create({
        data,
        include: { artist: true, album: true, lyrics: true },
      });

  fetchLyricsForTrack(track.id, trackTitle, artistName).catch(console.error);
  return track;
}

export async function resolveAndDownload(
  input: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH' = 'HIGH',
  opts?: { title?: string; artist?: string; url?: string; duration?: number; album?: string }
) {
  const trimmed = input.trim();

  // Direct YouTube URL
  if (opts?.url || /youtube\.com|youtu\.be|music\.youtube\.com/i.test(trimmed)) {
    const url = opts?.url || trimmed;
    const existing = await prisma.track.findFirst({
      where: { sourceUrl: url, isDownloaded: true },
      include: { artist: true, album: true, lyrics: true },
    });
    if (existing?.filePath && fs.existsSync(existing.filePath)) return existing;

    const download = await downloadFromYouTube(url, quality);
    return saveTrackRecord(download, quality, opts?.title, opts?.artist);
  }

  // Search query — find best YouTube match (especially for Spotify imports)
  const searchQuery = opts?.artist && opts?.title
    ? `${opts.artist} - ${opts.title}`
    : trimmed;

  const existing = await prisma.track.findFirst({
    where: {
      isDownloaded: true,
      OR: [
        { title: { equals: opts?.title || searchQuery, mode: 'insensitive' } },
        ...(opts?.title && opts?.artist ? [{
          AND: [
            { title: { contains: opts.title, mode: 'insensitive' as const } },
            { artist: { name: { contains: opts.artist.split(/[,;&]/)[0].trim(), mode: 'insensitive' as const } } },
          ],
        }] : []),
      ],
    },
    include: { artist: true, album: true, lyrics: true },
  });
  if (existing?.filePath && fs.existsSync(existing.filePath)) return existing;

  const target = {
    title: opts?.title || searchQuery,
    artist: opts?.artist || '',
    duration: opts?.duration,
    album: opts?.album,
  };

  let candidates: SearchResult[] = [];

  if (opts?.title && opts?.artist) {
    const queries = buildSearchQueries(opts.artist, opts.title, opts?.album);
    const seen = new Set<string>();
    for (const q of queries) {
      try {
        const batch = await searchYouTube(q, 8);
        for (const r of batch) {
          if (!seen.has(r.id)) {
            seen.add(r.id);
            candidates.push(r);
          }
        }
      } catch (err) {
        console.error(`YouTube search failed for "${q}":`, err);
      }
    }
    candidates = rankYouTubeResults(candidates, target);
  }

  if (candidates.length === 0) {
    const fallback = await searchYouTube(searchQuery, 10);
    candidates = opts?.title && opts?.artist
      ? rankYouTubeResults(fallback, target)
      : fallback;
  }

  if (candidates.length === 0) {
    throw new Error(`No YouTube results for: ${searchQuery}`);
  }

  let lastError: Error | null = null;
  for (const result of candidates.slice(0, 8)) {
    try {
      const bySource = await prisma.track.findFirst({
        where: { sourceId: result.id, isDownloaded: true },
        include: { artist: true, album: true, lyrics: true },
      });
      if (bySource?.filePath && fs.existsSync(bySource.filePath)) return bySource;

      const download = await downloadFromYouTube(result.url, quality);
      return saveTrackRecord(
        download,
        quality,
        opts?.title || result.title,
        opts?.artist || result.artist
      );
    } catch (err) {
      lastError = err as Error;
      console.error(`Download attempt failed for ${result.url}:`, lastError.message);
    }
  }

  throw lastError || new Error('All download attempts failed');
}

// Backward-compatible aliases
export const searchTracks = searchYouTube;
export const downloadTrack = downloadFromYouTube;
export const getOrCreateTrackFromSearch = (query: string, quality: 'LOW' | 'NORMAL' | 'HIGH' = 'HIGH') =>
  resolveAndDownload(query, quality);

async function fetchLyricsForTrack(trackId: string, title: string, artist: string) {
  try {
    const existing = await prisma.lyrics.findUnique({ where: { trackId } });
    if (existing) return;

    const response = await fetch(
      `https://lrclib.net/api/get?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`
    );

    if (response.ok) {
      const data = await response.json() as { plainLyrics?: string; syncedLyrics?: string };
      let synced = false;
      let lines: { time: number; text: string }[] | null = null;
      let content = data.plainLyrics || '';

      if (data.syncedLyrics) {
        synced = true;
        content = data.syncedLyrics;
        lines = parseLrc(data.syncedLyrics);
      }

      if (content) {
        await prisma.lyrics.create({
          data: { trackId, content, synced, lines: lines ? JSON.parse(JSON.stringify(lines)) : undefined, source: 'lrclib' },
        });
      }
    }
  } catch (err) {
    console.error('Lyrics fetch failed:', err);
  }
}

function parseLrc(lrc: string): { time: number; text: string }[] {
  const lines: { time: number; text: string }[] = [];
  for (const line of lrc.split('\n')) {
    const match = line.match(/\[(\d+):(\d+\.?\d*)\](.*)/);
    if (match) {
      lines.push({ time: parseInt(match[1], 10) * 60 + parseFloat(match[2]), text: match[3].trim() });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

export { fetchLyricsForTrack, parseLrc };
