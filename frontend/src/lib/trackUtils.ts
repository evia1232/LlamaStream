import { Track } from '../types';

/** Safely extract artist name — artist may be a string or { name: string } object. */
export function getArtistName(artist: { name?: string } | string | null | undefined): string {
  if (!artist) return '';
  if (typeof artist === 'string') return artist;
  return artist.name || '';
}

/** Normalize a track from any API shape into a consistent format. */
export function normalizeTrack(track: {
  id: string;
  title: string;
  duration?: number;
  thumbnailUrl?: string | null;
  isDownloaded?: boolean;
  streamUrl?: string | null;
  artist: { id?: string; name?: string } | string;
  album?: { id: string; title: string; coverUrl?: string | null } | null;
}): Track {
  const artistName = getArtistName(track.artist);
  const artistObj: Track['artist'] = typeof track.artist === 'object' && track.artist?.id
    ? { id: track.artist.id, name: track.artist.name || artistName }
    : { name: artistName };

  return {
    id: track.id,
    title: track.title,
    duration: track.duration || 0,
    thumbnailUrl: track.thumbnailUrl,
    isDownloaded: track.isDownloaded ?? !!track.streamUrl,
    streamUrl: track.streamUrl ?? null,
    artist: artistObj,
    album: track.album ?? null,
  };
}
