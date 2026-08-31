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

function sanitizeSpotifyQuery(query: string): string {
  // Spotify rejects queries over ~250 chars (400)
  return query.trim().replace(/\s+/g, ' ').slice(0, 250);
}

function normalizeMarket(market: string): string | null {
  const code = market.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

async function requestSpotifySearch(
  token: string,
  query: string,
  limit: number,
  market?: string
): Promise<Response> {
  const params = new URLSearchParams({
    q: query,
    type: 'track',
    limit: String(Math.min(50, Math.max(1, limit))),
  });
  if (market) params.set('market', market);

  return fetch(`https://api.spotify.com/v1/search?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
}

function parseSpotifyErrorBody(body: string): string | undefined {
  try {
    const data = JSON.parse(body) as { error?: { message?: string } };
    return data.error?.message;
  } catch {
    return undefined;
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

  const cleaned = sanitizeSpotifyQuery(query);
  if (!cleaned) {
    return { tracks: [], configured: true };
  }

  const { token, error: tokenError } = await fetchSpotifyToken();
  if (!token) {
    return { tracks: [], configured: true, error: tokenError || 'Spotify authentication failed' };
  }

  const primaryMarket = normalizeMarket(config.spotifyMarket);
  const fallbacks = [
    primaryMarket,
    primaryMarket && primaryMarket !== 'US' ? 'US' : null,
    null, // no market — last resort
  ].filter((m, i, arr) => m !== undefined && arr.indexOf(m) === i) as (string | null)[];

  try {
    let lastStatus = 0;
    let lastDetail: string | undefined;

    for (const market of fallbacks) {
      const res = await requestSpotifySearch(token, cleaned, limit, market || undefined);
      if (res.ok) {
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
      }

      const body = await res.text();
      lastStatus = res.status;
      lastDetail = parseSpotifyErrorBody(body);
      console.error('[Spotify] Search error:', res.status, market ? `market=${market}` : 'no market', body);

      // Only retry on client/request errors
      if (res.status !== 400 && res.status !== 404) break;
    }

    return {
      tracks: [],
      configured: true,
      error: lastDetail
        ? `Spotify search failed (${lastStatus}): ${lastDetail}`
        : `Spotify search failed (${lastStatus})`,
    };
  } catch (err) {
    return { tracks: [], configured: true, error: (err as Error).message };
  }
}
