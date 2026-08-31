import prisma from '../lib/prisma';
import { artistNameMatches } from '../lib/artistMatch';
import { trackStreamUrl, isDownloadInProgress } from './trackDownload';
import {
  isSpotifyConfigured,
  searchSpotifyArtist,
  fetchSpotifyArtistById,
  resolveSpotifyArtistIdFromTrack,
  fetchSpotifyArtistTopTracks,
  fetchSpotifyArtistAlbums,
  SpotifySearchResult,
  SpotifyArtistResult,
  SpotifyAlbumResult,
} from './spotifyApi';

const SPOTIFY_TIMEOUT_MS = 20000;
const MAX_SPOTIFY_ALBUMS = 24;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

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
  artist: { id: string; name: string; imageUrl: string | null; spotifyArtistId?: string | null };
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
    spotifyArtistId: track.artist.spotifyArtistId ?? undefined,
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

export interface ArtistPageLocal {
  artist: {
    id: string | null;
    name: string;
    imageUrl: string | null;
    bio: string | null;
    spotifyArtistId: string | null;
  };
  localTracks: ReturnType<typeof formatTrack>[];
  localAlbums: ReturnType<typeof formatAlbum>[];
  listenedTracks: ReturnType<typeof formatTrack>[];
}

export interface ArtistSpotifyData {
  configured: boolean;
  artist: SpotifyArtistResult | null;
  topTracks: SpotifySearchResult[];
  albums: SpotifyAlbumResult[];
  error?: string;
}

export interface ArtistPageFull extends ArtistPageLocal {
  spotify: ArtistSpotifyData;
}

async function persistArtistSpotifyMeta(
  artistName: string,
  spotify: SpotifyArtistResult,
  artistId?: string | null,
) {
  const data = {
    spotifyArtistId: spotify.id,
    ...(spotify.imageUrl ? { imageUrl: spotify.imageUrl } : {}),
  };

  try {
    if (artistId) {
      await prisma.artist.update({ where: { id: artistId }, data });
      return;
    }
    const existing = await prisma.artist.findFirst({
      where: { name: { equals: artistName, mode: 'insensitive' } },
    });
    if (existing) {
      await prisma.artist.update({ where: { id: existing.id }, data });
    } else {
      await prisma.artist.create({ data: { name: spotify.name, ...data } });
    }
  } catch (err) {
    console.error('[Artist] Failed to persist Spotify meta:', err);
  }
}

