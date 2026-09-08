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
  if (data.track) return normalizeTrack(data.track);
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
  // Already on disk — play immediately
  if (isLibraryId(track.id) && track.isDownloaded) {
    return { ...track, streamUrl: track.streamUrl || optimisticStreamUrl(track) };
  }

  // Library track with known YouTube source — stream + background download
  if (isLibraryId(track.id) && track.sourceUrl) {
    void api.post(`/tracks/${track.id}/prefetch`).catch(() => { /* ignore */ });
    return { ...track, streamUrl: track.streamUrl || optimisticStreamUrl(track) };
  }

  // Catalog-only library track (e.g. album page) — sync-resolve YouTube, then stream
  if (isLibraryId(track.id)) {
    const { data } = await api.post(`/tracks/${track.id}/prepare-playback`, {}, { timeout: 60000 });
    const ready = normalizeTrack(data.track);
    return { ...ready, streamUrl: ready.streamUrl || optimisticStreamUrl(ready) };
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
        thumbnailUrl: track.thumbnailUrl,
      };

  const { data } = await api.post('/tracks/prepare-playback', payload, { timeout: 60000 });
  return normalizeTrack(data.track);
}

/** True when the browser can hit /tracks/:id/stream with a real file or YouTube source. */
export function canStreamTrackLocally(track: Track | null | undefined): boolean {
  if (!track || !isLibraryId(track.id)) return false;
  return !!(track.isDownloaded || track.sourceUrl);
}

function optimisticStreamUrl(track: Track): string {
  return `/api/tracks/${track.id}/stream`;
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
  api.get('/discover/prefetch', { params: { seedTrackId }, timeout: 8000 }).catch(() => { /* ignore */ });
}
