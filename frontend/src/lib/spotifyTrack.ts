import { Track } from '../types';

/** Extract Spotify track ID from URL or external track id */
export function getSpotifyTrackId(track: Track): string | null {
  if (track.spotifyUrl) {
    const match = track.spotifyUrl.match(/track\/([a-zA-Z0-9]+)/i);
    if (match) return match[1];
  }

  const rawId = track.id.replace(/^external-/, '');
  if (/^[a-zA-Z0-9]{22}$/.test(rawId)) return rawId;

  return null;
}

export function getSpotifyTrackUri(track: Track): string | null {
  const id = getSpotifyTrackId(track);
  return id ? `spotify:track:${id}` : null;
}

export function canStreamFromSpotify(
  track: Track,
  spotify: { connected: boolean; premium: boolean }
): boolean {
  if (!spotify.connected || !spotify.premium) return false;
  if (track.isDownloaded) return false;
  return !!(track.spotifyUrl || track.source === 'spotify' || getSpotifyTrackUri(track));
}
