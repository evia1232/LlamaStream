import prisma from '../lib/prisma';
import { config } from '../config';
import { resolveAndDownload } from './downloader';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const createSpotifyUrlInfo = require('spotify-url-info') as (fetchFn: typeof fetch) => {
  getTracks: (url: string, opts?: RequestInit) => Promise<Array<{
    name: string; artist: string; album?: string; duration?: number;
  }>>;
  getPreview: (url: string, opts?: RequestInit) => Promise<{
    title: string; artist: string; image?: string; type: string;
  }>;
};

const spotifyUrlInfo = createSpotifyUrlInfo(fetch);

export interface SpotifyTrackInfo {
  id: string;
  name: string;
  artist: string;
  album?: string;
  duration?: number;
  thumbnailUrl?: string;
  spotifyUrl?: string;
  source: 'spotify';
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

async function getSpotifyApiToken(): Promise<string | null> {
  if (!config.spotifyClientId || !config.spotifyClientSecret) return null;

  if (tokenCache && Date.now() < tokenCache.expiresAt - 60000) {
    return tokenCache.token;
  }

  const credentials = Buffer.from(`${config.spotifyClientId}:${config.spotifyClientSecret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) return null;

  const data = await res.json() as { access_token: string; expires_in: number };
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

export function isSpotifyUrl(input: string): boolean {
  return /open\.spotify\.com\/(track|album|playlist|artist|episode)/i.test(input);
}

export function isYouTubeUrl(input: string): boolean {
  return /youtube\.com|youtu\.be|music\.youtube\.com/i.test(input);
}

export async function searchSpotifyTracks(query: string, limit = 15): Promise<SpotifySearchResult[]> {
  const token = await getSpotifyApiToken();
  if (!token) return [];

  const res = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) return [];

  const data = await res.json() as {
    tracks?: { items: Array<{
      id: string; name: string; duration_ms: number;
      external_urls: { spotify: string };
      album: { name: string; images: { url: string }[] };
      artists: { name: string }[];
    }> };
  };

  return (data.tracks?.items || []).map((t) => ({
    id: t.id,
    name: t.name,
    artist: t.artists.map((a) => a.name).join(', '),
    album: t.album.name,
    duration: Math.round(t.duration_ms / 1000),
    thumbnailUrl: t.album.images[0]?.url || '',
    spotifyUrl: t.external_urls.spotify,
    source: 'spotify' as const,
  }));
}

export async function parseSpotifyUrl(url: string): Promise<{
  name: string;
  tracks: SpotifyTrackInfo[];
}> {
  const tracks = await spotifyUrlInfo.getTracks(url);
  const preview = await spotifyUrlInfo.getPreview(url).catch(() => null);

  const parsed: SpotifyTrackInfo[] = tracks.map((t, i) => ({
    id: `spotify-${i}-${t.name}`,
    name: t.name,
    artist: t.artist,
    album: t.album,
    duration: t.duration,
    source: 'spotify' as const,
  }));

  let playlistName = preview?.title || 'Imported Playlist';
  try {
    const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    const res = await fetch(oembedUrl);
    if (res.ok) {
      const data = await res.json() as { title?: string };
      if (data.title) playlistName = data.title;
    }
  } catch { /* ignore */ }

  return { name: playlistName, tracks: parsed };
}

export async function importSpotifyPlaylist(
  url: string,
  userId: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH' = 'HIGH',
  onProgress?: (current: number, total: number, trackName: string) => void
) {
  const { name, tracks } = await parseSpotifyUrl(url);

  const playlist = await prisma.playlist.create({
    data: { name, description: `Imported from Spotify: ${url}`, userId, visibility: 'PRIVATE' },
  });

  let position = 0;
  const errors: string[] = [];

  for (const spotifyTrack of tracks) {
    try {
      onProgress?.(position, tracks.length, spotifyTrack.name);
      const track = await resolveAndDownload(
        `${spotifyTrack.artist} - ${spotifyTrack.name}`,
        quality,
        { title: spotifyTrack.name, artist: spotifyTrack.artist }
      );

      await prisma.playlistTrack.create({
        data: { playlistId: playlist.id, trackId: track.id, position: position++ },
      });
    } catch (err) {
      errors.push(`${spotifyTrack.name}: ${(err as Error).message}`);
    }
  }

  return { playlist, imported: position, total: tracks.length, errors };
}

export async function exportPlaylist(playlistId: string, format: 'json' | 'm3u' | 'txt' = 'json') {
  const playlist = await prisma.playlist.findUnique({
    where: { id: playlistId },
    include: {
      tracks: {
        orderBy: { position: 'asc' },
        include: { track: { include: { artist: true } } },
      },
    },
  });

  if (!playlist) throw new Error('Playlist not found');

  const trackList = playlist.tracks.map((pt) => ({
    title: pt.track.title,
    artist: pt.track.artist.name,
    duration: pt.track.duration,
    sourceUrl: pt.track.sourceUrl,
  }));

  switch (format) {
    case 'm3u':
      return {
        content: '#EXTM3U\n' + trackList.map((t) => `#EXTINF:${t.duration},${t.artist} - ${t.title}\n${t.sourceUrl || ''}`).join('\n'),
        filename: `${playlist.name}.m3u`,
        contentType: 'audio/x-mpegurl',
      };
    case 'txt':
      return {
        content: trackList.map((t, i) => `${i + 1}. ${t.artist} - ${t.title}`).join('\n'),
        filename: `${playlist.name}.txt`,
        contentType: 'text/plain',
      };
    default:
      return {
        content: JSON.stringify({ name: playlist.name, description: playlist.description, tracks: trackList }, null, 2),
        filename: `${playlist.name}.json`,
        contentType: 'application/json',
      };
  }
}
