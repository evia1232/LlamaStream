import prisma from '../lib/prisma';
import { artistNameMatches } from '../lib/artistMatch';
import { trackStreamUrl, isDownloadInProgress } from './trackDownload';
import {
  isSpotifyConfigured,
  searchSpotifyArtist,
  fetchSpotifyArtistTopTracks,
  fetchSpotifyArtistAlbums,
  SpotifySearchResult,
  SpotifyArtistResult,
  SpotifyAlbumResult,
} from './spotifyApi';

function formatTrack(track: {
  id: string;
  title: string;
  duration: number;
  filePath: string | null;
  sourceUrl: string | null;
  sourceId: string | null;
  thumbnailUrl: string | null;
  quality: string;
  isDownloaded: boolean;
  artist: { id: string; name: string; imageUrl: string | null };
  album?: { id: string; title: string; coverUrl: string | null } | null;
}) {
  return {
    id: track.id,
    title: track.title,
    duration: track.duration,
    thumbnailUrl: track.thumbnailUrl,
    sourceUrl: track.sourceUrl,
    sourceId: track.sourceId,
    quality: track.quality,
    isDownloaded: track.isDownloaded,
    isDownloading: !track.isDownloaded && !!track.sourceUrl && isDownloadInProgress(track.id),
    artist: track.artist,
    album: track.album || null,
    streamUrl: trackStreamUrl(track),
  };
}

function formatAlbum(album: {
  id: string;
  title: string;
  coverUrl: string | null;
  releaseYear: number | null;
  artist: { id: string; name: string };
  _count?: { tracks: number };
}) {
  return {
    id: album.id,
    title: album.title,
    coverUrl: album.coverUrl,
    releaseYear: album.releaseYear,
    trackCount: album._count?.tracks ?? 0,
    artist: { id: album.artist.id, name: album.artist.name },
  };
}

export interface ArtistPageData {
  artist: {
    id: string | null;
    name: string;
    imageUrl: string | null;
    bio: string | null;
  };
  localTracks: ReturnType<typeof formatTrack>[];
  localAlbums: ReturnType<typeof formatAlbum>[];
  listenedTracks: ReturnType<typeof formatTrack>[];
  spotify: {
    configured: boolean;
    artist: SpotifyArtistResult | null;
    topTracks: SpotifySearchResult[];
    albums: SpotifyAlbumResult[];
  };
}

async function findLocalTracks(artistName: string, artistId?: string | null) {
  const candidates = await prisma.track.findMany({
    where: artistId
      ? {
          OR: [
            { artistId },
            { artist: { name: { contains: artistName, mode: 'insensitive' } } },
          ],
        }
      : { artist: { name: { contains: artistName, mode: 'insensitive' } } },
    include: { artist: true, album: true },
    orderBy: { title: 'asc' },
  });

  return candidates.filter((t) => artistNameMatches(t.artist.name, artistName));
}

async function findLocalAlbums(artistName: string, artistId?: string | null) {
  const candidates = await prisma.album.findMany({
    where: artistId
      ? {
          OR: [
            { artistId },
            { artist: { name: { contains: artistName, mode: 'insensitive' } } },
          ],
        }
      : { artist: { name: { contains: artistName, mode: 'insensitive' } } },
    include: {
      artist: true,
      _count: { select: { tracks: true } },
    },
    orderBy: { releaseYear: 'desc' },
  });

  return candidates.filter((a) => artistNameMatches(a.artist.name, artistName));
}

async function findListenedTracks(userId: string, artistName: string) {
  const history = await prisma.playHistory.findMany({
    where: { userId },
    include: { track: { include: { artist: true, album: true } } },
    orderBy: { playedAt: 'desc' },
    take: 100,
    distinct: ['trackId'],
  });

  return history
    .map((h) => h.track)
    .filter((t) => artistNameMatches(t.artist.name, artistName));
}

export async function buildArtistPageData(
  userId: string,
  artistName: string,
  artistId?: string | null,
): Promise<ArtistPageData> {
  const dbArtist = artistId
    ? await prisma.artist.findUnique({ where: { id: artistId } })
    : await prisma.artist.findFirst({
        where: { name: { equals: artistName, mode: 'insensitive' } },
      });

  const resolvedName = dbArtist?.name ?? artistName;
  const resolvedId = dbArtist?.id ?? artistId ?? null;

  const [localTrackRows, localAlbumRows, listenedRows, spotifyArtist] = await Promise.all([
    findLocalTracks(resolvedName, resolvedId),
    findLocalAlbums(resolvedName, resolvedId),
    findListenedTracks(userId, resolvedName),
    isSpotifyConfigured() ? searchSpotifyArtist(resolvedName) : Promise.resolve(null),
  ]);

  let spotifyTopTracks: SpotifySearchResult[] = [];
  let spotifyAlbums: SpotifyAlbumResult[] = [];

  if (spotifyArtist) {
    [spotifyTopTracks, spotifyAlbums] = await Promise.all([
      fetchSpotifyArtistTopTracks(spotifyArtist.id),
      fetchSpotifyArtistAlbums(spotifyArtist.id),
    ]);
  }

  const imageUrl = dbArtist?.imageUrl || spotifyArtist?.imageUrl || null;

  return {
    artist: {
      id: resolvedId,
      name: resolvedName,
      imageUrl,
      bio: dbArtist?.bio ?? null,
    },
    localTracks: localTrackRows.map(formatTrack),
    localAlbums: localAlbumRows.map(formatAlbum),
    listenedTracks: listenedRows.map(formatTrack),
    spotify: {
      configured: isSpotifyConfigured(),
      artist: spotifyArtist,
      topTracks: spotifyTopTracks,
      albums: spotifyAlbums,
    },
  };
}
