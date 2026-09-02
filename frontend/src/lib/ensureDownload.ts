import api from '../api/client';
import { Track } from '../types';
import { normalizeTrack, getArtistName } from './trackUtils';

function isLibraryId(id: string): boolean {
  return !id.startsWith('external-') && !id.startsWith('discover-yt-');
}

export { isLibraryId };

/** Register track in library without waiting for download (starts prefetch). */
export async function registerTrackInLibrary(track: Track): Promise<Track> {
  if (isLibraryId(track.id)) {
    if (!track.isDownloaded) prefetchTrack(track);
    return track;
  }

  const artistName = getArtistName(track.artist);
  const payload = track.youtubeUrl
    ? {
        url: track.youtubeUrl,
        title: track.title,
        artist: artistName,
        duration: track.duration,
      }
    : {
        spotifyUrl: track.spotifyUrl,
        title: track.title,
        artist: artistName,
        duration: track.duration,
        album: track.album?.title,
      };

  const { data } = await api.post('/tracks/prefetch', payload);
  const { data: trackData } = await api.get(`/tracks/${data.trackId}`);
  return normalizeTrack(trackData.track);
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
        spotifyUrl: track.spotifyUrl,
        title: track.title,
        artist: artistName,
        duration: track.duration,
        album: track.album?.title,
      };

  const { data } = await api.post('/tracks/download', payload);
  return normalizeTrack(data.track);
}

/** Resolve source and return a streamable library track without waiting for full download. */
export async function prepareTrackForPlayback(track: Track): Promise<Track> {
  if (track.isDownloaded || track.streamUrl) return track;

  if (isLibraryId(track.id)) {
    await api.post(`/tracks/${track.id}/prefetch`).catch(() => { /* ignore */ });
    const { data } = await api.get(`/tracks/${track.id}`);
    const ready = normalizeTrack(data.track);
    if (ready.streamUrl || ready.isDownloaded) return ready;
    throw new Error('Track not ready for playback');
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
        spotifyUrl: track.spotifyUrl,
        title: track.title,
        artist: artistName,
        duration: track.duration,
        album: track.album?.title,
      };

  const { data } = await api.post('/tracks/prepare-playback', payload);
  return normalizeTrack(data.track);
}

export function canStreamTrackLocally(track: Track | null | undefined): boolean {
  if (!track) return false;
  return !!(track.streamUrl || track.isDownloaded);
}

/** Start background download without blocking playback */
export function prefetchTrack(track: Track): void {
  if (track.isDownloaded) return;

  if (isLibraryId(track.id)) {
    api.post(`/tracks/${track.id}/prefetch`).catch(() => { /* ignore */ });
    return;
  }

  const artistName = getArtistName(track.artist);
  if (track.youtubeUrl) {
    api.post('/tracks/prefetch', {
      url: track.youtubeUrl,
      title: track.title,
      artist: artistName,
      duration: track.duration,
    }).catch(() => { /* ignore */ });
    return;
  }

  if (track.spotifyUrl) {
    api.post('/tracks/prefetch', {
      spotifyUrl: track.spotifyUrl,
      title: track.title,
      artist: artistName,
      duration: track.duration,
      album: track.album?.title,
    }).catch(() => { /* ignore */ });
  }
}

export function prefetchDiscoverNext(seedTrackId: string): void {
  api.get('/discover/prefetch', { params: { seedTrackId } }).catch(() => { /* ignore */ });
}
