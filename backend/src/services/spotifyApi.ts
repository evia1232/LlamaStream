import { config } from '../config';

export interface SpotifySearchResponse {
  tracks: SpotifySearchResult[];
  error?: string;
  configured: boolean;
}

export interface SpotifySearchResult {
  id: string;
  name: string;
  artist: string;
  album?: string;
  duration: number;
  thumbnailUrl: string;
  spotifyUrl: string;
  source: 'spotify';
}

let tokenCache: { token: string; expiresAt: number } | null = null;

export function isSpotifyConfigured(): boolean {
  return !!(config.spotifyClientId && config.spotifyClientSecret);
}

export async function getSpotifyStatus(): Promise<{
  configured: boolean;
  connected: boolean;
  error?: string;
  market: string;
}> {
  if (!isSpotifyConfigured()) {
    return {
      configured: false,
      connected: false,
      error: 'SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET not set in .env',
      market: config.spotifyMarket,
    };
  }

  const tokenResult = await fetchSpotifyToken();
  return {
    configured: true,
    connected: !!tokenResult.token,
    error: tokenResult.error,
    market: config.spotifyMarket,
  };
}

async function fetchSpotifyToken(): Promise<{ token: string | null; error?: string }> {
  if (!isSpotifyConfigured()) {
    return { token: null, error: 'Spotify credentials not configured' };
  }

  if (tokenCache && Date.now() < tokenCache.expiresAt - 60000) {
    return { token: tokenCache.token };
  }

  const credentials = Buffer.from(
    `${config.spotifyClientId}:${config.spotifyClientSecret}`
  ).toString('base64');

  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('[Spotify] Token error:', res.status, body);
      return {
        token: null,
        error: `Spotify auth failed (${res.status}). Check Client ID & Secret in .env`,
      };
    }

    const data = await res.json() as { access_token: string; expires_in: number };
    tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return { token: data.access_token };
  } catch (err) {
    console.error('[Spotify] Token fetch error:', err);
    return { token: null, error: (err as Error).message };
  }
}

export async function searchSpotifyTracks(query: string, limit = 15): Promise<SpotifySearchResponse> {
  if (!isSpotifyConfigured()) {
    return {
      tracks: [],
      configured: false,
      error: 'Spotify API not configured. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to .env',
    };
  }

  const { token, error: tokenError } = await fetchSpotifyToken();
  if (!token) {
    return { tracks: [], configured: true, error: tokenError || 'Spotify authentication failed' };
  }

  const market = config.spotifyMarket;
  const url =
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}` +
    `&type=track&limit=${limit}&market=${market}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('[Spotify] Search error:', res.status, body);
      return {
        tracks: [],
        configured: true,
        error: `Spotify search failed (${res.status})`,
      };
    }

    const data = await res.json() as {
      tracks?: { items: Array<{
        id: string; name: string; duration_ms: number;
        external_urls: { spotify: string };
        album: { name: string; images: { url: string }[] };
        artists: { name: string }[];
      }> };
    };

    const tracks = (data.tracks?.items || []).map((t) => ({
      id: t.id,
      name: t.name,
      artist: t.artists.map((a) => a.name).join(', '),
      album: t.album.name,
      duration: Math.round(t.duration_ms / 1000),
      thumbnailUrl: t.album.images[0]?.url || '',
      spotifyUrl: t.external_urls.spotify,
      source: 'spotify' as const,
    }));

    return { tracks, configured: true };
  } catch (err) {
    return { tracks: [], configured: true, error: (err as Error).message };
  }
}
