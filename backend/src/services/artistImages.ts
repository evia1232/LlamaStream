import prisma from '../lib/prisma';
import { fetchSpotifyArtistById, searchSpotifyArtist, isSpotifyConfigured, isSpotifyRateLimited } from './spotifyApi';

export type ArtistImageRow = {
  id: string;
  name: string;
  imageUrl: string | null;
  spotifyArtistId?: string | null;
};

/**
 * Fill missing artist images from Spotify (and persist for local DB artists).
 * Caps work to avoid re-arming Spotify quota.
 */
export async function enrichArtistImages(
  artists: ArtistImageRow[],
  opts?: { maxLookups?: number },
): Promise<ArtistImageRow[]> {
  if (!artists.length || !isSpotifyConfigured() || isSpotifyRateLimited()) {
    return artists;
  }

  const maxLookups = opts?.maxLookups ?? 6;
  let lookups = 0;
  const out = artists.map((a) => ({ ...a }));

  for (const artist of out) {
    if (lookups >= maxLookups) break;
    if (artist.imageUrl) continue;
    if (isSpotifyRateLimited()) break;

    try {
      lookups++;
      const sp = artist.spotifyArtistId
        ? await fetchSpotifyArtistById(artist.spotifyArtistId)
        : await searchSpotifyArtist(artist.name);
      if (!sp?.imageUrl) continue;

      artist.imageUrl = sp.imageUrl;
      artist.spotifyArtistId = sp.id;

      if (artist.id && !artist.id.startsWith('spotify-')) {
        await prisma.artist.update({
          where: { id: artist.id },
          data: {
            imageUrl: sp.imageUrl,
            spotifyArtistId: sp.id,
          },
        }).catch(() => null);
      }
    } catch (err) {
      console.error(`[ArtistImages] Failed for "${artist.name}":`, err);
    }
  }

  return out;
}
