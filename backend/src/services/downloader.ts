import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import prisma from '../lib/prisma';
import { runYtDlp, findFileByPrefix, lastLines, ytDlpAudioExtractAttempts, isFormatUnavailableError, ytDlpAuthArgs } from './ytdlp';
import { buildSearchQueries, rankYouTubeResults, shouldFilterVariants, pickBestAvailableResult, sanitizeSearchText, cleanSearchTitle, isYouTubeShortOrReel, isDurationCompatible, isRejectedYouTubeResult, filterYouTubeResults } from '../lib/trackMatch';
import { lookupSpotifyTrack, isSpotifyConfigured, fetchSpotifyTrackByUrl } from './spotifyApi';
import { fetchLyricsForTrack } from './lyrics';
import { ensureBackgroundDownload, cancelBackgroundDownload, isDownloadInProgress, waitForTrackDownload } from './trackDownload';
import { getCacheAudioDir, getDownloadDirForTrack, finalizeFileStorage, promoteTrackToLibrary, isTrackPinned } from './trackStorage';
import { findCanonicalDownloadedTrack, linkTrackToCanonical, propagateDownloadToSourceId } from './trackDedup';

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

export interface ResolvedSource {
  url: string;
  sourceId: string;
  title: string;
  artist: string;
  duration: number;
  thumbnailUrl: string;
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

async function fetchYouTubeDuration(url: string): Promise<number> {
  const metaResult = await runYtDlp(['--dump-single-json', '--skip-download', url], 45000);
  if (metaResult.code !== 0) return 0;
  try {
    const meta = JSON.parse(metaResult.stdout) as { duration?: number };
    return Math.round(Number(meta.duration || 0));
  } catch {
    return 0;
  }
}

async function enrichTargetFromSpotify(
  artist: string,
  title: string,
  duration?: number,
  album?: string
): Promise<{ artist: string; title: string; duration?: number; album?: string }> {
  if (!isSpotifyConfigured() || !artist || !title) {
    return { artist, title, duration, album };
  }
  try {
    const spotify = await lookupSpotifyTrack(artist, title);
    if (spotify) {
      return {
        artist: spotify.artist,
        title: spotify.name,
        duration: spotify.duration > 0 ? spotify.duration : duration,
        album: spotify.album || album,
      };
    }
  } catch (err) {
    console.error('[Match] Spotify lookup failed:', (err as Error).message);
  }
  return { artist, title, duration, album };
}

async function pickVerifiedCandidate(
  candidates: SearchResult[],
  target: { title: string; artist: string; duration?: number },
  relaxed: boolean,
  excludeIds: Set<string> = new Set()
): Promise<SearchResult | null> {
  for (const candidate of candidates.slice(0, 6)) {
    if (isYouTubeShortOrReel(candidate) || excludeIds.has(candidate.id)) continue;

    let duration = candidate.duration;
    if (target.duration && target.duration > 0) {
      if (duration <= 0) {
        duration = await fetchYouTubeDuration(candidate.url);
      }
      if (duration > 0 && !isDurationCompatible(target.duration, duration, relaxed)) {
        console.log(`[Match] Skipped duration mismatch: "${candidate.title}" (${duration}s vs ${target.duration}s)`);
        continue;
      }
      if (duration > 0 && target.duration >= 90 && duration <= 60) continue;
    }

    return { ...candidate, duration: duration || candidate.duration };
  }
  return null;
}

export async function searchYouTube(query: string, limit = 15, minDuration?: number): Promise<SearchResult[]> {
  const clientAttempts = [
    'android,web',
    'ios,web',
    'tv_embedded,web',
    'web',
  ];

  let lastError = '';

  for (const clients of clientAttempts) {
    const args = [
      '--flat-playlist',
      '--dump-json',
      '--skip-download',
      '--extractor-args', `youtube:player_client=${clients}`,
    ];

    if (minDuration && minDuration >= 60) {
      const floor = Math.max(45, Math.floor(minDuration * 0.45));
      args.push('--match-filter', `duration >= ${floor}`);
    }

    args.push(`ytsearch${limit}:${query}`);

    const result = await runYtDlp(args, 60000);

    if (result.code === 0) {
      return parseJsonLines<Record<string, unknown>>(result.stdout)
        .map((data) => ({
          id: String(data.id),
          title: String(data.title || 'Unknown'),
          artist: String(data.uploader || data.channel || extractArtistFromTitle(String(data.title || ''))),
          duration: Number(data.duration || 0),
          thumbnailUrl: String(data.thumbnail || (data.thumbnails as { url: string }[])?.[0]?.url || ''),
          url: String(data.url || data.webpage_url || `https://www.youtube.com/watch?v=${data.id}`),
          source: 'youtube' as const,
        }))
        .filter((r) => !isYouTubeShortOrReel(r));
    }

    lastError = lastLines(result.stderr) || 'YouTube search failed';
    const blocked = /403|Forbidden|Sign in to confirm/i.test(result.stderr);
    if (!blocked) break;
  }

  throw new Error(lastError || 'YouTube search failed');
}

export async function downloadFromYouTube(
  sourceUrl: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH' = 'HIGH',
  onProgress?: (progress: number) => void,
  outputDir?: string
): Promise<DownloadResult> {
  const dir = outputDir ?? getCacheAudioDir();
  fs.mkdirSync(dir, { recursive: true });

  const fileId = uuidv4();
  const outputTemplate = path.join(dir, `${fileId}.%(ext)s`);

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
    const attempts = ytDlpAudioExtractAttempts(quality);
    let attemptIndex = 0;
    let lastStderr = '';

    const tryDownload = () => {
      if (attemptIndex >= attempts.length) {
        reject(new Error(lastLines(lastStderr) || 'Download failed (all format attempts)'));
        return;
      }

      const attempt = attempts[attemptIndex++];
      const args = [
        '--no-warnings', '--no-playlist', '--retries', '5', '--fragment-retries', '5',
        '--socket-timeout', '30',
        ...ytDlpAuthArgs(),
        ...attempt.args,
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
        if (code === 0) {
          resolve({ stderr });
          return;
        }
        lastStderr = stderr;
        if (isFormatUnavailableError(stderr) && attemptIndex < attempts.length) {
          console.warn(`[Download] Format unavailable (${attempt.label}), retrying…`);
          tryDownload();
          return;
        }
        if (attemptIndex < attempts.length) {
          console.warn(`[Download] Failed with ${attempt.label}, retrying…`);
          tryDownload();
          return;
        }
        reject(new Error(lastLines(stderr) || `Download failed (exit ${code})`));
      });
    };

