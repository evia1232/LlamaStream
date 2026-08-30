import prisma from '../lib/prisma';
import { getOrCreateTrackFromSearch } from './downloader';

// spotify-url-info exports a factory: require('spotify-url-info')(fetch)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const createSpotifyUrlInfo = require('spotify-url-info') as (fetchFn: typeof fetch) => {
  getTracks: (url: string, opts?: RequestInit) => Promise<Array<{
    name: string; artist: string; duration?: number;
  }>>;
};

const { getTracks } = createSpotifyUrlInfo(fetch);

export interface SpotifyTrackInfo {
  name: string;
  artist: string;
  album?: string;
  duration?: number;
}

export async function parseSpotifyPlaylist(url: string): Promise<{
  name: string;
  tracks: SpotifyTrackInfo[];
}> {
  const tracks = await getTracks(url);
  const parsed: SpotifyTrackInfo[] = tracks.map((t: { name: string; artist: string; album?: string; duration?: number }) => ({
    name: t.name,
    artist: t.artist,
    album: t.album,
    duration: t.duration,
  }));

  // Try to get playlist name from oEmbed
  let playlistName = 'Imported Playlist';
  try {
    const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    const res = await fetch(oembedUrl);
    if (res.ok) {
      const data = await res.json() as { title?: string };
      if (data.title) playlistName = data.title;
    }
  } catch {
    // use default name
  }

  return { name: playlistName, tracks: parsed };
}

export async function importSpotifyPlaylist(
  url: string,
  userId: string,
  quality: 'LOW' | 'NORMAL' | 'HIGH' = 'HIGH',
  onProgress?: (current: number, total: number, trackName: string) => void
) {
  const { name, tracks } = await parseSpotifyPlaylist(url);

  const playlist = await prisma.playlist.create({
    data: {
      name,
      description: `Imported from Spotify: ${url}`,
      userId,
      visibility: 'PRIVATE',
    },
  });

  let position = 0;
  const errors: string[] = [];

  for (const spotifyTrack of tracks) {
    try {
      const query = `${spotifyTrack.artist} - ${spotifyTrack.name}`;
      onProgress?.(position, tracks.length, spotifyTrack.name);

      const track = await getOrCreateTrackFromSearch(query, quality);

      await prisma.playlistTrack.create({
        data: {
          playlistId: playlist.id,
          trackId: track.id,
          position: position++,
        },
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
