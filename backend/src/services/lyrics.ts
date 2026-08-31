import prisma from '../lib/prisma';
import { config } from '../config';

const LRCLIB_BASE = 'https://lrclib.net/api';

function lrcLibHeaders(): Record<string, string> {
  return {
    'User-Agent': `${config.appName}/1.0 (https://github.com/evia1232/LlamaStream)`,
    Accept: 'application/json',
  };
}

interface LrcRecord {
  id?: number;
  trackName?: string;
  name?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  plainLyrics?: string;
  syncedLyrics?: string;
}

export interface LyricsFetchInput {
  trackId: string;
  title: string;
  artist: string;
  duration?: number;
  album?: string | null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u0590-\u05ff\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTitle(title: string): string {
  return title
    .replace(/\s*[\(\[\{](official\s*(video|audio|lyric(s)?|visualizer)|lyrics?|audio|video|hd|4k|visual|prod\.?)[^)\]\}]*[\)\]\}]/gi, '')
    .replace(/\s*[\(\[\{][^)\]\}]*[\)\]\}]/g, '')
    .replace(/\s+-\s+(remix|live|acoustic|cover|karaoke|version).*$/i, '')
    .trim();
}

function primaryArtist(artist: string): string {
  return artist.split(/\s*,\s*|\s*&\s*|\s+feat\.?\s+|\s+ft\.?\s+|\s+x\s+/i)[0].trim();
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(normalizeText(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeText(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.max(ta.size, tb.size);
}

function scoreRecord(record: LrcRecord, target: { title: string; artist: string; duration?: number; album?: string | null }): number {
  const name = record.trackName || record.name || '';
  let score = tokenOverlap(name, target.title) * 50;
  score += tokenOverlap(record.artistName || '', target.artist) * 35;
  if (target.album && record.albumName) {
    score += tokenOverlap(record.albumName, target.album) * 10;
  }
  if (target.duration && record.duration) {
    const diff = Math.abs(record.duration - target.duration);
    if (diff <= 2) score += 25;
    else if (diff <= 5) score += 15;
    else if (diff <= 12) score += 5;
    else score -= 10;
  }
  if (record.syncedLyrics) score += 5;
  return score;
}

async function lrcFetch(path: string): Promise<Response> {
  await sleep(250);
  return fetch(`${LRCLIB_BASE}${path}`, { headers: lrcLibHeaders() });
}

async function tryGetLyrics(params: Record<string, string>): Promise<LrcRecord | null> {
  const qs = new URLSearchParams(params);
  const res = await lrcFetch(`/get?${qs}`);
  if (!res.ok) return null;
  return res.json() as Promise<LrcRecord>;
}

async function searchLyrics(params: Record<string, string>): Promise<LrcRecord[]> {
  const qs = new URLSearchParams(params);
  const res = await lrcFetch(`/search?${qs}`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data as LrcRecord[] : [];
}

function pickBest(records: LrcRecord[], target: { title: string; artist: string; duration?: number; album?: string | null }): LrcRecord | null {
  if (records.length === 0) return null;
  const scored = records
    .map((r) => ({ r, score: scoreRecord(r, target) }))
    .filter(({ score }) => score >= 35)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.r ?? null;
}

async function resolveFromLrcLib(target: { title: string; artist: string; duration?: number; album?: string | null }): Promise<LrcRecord | null> {
  const title = cleanTitle(target.title);
  const artist = primaryArtist(target.artist);
  const album = target.album?.trim() || undefined;
  const duration = target.duration && target.duration > 0 ? Math.round(target.duration) : undefined;

  const getAttempts: Record<string, string>[] = [];
  if (duration) {
    getAttempts.push({ track_name: title, artist_name: artist, duration: String(duration), ...(album ? { album_name: album } : {}) });
    getAttempts.push({ track_name: title, artist_name: artist, duration: String(duration) });
  }
  getAttempts.push({ track_name: title, artist_name: artist, ...(album ? { album_name: album } : {}) });
  getAttempts.push({ track_name: title, artist_name: artist });

  const cleanedTitle = cleanTitle(title);
  if (cleanedTitle !== title) {
    getAttempts.push({ track_name: cleanedTitle, artist_name: artist, ...(duration ? { duration: String(duration) } : {}) });
  }

  for (const params of getAttempts) {
    const hit = await tryGetLyrics(params);
    if (hit && (hit.plainLyrics || hit.syncedLyrics)) return hit;
  }

  const searchQueries: Record<string, string>[] = [
    { q: `${title} ${artist}` },
    { track_name: title, artist_name: artist },
    { q: `${cleanedTitle} ${artist}` },
    { track_name: cleanedTitle, artist_name: primaryArtist(artist) },
  ];

  for (const params of searchQueries) {
    const results = await searchLyrics(params);
    const best = pickBest(results, { title, artist, duration, album });
    if (best) return best;
  }

  return null;
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

export { parseLrc };

async function saveLyricsRecord(trackId: string, data: LrcRecord) {
  let synced = false;
  let lines: { time: number; text: string }[] | null = null;
  let content = data.plainLyrics || '';

  if (data.syncedLyrics) {
    synced = true;
    content = data.syncedLyrics;
    lines = parseLrc(data.syncedLyrics);
  }

  if (!content) return null;

  return prisma.lyrics.upsert({
    where: { trackId },
    create: {
      trackId,
      content,
      synced,
      lines: lines ? JSON.parse(JSON.stringify(lines)) : undefined,
      source: 'lrclib',
    },
    update: {
      content,
      synced,
      lines: lines ? JSON.parse(JSON.stringify(lines)) : undefined,
      source: 'lrclib',
    },
  });
}

export async function fetchLyricsForTrack(input: LyricsFetchInput | string, title?: string, artist?: string) {
  try {
    let trackId: string;
    let meta: { title: string; artist: string; duration?: number; album?: string | null };

    if (typeof input === 'string') {
      trackId = input;
      meta = { title: title || '', artist: artist || '' };
      const track = await prisma.track.findUnique({
        where: { id: trackId },
        include: { artist: true, album: true, lyrics: true },
      });
      if (!track) return null;
      if (track.lyrics) return track.lyrics;
      meta = {
        title: track.title,
        artist: track.artist.name,
        duration: track.duration,
        album: track.album?.title ?? null,
      };
    } else {
      trackId = input.trackId;
      const existing = await prisma.lyrics.findUnique({ where: { trackId } });
      if (existing) return existing;
      meta = {
        title: input.title,
        artist: input.artist,
        duration: input.duration,
        album: input.album,
      };
    }

    if (!meta.title || !meta.artist) return null;

    const record = await resolveFromLrcLib(meta);
    if (!record) return null;

    return saveLyricsRecord(trackId, record);
  } catch (err) {
    console.error('Lyrics fetch failed:', err);
    return null;
  }
}