    tryDownload();
  });

  void downloadResult;

  const filePath = findFileByPrefix(dir, fileId);
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
  preferredArtist?: string,
  preferredAlbum?: string,
  spotifyMeta?: { spotifyArtistId?: string; imageUrl?: string },
) {
  const artistName = preferredArtist || download.artist;
  const trackTitle = preferredTitle || download.title;

  let artist = await prisma.artist.findUnique({ where: { name: artistName } });
  if (!artist) artist = await prisma.artist.create({ data: { name: artistName } });

  if (spotifyMeta?.spotifyArtistId) {
    artist = await prisma.artist.update({
      where: { id: artist.id },
      data: {
        spotifyArtistId: spotifyMeta.spotifyArtistId,
        ...(spotifyMeta.imageUrl ? { imageUrl: spotifyMeta.imageUrl } : {}),
      },
    });
  }

  const existing = download.sourceId
    ? await prisma.track.findFirst({ where: { sourceId: download.sourceId } })
    : null;

  const canonical = await findCanonicalDownloadedTrack(download.sourceId, download.sourceUrl);
  if (canonical?.filePath && fs.existsSync(canonical.filePath)) {
    const trackId = existing?.id ?? null;
    if (trackId) {
      await linkTrackToCanonical(trackId, canonical);
      return prisma.track.findUniqueOrThrow({
        where: { id: trackId },
        include: { artist: true, album: true, lyrics: true },
      });
    }
  }

  const trackId = existing?.id ?? null;
  const { filePath, storageTier } = trackId
    ? await finalizeFileStorage(trackId, download.filePath)
    : { filePath: download.filePath, storageTier: 'CACHE' as const };

  const data = {
    title: trackTitle,
    artistId: artist.id,
    duration: download.duration,
    filePath,
    sourceUrl: download.sourceUrl,
    sourceId: download.sourceId,
    thumbnailUrl: download.thumbnailUrl,
    quality,
    isDownloaded: true,
    downloadedAt: new Date(),
    storageTier,
    lastAccessedAt: new Date(),
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

  if (download.sourceId && filePath) {
    await propagateDownloadToSourceId(
      download.sourceId,
      {
        filePath,
        sourceUrl: download.sourceUrl,
        downloadedAt: data.downloadedAt as Date,
        storageTier,
        quality,
        duration: download.duration,
        thumbnailUrl: download.thumbnailUrl,
      },
      track.id,
    );
  }

  if (await isTrackPinned(track.id)) {
    await promoteTrackToLibrary(track.id);
  }

  fetchLyricsForTrack({
    trackId: track.id,
    title: trackTitle,
    artist: artistName,
    duration: download.duration,
    album: preferredAlbum ?? track.album?.title ?? null,
  }).catch(console.error);
  return track;
}

export async function upsertPendingTrack(
  source: ResolvedSource,
  quality: 'LOW' | 'NORMAL' | 'HIGH',
  preferredTitle?: string,
  preferredArtist?: string
) {
  const artistName = preferredArtist || source.artist;
  const trackTitle = preferredTitle || source.title;

  let artist = await prisma.artist.findUnique({ where: { name: artistName } });
  if (!artist) artist = await prisma.artist.create({ data: { name: artistName } });

  const existing = source.sourceId
    ? await prisma.track.findFirst({ where: { sourceId: source.sourceId }, include: { artist: true, album: true, lyrics: true } })
    : null;

  if (existing?.isDownloaded && existing.filePath && fs.existsSync(existing.filePath)) {
    return existing;
  }

  const canonical = await findCanonicalDownloadedTrack(source.sourceId, source.url);
  if (canonical?.filePath && fs.existsSync(canonical.filePath)) {
    if (existing) {
      await linkTrackToCanonical(existing.id, canonical);
      return prisma.track.findUniqueOrThrow({
        where: { id: existing.id },
        include: { artist: true, album: true, lyrics: true },
      });
    }
  }

  const data = {
    title: trackTitle,
    artistId: artist.id,
    duration: source.duration,
    sourceUrl: source.url,
    sourceId: source.sourceId,
    thumbnailUrl: source.thumbnailUrl,
    quality,
    isDownloaded: false,
    filePath: null as string | null,
    downloadedAt: null as Date | null,
  };

  if (existing) {
    const updated = await prisma.track.update({
      where: { id: existing.id },
      data,
      include: { artist: true, album: true, lyrics: true },
    });
    if (canonical?.filePath && fs.existsSync(canonical.filePath)) {
      await linkTrackToCanonical(updated.id, canonical);
      return prisma.track.findUniqueOrThrow({
        where: { id: updated.id },
        include: { artist: true, album: true, lyrics: true },
      });
    }
    return updated;
  }

  const created = await prisma.track.create({
    data,
    include: { artist: true, album: true, lyrics: true },
  });
  if (canonical?.filePath && fs.existsSync(canonical.filePath)) {
    await linkTrackToCanonical(created.id, canonical);
    return prisma.track.findUniqueOrThrow({
      where: { id: created.id },
      include: { artist: true, album: true, lyrics: true },
    });
  }
  return created;
}

export async function resolveYouTubeSource(
  input: string,
  opts?: {
    title?: string;
    artist?: string;
    url?: string;
    spotifyUrl?: string;
    duration?: number;
    album?: string;
    relaxed?: boolean;
    excludeSourceIds?: string[];
  }
): Promise<ResolvedSource> {
  const trimmed = input.trim();

  if (opts?.url || /youtube\.com|youtu\.be|music\.youtube\.com/i.test(trimmed)) {
    const url = opts?.url || trimmed;
    if (/\/shorts\//i.test(url)) {
      throw new Error('YouTube Shorts/Reels are not supported');
    }
    const metaResult = await runYtDlp(['--dump-single-json', '--skip-download', url], 60000);
    if (metaResult.code !== 0) {
      throw new Error(lastLines(metaResult.stderr) || 'Failed to fetch video metadata');
    }
    const meta = JSON.parse(metaResult.stdout) as Record<string, unknown>;
    const rawTitle = String(meta.title || opts?.title || 'Unknown');
    const metaDuration = Math.round(Number(meta.duration || 0));
    const reelCheck = { url, title: rawTitle, duration: metaDuration };
    if (isYouTubeShortOrReel(reelCheck)) {
      throw new Error('YouTube Shorts/Reels are not supported');
    }
    if (opts?.duration && opts.duration > 0 && metaDuration > 0
      && !isDurationCompatible(opts.duration, metaDuration, !!opts.relaxed)) {
      throw new Error(`Video duration (${metaDuration}s) does not match expected track length (${opts.duration}s)`);
    }
    return {
      url,
      sourceId: String(meta.id || ''),
      title: opts?.title || extractTrackTitle(rawTitle),
      artist: opts?.artist || String(meta.uploader || meta.channel || extractArtistFromTitle(rawTitle)),
      duration: opts?.duration || metaDuration,
      thumbnailUrl: String(meta.thumbnail || ''),
    };
  }

  let artist = opts?.artist ? sanitizeSearchText(opts.artist) : '';
  let title = opts?.title ? cleanSearchTitle(opts.title) : '';
  let album = opts?.album;
  let targetDuration = opts?.duration;

  if (opts?.spotifyUrl && !(opts?.title && opts?.artist)) {
    const spotifyMeta = await fetchSpotifyTrackByUrl(opts.spotifyUrl);
    if (spotifyMeta) {
      artist = sanitizeSearchText(spotifyMeta.artist);
      title = cleanSearchTitle(spotifyMeta.name);
      targetDuration = spotifyMeta.duration || targetDuration;
      album = spotifyMeta.album || album;
    }
  } else if (!opts?.spotifyUrl) {
    const enriched = await enrichTargetFromSpotify(artist, title, targetDuration, album);
    artist = enriched.artist;
    title = cleanSearchTitle(enriched.title);
    targetDuration = enriched.duration;
    album = enriched.album;
  }

  // Prefer primary artist for search — long Spotify credit lists kill YouTube matches
  const searchArtist = artist.split(/[,;&]| feat\.?| ft\.?| featuring /i)[0]?.trim() || artist;
  const searchQuery = searchArtist && title ? `${searchArtist} - ${title}` : trimmed;
  const target = {
    title: title || searchQuery,
    artist: searchArtist,
    duration: targetDuration,
    album,
  };

  const filterVariants = shouldFilterVariants(trimmed, opts);
  const baseMinScore = opts?.relaxed ? 22 : (filterVariants ? 40 : 20);
  const rankOpts = { filterVariants, rawQuery: trimmed, minScore: baseMinScore };
  const minSearchDuration = targetDuration && targetDuration > 0 ? targetDuration : undefined;
  const excludeIds = new Set(opts?.excludeSourceIds ?? []);
  const isExcluded = (r: SearchResult) => excludeIds.has(r.id);

  let candidates: SearchResult[] = [];
  const allRaw: SearchResult[] = [];
  const seenIds = new Set<string>();

  const collectResults = (batch: SearchResult[]) => {
    const filtered = filterYouTubeResults(batch, target, !!opts?.relaxed)
      .filter((r) => !isExcluded(r));
    for (const r of filtered) {
      if (!seenIds.has(r.id)) {
        seenIds.add(r.id);
        allRaw.push(r);
      }
    }
  };

  if (title && artist) {
    const queries = buildSearchQueries(searchArtist || artist, title, album);
    for (const q of queries) {
      try {
        const batch = await searchYouTube(q, 10, minSearchDuration);
        collectResults(batch);
        candidates.push(...batch.filter((r) => !candidates.some((c) => c.id === r.id)
          && !isRejectedYouTubeResult(r, target, !!opts?.relaxed) && !isExcluded(r)));
      } catch (err) {
        console.error(`YouTube search failed for "${q}":`, err);
      }
    }
    candidates = rankYouTubeResults(candidates, target, rankOpts);
  }

  if (candidates.length === 0) {
    try {
      const fallback = await searchYouTube(searchQuery, 15, minSearchDuration);
      collectResults(fallback);
      const pool = filterYouTubeResults(fallback, target, !!opts?.relaxed);
      candidates = title && artist
        ? rankYouTubeResults(pool, target, rankOpts)
        : rankYouTubeResults(pool, target, { ...rankOpts, filterVariants: false });
    } catch (err) {
      console.error(`YouTube search failed for "${searchQuery}":`, err);
    }
  }

  if (candidates.length === 0 && title) {
    try {
      const titleOnly = await searchYouTube(`${title} official audio`, 15, minSearchDuration);
      collectResults(titleOnly);
      const pool = filterYouTubeResults(titleOnly, target, !!opts?.relaxed);
      candidates = rankYouTubeResults(pool, target, { ...rankOpts, minScore: opts?.relaxed ? 18 : 25 });
    } catch (err) {
      console.error(`YouTube title search failed for "${title}":`, err);
    }
  }

  if (candidates.length === 0 && filterVariants) {
    const pool = allRaw.length > 0 ? allRaw : [];
    if (pool.length > 0) {
      candidates = rankYouTubeResults(pool, target, {
        ...rankOpts,
        filterVariants: true,
        minScore: opts?.relaxed ? 15 : 20,
      });
    }
  }

  if (candidates.length === 0) {
    const best = pickBestAvailableResult(allRaw, target, {
      filterVariants: true,
      rawQuery: trimmed,
      minScore: opts?.relaxed ? 12 : 18,
    });
    if (best) {
      candidates = [best];
    }
  }

  if (candidates.length === 0) {
    throw new Error(`No YouTube results for: ${searchQuery}`);
  }

  const verified = await pickVerifiedCandidate(candidates, target, !!opts?.relaxed, excludeIds);
  if (!verified) {
    throw new Error(`No YouTube match with compatible duration for: ${searchQuery}${targetDuration ? ` (${targetDuration}s)` : ''}`);
  }

  const best = verified;
  return {
    url: best.url,
    sourceId: best.id,
    title: title || extractTrackTitle(best.title),
    artist: artist || best.artist,
    duration: targetDuration || best.duration,
    thumbnailUrl: best.thumbnailUrl,
  };
}

function extractYouTubeVideoId(url: string): string | null {
  const match = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{6,})/);
  return match?.[1] ?? null;
}

