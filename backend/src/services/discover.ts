import prisma from '../lib/prisma';
import { searchYouTube, SearchResult, resolveYouTubeSource, upsertPendingTrack, prefetchLibraryTrack } from './downloader';
import { rankYouTubeResults, extractTrackTitleFromYouTube } from '../lib/trackMatch';
import { trackStreamUrl, ensureBackgroundDownload } from './trackDownload';
import { effectiveDownloadedFlag, isTrackPlayable } from './trackIntegrity';
import { isYouTubeBlockedError } from './ytdlp';

/** Pause Discover YouTube searches after 403 to avoid log spam / hammering */
let youtubeDiscoverBlockedUntil = 0;

export interface DiscoverItem {
  id: string;
  title: string;
  duration: number;
  thumbnailUrl: string | null;
  isDownloaded: boolean;
  streamUrl: string | null;
  artist: { id: string; name: string; imageUrl: string | null };
  album: { id: string; title: string; coverUrl: string | null } | null;
  source: 'library' | 'youtube';
  youtubeUrl?: string;
}

function formatDiscoverTrack(track: {
  id: string;
  title: string;
  duration: number;
  thumbnailUrl: string | null;
  sourceUrl: string | null;
  sourceId: string | null;
  quality: string;
  isDownloaded: boolean;
  filePath: string | null;
  artist: { id: string; name: string; imageUrl: string | null };
  album?: { id: string; title: string; coverUrl: string | null } | null;
}): DiscoverItem {
  const isDownloaded = effectiveDownloadedFlag(track);
  return {
    id: track.id,
    title: track.title,
    duration: track.duration,
    thumbnailUrl: track.thumbnailUrl,
    isDownloaded,
    streamUrl: trackStreamUrl({ id: track.id, isDownloaded, sourceUrl: track.sourceUrl, title: track.title, artist: track.artist }),
    artist: track.artist,
    album: track.album ?? null,
    source: 'library',
  };
}

