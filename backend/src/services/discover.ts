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
  const artistFilter = seed.artistId
    ? { artistId: seed.artistId }
    : seed.artist?.name
      ? { artist: { name: { contains: seed.artist.name.split(/[,;&]/)[0].trim(), mode: 'insensitive' as const } } }
      : null;

  const [sameArtist, liked] = await Promise.all([
    artistFilter
      ? prisma.track.findMany({
          where: {
            ...artistFilter,
            id: { notIn: [...exclude] },
          },
          include: { artist: true, album: true },
          orderBy: { updatedAt: 'desc' },
          take: limit * 2,
        })
      : Promise.resolve([]),
    prisma.likedTrack.findMany({
      where: {
        userId,
        track: { id: { notIn: [...exclude, seed.id] } },
      },
      include: { track: { include: { artist: true, album: true } } },
      take: limit,
    }),
  ]);

  const out = [];
  const seen = new Set<string>();
  for (const t of sameArtist) {
    if (!isTrackPlayable(t) || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  for (const l of liked) {
    if (!isTrackPlayable(l.track) || seen.has(l.track.id)) continue;
    seen.add(l.track.id);
    out.push(l.track);
  }
  return out.slice(0, limit);
}

async function collectYouTubeRecs(
  seed: { title: string; artist: { name: string }; duration: number },
  excludeSourceIds: Set<string>,
  excludeTitles: Set<string>,
  limit: number
): Promise<SearchResult[]> {
  const artist = seed.artist.name;
  const queries = [
    `${artist} official audio`,
    `${artist} - official`,
    `songs like ${seed.title} ${artist}`,
  ];

  const found: SearchResult[] = [];
  const seen = new Set<string>();

  for (const q of queries) {
    if (found.length >= limit) break;
    if (Date.now() < youtubeDiscoverBlockedUntil) break;
    try {
      const results = await searchYouTube(q, 12);
      const ranked = rankYouTubeResults(
        results,
        { title: seed.title, artist, duration: seed.duration },
        { filterVariants: true, rawQuery: q, minScore: 42 }
      );

      for (const r of ranked) {
        if (seen.has(r.id) || excludeSourceIds.has(r.id)) continue;
        const titleKey = extractTrackTitleFromYouTube(r.title).toLowerCase();
        if (excludeTitles.has(titleKey)) continue;
        seen.add(r.id);
        found.push(r);
        if (found.length >= limit) break;
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

  return found;
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
      take: limit,
    });
    return { seed: null, recommendations: popular.map(formatDiscoverTrack) };
  }

  titles.add(seed.title.toLowerCase());
  const libraryRecs = await collectLibraryRecs(userId, seed, trackIds, Math.ceil(limit / 2));
  const recommendations: DiscoverItem[] = libraryRecs.map(formatDiscoverTrack);

  const ytNeeded = limit - recommendations.length;
  if (ytNeeded > 0) {
    const ytResults = await collectYouTubeRecs(seed, sourceIds, titles, ytNeeded);
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

  return {
    seed: { id: seed.id, title: seed.title, artist: seed.artist.name },
    recommendations: recommendations.slice(0, limit),
  };
}

export async function getNextDiscoverTrack(
  userId: string,
  seedTrackId: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH' = 'HIGH'
) {
  const { recommendations } = await getDiscoverRecommendations(userId, seedTrackId, 6);

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
        if (isYouTubeBlockedError(err)) {
          youtubeDiscoverBlockedUntil = Date.now() + 15 * 60 * 1000;
          console.warn('[Discover] Prefetch blocked by YouTube 403 — pausing 15m');
          break;
        }
        if (/format is not available/i.test(msg)) {
          console.warn('[Discover] Prefetch skipped (format):', msg.split('\n')[0]);
        } else {
          console.error('[Discover] Prefetch failed:', msg);
        }
      }
    }
  }

  return { status: 'none' };
}