function isYouTubeInput(input: string, url?: string): boolean {
  return !!(url || /youtube\.com|youtu\.be|music\.youtube\.com/i.test(input));
}

function sourceFromYouTubeUrl(
  url: string,
  opts?: { title?: string; artist?: string; duration?: number; thumbnailUrl?: string },
): ResolvedSource {
  const id = extractYouTubeVideoId(url) || '';
  return {
    url,
    sourceId: id,
    title: opts?.title || 'Unknown',
    artist: opts?.artist || 'Unknown Artist',
    duration: opts?.duration || 0,
    thumbnailUrl: opts?.thumbnailUrl || (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : ''),
  };
}

async function findPlayableExisting(
  opts?: { title?: string; artist?: string; url?: string },
  searchQuery?: string,
) {
  if (opts?.url) {
    const byUrl = await prisma.track.findFirst({
      where: { OR: [{ sourceUrl: opts.url }, ...(extractYouTubeVideoId(opts.url) ? [{ sourceId: extractYouTubeVideoId(opts.url)! }] : [])] },
      include: { artist: true, album: true, lyrics: true },
    });
    if (byUrl) return byUrl;
  }

  if (opts?.title && opts?.artist) {
    const byMeta = await prisma.track.findFirst({
      where: {
        title: { equals: opts.title, mode: 'insensitive' },
        artist: { name: { contains: opts.artist.split(/[,;&]/)[0].trim(), mode: 'insensitive' } },
      },
      include: { artist: true, album: true, lyrics: true },
    });
    if (byMeta) return byMeta;
  }

  if (searchQuery) {
    const byTitle = await prisma.track.findFirst({
      where: { title: { equals: searchQuery, mode: 'insensitive' } },
      include: { artist: true, album: true, lyrics: true },
    });
    if (byTitle) return byTitle;
  }

  return null;
}

