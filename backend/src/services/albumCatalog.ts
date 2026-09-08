import prisma from '../lib/prisma';
import { trackStreamUrl, isDownloadInProgress } from './trackDownload';
import { effectiveDownloadedFlag } from './trackIntegrity';
import { cacheRemoteImage } from './mediaCache';
import {
  isSpotifyConfigured,
  isSpotifyRateLimited,
  fetchSpotifyAlbumDetails,
  SpotifySearchResult,
} from './spotifyApi';

function formatLibraryTrack(track: {
  id: string;
  title: string;
  duration: number;
  thumbnailUrl: string | null;
  sourceUrl: string | null;
  sourceId: string | null;
  spotifyTrackId?: string | null;
  quality: string;
  isDownloaded: boolean;
  filePath?: string | null;
  artist: { id: string; name: string; imageUrl: string | null; spotifyArtistId?: string | null };
  album?: { id: string; title: string; coverUrl: string | null } | null;
}) {
  const forIntegrity = { isDownloaded: track.isDownloaded, filePath: track.filePath ?? null };
  return {
    id: track.id,
    title: track.title,
    duration: track.duration,
    thumbnailUrl: track.thumbnailUrl,
    sourceUrl: track.sourceUrl,
    sourceId: track.sourceId,
    spotifyTrackId: track.spotifyTrackId ?? undefined,
    quality: track.quality,
    isDownloaded: effectiveDownloadedFlag(forIntegrity),
    isDownloading: !effectiveDownloadedFlag(forIntegrity) && !!track.sourceUrl && isDownloadInProgress(track.id),
    artist: track.artist,
    album: track.album || null,
    streamUrl: trackStreamUrl({
      id: track.id,
      isDownloaded: effectiveDownloadedFlag(forIntegrity),
      sourceUrl: track.sourceUrl,
      title: track.title,
      artist: track.artist,
    }),
    spotifyUrl: track.spotifyTrackId
      ? `https://open.spotify.com/track/${track.spotifyTrackId}`
      : undefined,
    source: track.sourceUrl ? 'library' : 'spotify',
  };
}

export async function upsertArtistLocal(opts: {
  name: string;
  spotifyArtistId?: string | null;
  imageUrl?: string | null;
}) {
  const name = opts.name.trim();
  if (!name) throw new Error('Artist name required');

  const localImage = opts.imageUrl
    ? await cacheRemoteImage(opts.imageUrl, `artist:${opts.spotifyArtistId || name}`)
    : null;

  if (opts.spotifyArtistId) {
    const bySp = await prisma.artist.findFirst({ where: { spotifyArtistId: opts.spotifyArtistId } });
    if (bySp) {
      return prisma.artist.update({
        where: { id: bySp.id },
        data: {
          imageUrl: localImage || bySp.imageUrl,
        },
      });
    }
  }

  const existing = await prisma.artist.findUnique({ where: { name } });
  if (existing) {
    return prisma.artist.update({
      where: { id: existing.id },
      data: {
        ...(opts.spotifyArtistId && !existing.spotifyArtistId
          ? { spotifyArtistId: opts.spotifyArtistId }
          : {}),
        imageUrl: localImage || existing.imageUrl,
      },
    });
  }

  return prisma.artist.create({
    data: {
      name,
      spotifyArtistId: opts.spotifyArtistId || undefined,
      imageUrl: localImage,
    },
  });
}

export async function upsertAlbumLocal(opts: {
  title: string;
  artistId: string;
  coverUrl?: string | null;
  releaseYear?: number | null;
  spotifyAlbumId?: string | null;
}) {
  const title = opts.title.trim();
  const localCover = opts.coverUrl
    ? await cacheRemoteImage(opts.coverUrl, `album:${opts.spotifyAlbumId || title}`)
    : null;

  if (opts.spotifyAlbumId) {
    const bySp = await prisma.album.findFirst({ where: { spotifyAlbumId: opts.spotifyAlbumId } });
    if (bySp) {
      return prisma.album.update({
        where: { id: bySp.id },
        data: {
          coverUrl: localCover || bySp.coverUrl,
          releaseYear: opts.releaseYear ?? bySp.releaseYear,
          title: bySp.title || title,
        },
      });
    }
  }

  const existing = await prisma.album.findUnique({
    where: { title_artistId: { title, artistId: opts.artistId } },
  });
  if (existing) {
    return prisma.album.update({
      where: { id: existing.id },
      data: {
        coverUrl: localCover || existing.coverUrl,
        releaseYear: opts.releaseYear ?? existing.releaseYear,
        ...(opts.spotifyAlbumId && !existing.spotifyAlbumId
          ? { spotifyAlbumId: opts.spotifyAlbumId }
          : {}),
      },
    });
  }

  return prisma.album.create({
    data: {
      title,
      artistId: opts.artistId,
      coverUrl: localCover,
      releaseYear: opts.releaseYear ?? undefined,
      spotifyAlbumId: opts.spotifyAlbumId || undefined,
    },
  });
}

