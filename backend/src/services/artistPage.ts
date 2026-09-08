import prisma from '../lib/prisma';
import { artistNameMatches } from '../lib/artistMatch';
import { trackStreamUrl, isDownloadInProgress } from './trackDownload';
import { effectiveDownloadedFlag, isTrackPlayable } from './trackIntegrity';
import {
  isSpotifyConfigured,
  isSpotifyRateLimited,
  searchSpotifyArtist,
  fetchSpotifyArtistById,
  resolveSpotifyArtistIdFromTrack,
  fetchSpotifyArtistTopTracks,
  fetchSpotifyArtistAlbums,
  fetchSpotifyAlbumTracks,
  SpotifySearchResult,
  SpotifyArtistResult,
  SpotifyAlbumResult,
} from './spotifyApi';

// Re-export rate-limit helper text from spotifyApi via local copy for artist errors
function spotifyUnavailableMessage(): string {
  if (isSpotifyRateLimited()) {
    return 'Spotify temporarily unavailable (rate limit). Showing local catalog if available.';
  }
  return 'Spotify temporarily unavailable. Showing local catalog if available.';
}

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
    isDownloaded: effectiveDownloadedFlag(track),
    isDownloading: !effectiveDownloadedFlag(track) && !!track.sourceUrl && isDownloadInProgress(track.id),
    artist: track.artist,
    album: track.album || null,
    streamUrl: trackStreamUrl({
      id: track.id,
      isDownloaded: effectiveDownloadedFlag(track),
      sourceUrl: track.sourceUrl,
      title: track.title,
      artist: track.artist,
    }),
    spotifyArtistId: track.artist.spotifyArtistId ?? undefined,
  };
}