/** Resolve YouTube source in background, then cache to disk if pinned. */
export function resolveAndAttachSourceInBackground(
  trackId: string,
  input: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH',
  opts?: { title?: string; artist?: string; url?: string; spotifyUrl?: string; duration?: number; album?: string },
) {
  void (async () => {
    try {
      if (isDownloadInProgress(trackId)) return;
      const source = await resolveYouTubeSource(input, { ...opts, relaxed: true });
      const track = await prisma.track.findUnique({ where: { id: trackId }, include: { artist: true } });
      if (!track) return;

      await prisma.track.update({
        where: { id: trackId },
        data: {
          sourceUrl: source.url,
          sourceId: source.sourceId,
          thumbnailUrl: source.thumbnailUrl || track.thumbnailUrl,
          duration: source.duration || track.duration,
        },
      });

      ensureBackgroundDownload(trackId, source.url, quality, {
        title: opts?.title || track.title,
        artist: opts?.artist || track.artist.name,
        album: opts?.album,
      });
    } catch (err) {
      console.error(`[Prepare] Background source resolve failed for ${trackId}:`, (err as Error).message);
    }
  })();
}

/** Resolve source, create pending track, start background download — returns quickly for streaming. */
export async function prepareTrackForPlayback(
  input: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH' = 'HIGH',
  opts?: { title?: string; artist?: string; url?: string; spotifyUrl?: string; duration?: number; album?: string; thumbnailUrl?: string; relaxed?: boolean }
) {
  const trimmed = input.trim();
  const searchQuery = opts?.artist && opts?.title ? `${opts.artist} - ${opts.title}` : trimmed;

  const existing = await findPlayableExisting(opts, searchQuery);
  if (existing) {
    if (existing.isDownloaded && existing.filePath && fs.existsSync(existing.filePath)) {
      return existing;
    }
    if (existing.sourceUrl && !isDownloadInProgress(existing.id)) {
      ensureBackgroundDownload(existing.id, existing.sourceUrl, quality, {
        title: existing.title,
        artist: existing.artist.name,
        album: existing.album?.title,
      });
    } else if (!existing.sourceUrl && existing.title && existing.artist.name) {
      resolveAndAttachSourceInBackground(existing.id, searchQuery, quality, opts);
    }
    return existing;
  }

  if (isYouTubeInput(trimmed, opts?.url)) {
    const url = opts?.url || trimmed;
    if (/\/shorts\//i.test(url)) {
      throw new Error('YouTube Shorts/Reels are not supported');
    }
    const source = sourceFromYouTubeUrl(url, opts);
    const track = await upsertPendingTrack(source, quality, opts?.title || source.title, opts?.artist || source.artist);
    ensureBackgroundDownload(track.id, source.url, quality, {
      title: opts?.title || source.title,
      artist: opts?.artist || source.artist,
      album: opts?.album,
    });
    return track;
  }

  if (opts?.title && opts?.artist) {
    const pendingSource: ResolvedSource = {
      url: '',
      sourceId: '',
      title: opts.title,
      artist: opts.artist,
      duration: opts.duration || 0,
      thumbnailUrl: opts.thumbnailUrl || '',
    };
    const track = await upsertPendingTrack(pendingSource, quality, opts.title, opts.artist);
    resolveAndAttachSourceInBackground(track.id, searchQuery, quality, opts);
    return track;
  }

  const source = await resolveYouTubeSource(input, { ...opts, relaxed: true });
  const track = await upsertPendingTrack(
    source,
    quality,
    opts?.title || source.title,
    opts?.artist || source.artist,
  );

  ensureBackgroundDownload(track.id, source.url, quality, {
    title: opts?.title || source.title,
    artist: opts?.artist || source.artist,
    album: opts?.album,
  });

  return track;
}