function artistKey(name: string | null | undefined): string {
  return (name || '')
    .toLowerCase()
    .split(/[,;&]| feat\.?| ft\.?| featuring /i)[0]
    .trim();
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Prefer variety: at most `maxPerArtist` tracks from the same primary artist. */
function diversifyByArtist<T extends { artist?: { name?: string } | string | null; title?: string }>(
  items: T[],
  limit: number,
  maxPerArtist = 1,
  seedArtist?: string,
): T[] {
  const seed = artistKey(seedArtist);
  const counts = new Map<string, number>();
  const out: T[] = [];
  for (const item of items) {
    const name = typeof item.artist === 'string' ? item.artist : item.artist?.name;
    const key = artistKey(name) || `unknown-${out.length}`;
    // Soft-penalize seed artist: allow at most 1, and only after we have some variety
    const cap = key && key === seed ? 1 : maxPerArtist;
    const n = counts.get(key) || 0;
    if (n >= cap) continue;
    if (key === seed && out.length < 2 && items.length > 3) continue;
    counts.set(key, n + 1);
    out.push(item);
    if (out.length >= limit) break;
  }
  // If still short, relax seed-artist deferral
  if (out.length < limit) {
    for (const item of items) {
      if (out.includes(item)) continue;
      const name = typeof item.artist === 'string' ? item.artist : item.artist?.name;
      const key = artistKey(name) || `unknown-${out.length}`;
      const n = counts.get(key) || 0;
      if (n >= maxPerArtist + 1) continue;
      counts.set(key, n + 1);
      out.push(item);
      if (out.length >= limit) break;
    }
  }
  return out;
}

async function getExcludeIds(userId: string, extraTrackId?: string) {
  const recent = await prisma.playHistory.findMany({
    where: { userId },
    orderBy: { playedAt: 'desc' },
    take: 40,
    include: { track: { select: { id: true, sourceId: true, title: true } } },
  });

  const trackIds = new Set<string>(recent.map((h) => h.trackId));
  const sourceIds = new Set<string>();
  const titles = new Set<string>();
  for (const h of recent) {
    if (h.track.sourceId) sourceIds.add(h.track.sourceId);
    titles.add(h.track.title.toLowerCase());
  }
  if (extraTrackId) trackIds.add(extraTrackId);
  return { trackIds, sourceIds, titles };
}

async function collectLibraryRecs(
  userId: string,
  seed: { artistId: string; id: string; artist?: { name: string } },
  exclude: Set<string>,
  limit: number
) {
  const seedArtistName = seed.artist?.name?.split(/[,;&]/)[0]?.trim() || '';

  const [otherArtistsLiked, recentOther, sameArtist] = await Promise.all([
    prisma.likedTrack.findMany({
      where: {
        userId,
        track: {
          id: { notIn: [...exclude, seed.id] },
          ...(seed.artistId
            ? { artistId: { not: seed.artistId } }
            : seedArtistName
              ? { NOT: { artist: { name: { contains: seedArtistName, mode: 'insensitive' } } } }
              : {}),
        },
      },
      include: { track: { include: { artist: true, album: true } } },
      take: limit * 3,
    }),
    prisma.playHistory.findMany({
      where: {
        userId,
        trackId: { notIn: [...exclude, seed.id] },
        ...(seed.artistId
          ? { track: { artistId: { not: seed.artistId } } }
          : {}),
      },
      orderBy: { playedAt: 'desc' },
      take: limit * 2,
      include: { track: { include: { artist: true, album: true } } },
    }),
    seed.artistId || seedArtistName
      ? prisma.track.findMany({
          where: {
            id: { notIn: [...exclude] },
            ...(seed.artistId
              ? { artistId: seed.artistId }
              : { artist: { name: { contains: seedArtistName, mode: 'insensitive' } } }),
          },
          include: { artist: true, album: true },
          orderBy: { updatedAt: 'desc' },
          take: 4,
        })
      : Promise.resolve(
          [] as Awaited<
            ReturnType<
              typeof prisma.track.findMany<{ include: { artist: true; album: true } }>
            >
          >,
        ),
  ]);

  type LibTrack = (typeof otherArtistsLiked)[number]['track'];
  const pool: LibTrack[] = [];
  const seen = new Set<string>();
  const push = (t: LibTrack) => {
    if (!t || !isTrackPlayable(t) || seen.has(t.id)) return;
    seen.add(t.id);
    pool.push(t);
  };

  // Prefer different artists first (liked + recent), then at most a couple same-artist tracks
  shuffleInPlace(otherArtistsLiked.map((l) => l.track)).forEach(push);
  recentOther.forEach((h) => push(h.track));
  shuffleInPlace([...sameArtist]).slice(0, 2).forEach(push);

  return diversifyByArtist(shuffleInPlace(pool), limit, 1, seedArtistName);
}

async function collectYouTubeRecs(
  seed: { title: string; artist: { name: string }; duration: number },
  excludeSourceIds: Set<string>,
  excludeTitles: Set<string>,
  limit: number
): Promise<SearchResult[]> {
  const artist = seed.artist.name.split(/[,;&]/)[0]?.trim() || seed.artist.name;
  // Style / similar — NOT "artist official" (that floods same-artist results)
  const queries = shuffleInPlace([
    `songs like ${seed.title}`,
    `similar to ${artist}`,
    `${seed.title} mix`,
    `best songs like ${artist}`,
    `${artist} radio mix`,
  ]).slice(0, 1);

  const found: SearchResult[] = [];
  const seen = new Set<string>();
  const seedArtist = artistKey(artist);

  for (const q of queries) {
    if (found.length >= limit * 2) break;
    if (Date.now() < youtubeDiscoverBlockedUntil) break;
    try {
      const { isYouTubeRateLimited } = await import('./ytdlp');
      if (isYouTubeRateLimited()) {
        youtubeDiscoverBlockedUntil = Date.now() + 10 * 60 * 1000;
        break;
      }
    } catch { /* ignore */ }
    try {
      const results = await searchYouTube(q, 8);
      // Looser match to the seed title — we want adjacent songs, not clones
      const ranked = rankYouTubeResults(
        results,
        { title: seed.title, artist, duration: seed.duration },
        { filterVariants: true, rawQuery: q, minScore: 28 }
      );

      for (const r of ranked) {
        if (seen.has(r.id) || excludeSourceIds.has(r.id)) continue;
        const titleKey = extractTrackTitleFromYouTube(r.title).toLowerCase();
        if (excludeTitles.has(titleKey)) continue;
        // Skip obvious same-artist uploads when we already have variety options
        const rArtist = artistKey(r.artist);
        if (rArtist && rArtist === seedArtist && found.length >= Math.ceil(limit / 2)) continue;
        seen.add(r.id);
        found.push(r);
        if (found.length >= limit * 2) break;
      }
    } catch (err) {
      if (isYouTubeBlockedError(err)) {
        youtubeDiscoverBlockedUntil = Date.now() + 15 * 60 * 1000;
        console.warn('[Discover] YouTube blocked (403) — pausing Discover YT searches for 15m');
        break;
      }
      console.error('[Discover] YouTube search failed:', (err as Error).message);
    }
  }

  // Diversify: prefer different artists than the seed
  const byArtist = new Map<string, SearchResult[]>();
  for (const r of found) {
    const key = artistKey(r.artist) || r.id;
    const list = byArtist.get(key) || [];
    list.push(r);
    byArtist.set(key, list);
  }
  const out: SearchResult[] = [];
  const keys = shuffleInPlace([...byArtist.keys()].filter((k) => k !== seedArtist));
  for (const k of keys) {
    const list = byArtist.get(k);
    if (list?.[0]) out.push(list[0]);
    if (out.length >= limit) break;
  }
  // Fill with seed-artist only if needed
  if (out.length < limit && seedArtist && byArtist.has(seedArtist)) {
    for (const r of byArtist.get(seedArtist)!) {
      if (out.length >= limit) break;
      if (!out.includes(r)) out.push(r);
    }
  }
  // Any remaining
  if (out.length < limit) {
    for (const r of shuffleInPlace([...found])) {
      if (out.length >= limit) break;
      if (!out.includes(r)) out.push(r);
    }
  }
  return out.slice(0, limit);
}

export async function getDiscoverRecommendations(
  userId: string,
  seedTrackId?: string,
  limit = 12,
  seedMeta?: { title?: string; artist?: string },
) {
  const { trackIds, sourceIds, titles } = await getExcludeIds(userId, seedTrackId);

  let seed = seedTrackId
    ? await prisma.track.findUnique({
        where: { id: seedTrackId },
        include: { artist: true, album: true },
      })
    : null;

  if (!seed && seedMeta?.title && seedMeta?.artist) {
    const artist = await prisma.artist.findFirst({
      where: { name: { contains: seedMeta.artist.split(/[,;&]/)[0].trim(), mode: 'insensitive' } },
    });
    seed = {
      id: seedTrackId || '',
      title: seedMeta.title,
      artistId: artist?.id || '',
      duration: 0,
      artist: artist || { id: '', name: seedMeta.artist, imageUrl: null },
      album: null,
    } as typeof seed & { artist: { id: string; name: string; imageUrl: string | null } };
  }

  if (!seed) {
    const last = await prisma.playHistory.findFirst({
      where: { userId },
      orderBy: { playedAt: 'desc' },
      include: { track: { include: { artist: true, album: true } } },
    });
    seed = last?.track ?? null;
  }

  if (!seed) {
    const popular = await prisma.track.findMany({
      where: { isDownloaded: true },
      include: { artist: true, album: true },
      orderBy: { updatedAt: 'desc' },
      take: limit * 2,
    });
    return {
      seed: null,
      recommendations: diversifyByArtist(shuffleInPlace(popular), limit, 1).map(formatDiscoverTrack),
    };
  }

  titles.add(seed.title.toLowerCase());
  const libraryRecs = await collectLibraryRecs(userId, seed, trackIds, Math.ceil(limit * 0.6));
  let recommendations: DiscoverItem[] = libraryRecs.map(formatDiscoverTrack);

  const ytNeeded = limit - recommendations.length;
  if (ytNeeded > 0) {
    let ytResults: SearchResult[] = [];
    try {
      const { isYouTubeRateLimited } = await import('./ytdlp');
      if (!isYouTubeRateLimited() && Date.now() >= youtubeDiscoverBlockedUntil) {
        ytResults = await Promise.race([
          collectYouTubeRecs(seed, sourceIds, titles, ytNeeded + 2),
          new Promise<SearchResult[]>((resolve) => setTimeout(() => resolve([]), 12000)),
        ]);
      }
    } catch (err) {
      console.warn('[Discover] YouTube recs skipped:', (err as Error).message);
    }
    for (const r of ytResults) {
      recommendations.push({
        id: `discover-yt-${r.id}`,
        title: extractTrackTitleFromYouTube(r.title),
        duration: r.duration,
        thumbnailUrl: r.thumbnailUrl,
        isDownloaded: false,
        streamUrl: null,
        artist: { id: '', name: r.artist, imageUrl: null },
        album: null,
        source: 'youtube',
        youtubeUrl: r.url,
      });
    }
  }

  recommendations = diversifyByArtist(
    shuffleInPlace(recommendations),
    limit,
    1,
    seed.artist.name,
  );

  return {
    seed: { id: seed.id, title: seed.title, artist: seed.artist.name },
    recommendations,
  };
}

export async function getNextDiscoverTrack(
  userId: string,
  seedTrackId: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH' = 'HIGH'
) {
  const { recommendations } = await getDiscoverRecommendations(userId, seedTrackId, 8);

  for (const rec of recommendations) {
    if (rec.source === 'library') {
      const track = await prisma.track.findUnique({
        where: { id: rec.id },
        include: { artist: true, album: true },
      });
      if (track) {
        return {
          track: formatDiscoverTrack(track),
          upcoming: recommendations.filter((r) => r.id !== rec.id).slice(0, 5),
        };
      }
    }

    if (rec.source === 'youtube' && rec.youtubeUrl) {
      return {
        track: rec,
        upcoming: recommendations.filter((r) => r.id !== rec.id).slice(0, 5),
      };
    }
  }

  return { track: null, upcoming: [] as DiscoverItem[] };
}

/** Prefetch the next recommended track in the background while user listens */
export async function prefetchNextDiscoverTrack(
  userId: string,
  seedTrackId: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH' = 'HIGH'
) {
  const { isYouTubeRateLimited } = await import('./ytdlp');
  if (isYouTubeRateLimited()) {
    return { status: 'skipped', reason: 'youtube-rate-limited' };
  }

  // Prefer library-only recommendations for prefetch speed
  const { recommendations } = await getDiscoverRecommendations(userId, seedTrackId, 4);

  for (const rec of recommendations) {
    if (rec.source === 'library') {
      const track = await prisma.track.findUnique({ where: { id: rec.id } });
      if (!track) continue;
      if (track.isDownloaded) continue;
      await prefetchLibraryTrack(track.id, quality);
      return { trackId: track.id, status: 'prefetching' };
    }

    if (rec.source === 'youtube' && rec.youtubeUrl) {
      try {
        const source = await resolveYouTubeSource(rec.youtubeUrl, {
          url: rec.youtubeUrl,
          title: rec.title,
          artist: rec.artist.name,
          duration: rec.duration,
          relaxed: true,
        });
        const track = await upsertPendingTrack(source, quality, rec.title, rec.artist.name);
        ensureBackgroundDownload(track.id, source.url, quality, {
          title: rec.title,
          artist: rec.artist.name,
        });
        return { trackId: track.id, status: 'prefetching' };
      } catch (err) {
        const msg = (err as Error).message;
        if (isYouTubeBlockedError(err) || /rate-?limited/i.test(msg)) {
          youtubeDiscoverBlockedUntil = Date.now() + 10 * 60 * 1000;
          console.warn('[Discover] Prefetch blocked — pausing 10m');
          break;
        }
        if (/format is not available/i.test(msg)) {
          console.warn('[Discover] Prefetch skipped (format):', msg.split('\n')[0]);
        } else {
          console.warn('[Discover] Prefetch failed:', msg.split('\n')[0]);
        }
      }
    }
  }

  return { status: 'none' };
}
