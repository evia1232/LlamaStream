import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config, qualityBitrates } from '../config';
import prisma from '../lib/prisma';

export interface SearchResult {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnailUrl: string;
  url: string;
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

function runCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { shell: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr || `Command failed with code ${code}`));
    });
    proc.on('error', reject);
  });
}

export async function searchTracks(query: string, limit = 10): Promise<SearchResult[]> {
  const searchQuery = `ytsearch${limit}:${query}`;
  const output = await runCommand('yt-dlp', [
    '--flat-playlist',
    '--dump-json',
    '--no-warnings',
    searchQuery,
  ]);

  const results: SearchResult[] = [];
  for (const line of output.split('\n').filter(Boolean)) {
    try {
      const data = JSON.parse(line);
      results.push({
        id: data.id,
        title: data.title || 'Unknown',
        artist: data.uploader || data.channel || 'Unknown Artist',
        duration: data.duration || 0,
        thumbnailUrl: data.thumbnail || data.thumbnails?.[0]?.url || '',
        url: data.url || `https://www.youtube.com/watch?v=${data.id}`,
      });
    } catch {
      // skip malformed lines
    }
  }
  return results;
}

export async function downloadTrack(
  sourceUrl: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH' = 'HIGH',
  onProgress?: (progress: number) => void
): Promise<DownloadResult> {
  const outputDir = config.musicStoragePath;
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const fileId = uuidv4();
  const outputTemplate = path.join(outputDir, `${fileId}.%(ext)s`);
  const bitrate = qualityBitrates[quality] || '320';

  // Get metadata first
  const metaJson = await runCommand('yt-dlp', [
    '--dump-json',
    '--no-warnings',
    sourceUrl,
  ]);
  const meta = JSON.parse(metaJson);

  await new Promise<void>((resolve, reject) => {
    const args = [
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', `${bitrate}K`,
      '-o', outputTemplate,
      '--no-playlist',
      '--newline',
      sourceUrl,
    ];

    const proc = spawn('yt-dlp', args, { shell: true });
    proc.stderr.on('data', (d) => {
      const line = d.toString();
      const match = line.match(/(\d+\.?\d*)%/);
      if (match && onProgress) {
        onProgress(parseFloat(match[1]));
      }
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('Download failed'));
    });
    proc.on('error', reject);
  });

  const filePath = path.join(outputDir, `${fileId}.mp3`);
  if (!fs.existsSync(filePath)) {
    throw new Error('Downloaded file not found');
  }

  return {
    filePath,
    title: meta.title || 'Unknown',
    artist: meta.uploader || meta.channel || meta.artist || 'Unknown Artist',
    duration: Math.round(meta.duration || 0),
    thumbnailUrl: meta.thumbnail || '',
    sourceId: meta.id,
    sourceUrl: meta.webpage_url || sourceUrl,
  };
}

export async function getOrCreateTrackFromSearch(
  query: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH' = 'HIGH'
) {
  // Check if track already exists by searching DB
  const existing = await prisma.track.findFirst({
    where: {
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { sourceUrl: { contains: query } },
      ],
      isDownloaded: true,
    },
    include: { artist: true, album: true, lyrics: true },
  });

  if (existing) return existing;

  const results = await searchTracks(query, 1);
  if (results.length === 0) {
    throw new Error(`No results found for: ${query}`);
  }

  const result = results[0];

  // Check by source ID
  const bySource = await prisma.track.findFirst({
    where: { sourceId: result.id },
    include: { artist: true, album: true, lyrics: true },
  });
  if (bySource?.isDownloaded) return bySource;

  const download = await downloadTrack(result.url, quality);

  let artist = await prisma.artist.findUnique({ where: { name: download.artist } });
  if (!artist) {
    artist = await prisma.artist.create({ data: { name: download.artist } });
  }

  if (bySource) {
    return prisma.track.update({
      where: { id: bySource.id },
      data: {
        filePath: download.filePath,
        isDownloaded: true,
        quality,
        duration: download.duration,
        thumbnailUrl: download.thumbnailUrl,
      },
      include: { artist: true, album: true, lyrics: true },
    });
  }

  const track = await prisma.track.create({
    data: {
      title: download.title,
      artistId: artist.id,
      duration: download.duration,
      filePath: download.filePath,
      sourceUrl: download.sourceUrl,
      sourceId: download.sourceId,
      thumbnailUrl: download.thumbnailUrl,
      quality,
      isDownloaded: true,
    },
    include: { artist: true, album: true, lyrics: true },
  });

  // Fetch lyrics in background
  fetchLyricsForTrack(track.id, download.title, download.artist).catch(console.error);

  return track;
}

async function fetchLyricsForTrack(trackId: string, title: string, artist: string) {
  try {
    const existing = await prisma.lyrics.findUnique({ where: { trackId } });
    if (existing) return;

    const response = await fetch(
      `https://lrclib.net/api/get?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`
    );
    
    if (response.ok) {
      const data = await response.json() as {
        plainLyrics?: string;
        syncedLyrics?: string;
      };

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
          data: {
            trackId,
            content,
            synced,
            lines: lines ? JSON.parse(JSON.stringify(lines)) : undefined,
            source: 'lrclib',
          },
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
      const minutes = parseInt(match[1], 10);
      const seconds = parseFloat(match[2]);
      lines.push({ time: minutes * 60 + seconds, text: match[3].trim() });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

export { fetchLyricsForTrack, parseLrc };