export async function resolveAndDownload(
  input: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH' = 'HIGH',
  opts?: { title?: string; artist?: string; url?: string; spotifyUrl?: string; duration?: number; album?: string; relaxed?: boolean }
) {
  const trimmed = input.trim();

  let spotifyMeta: { spotifyArtistId?: string; imageUrl?: string } | undefined;
  if (opts?.spotifyUrl) {
    const meta = await fetchSpotifyTrackByUrl(opts.spotifyUrl);
    if (meta?.primaryArtistId) {
      spotifyMeta = { spotifyArtistId: meta.primaryArtistId, imageUrl: meta.thumbnailUrl || undefined };
    }
  }

  if (opts?.url || /youtube\.com|youtu\.be|music\.youtube\.com/i.test(trimmed)) {
    const url = opts?.url || trimmed;
    const existing = await prisma.track.findFirst({
      where: { sourceUrl: url, isDownloaded: true },
      include: { artist: true, album: true, lyrics: true },
    });
    if (existing?.filePath && fs.existsSync(existing.filePath)) return existing;

    const download = await downloadFromYouTube(url, quality);
    return saveTrackRecord(download, quality, opts?.title, opts?.artist, opts?.album, spotifyMeta);
  }

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

  const source = await resolveYouTubeSource(input, opts);

  const pending = await prisma.track.findFirst({
    where: { sourceId: source.sourceId },
    include: { artist: true, album: true, lyrics: true },
  });
  if (pending) {
    if (pending.isDownloaded && pending.filePath && fs.existsSync(pending.filePath)) {
      return pending;
    }
    if (isDownloadInProgress(pending.id)) {
      await waitForTrackDownload(pending.id);
      const ready = await prisma.track.findUnique({
        where: { id: pending.id },
        include: { artist: true, album: true, lyrics: true },
      });
      if (ready?.isDownloaded && ready.filePath && fs.existsSync(ready.filePath)) return ready;
    }
  }

  const bySource = await prisma.track.findFirst({
    where: { sourceId: source.sourceId, isDownloaded: true },
    include: { artist: true, album: true, lyrics: true },
  });
  if (bySource?.filePath && fs.existsSync(bySource.filePath)) return bySource;

  if (opts?.title && opts?.artist) {
    const byMeta = await prisma.track.findFirst({
      where: {
        isDownloaded: true,
        title: { equals: opts.title, mode: 'insensitive' },
        artist: { name: { contains: opts.artist.split(/[,;&]/)[0].trim(), mode: 'insensitive' } },
      },
      include: { artist: true, album: true, lyrics: true },
    });
    if (byMeta?.filePath && fs.existsSync(byMeta.filePath)) return byMeta;
  }

  const track = await upsertPendingTrack(
    source,
    quality,
    opts?.title || source.title,
    opts?.artist || source.artist,
  );

  if (track.isDownloaded && track.filePath && fs.existsSync(track.filePath)) {
    return track;
  }

  if (!isDownloadInProgress(track.id)) {
    ensureBackgroundDownload(track.id, source.url, quality, {
      title: opts?.title || source.title,
      artist: opts?.artist || source.artist,
      album: opts?.album,
    });
  }

  try {
    await waitForTrackDownload(track.id);
    const ready = await prisma.track.findUniqueOrThrow({
      where: { id: track.id },
      include: { artist: true, album: true, lyrics: true },
    });
    if (ready.isDownloaded && ready.filePath && fs.existsSync(ready.filePath)) {
      return ready;
    }
  } catch {
    // Fall through to synchronous multi-candidate download
  }

  let lastError: Error | null = null;
  const target = {
    title: opts?.title || searchQuery,
    artist: opts?.artist || '',
    duration: opts?.duration,
    album: opts?.album,
  };
  const filterVariants = shouldFilterVariants(trimmed, opts);
  const rankOpts = { filterVariants, rawQuery: trimmed, minScore: filterVariants ? 40 : 20 };

  let candidates: SearchResult[] = [];
  if (opts?.title && opts?.artist) {
    const queries = buildSearchQueries(opts.artist, opts.title, opts?.album);
    const seen = new Set<string>();
    for (const q of queries) {
      try {
        const batch = await searchYouTube(q, 8);
        for (const r of batch) {
          if (!seen.has(r.id)) { seen.add(r.id); candidates.push(r); }
        }
      } catch (err) {
        console.error(`YouTube search failed for "${q}":`, err);
      }
    }
    candidates = rankYouTubeResults(candidates, target, rankOpts);
  }
  if (candidates.length === 0) {
    const fallback = await searchYouTube(searchQuery, 12);
    candidates = rankYouTubeResults(fallback, target, rankOpts);
  }

  for (const result of candidates.slice(0, 6)) {
    try {
      console.log(`[Match] Downloading: "${result.title}" (${result.url})`);
      const download = await downloadFromYouTube(result.url, quality);
      return saveTrackRecord(
        download,
        quality,
        opts?.title || result.title,
        opts?.artist || result.artist,
        opts?.album,
        spotifyMeta,
      );
    } catch (err) {
      lastError = err as Error;
      console.error(`Download attempt failed for ${result.url}:`, lastError.message);
    }
  }

  // Fallback: at least try the top resolved source
  try {
    const download = await downloadFromYouTube(source.url, quality);
    return saveTrackRecord(download, quality, opts?.title || source.title, opts?.artist || source.artist, opts?.album, spotifyMeta);
  } catch (err) {
    throw lastError || err;
  }
}