async function findLocalTracks(artistName: string, artistId?: string | null) {
  const candidates = await prisma.track.findMany({
    where: {
      isDownloaded: true,
      ...(artistId
        ? {
            OR: [
              { artistId },
              { artist: { name: { contains: artistName, mode: 'insensitive' } } },
            ],
          }
        : { artist: { name: { contains: artistName, mode: 'insensitive' } } }),
    },
    include: { artist: true, album: true },
    orderBy: { title: 'asc' },
    take: 500,
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
    take: 100,
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

async function resolveArtist(artistName: string, artistId?: string | null) {
  const dbArtist = artistId
    ? await prisma.artist.findUnique({ where: { id: artistId } })
    : await prisma.artist.findFirst({
        where: { name: { equals: artistName, mode: 'insensitive' } },
      });

  return {
    resolvedName: dbArtist?.name ?? artistName,
    resolvedId: dbArtist?.id ?? artistId ?? null,
    dbArtist,
  };
}

export async function buildArtistPageLocal(
  userId: string,
  artistName: string,
  artistId?: string | null,
): Promise<ArtistPageLocal> {
  const { resolvedName, resolvedId, dbArtist } = await resolveArtist(artistName, artistId);

  const [localTrackRows, localAlbumRows, listenedRows] = await Promise.all([
    findLocalTracks(resolvedName, resolvedId),
    findLocalAlbums(resolvedName, resolvedId),
    findListenedTracks(userId, resolvedName),
  ]);

  return {
    artist: {
      id: resolvedId,
      name: resolvedName,
      imageUrl: dbArtist?.imageUrl ?? null,
      bio: dbArtist?.bio ?? null,
      spotifyArtistId: dbArtist?.spotifyArtistId ?? null,
    },
    localTracks: localTrackRows.map(formatTrack),
    localAlbums: localAlbumRows.map(formatAlbum),
    listenedTracks: listenedRows.map(formatTrack),
  };
}

export async function fetchArtistSpotifyData(
  artistName: string,
  hints?: { spotifyArtistId?: string | null; spotifyTrackId?: string | null },
  persistForArtistId?: string | null,
): Promise<ArtistSpotifyData> {
  const empty: ArtistSpotifyData = {
    configured: isSpotifyConfigured(),
    artist: null,
    topTracks: [],
    albums: [],
  };

  if (!isSpotifyConfigured()) {
    return { ...empty, error: 'Spotify API not configured' };
  }

  try {
    let spotifyArtist: SpotifyArtistResult | null = null;
    let resolveError: string | undefined;

    const tryById = async (id: string) => {
      spotifyArtist = await withTimeout(
        fetchSpotifyArtistById(id),
        SPOTIFY_TIMEOUT_MS,
        null,
      );
    };

    if (hints?.spotifyArtistId) {
      await tryById(hints.spotifyArtistId);
    }

    if (!spotifyArtist && hints?.spotifyTrackId) {
      const artistId = await withTimeout(
        resolveSpotifyArtistIdFromTrack(hints.spotifyTrackId),
        SPOTIFY_TIMEOUT_MS,
        null,
      );
      if (artistId) await tryById(artistId);
    }

    if (!spotifyArtist) {
      spotifyArtist = await withTimeout(
        searchSpotifyArtist(artistName),
        SPOTIFY_TIMEOUT_MS,
        null,
      );
      if (!spotifyArtist) {
        resolveError = `Could not find artist "${artistName}" on Spotify`;
      }
    }

    if (!spotifyArtist) {
      return { ...empty, configured: true, error: resolveError };
    }

    const [topTracks, albums] = await Promise.all([
      withTimeout(fetchSpotifyArtistTopTracks(spotifyArtist.id), SPOTIFY_TIMEOUT_MS, []),
      withTimeout(fetchSpotifyArtistAlbums(spotifyArtist.id), SPOTIFY_TIMEOUT_MS, []),
    ]);

    void persistArtistSpotifyMeta(artistName, spotifyArtist, persistForArtistId);

    return {
      configured: true,
      artist: spotifyArtist,
      topTracks,
      albums: albums.slice(0, MAX_SPOTIFY_ALBUMS),
    };
  } catch (err) {
    console.error('[Artist] Spotify fetch failed:', err);
    return { ...empty, configured: true, error: (err as Error).message };
  }
}

/** Full artist page — local library + Spotify catalog in one response */
export async function buildArtistPage(
  userId: string,
  artistName: string,
  artistId?: string | null,
  hints?: { spotifyArtistId?: string | null; spotifyTrackId?: string | null },
): Promise<ArtistPageFull> {
  const local = await buildArtistPageLocal(userId, artistName, artistId);

  const mergedHints = {
    spotifyArtistId: hints?.spotifyArtistId || local.artist.spotifyArtistId,
    spotifyTrackId: hints?.spotifyTrackId,
  };

  const spotify = await fetchArtistSpotifyData(
    local.artist.name,
    mergedHints,
    local.artist.id,
  );

  const imageUrl = local.artist.imageUrl || spotify.artist?.imageUrl || null;
  const spotifyArtistId = spotify.artist?.id || local.artist.spotifyArtistId;

  return {
    ...local,
    artist: {
      ...local.artist,
      name: spotify.artist?.name || local.artist.name,
      imageUrl,
      spotifyArtistId,
    },
    spotify,
  };
}

/** @deprecated Use buildArtistPage */
export async function buildArtistPageData(
  userId: string,
  artistName: string,
  artistId?: string | null,
) {
  return buildArtistPage(userId, artistName, artistId);
}
