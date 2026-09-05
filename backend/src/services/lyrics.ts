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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanTitle(title: string): string {
  return title
    .replace(/\s*[\(\[\{](official\s*(video|audio|lyric(s)?|visualizer)|lyrics?|audio|video|hd|4k|visual|prod\.?|topic)[^)\]\}]*[\)\]\}]/gi, '')
    .replace(/\s*[\(\[\{][^)\]\}]*[\)\]\}]/g, '')
    .replace(/\s+-\s+(remix|live|acoustic|cover|karaoke|version|edit|remaster(ed)?).*$/i, '')
    .replace(/\s+(feat\.?|ft\.?|featuring)\s+.+$/i, '')
    .replace(/\s+\|\s+.+$/g, '')
    .trim();
}

function primaryArtist(artist: string): string {
  return artist.split(/\s*,\s*|\s*&\s*|\s+feat\.?\s+|\s+ft\.?\s+|\s+featuring\s+|\s+x\s+/i)[0].trim();
}

function artistVariants(artist: string): string[] {
  const parts = artist
    .split(/\s*,\s*|\s*&\s*|\s+feat\.?\s+|\s+ft\.?\s+|\s+featuring\s+|\s+x\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  return [...new Set([artist.trim(), primaryArtist(artist), ...parts].filter(Boolean))];
}

function stripArtistFromTitle(title: string, artist: string): string {
  let result = title.trim();
  for (const name of artistVariants(artist)) {
    if (!name) continue;
    const pattern = new RegExp(`^${escapeRegex(name)}\\s*[-–—:|]\\s*`, 'i');
    result = result.replace(pattern, '').trim();
  }
  return result || title.trim();
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(normalizeText(a).split(' ').filter((w) => w.length > 1));
  const tb = new Set(normalizeText(b).split(' ').filter((w) => w.length > 1));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.max(ta.size, tb.size);
}

function scoreRecord(
  record: LrcRecord,
  target: { title: string; artist: string; duration?: number; album?: string | null },
  opts?: { ignoreDuration?: boolean },
): number {
  const name = record.trackName || record.name || '';
  let score = tokenOverlap(name, target.title) * 50;
  score += tokenOverlap(record.artistName || '', target.artist) * 35;
  if (target.album && record.albumName) {
    score += tokenOverlap(record.albumName, target.album) * 10;
  }
  if (!opts?.ignoreDuration && target.duration && record.duration) {
    const diff = Math.abs(record.duration - target.duration);
    if (diff <= 2) score += 25;
    else if (diff <= 5) score += 15;
    else if (diff <= 12) score += 5;
    else if (diff <= 20) score -= 5;
    else score -= 15;
  }
  if (record.syncedLyrics) score += 5;
  if (record.plainLyrics || record.syncedLyrics) score += 3;
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

function pickBest(
  records: LrcRecord[],
  target: { title: string; artist: string; duration?: number; album?: string | null },
  minScore = 35,
  opts?: { ignoreDuration?: boolean },
): LrcRecord | null {
  if (records.length === 0) return null;
  const scored = records
    .map((r) => ({ r, score: scoreRecord(r, target, opts) }))
    .filter(({ r, score }) => score >= minScore && (r.plainLyrics || r.syncedLyrics))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.r ?? null;
}

function buildSearchTargets(target: { title: string; artist: string; duration?: number; album?: string | null }) {
  const rawTitle = target.title.trim();
  const cleaned = cleanTitle(rawTitle);
  const stripped = stripArtistFromTitle(cleaned, target.artist);
  const titles = [...new Set([rawTitle, cleaned, stripped].filter(Boolean))];
  const artists = artistVariants(target.artist);
  return { titles, artists, album: target.album?.trim() || undefined, duration: target.duration };
}

async function resolveFromLrcLib(target: { title: string; artist: string; duration?: number; album?: string | null }): Promise<LrcRecord | null> {
  const { titles, artists, album, duration } = buildSearchTargets(target);

  const getAttempts: Record<string, string>[] = [];
  for (const title of titles) {
    for (const artist of artists) {
      if (duration) {
        getAttempts.push({ track_name: title, artist_name: artist, duration: String(duration), ...(album ? { album_name: album } : {}) });
        getAttempts.push({ track_name: title, artist_name: artist, duration: String(duration) });
      }
      getAttempts.push({ track_name: title, artist_name: artist, ...(album ? { album_name: album } : {}) });
      getAttempts.push({ track_name: title, artist_name: artist });
    }
  }

  for (const params of getAttempts) {
    const hit = await tryGetLyrics(params);
    if (hit && (hit.plainLyrics || hit.syncedLyrics)) return hit;
  }

  const searchQueries: Record<string, string>[] = [];
  for (const title of titles) {
    for (const artist of artists) {
      searchQueries.push({ q: `${title} ${artist}` });
      searchQueries.push({ track_name: title, artist_name: artist });
    }
    searchQueries.push({ q: title });
    searchQueries.push({ track_name: title });
  }

  const scoredTarget = { title: titles[0] || target.title, artist: artists[0] || target.artist, duration, album };

  for (const params of searchQueries) {
    const results = await searchLyrics(params);
    const best = pickBest(results, scoredTarget, 30);
    if (best) return best;
  }

  // Relaxed fallback — ignore duration mismatch (common for popular radio edits / live versions)
  for (const params of searchQueries.slice(0, 8)) {
    const results = await searchLyrics(params);
    const best = pickBest(results, scoredTarget, 22, { ignoreDuration: true });
    if (best) return best;
  }

  // Last resort: title-only with very loose match
  for (const title of titles) {
    const results = await searchLyrics({ q: title });
    const best = pickBest(results, { ...scoredTarget, title }, 18, { ignoreDuration: true });
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
