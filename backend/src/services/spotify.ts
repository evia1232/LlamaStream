import prisma from '../lib/prisma';
import { resolveAndDownload } from './downloader';
import { addTrackToPlaylist } from '../lib/playlistTracks';
import {
  fetchSpotifyUrlTracks,
  extractSpotifyTrackId,
  searchSpotifyTracks,
  getSpotifyStatus,
  isSpotifyConfigured,
  type SpotifySearchResult,
  type SpotifySearchResponse,
} from './spotifyApi';

export {
  searchSpotifyTracks,
  getSpotifyStatus,
  isSpotifyConfigured,
  fetchSpotifyTrackByUrl,
  fetchSpotifyUrlTracks,
  type SpotifySearchResult,
  type SpotifySearchResponse,
  type SpotifyUrlParseResult,
} from './spotifyApi';

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

export function isSpotifyUrl(input: string): boolean {
  return /open\.spotify\.com\/(track|album|playlist|artist|episode)/i.test(input);
}

export function isYouTubeUrl(input: string): boolean {
  return /youtube\.com|youtu\.be|music\.youtube\.com/i.test(input);
}

export async function parseSpotifyUrl(url: string): Promise<{
  name: string;
  tracks: SpotifyTrackInfo[];
}> {
  const apiResult = await fetchSpotifyUrlTracks(url);
  if (apiResult && apiResult.tracks.length > 0) {
    return {
      name: apiResult.name,
      tracks: apiResult.tracks.map((t) => ({
        id: t.id,
        name: t.name,
        artist: t.artist,
        album: t.album,
        duration: t.duration,
        thumbnailUrl: t.thumbnailUrl,
        spotifyUrl: t.spotifyUrl,
        source: 'spotify' as const,
      })),
    };
  }

  const tracks = await spotifyUrlInfo.getTracks(url);
  const preview = await spotifyUrlInfo.getPreview(url).catch(() => null);

  const parsed: SpotifyTrackInfo[] = tracks.map((t, i) => {
    const trackId = extractSpotifyTrackId(url);
    return {
      id: `spotify-${i}-${t.name}`,
      name: t.name,
      artist: t.artist,
      album: t.album,
      duration: t.duration,
      spotifyUrl: trackId ? `https://open.spotify.com/track/${trackId}` : undefined,
      source: 'spotify' as const,
    };
  });

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
  let imported = 0;
  const errors: string[] = [];
  const skipped: string[] = [];

  for (const spotifyTrack of tracks) {
    try {
      onProgress?.(position, tracks.length, spotifyTrack.name);
      const track = await resolveAndDownload(
        `${spotifyTrack.artist} - ${spotifyTrack.name}`,
        quality,
        {
          title: spotifyTrack.name,
          artist: spotifyTrack.artist,
          duration: spotifyTrack.duration,
          album: spotifyTrack.album,
          spotifyUrl: spotifyTrack.spotifyUrl,
        }
      );

      const { added } = await addTrackToPlaylist(playlist.id, track.id, position);
      if (added) imported++;
      else skipped.push(spotifyTrack.name);

      position++;
    } catch (err) {
      errors.push(`${spotifyTrack.name}: ${(err as Error).message}`);
      position++;
    }
  }

  return { playlist, imported, skipped: skipped.length, total: tracks.length, errors };
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
