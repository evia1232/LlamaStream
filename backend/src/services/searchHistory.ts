import prisma from '../lib/prisma';

const MAX_QUERIES = 12;
const MAX_TRACKS = 20;

export interface SearchHistoryTrackDto {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnailUrl?: string | null;
  youtubeUrl?: string;
  spotifyUrl?: string;
  album?: string;
  searchedAt: number;
}

export async function getSearchHistory(userId: string): Promise<{
  queries: string[];
  tracks: SearchHistoryTrackDto[];
}> {
  const [queryRows, trackRows] = await Promise.all([
    prisma.searchHistoryQuery.findMany({
      where: { userId },
      orderBy: { searchedAt: 'desc' },
      take: MAX_QUERIES,
    }),
    prisma.searchHistoryTrack.findMany({
      where: { userId },
      orderBy: { searchedAt: 'desc' },
      take: MAX_TRACKS,
    }),
  ]);

  return {
    queries: queryRows.map((r) => r.query),
    tracks: trackRows.map((r) => ({
      id: r.trackKey,
      title: r.title,
      artist: r.artist,
      duration: r.duration,
      thumbnailUrl: r.thumbnailUrl,
      youtubeUrl: r.youtubeUrl ?? undefined,
      spotifyUrl: r.spotifyUrl ?? undefined,
      album: r.album ?? undefined,
      searchedAt: r.searchedAt.getTime(),
    })),
  };
}

export async function addSearchQuery(userId: string, query: string): Promise<string[]> {
  const q = query.trim();
  if (!q) return (await getSearchHistory(userId)).queries;

  const existing = await prisma.searchHistoryQuery.findMany({
    where: { userId },
    select: { id: true, query: true },
  });
  const dupes = existing.filter((r) => r.query.toLowerCase() === q.toLowerCase());
  if (dupes.length > 0) {
    await prisma.searchHistoryQuery.deleteMany({ where: { id: { in: dupes.map((d) => d.id) } } });
  }

  await prisma.searchHistoryQuery.create({ data: { userId, query: q } });

  const overflow = await prisma.searchHistoryQuery.findMany({
    where: { userId },
    orderBy: { searchedAt: 'desc' },
    skip: MAX_QUERIES,
    select: { id: true },
  });
  if (overflow.length > 0) {
    await prisma.searchHistoryQuery.deleteMany({ where: { id: { in: overflow.map((o) => o.id) } } });
  }

  return (await getSearchHistory(userId)).queries;
}

export async function addSearchTrack(userId: string, track: {
  id: string;
  title: string;
  artist: string;
  duration?: number;
  thumbnailUrl?: string | null;
  youtubeUrl?: string;
  spotifyUrl?: string;
  album?: string;
}): Promise<SearchHistoryTrackDto[]> {
  const trackKey = track.id.trim();
  if (!trackKey || !track.title.trim()) return (await getSearchHistory(userId)).tracks;

  await prisma.searchHistoryTrack.upsert({
    where: { userId_trackKey: { userId, trackKey } },
    create: {
      userId,
      trackKey,
      title: track.title.trim(),
      artist: track.artist.trim(),
      duration: Math.max(0, Math.floor(track.duration ?? 0)),
      thumbnailUrl: track.thumbnailUrl ?? null,
      youtubeUrl: track.youtubeUrl ?? null,
      spotifyUrl: track.spotifyUrl ?? null,
      album: track.album ?? null,
    },
    update: {
      title: track.title.trim(),
      artist: track.artist.trim(),
      duration: Math.max(0, Math.floor(track.duration ?? 0)),
      thumbnailUrl: track.thumbnailUrl ?? null,
      youtubeUrl: track.youtubeUrl ?? null,
      spotifyUrl: track.spotifyUrl ?? null,
      album: track.album ?? null,
      searchedAt: new Date(),
    },
  });

  const overflow = await prisma.searchHistoryTrack.findMany({
    where: { userId },
    orderBy: { searchedAt: 'desc' },
    skip: MAX_TRACKS,
    select: { id: true },
  });
  if (overflow.length > 0) {
    await prisma.searchHistoryTrack.deleteMany({ where: { id: { in: overflow.map((o) => o.id) } } });
  }

  return (await getSearchHistory(userId)).tracks;
}

/** One-time merge from a device's localStorage on first sync. */
export async function importSearchHistory(userId: string, data: {
  queries?: string[];
  tracks?: Array<{
    id: string;
    title: string;
    artist?: string;
    duration?: number;
    thumbnailUrl?: string | null;
    youtubeUrl?: string;
    spotifyUrl?: string;
    album?: string;
    searchedAt?: number;
  }>;
}): Promise<{ queries: string[]; tracks: SearchHistoryTrackDto[] }> {
  const queries = [...(data.queries ?? [])].reverse();
  for (const q of queries) {
    if (typeof q === 'string' && q.trim()) await addSearchQuery(userId, q);
  }

  const tracks = [...(data.tracks ?? [])].sort((a, b) => (a.searchedAt ?? 0) - (b.searchedAt ?? 0));
  for (const t of tracks) {
    if (!t?.id || !t?.title) continue;
    await addSearchTrack(userId, {
      id: t.id,
      title: t.title,
      artist: t.artist ?? '',
      duration: t.duration ?? 0,
      thumbnailUrl: t.thumbnailUrl,
      youtubeUrl: t.youtubeUrl,
      spotifyUrl: t.spotifyUrl,
      album: t.album,
    });
  }

  return getSearchHistory(userId);
}
