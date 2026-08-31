import prisma from '../lib/prisma';
import { searchYouTube } from './downloader';
import {
  searchSpotifyTracks,
  parseSpotifyUrl,
  isSpotifyUrl,
  isYouTubeUrl,
  SpotifySearchResult,
} from './spotify';

export interface UnifiedSearchResult {
  library: Array<{
    id: string; title: string; duration: number;
    thumbnailUrl: string | null; isDownloaded: boolean;
    artist: { id: string; name: string };
    streamUrl: string | null;
  }>;
  youtube: Awaited<ReturnType<typeof searchYouTube>>;
  spotify: SpotifySearchResult[];
  spotifyUrlTracks: Array<{
    name: string; artist: string; album?: string; duration?: number; source: 'spotify';
  }>;
  artists: Array<{ id: string; name: string; imageUrl: string | null }>;
  albums: Array<{ id: string; title: string; coverUrl: string | null; artist: { name: string } }>;
  playlists: Array<{ id: string; name: string; coverUrl: string | null }>;
  detectedUrl?: { type: 'spotify' | 'youtube'; url: string };
}

export async function unifiedSearch(query: string, userId: string, limit = 20): Promise<UnifiedSearchResult> {
  const trimmed = query.trim();

  const [library, artists, albums, playlists] = await Promise.all([
    prisma.track.findMany({
      where: {
        OR: [
          { title: { contains: trimmed, mode: 'insensitive' } },
          { artist: { name: { contains: trimmed, mode: 'insensitive' } } },
        ],
      },
      include: { artist: true },
      take: limit,
    }),
    prisma.artist.findMany({
      where: { name: { contains: trimmed, mode: 'insensitive' } },
      take: 10,
    }),
    prisma.album.findMany({
      where: { title: { contains: trimmed, mode: 'insensitive' } },
      include: { artist: true },
      take: 10,
    }),
    prisma.playlist.findMany({
      where: {
        name: { contains: trimmed, mode: 'insensitive' },
        OR: [{ visibility: 'PUBLIC' }, { userId }],
      },
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
    // YouTube URL will be handled by download endpoint
  } else {
    // Parallel text search on both platforms
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
    library: library.map((t) => ({
      id: t.id,
      title: t.title,
      duration: t.duration,
      thumbnailUrl: t.thumbnailUrl,
      isDownloaded: t.isDownloaded,
      artist: { id: t.artist.id, name: t.artist.name },
      streamUrl: t.isDownloaded ? `/api/tracks/${t.id}/stream` : null,
    })),
    youtube,
    spotify,
    spotifyUrlTracks,
    artists,
    albums,
    playlists,
    detectedUrl,
  };
}