/** Persist a Spotify catalog track locally (metadata only — audio resolved on play). */
export async function upsertCatalogTrack(opts: {
  title: string;
  artistId: string;
  albumId?: string | null;
  duration?: number;
  thumbnailUrl?: string | null;
  spotifyTrackId?: string | null;
  spotifyUrl?: string | null;
}) {
  const thumb = opts.thumbnailUrl
    ? await cacheRemoteImage(opts.thumbnailUrl, `track:${opts.spotifyTrackId || opts.title}`)
    : null;

  if (opts.spotifyTrackId) {
    const bySp = await prisma.track.findFirst({
      where: { spotifyTrackId: opts.spotifyTrackId },
      include: { artist: true, album: true },
    });
    if (bySp) {
      return prisma.track.update({
        where: { id: bySp.id },
        data: {
          albumId: opts.albumId || bySp.albumId,
          thumbnailUrl: thumb || bySp.thumbnailUrl,
          duration: opts.duration && opts.duration > 0 ? opts.duration : bySp.duration,
        },
        include: { artist: true, album: true },
      });
    }
  }

  const existing = await prisma.track.findFirst({
    where: {
      title: opts.title,
      artistId: opts.artistId,
      ...(opts.albumId ? { albumId: opts.albumId } : {}),
    },
    include: { artist: true, album: true },
  });
  if (existing) {
    return prisma.track.update({
      where: { id: existing.id },
      data: {
        spotifyTrackId: opts.spotifyTrackId || existing.spotifyTrackId,
        albumId: opts.albumId || existing.albumId,
        thumbnailUrl: thumb || existing.thumbnailUrl,
        duration: opts.duration && opts.duration > 0 ? opts.duration : existing.duration,
      },
      include: { artist: true, album: true },
    });
  }

  return prisma.track.create({
    data: {
      title: opts.title,
      artistId: opts.artistId,
      albumId: opts.albumId || undefined,
      duration: opts.duration || 0,
      thumbnailUrl: thumb,
      spotifyTrackId: opts.spotifyTrackId || undefined,
      isDownloaded: false,
      storageTier: 'CACHE',
    },
    include: { artist: true, album: true },
  });
}

export async function getLocalAlbumPage(albumId: string) {
  const album = await prisma.album.findUnique({
    where: { id: albumId },
    include: {
      artist: true,
      tracks: {
        include: { artist: true, album: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!album) return null;

  return {
    album: {
      id: album.id,
      title: album.title,
      coverUrl: album.coverUrl,
      releaseYear: album.releaseYear,
      spotifyAlbumId: album.spotifyAlbumId,
      artist: {
        id: album.artist.id,
        name: album.artist.name,
        imageUrl: album.artist.imageUrl,
        spotifyArtistId: album.artist.spotifyArtistId,
      },
      trackCount: album.tracks.length,
    },
    tracks: album.tracks.map(formatLibraryTrack),
  };
}

/**
 * Load Spotify album into local DB (artist + album + track metadata + cached images),
 * then return an in-app album page payload.
 */
export async function openSpotifyAlbumInApp(spotifyAlbumId: string) {
  if (!isSpotifyConfigured()) throw new Error('Spotify is not configured');
  if (isSpotifyRateLimited()) {
    // Fall back to whatever we already cached locally
    const cached = await prisma.album.findFirst({
      where: { spotifyAlbumId },
      select: { id: true },
    });
    if (cached) return getLocalAlbumPage(cached.id);
    throw new Error('Spotify rate-limited — open this album again later');
  }

  const details = await fetchSpotifyAlbumDetails(spotifyAlbumId);
  if (!details) throw new Error('Album not found on Spotify');

  const artist = await upsertArtistLocal({
    name: details.artistName,
    spotifyArtistId: details.spotifyArtistId,
    imageUrl: details.artistImageUrl,
  });

  const album = await upsertAlbumLocal({
    title: details.name,
    artistId: artist.id,
    coverUrl: details.imageUrl,
    releaseYear: details.releaseYear,
    spotifyAlbumId: details.id,
  });

  for (const t of details.tracks) {
    const trackArtist = t.artist && t.artist !== details.artistName
      ? await upsertArtistLocal({
          name: t.artist.split(',')[0].trim() || details.artistName,
          spotifyArtistId: t.primaryArtistId,
        })
      : artist;

    await upsertCatalogTrack({
      title: t.name,
      artistId: trackArtist.id,
      albumId: album.id,
      duration: t.duration,
      thumbnailUrl: t.thumbnailUrl || details.imageUrl,
      spotifyTrackId: t.id,
      spotifyUrl: t.spotifyUrl,
    });
  }

  return getLocalAlbumPage(album.id);
}

export type { SpotifySearchResult };