// Backward-compatible aliases
export const searchTracks = searchYouTube;
export const downloadTrack = downloadFromYouTube;
export const getOrCreateTrackFromSearch = (query: string, quality: 'LOW' | 'NORMAL' | 'HIGH' = 'HIGH') =>
  resolveAndDownload(query, quality);

/** Download a library track fully before playback */
export async function downloadLibraryTrack(
  trackId: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH' = 'HIGH'
) {
  const track = await prisma.track.findUnique({
    where: { id: trackId },
    include: { artist: true, album: true, lyrics: true },
  });
  if (!track) throw new Error('Track not found');
  if (track.isDownloaded && track.filePath && fs.existsSync(track.filePath)) {
    return track;
  }

  cancelBackgroundDownload(trackId);

  let sourceUrl = track.sourceUrl;
  if (!sourceUrl) {
    const source = await resolveYouTubeSource(
      `${track.artist.name} - ${track.title}`,
      {
        title: track.title,
        artist: track.artist.name,
        duration: track.duration > 0 ? track.duration : undefined,
        album: track.album?.title,
      }
    );
    sourceUrl = source.url;
    await prisma.track.update({
      where: { id: trackId },
      data: {
        sourceUrl: source.url,
        sourceId: source.sourceId,
        thumbnailUrl: source.thumbnailUrl || track.thumbnailUrl,
      },
    });
  }

  const outputDir = await getDownloadDirForTrack(trackId);
  const download = await downloadFromYouTube(sourceUrl, quality, undefined, outputDir);
  const { filePath, storageTier } = await finalizeFileStorage(trackId, download.filePath);

  await prisma.track.update({
    where: { id: trackId },
    data: {
      filePath,
      sourceUrl: download.sourceUrl,
      sourceId: download.sourceId,
      thumbnailUrl: download.thumbnailUrl || track.thumbnailUrl,
      duration: download.duration || track.duration,
      quality,
      isDownloaded: true,
      downloadedAt: new Date(),
      storageTier,
      lastAccessedAt: new Date(),
    },
  });

  fetchLyricsForTrack({
    trackId,
    title: track.title,
    artist: track.artist.name,
    duration: download.duration,
    album: track.album?.title ?? null,
  }).catch(console.error);

  return prisma.track.findUniqueOrThrow({
    where: { id: trackId },
    include: { artist: true, album: true, lyrics: true },
  });
}

