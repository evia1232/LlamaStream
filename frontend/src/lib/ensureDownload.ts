import api from '../api/client';
import { Track } from '../types';
import { normalizeTrack, getArtistName } from './trackUtils';

function isLibraryId(id: string): boolean {
  return !id.startsWith('external-') && !id.startsWith('discover-yt-');
}

/** Block until the track MP3 is fully downloaded on the server */
export async function ensureTrackDownloaded(track: Track): Promise<Track> {
  if (track.isDownloaded) return track;

  if (isLibraryId(track.id)) {
    const { data } = await api.post(`/tracks/${track.id}/download`);
    return normalizeTrack(data.track);
  }

  const artistName = getArtistName(track.artist);
  const payload = track.youtubeUrl
    ? {
        url: track.youtubeUrl,
        title: track.title,
        artist: artistName,
        duration: track.duration,
        album: track.album?.title,
      }
    : {
        query: `${artistName} - ${track.title}`,
        title: track.title,
        artist: artistName,
        duration: track.duration,
        album: track.album?.title,
      };

  const { data } = await api.post('/tracks/download', payload);
  return normalizeTrack(data.track);
}

/** Start background download without blocking playback */
export function prefetchTrack(track: Track): void {
  if (track.isDownloaded) return;

  if (isLibraryId(track.id)) {
    api.post(`/tracks/${track.id}/prefetch`).catch(() => { /* ignore */ });
    return;
  }

  if (track.youtubeUrl) {
    const artistName = getArtistName(track.artist);
    api.post('/tracks/prefetch', {
      url: track.youtubeUrl,
      title: track.title,
      artist: artistName,
      duration: track.duration,
    }).catch(() => { /* ignore */ });
  }
}

export function prefetchDiscoverNext(seedTrackId: string): void {
  api.get('/discover/prefetch', { params: { seedTrackId } }).catch(() => { /* ignore */ });
}
