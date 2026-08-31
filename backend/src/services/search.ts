import prisma from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { searchYouTube } from './downloader';
import {
  searchSpotifyTracks,
  parseSpotifyUrl,
  isSpotifyUrl,
  isYouTubeUrl,
  SpotifySearchResult,
} from './spotify';

export interface LocalTrack {
  id: string;
  title: string;
  duration: number;
  thumbnailUrl: string | null;
  isDownloaded: boolean;
  streamUrl: string | null;
  sourceUrl: string | null;
  artist: { id: string; name: string; imageUrl: string | null };
  album: { id: string; title: string; coverUrl: string | null } | null;
}

export interface UnifiedSearchResult {
  library: LocalTrack[];
  youtube: Awaited<ReturnType<typeof searchYouTube>>;
  spotify: SpotifySearchResult[];
  spotifyUrlTracks: Array<{
    name: string; artist: string; album?: string; duration?: number; source: 'spotify';
  }>;
  artists: Array<{ id: string; name: string; imageUrl: string | null }>;
  albums: Array<{ id: string; title: string; coverUrl: string | null; artist: { id: string; name: string } }>;
  playlists: Array<{ id: string; name: string; coverUrl: string | null; trackCount: number; userId: string }>;
  detectedUrl?: { type: 'spotify' | 'youtube'; url: string };
}

function buildTrackFilter(query: string): Prisma.TrackWhereInput {
  const words = query.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return {};

  return {
    AND: words.map((word) => ({
      OR: [
        { title: { contains: word, mode: 'insensitive' } },
        { artist: { name: { contains: word, mode: 'insensitive' } } },
        { album: { title: { contains: word, mode: 'insensitive' } } },
      ],
    })),
  };
}

export async function unifiedSearch(query: string, userId: string, limit = 20): Promise<UnifiedSearchResult> {
  const trimmed = query.trim();
  const trackFilter = buildTrackFilter(trimmed);
  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);

  // Local search always runs — library, artists, albums, playlists
  const [libraryTracks, artists, albums, playlists] = await Promise.all([
    prisma.track.findMany({
      where: trackFilter,
      include: { artist: true, album: true },
      orderBy: [{ isDownloaded: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
    }),
    prisma.artist.findMany({
      where: words.length > 0
        ? { OR: words.map((word) => ({ name: { contains: word, mode: 'insensitive' } })) }
        : { name: { contains: trimmed, mode: 'insensitive' } },
      take: 10,
    }),
    prisma.album.findMany({
      where: words.length > 0
        ? {
            OR: words.flatMap((word) => [
              { title: { contains: word, mode: 'insensitive' } },
              { artist: { name: { contains: word, mode: 'insensitive' } } },
            ]),
          }
        : { title: { contains: trimmed, mode: 'insensitive' } },
      include: { artist: true },
      take: 10,
    }),
    prisma.playlist.findMany({
      where: {
        AND: [
          { OR: [{ visibility: 'PUBLIC' }, { userId }] },
          words.length > 0
            ? { OR: words.map((word) => ({ name: { contains: word, mode: 'insensitive' } })) }
            : { name: { contains: trimmed, mode: 'insensitive' } },
        ],
      },
      include: { _count: { select: { tracks: true } } },
      take: 10,
    }),
  ]);

  let youtube: UnifiedSearchResult['youtube'] = [];
  let spotify: SpotifySearchResult[] = [];
  let spotifyUrlTracks: UnifiedSearchResult['spotifyUrlTracks'] = [];
  let detectedUrl: UnifiedSearchResult['detectedUrl'];

  if (isSpotifyUrl(trimmed)) {
    detectedUrl = { type: 'spotify', url: trimmed };
    try {
      const parsed = await parseSpotifyUrl(trimmed);
      spotifyUrlTracks = parsed.tracks;
    } catch (err) {
      console.error('Spotify URL parse failed:', err);
    }
  } else if (isYouTubeUrl(trimmed)) {
    detectedUrl = { type: 'youtube', url: trimmed };
  } else {
    // Text query: search YouTube + Spotify in parallel (local already done above)
    const [ytResults, spResults] = await Promise.allSettled([
      searchYouTube(trimmed, limit),
      searchSpotifyTracks(trimmed, limit),
    ]);

    if (ytResults.status === 'fulfilled') youtube = ytResults.value;
    else console.error('YouTube search failed:', ytResults.reason);

    if (spResults.status === 'fulfilled') spotify = spResults.value;
    else console.error('Spotify search failed:', spResults.reason);
  }

  return {
    library: libraryTracks.map((t) => ({
      id: t.id,
      title: t.title,
      duration: t.duration,
      thumbnailUrl: t.thumbnailUrl,
      isDownloaded: t.isDownloaded,
      streamUrl: t.isDownloaded ? `/api/tracks/${t.id}/stream` : null,
      sourceUrl: t.sourceUrl,
      artist: { id: t.artist.id, name: t.artist.name, imageUrl: t.artist.imageUrl },
      album: t.album ? { id: t.album.id, title: t.album.title, coverUrl: t.album.coverUrl } : null,
    })),
    youtube,
    spotify,
    spotifyUrlTracks,
    artists,
    albums: albums.map((a) => ({
      id: a.id,
      title: a.title,
      coverUrl: a.coverUrl,
      artist: { id: a.artist.id, name: a.artist.name },
    })),
    playlists: playlists.map((p) => ({
      id: p.id,
      name: p.name,
      coverUrl: p.coverUrl,
      trackCount: p._count.tracks,
      userId: p.userId,
    })),
    detectedUrl,
  };
}
