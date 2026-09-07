import prisma from '../lib/prisma';
import { fetchSpotifyArtistById, searchSpotifyArtist, isSpotifyConfigured, isSpotifyRateLimited } from './spotifyApi';

export type ArtistImageRow = {
  id: string;
  name: string;
  imageUrl: string | null;
  spotifyArtistId?: string | null;
};

function itunesHiRes(url: string): string {
  return url
    .replace(/\/\d+x\d+bb\./, '/600x600bb.')
    .replace(/100x100bb/, '600x600bb')
    .replace(/60x60bb/, '600x600bb');
}

/** Free Deezer search — no API key; useful when Spotify quota is exhausted. */
async function fetchDeezerArtistImage(name: string): Promise<string | null> {
  try {
    const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=5`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'LlamaStream/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: Array<{ name?: string; picture_xl?: string; picture_medium?: string; picture?: string }>;
    };
    const want = name.toLowerCase().trim();
    const rows = data.data || [];
    const exact = rows.find((r) => (r.name || '').toLowerCase().trim() === want);
    const hit = exact || rows[0];
    return hit?.picture_xl || hit?.picture_medium || hit?.picture || null;
  } catch {
    return null;
  }
}

async function fetchItunesArtistImage(name: string): Promise<string | null> {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=5`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'LlamaStream/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: Array<{ artistName?: string; artworkUrl100?: string }>;
    };
    const want = name.toLowerCase().trim();
    const rows = data.results || [];
    const exact = rows.find((r) => (r.artistName || '').toLowerCase().trim() === want && r.artworkUrl100);
    const hit = exact || rows.find((r) => r.artworkUrl100);
    return hit?.artworkUrl100 ? itunesHiRes(hit.artworkUrl100) : null;
  } catch {
    return null;
  }
}

/** Last resort: reuse a track cover already stored for this artist. */
async function imageFromLocalTracks(artistId: string): Promise<string | null> {
  if (!artistId || artistId.startsWith('spotify-')) return null;
  try {
    const track = await prisma.track.findFirst({
      where: {
        artistId,
        thumbnailUrl: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
      select: { thumbnailUrl: true },
    });
    return track?.thumbnailUrl || null;
  } catch {
    return null;
  }
}

async function resolveArtistImageFallback(name: string, artistId: string): Promise<string | null> {
  const fromDeezer = await fetchDeezerArtistImage(name);
  if (fromDeezer) return fromDeezer;
  const fromItunes = await fetchItunesArtistImage(name);
  if (fromItunes) return fromItunes;
  return imageFromLocalTracks(artistId);
}

/**
 * Fill missing artist images (Spotify when available, else Deezer/iTunes/local tracks).
 * Caps work to avoid burning Spotify quota.
 */
export async function enrichArtistImages(
  artists: ArtistImageRow[],
  opts?: { maxLookups?: number },
): Promise<ArtistImageRow[]> {
  if (!artists.length) return artists;

  const maxLookups = opts?.maxLookups ?? 6;
  let lookups = 0;
  const out = artists.map((a) => ({ ...a }));
  const spotifyOk = isSpotifyConfigured() && !isSpotifyRateLimited();

  for (const artist of out) {
    if (lookups >= maxLookups) break;
    if (artist.imageUrl) continue;

    try {
      lookups++;
      let imageUrl: string | null = null;
      let spotifyArtistId = artist.spotifyArtistId || null;

      if (spotifyOk) {
        try {
          const sp = artist.spotifyArtistId
            ? await fetchSpotifyArtistById(artist.spotifyArtistId)
            : await searchSpotifyArtist(artist.name);
          if (sp?.imageUrl) {
            imageUrl = sp.imageUrl;
            spotifyArtistId = sp.id;
          }
        } catch (err) {
          console.error(`[ArtistImages] Spotify failed for "${artist.name}":`, err);
        }
      }

      if (!imageUrl) {
        imageUrl = await resolveArtistImageFallback(artist.name, artist.id);
      }

      if (!imageUrl) continue;

      artist.imageUrl = imageUrl;
      if (spotifyArtistId) artist.spotifyArtistId = spotifyArtistId;

      if (artist.id && !artist.id.startsWith('spotify-')) {
        await prisma.artist.update({
          where: { id: artist.id },
          data: {
            imageUrl,
            ...(spotifyArtistId ? { spotifyArtistId } : {}),
          },
        }).catch(() => null);
      }
    } catch (err) {
      console.error(`[ArtistImages] Failed for "${artist.name}":`, err);
    }
  }

  return out;
}
