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

/** Spotify /search limit max (API tightened from 50 → 10; values >10 return 400 Invalid limit). */
const SPOTIFY_SEARCH_MAX_LIMIT = 10;

function normalizeSpotifySearchLimit(limit: unknown): number {
  const n = typeof limit === 'number' ? limit : parseInt(String(limit ?? ''), 10);
  if (!Number.isFinite(n)) return SPOTIFY_SEARCH_MAX_LIMIT;
  return Math.min(SPOTIFY_SEARCH_MAX_LIMIT, Math.max(1, Math.floor(n)));
}

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
  limit: unknown,
  market?: string
): Promise<Response> {
  const safeLimit = normalizeSpotifySearchLimit(limit);
  const params = new URLSearchParams({
    q: query,
    type: 'track',
    limit: String(safeLimit),
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

export async function searchSpotifyTracks(query: string, limit = SPOTIFY_SEARCH_MAX_LIMIT): Promise<SpotifySearchResponse> {
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

function normalizeForSpotifyMatch(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

/** Look up canonical Spotify track metadata (title, artist, duration) for YouTube matching */
export async function lookupSpotifyTrack(
  artist: string,
  title: string
): Promise<SpotifySearchResult | null> {
  const primaryArtist = artist.split(/[,;&]| feat\.?| ft\.?| featuring /i)[0].trim();
  const queries = [
    `track:"${title.replace(/"/g, '')}" artist:"${primaryArtist.replace(/"/g, '')}"`,
    `${primaryArtist} ${title}`,
    title,
  ];

  const normTitle = normalizeForSpotifyMatch(title);
  let best: SpotifySearchResult | null = null;
  let bestScore = 0;

  for (const q of queries) {
    const { tracks } = await searchSpotifyTracks(q, 5);
    for (const t of tracks) {
      const tNorm = normalizeForSpotifyMatch(t.name);
      let score = 0;
      if (tNorm === normTitle) score += 50;
      else if (tNorm.includes(normTitle) || normTitle.includes(tNorm)) score += 35;
      else {
        const titleWords = normTitle.split(' ').filter((w) => w.length > 1);
        const matchWords = titleWords.filter((w) => tNorm.includes(w));
        score += Math.round((matchWords.length / Math.max(titleWords.length, 1)) * 25);
      }
      const artistNorm = normalizeForSpotifyMatch(primaryArtist);
      if (normalizeForSpotifyMatch(t.artist).includes(artistNorm) || artistNorm.includes(normalizeForSpotifyMatch(t.artist))) {
        score += 20;
      }
      if (t.duration > 0) score += 5;
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (bestScore >= 45) break;
  }

  return bestScore >= 25 ? best : null;
}

type SpotifyApiTrack = {
  id: string;
  name: string;
  duration_ms: number;
  external_urls: { spotify: string };
  album: { name: string; images: { url: string }[] };
  artists: { name: string }[];
};

function mapSpotifyApiTrack(t: SpotifyApiTrack): SpotifySearchResult {
  return {
    id: t.id,
    name: t.name,
    artist: t.artists.map((a) => a.name).join(', '),
    album: t.album.name,
    duration: Math.round(t.duration_ms / 1000),
    thumbnailUrl: t.album.images[0]?.url || '',
    spotifyUrl: t.external_urls.spotify,
    source: 'spotify',
  };
}

export function extractSpotifyTrackId(url: string): string | null {
  const match = url.match(/open\.spotify\.com\/track\/([a-zA-Z0-9]+)/i);
  return match?.[1] ?? null;
}

/** Fetch canonical metadata for a Spotify track URL (requires API credentials). */
export async function fetchSpotifyTrackByUrl(url: string): Promise<SpotifySearchResult | null> {
  if (!isSpotifyConfigured()) return null;
  const trackId = extractSpotifyTrackId(url);
  if (!trackId) return null;

  const { token } = await fetchSpotifyToken();
  if (!token) return null;

  try {
    const res = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json() as SpotifyApiTrack;
    return mapSpotifyApiTrack(data);
  } catch {
    return null;
  }
}

export interface SpotifyUrlParseResult {
  name: string;
  tracks: SpotifySearchResult[];
}

/** Resolve a Spotify track/album/playlist URL to tracks with spotifyUrl (API when configured). */
export async function fetchSpotifyUrlTracks(url: string): Promise<SpotifyUrlParseResult | null> {
  if (!isSpotifyConfigured()) return null;

  const { token } = await fetchSpotifyToken();
  if (!token) return null;

  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const trackMatch = url.match(/open\.spotify\.com\/track\/([a-zA-Z0-9]+)/i);
  const albumMatch = url.match(/open\.spotify\.com\/album\/([a-zA-Z0-9]+)/i);
  const playlistMatch = url.match(/open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/i);

  try {
    if (trackMatch) {
      const res = await fetch(`https://api.spotify.com/v1/tracks/${trackMatch[1]}`, { headers });
      if (!res.ok) return null;
      const data = await res.json() as SpotifyApiTrack;
      const track = mapSpotifyApiTrack(data);
      return { name: track.name, tracks: [track] };
    }

    if (albumMatch) {
      const albumRes = await fetch(`https://api.spotify.com/v1/albums/${albumMatch[1]}`, { headers });
      if (!albumRes.ok) return null;
      const album = await albumRes.json() as { name: string; tracks: { items: SpotifyApiTrack[] } };
      return {
        name: album.name,
        tracks: album.tracks.items.map(mapSpotifyApiTrack),
      };
    }

    if (playlistMatch) {
      const tracks: SpotifySearchResult[] = [];
      let nextUrl: string | null = `https://api.spotify.com/v1/playlists/${playlistMatch[1]}/tracks?limit=100`;
      let playlistName = 'Imported Playlist';

      const metaRes = await fetch(`https://api.spotify.com/v1/playlists/${playlistMatch[1]}?fields=name`, { headers });
      if (metaRes.ok) {
        const meta = await metaRes.json() as { name?: string };
        if (meta.name) playlistName = meta.name;
      }

      while (nextUrl) {
        const res = await fetch(nextUrl, { headers });
        if (!res.ok) break;
        const data = await res.json() as {
          items: Array<{ track: SpotifyApiTrack | null }>;
          next: string | null;
        };
        for (const item of data.items) {
          if (item.track?.id) tracks.push(mapSpotifyApiTrack(item.track));
        }
        nextUrl = data.next;
      }

      return tracks.length > 0 ? { name: playlistName, tracks } : null;
    }
  } catch (err) {
    console.error('[Spotify] URL fetch failed:', (err as Error).message);
  }

  return null;
}
