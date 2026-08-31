import { config } from '../config';
import { splitArtistNames } from '../lib/artistMatch';

export interface SpotifySearchResponse {
  tracks: SpotifySearchResult[];
  error?: string;
  configured: boolean;
}

export interface SpotifySearchResult {
  id: string;
  name: string;
  artist: string;
  primaryArtistId?: string;
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
            artists: { id: string; name: string }[];
          }> };
        };

        const tracks = (data.tracks?.items || []).map((t) => ({
          id: t.id,
          name: t.name,
          artist: t.artists.map((a) => a.name).join(', '),
          primaryArtistId: t.artists[0]?.id,
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
  artists: { id: string; name: string }[];
};

function mapSpotifyApiTrack(t: SpotifyApiTrack): SpotifySearchResult {
  return {
    id: t.id,
    name: t.name,
    artist: t.artists.map((a) => a.name).join(', '),
    primaryArtistId: t.artists[0]?.id,
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

export interface SpotifyArtistResult {
  id: string;
  name: string;
  imageUrl: string;
  followers: number;
  genres: string[];
  spotifyUrl: string;
}

export interface SpotifyAlbumResult {
  id: string;
  name: string;
  imageUrl: string;
  releaseYear: number | null;
  totalTracks: number;
  spotifyUrl: string;
  albumType: string;
}

async function spotifyGet<T>(path: string): Promise<T | null> {
  if (!isSpotifyConfigured()) return null;
  const { token } = await fetchSpotifyToken();
  if (!token) return null;

  try {
    const res = await fetch(`https://api.spotify.com/v1${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

function primaryArtistName(name: string): string {
  const parts = splitArtistNames(name);
  return parts[0]?.trim() || name.trim();
}

/** Resolve artist via track search — same API path as main search (most reliable). */
async function resolveSpotifyArtistViaTrackSearch(artistName: string): Promise<SpotifyArtistResult | null> {
  const cleaned = sanitizeSpotifyQuery(artistName);
  if (!cleaned) return null;

  const qNorm = normalizeForSpotifyMatch(cleaned);
  const queries = [`artist:"${cleaned.replace(/"/g, '')}"`, cleaned];

  for (const q of queries) {
    const { tracks } = await searchSpotifyTracks(q, 10);
    if (tracks.length === 0) continue;

    for (const t of tracks) {
      if (!t.primaryArtistId) continue;
      const primaryName = normalizeForSpotifyMatch(t.artist.split(',')[0].trim());
      if (primaryName === qNorm || primaryName.includes(qNorm) || qNorm.includes(primaryName)) {
        const artist = await fetchSpotifyArtistById(t.primaryArtistId);
        if (artist) return artist;
      }
    }

    if (q.startsWith('artist:"') && tracks[0]?.primaryArtistId) {
      const artist = await fetchSpotifyArtistById(tracks[0].primaryArtistId);
      if (artist) return artist;
    }
  }

  return null;
}

/** Find the best-matching Spotify artist for a name. */
export async function searchSpotifyArtist(query: string): Promise<SpotifyArtistResult | null> {
  if (!isSpotifyConfigured()) return null;

  const candidates = [
    query.trim(),
    primaryArtistName(query),
    ...splitArtistNames(query),
  ].filter((n, i, arr) => n && arr.indexOf(n) === i);

  for (const candidate of candidates) {
    const viaTracks = await resolveSpotifyArtistViaTrackSearch(candidate);
    if (viaTracks) return viaTracks;
  }

  for (const candidate of candidates) {
    const result = await searchSpotifyArtistOnce(candidate);
    if (result) return result;
  }

  return null;
}

async function searchSpotifyArtistOnce(query: string): Promise<SpotifyArtistResult | null> {
  const cleaned = sanitizeSpotifyQuery(query);
  if (!cleaned) return null;

  const { token } = await fetchSpotifyToken();
  if (!token) return null;

  const primaryMarket = normalizeMarket(config.spotifyMarket);
  const markets = [primaryMarket, primaryMarket !== 'US' ? 'US' : null, null].filter(
    (m, i, arr) => m !== undefined && arr.indexOf(m) === i,
  ) as (string | null)[];

  const qNorm = normalizeForSpotifyMatch(cleaned);
  let best: SpotifyArtistResult | null = null;
  let bestScore = 0;

  const queries = [`artist:"${cleaned.replace(/"/g, '')}"`, cleaned];

  for (const searchQ of queries) {
    for (const market of markets) {
      const params = new URLSearchParams({ q: searchQ, type: 'artist', limit: '10' });
      if (market) params.set('market', market);

      const res = await fetch(`https://api.spotify.com/v1/search?${params}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (!res.ok) continue;

      const data = await res.json() as {
        artists?: { items: Array<{
          id: string;
          name: string;
          followers: { total: number };
          genres: string[];
          external_urls: { spotify: string };
          images: { url: string }[];
        }> };
      };

      const items = data.artists?.items || [];

      if (searchQ.startsWith('artist:"') && items.length > 0) {
        const a = items[0];
        return {
          id: a.id,
          name: a.name,
          imageUrl: a.images[0]?.url || '',
          followers: a.followers.total,
          genres: a.genres,
          spotifyUrl: a.external_urls.spotify,
        };
      }

      for (const a of items) {
        const aNorm = normalizeForSpotifyMatch(a.name);
        let score = 0;
        if (aNorm === qNorm) score += 50;
        else if (aNorm.includes(qNorm) || qNorm.includes(aNorm)) score += 35;
        else {
          const words = qNorm.split(' ').filter((w) => w.length > 1);
          const matched = words.filter((w) => aNorm.includes(w));
          score += Math.round((matched.length / Math.max(words.length, 1)) * 25);
        }
        if (a.followers.total > 1000) score += 5;
        if (score > bestScore) {
          bestScore = score;
          best = {
            id: a.id,
            name: a.name,
            imageUrl: a.images[0]?.url || '',
            followers: a.followers.total,
            genres: a.genres,
            spotifyUrl: a.external_urls.spotify,
          };
        }
      }
      if (bestScore >= 45) break;
    }
    if (bestScore >= 45) break;
  }

  return bestScore >= 5 ? best : (bestScore > 0 ? best : null);
}

export async function fetchSpotifyArtistById(artistId: string): Promise<SpotifyArtistResult | null> {
  const data = await spotifyGet<{
    id: string;
    name: string;
    followers: { total: number };
    genres: string[];
    external_urls: { spotify: string };
    images: { url: string }[];
  }>(`/artists/${artistId}`);
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    imageUrl: data.images[0]?.url || '',
    followers: data.followers.total,
    genres: data.genres,
    spotifyUrl: data.external_urls.spotify,
  };
}

export async function resolveSpotifyArtistIdFromTrack(trackId: string): Promise<string | null> {
  const data = await spotifyGet<{ artists: { id: string }[] }>(`/tracks/${trackId}`);
  return data?.artists?.[0]?.id ?? null;
}

export async function fetchSpotifyArtistTopTracks(artistId: string): Promise<SpotifySearchResult[]> {
  const market = normalizeMarket(config.spotifyMarket) || 'US';
  const data = await spotifyGet<{ tracks: SpotifyApiTrack[] }>(
    `/artists/${artistId}/top-tracks?market=${market}`,
  );
  return (data?.tracks || []).map(mapSpotifyApiTrack);
}

export async function fetchSpotifyArtistAlbums(artistId: string): Promise<SpotifyAlbumResult[]> {
  const seen = new Set<string>();
  const albums: SpotifyAlbumResult[] = [];

  const data = await spotifyGet<{
    items: Array<{
      id: string;
      name: string;
      album_type: string;
      total_tracks: number;
      release_date: string;
      external_urls: { spotify: string };
      images: { url: string }[];
    }>;
  }>(`/artists/${artistId}/albums?include_groups=album,single&limit=50`);

  if (!data?.items?.length) return albums;

  for (const a of data.items) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    albums.push({
      id: a.id,
      name: a.name,
      imageUrl: a.images[0]?.url || '',
      releaseYear: a.release_date ? parseInt(a.release_date.slice(0, 4), 10) || null : null,
      totalTracks: a.total_tracks,
      spotifyUrl: a.external_urls.spotify,
      albumType: a.album_type,
    });
  }

  return albums;
}

