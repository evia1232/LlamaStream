import { Track } from '../types';

/** Safely extract artist name — artist may be a string or { name: string } object. */
export function getArtistName(artist: { name?: string } | string | null | undefined): string {
  if (!artist) return '';
  if (typeof artist === 'string') return artist;
  return artist.name || '';
}

/** Best available cover art for a track row. */
export function getTrackImageUrl(track: {
  thumbnailUrl?: string | null;
  album?: { coverUrl?: string | null } | null;
}): string | null {
  return track.thumbnailUrl || track.album?.coverUrl || null;
}

/** Build a pseudo-track for search/external results (right-click menu + download). */
export function externalTrack(
  id: string,
  title: string,
  artist: string,
  duration: number,
  thumbnailUrl?: string | null,
  album?: string,
  opts?: { youtubeUrl?: string; spotifyUrl?: string }
): Track {
  return {
    id: `external-${id}`,
    title,
    duration,
    thumbnailUrl: thumbnailUrl || null,
    isDownloaded: false,
    artist: { name: artist },
    album: album ? { id: '', title: album } : null,
    youtubeUrl: opts?.youtubeUrl,
    spotifyUrl: opts?.spotifyUrl,
    source: opts?.spotifyUrl ? 'spotify' : opts?.youtubeUrl ? 'youtube' : undefined,
  };
}

/** Normalize a track from any API shape into a consistent format. */
export function normalizeTrack(track: {
  id: string;
  title: string;
  duration?: number;
  thumbnailUrl?: string | null;
  isDownloaded?: boolean;
  isDownloading?: boolean;
  streamUrl?: string | null;
  source?: 'library' | 'youtube' | 'spotify';
  youtubeUrl?: string;
  spotifyUrl?: string;
  quality?: 'LOW' | 'NORMAL' | 'HIGH';
  artist: { id?: string; name?: string } | string;
  album?: { id: string; title: string; coverUrl?: string | null } | null;
}): Track {
  const artistName = getArtistName(track.artist);
  const artistObj: Track['artist'] = typeof track.artist === 'object' && track.artist?.id
    ? { id: track.artist.id, name: track.artist.name || artistName }
    : { name: artistName };

  const thumbnailUrl = track.thumbnailUrl || track.album?.coverUrl || null;

  return {
    id: track.id,
    title: track.title,
    duration: track.duration || 0,
    thumbnailUrl,
    isDownloaded: !!track.isDownloaded,
    isDownloading: track.isDownloading ?? false,
    streamUrl: track.streamUrl ?? null,
    artist: artistObj,
    album: track.album ?? null,
    source: track.source,
    youtubeUrl: track.youtubeUrl,
    spotifyUrl: track.spotifyUrl,
    quality: track.quality as Track['quality'],
  };
}