function formatAlbum(album: {
  id: string;
  title: string;
  coverUrl: string | null;
  releaseYear: number | null;
  spotifyAlbumId?: string | null;
  artist: { id: string; name: string };
  _count?: { tracks: number };
}) {
  return {
    id: album.id,
    title: album.title,
    coverUrl: album.coverUrl,
    releaseYear: album.releaseYear,
    spotifyAlbumId: album.spotifyAlbumId ?? null,
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
  recommendedTracks: SpotifySearchResult[];
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

async function persistAlbumStubs(spotifyArtist: SpotifyArtistResult, albums: SpotifyAlbumResult[]) {
  try {
    const { upsertArtistLocal, upsertAlbumLocal } = await import('./albumCatalog');
    const artist = await upsertArtistLocal({
      name: spotifyArtist.name,
      spotifyArtistId: spotifyArtist.id,
      imageUrl: spotifyArtist.imageUrl,
      // Fast path — don't download dozens of covers during artist page load
      cacheImages: false,
    });
    for (const album of albums.slice(0, 40)) {
      await upsertAlbumLocal({
        title: album.name,
        artistId: artist.id,
        coverUrl: album.imageUrl,
        releaseYear: album.releaseYear,
        spotifyAlbumId: album.id,
        cacheImages: false,
      });
    }
  } catch (err) {
    console.error('[Artist] Failed to persist album stubs:', err);
  }
}

async function persistArtistSpotifyMeta(
  artistName: string,
  spotify: SpotifyArtistResult,
  artistId?: string | null,
) {
  const { cacheRemoteImage } = await import('./mediaCache');
  const localImage = spotify.imageUrl
    ? await cacheRemoteImage(spotify.imageUrl, `artist:${spotify.id}`)
    : null;
  const data = {
    spotifyArtistId: spotify.id,
    ...(localImage ? { imageUrl: localImage } : spotify.imageUrl ? { imageUrl: spotify.imageUrl } : {}),
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
    take: 500,
  });

  return candidates.filter(
    (t) => artistNameMatches(t.artist.name, artistName) && isTrackPlayable(t),
  );
}

async function findLocalAlbums(
  artistName: string,
  artistId?: string | null,
  spotifyArtistId?: string | null,
) {
  const or: object[] = [
    { artist: { name: { contains: artistName, mode: 'insensitive' } } },
  ];
  if (artistId) or.push({ artistId });
  if (spotifyArtistId) {
    or.push({ artist: { spotifyArtistId } });
  }

  const candidates = await prisma.album.findMany({
    where: { OR: or },
    include: {
      artist: true,
      _count: { select: { tracks: true } },
    },
    orderBy: { releaseYear: 'desc' },
    take: 100,
  });

  return candidates.filter((a) => {
    if (spotifyArtistId && a.artist.spotifyArtistId === spotifyArtistId) return true;
    if (artistId && a.artistId === artistId) return true;
    return artistNameMatches(a.artist.name, artistName);
  });
}

async function findListenedTracks(userId: string, artistName: string, artistId?: string | null) {
  const primaryName = artistName.split(/[,;&]/)[0].trim();
  const history = await prisma.playHistory.findMany({
    where: {
      userId,
      track: artistId
        ? {
            OR: [
              { artistId },
              { artist: { name: { contains: primaryName, mode: 'insensitive' } } },
            ],
          }
        : { artist: { name: { contains: primaryName, mode: 'insensitive' } } },
    },
    include: { track: { include: { artist: true, album: true } } },
    orderBy: { playedAt: 'desc' },
    take: 500,
  });

  const seen = new Set<string>();
  const tracks = [];
  for (const h of history) {
    if (seen.has(h.trackId)) continue;
    if (!artistNameMatches(h.track.artist.name, artistName)) continue;
    if (!isTrackPlayable(h.track)) continue;
    seen.add(h.trackId);
    tracks.push(h.track);
  }
  return tracks;
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

function normalizeTitleKey(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim();
}

function buildKnownTrackKeys(
  listened: ReturnType<typeof formatTrack>[],
  local: ReturnType<typeof formatTrack>[],
) {
  const titles = new Set<string>();
  const spotifyIds = new Set<string>();
  for (const t of [...listened, ...local]) {
    titles.add(normalizeTitleKey(t.title));
    if (t.sourceId) spotifyIds.add(t.sourceId);
  }
  return { titles, spotifyIds };
}

function isUnheardSpotifyTrack(
  track: SpotifySearchResult,
  known: { titles: Set<string>; spotifyIds: Set<string> },
): boolean {
  if (known.spotifyIds.has(track.id)) return false;
  return !known.titles.has(normalizeTitleKey(track.name));
}

async function buildArtistRecommendations(
  topTracks: SpotifySearchResult[],
  albums: SpotifyAlbumResult[],
  listened: ReturnType<typeof formatTrack>[],
  local: ReturnType<typeof formatTrack>[],
): Promise<SpotifySearchResult[]> {
  const known = buildKnownTrackKeys(listened, local);
  const out: SpotifySearchResult[] = [];
  const seen = new Set<string>();

  for (const t of topTracks) {
    if (!isUnheardSpotifyTrack(t, known) || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }

  const recentSingles = albums
    .filter((a) => a.albumType === 'single')
    .sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0))
    .slice(0, 3);

  for (const album of recentSingles) {
    const tracks = await withTimeout(fetchSpotifyAlbumTracks(album.id), 8000, []);
    for (const t of tracks) {
      if (!isUnheardSpotifyTrack(t, known) || seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
  }

  return out.slice(0, 20);
}

export async function buildArtistPageLocal(
  userId: string,
  artistName: string,
  artistId?: string | null,
  spotifyArtistIdHint?: string | null,
): Promise<ArtistPageLocal> {
  const { resolvedName, resolvedId, dbArtist } = await resolveArtist(artistName, artistId);
  const spotifyArtistId = spotifyArtistIdHint || dbArtist?.spotifyArtistId || null;

  const [localTrackRows, localAlbumRows, listenedRows] = await Promise.all([
    findLocalTracks(resolvedName, resolvedId),
    findLocalAlbums(resolvedName, resolvedId, spotifyArtistId),
    findListenedTracks(userId, resolvedName, resolvedId),
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
    recommendedTracks: [],
  };
}

function stubArtistFromLocal(
  name: string,
  spotifyArtistId: string,
  imageUrl?: string | null,
): SpotifyArtistResult {
  return {
    id: spotifyArtistId,
    name,
    imageUrl: imageUrl || '',
    followers: 0,
    genres: [],
    spotifyUrl: `https://open.spotify.com/artist/${spotifyArtistId}`,
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

  // Soft-fail while cooling down — caller will fill albums from local DB
  if (isSpotifyRateLimited()) {
    return {
      ...empty,
      artist: hints?.spotifyArtistId
        ? stubArtistFromLocal(artistName, hints.spotifyArtistId)
        : null,
      error: spotifyUnavailableMessage(),
    };
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
    }

    if (!spotifyArtist) {
      // Rate-limit / timeout often looks like "not found" — don't lie to the UI
      if (isSpotifyRateLimited() || hints?.spotifyArtistId) {
        return {
          ...empty,
          artist: hints?.spotifyArtistId
            ? stubArtistFromLocal(artistName, hints.spotifyArtistId)
            : null,
          error: spotifyUnavailableMessage(),
        };
      }
      resolveError = `Could not find artist "${artistName}" on Spotify`;
      return { ...empty, configured: true, error: resolveError };
    }

    const [topTracks, albums] = await Promise.all([
      withTimeout(fetchSpotifyArtistTopTracks(spotifyArtist.id), SPOTIFY_TIMEOUT_MS, []),
      withTimeout(fetchSpotifyArtistAlbums(spotifyArtist.id), SPOTIFY_TIMEOUT_MS, []),
    ]);

    void persistArtistSpotifyMeta(artistName, spotifyArtist, persistForArtistId);
    void persistAlbumStubs(spotifyArtist, albums.slice(0, MAX_SPOTIFY_ALBUMS));

    return {
      configured: true,
      artist: spotifyArtist,
      topTracks,
      albums: albums.slice(0, MAX_SPOTIFY_ALBUMS),
      ...(albums.length === 0 && isSpotifyRateLimited()
        ? { error: spotifyUnavailableMessage() }
        : {}),
    };
  } catch (err) {
    console.error('[Artist] Spotify fetch failed:', err);
    return {
      ...empty,
      artist: hints?.spotifyArtistId
        ? stubArtistFromLocal(artistName, hints.spotifyArtistId)
        : null,
      error: spotifyUnavailableMessage(),
    };
  }
}

/** Full artist page — refresh Spotify catalog, fall back to local albums if needed */
export async function buildArtistPage(
  userId: string,
  artistName: string,
  artistId?: string | null,
  hints?: { spotifyArtistId?: string | null; spotifyTrackId?: string | null },
): Promise<ArtistPageFull> {
  const localFirst = await buildArtistPageLocal(
    userId,
    artistName,
    artistId,
    hints?.spotifyArtistId,
  );

  const mergedHints = {
    spotifyArtistId: hints?.spotifyArtistId || localFirst.artist.spotifyArtistId,
    spotifyTrackId: hints?.spotifyTrackId,
  };

  const spotify = await fetchArtistSpotifyData(
    localFirst.artist.name,
    mergedHints,
    localFirst.artist.id,
  );

  // Re-load local after possible stub writes / with spotify id for broader album match
  const local = await buildArtistPageLocal(
    userId,
    artistName,
    artistId || localFirst.artist.id,
    mergedHints.spotifyArtistId || spotify.artist?.id,
  );

  let albums = spotify.albums;
  if (albums.length === 0 && local.localAlbums.length > 0) {
    albums = local.localAlbums.map((a) => ({
      id: a.spotifyAlbumId || a.id,
      name: a.title,
      imageUrl: a.coverUrl || '',
      releaseYear: a.releaseYear,
      totalTracks: a.trackCount,
      spotifyUrl: a.spotifyAlbumId
        ? `https://open.spotify.com/album/${a.spotifyAlbumId}`
        : '',
      albumType: 'album',
    }));
  }

  const spotifyMerged: ArtistSpotifyData = {
    ...spotify,
    albums,
    artist: spotify.artist
      || (mergedHints.spotifyArtistId
        ? stubArtistFromLocal(
            local.artist.name,
            mergedHints.spotifyArtistId,
            local.artist.imageUrl,
          )
        : null),
  };

  const imageUrl = local.artist.imageUrl || spotifyMerged.artist?.imageUrl || null;
  const spotifyArtistId = spotifyMerged.artist?.id || local.artist.spotifyArtistId;

  const recommendedTracks =
    !isSpotifyRateLimited()
    && (spotifyMerged.topTracks.length > 0 || spotify.albums.length > 0)
      ? await buildArtistRecommendations(
          spotifyMerged.topTracks,
          spotify.albums,
          local.listenedTracks,
          local.localTracks,
        )
      : [];

  return {
    ...local,
    artist: {
      ...local.artist,
      name: spotifyMerged.artist?.name || local.artist.name,
      imageUrl,
      spotifyArtistId,
    },
    spotify: spotifyMerged,
    recommendedTracks,
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
