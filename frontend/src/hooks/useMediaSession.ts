import { useEffect } from 'react';
import { usePlayerStore } from '../store';
import { getArtistName, getTrackImageUrl } from '../lib/trackUtils';

function setHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    /* unsupported action on this platform */
  }
}

export function useMediaSession() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    setHandler('play', () => usePlayerStore.getState().setIsPlaying(true));
    setHandler('pause', () => usePlayerStore.getState().setIsPlaying(false));
    setHandler('previoustrack', () => usePlayerStore.getState().playPrevious());
    setHandler('nexttrack', () => usePlayerStore.getState().playNext());
    setHandler('seekbackward', () => {
      const { currentTime: t } = usePlayerStore.getState();
      usePlayerStore.getState().seekTo(Math.max(0, t - 10));
    });
    setHandler('seekforward', () => {
      const { currentTime: t, duration: d } = usePlayerStore.getState();
      usePlayerStore.getState().seekTo(Math.min(d || t + 10, t + 10));
    });
    setHandler('seekto', (details: MediaSessionActionDetails) => {
      if (details.seekTime != null) {
        usePlayerStore.getState().seekTo(details.seekTime);
      }
    });

    return () => {
      for (const action of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward', 'seekto'] as const) {
        setHandler(action, null);
      }
    };
  }, []);

  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack) return;

    const artist = getArtistName(currentTrack.artist);
    const artworkUrl = getTrackImageUrl(currentTrack);
    const artwork: MediaImage[] = artworkUrl
      ? [96, 128, 192, 256, 384, 512].map((size) => ({
          src: artworkUrl,
          sizes: `${size}x${size}`,
          type: 'image/jpeg',
        }))
      : [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }];

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist,
      album: currentTrack.album?.title || 'LlamaStream',
      artwork,
    });
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.thumbnailUrl]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [isPlaying]);

  useEffect(() => {
    if (!('mediaSession' in navigator) || !duration || duration <= 0) return;
    if (!('setPositionState' in navigator.mediaSession)) return;

    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: 1,
        position: Math.min(Math.max(0, currentTime), duration),
      });
    } catch {
      /* position updates can fail during track transitions */
    }
  }, [currentTime, duration, currentTrack?.id]);
}