/** Start background full download for a library track (prefetch while another song plays) */
export async function prefetchLibraryTrack(
  trackId: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH' = 'HIGH'
) {
  const track = await prisma.track.findUnique({
    where: { id: trackId },
    include: { artist: true, album: true },
  });
  if (!track) throw new Error('Track not found');
  if (track.isDownloaded && track.filePath && fs.existsSync(track.filePath)) {
    return { status: 'ready' as const, trackId };
  }
  if (isDownloadInProgress(trackId)) {
    return { status: 'downloading' as const, trackId };
  }

  let sourceUrl = track.sourceUrl;
  if (!sourceUrl) {
    resolveAndAttachSourceInBackground(
      trackId,
      `${track.artist.name} - ${track.title}`,
      quality,
      {
        title: track.title,
        artist: track.artist.name,
        duration: track.duration > 0 ? track.duration : undefined,
        album: track.album?.title,
      },
    );
    return { status: 'preparing' as const, trackId };
  }

  ensureBackgroundDownload(trackId, sourceUrl, quality, {
    title: track.title,
    artist: track.artist.name,
    album: track.album?.title,
  });

  return { status: 'downloading' as const, trackId };
}

/** Re-search YouTube for an existing library track and replace the source/file */
export async function researchTrack(
  trackId: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH' = 'HIGH'
) {
  const track = await prisma.track.findUnique({
    where: { id: trackId },
    include: { artist: true, album: true, lyrics: true },
  });
  if (!track) throw new Error('Track not found');

  const previousSourceId = track.sourceId;
  cancelBackgroundDownload(trackId);

  if (track.filePath && fs.existsSync(track.filePath)) {
    try {
      fs.unlinkSync(track.filePath);
    } catch (err) {
      console.error(`[Research] Failed to delete old file:`, err);
    }
  }

  await prisma.track.update({
    where: { id: trackId },
    data: {
      filePath: null,
      isDownloaded: false,
      downloadedAt: null,
      sourceUrl: null,
      sourceId: null,
    },
  });

  const source = await resolveYouTubeSource(
    `${track.artist.name} - ${track.title}`,
    {
      title: track.title,
      artist: track.artist.name,
      duration: track.duration > 0 ? track.duration : undefined,
      album: track.album?.title,
      excludeSourceIds: previousSourceId ? [previousSourceId] : [],
    }
  );

  const updated = await prisma.track.update({
    where: { id: trackId },
    data: {
      sourceUrl: source.url,
      sourceId: source.sourceId,
      thumbnailUrl: source.thumbnailUrl || track.thumbnailUrl,
      duration: source.duration || track.duration,
    },
    include: { artist: true, album: true, lyrics: true },
  });

  ensureBackgroundDownload(trackId, source.url, quality, {
    title: track.title,
    artist: track.artist.name,
    album: track.album?.title,
  });

  console.log(`[Research] Track ${trackId} re-matched to "${source.url}"`);
  return updated;
}
