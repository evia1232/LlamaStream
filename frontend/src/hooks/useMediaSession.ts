import { useEffect } from 'react';
import { usePlayerStore } from '../store';
import { getArtistName, getTrackImageUrl, isTrackLiked } from '../lib/trackUtils';
import { getAppName } from '../lib/appName';
import { resumePlayerAudio } from '../lib/audioPlay';
import {
  MediaSession,
  absoluteMediaUrl,
  isNativeShell,
} from '../lib/nativeMediaSession';
import { useToastStore } from '../lib/toastStore';
import i18n from '../i18n';

function setWebHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    /* unsupported */
  }
}

export function useMediaSession() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const duration = usePlayerStore((s) => s.duration);
  const likedTrackIds = usePlayerStore((s) => s.likedTrackIds);
  const likedPendingTracks = usePlayerStore((s) => s.likedPendingTracks);
  const native = isNativeShell();

  const liked = currentTrack
    ? isTrackLiked(currentTrack, likedTrackIds, likedPendingTracks)
    : false;

  useEffect(() => {
    const onPlay = () => {
      usePlayerStore.getState().setIsPlaying(true);
      resumePlayerAudio();
    };
    const onPause = () => usePlayerStore.getState().setIsPlaying(false);
    const onPrev = () => usePlayerStore.getState().playPrevious();
    const onNext = () => usePlayerStore.getState().playNext();
    const onSeekTo = (details: { seekTime?: number | null }) => {
      if (details.seekTime != null) usePlayerStore.getState().seekTo(details.seekTime);
    };
    const onLike = () => {
      const track = usePlayerStore.getState().currentTrack;
      if (!track) return;
      const wasLiked = isTrackLiked(
        track,
        usePlayerStore.getState().likedTrackIds,
        usePlayerStore.getState().likedPendingTracks,
      );
      usePlayerStore.getState().toggleLike(track.id, track);
      const nowLiked = !wasLiked;
      if (native) void MediaSession.setLiked({ liked: nowLiked });
      useToastStore
        .getState()
        .show(nowLiked ? i18n.t('addedToLiked') : i18n.t('removedFromLiked'));
    };

    if (native) {
      void MediaSession.requestNotificationPermission();
      void MediaSession.setActionHandler({ action: 'play' }, onPlay);
      void MediaSession.setActionHandler({ action: 'pause' }, onPause);
      void MediaSession.setActionHandler({ action: 'previoustrack' }, onPrev);
      void MediaSession.setActionHandler({ action: 'nexttrack' }, onNext);
      void MediaSession.setActionHandler({ action: 'seekto' }, onSeekTo);
      void MediaSession.setActionHandler({ action: 'like' }, onLike);
      void MediaSession.setActionHandler({ action: 'stop' }, onPause);
      return;
    }

    if (!('mediaSession' in navigator)) return;

    setWebHandler('play', onPlay);
    setWebHandler('pause', onPause);
    setWebHandler('previoustrack', onPrev);
    setWebHandler('nexttrack', onNext);
    setWebHandler('seekbackward', () => {
      const { currentTime: t } = usePlayerStore.getState();
      usePlayerStore.getState().seekTo(Math.max(0, t - 10));
    });
    setWebHandler('seekforward', () => {
      const { currentTime: t, duration: d } = usePlayerStore.getState();
      usePlayerStore.getState().seekTo(Math.min(d || t + 10, t + 10));
    });
    setWebHandler('seekto', (details) => onSeekTo(details));

    return () => {
      for (const action of [
        'play',
        'pause',
        'previoustrack',
        'nexttrack',
        'seekbackward',
        'seekforward',
        'seekto',
      ] as const) {
        setWebHandler(action, null);
      }
    };
  }, [native]);

  useEffect(() => {
    if (!currentTrack) return;

    const artist = getArtistName(currentTrack.artist);
    const artworkUrl = absoluteMediaUrl(getTrackImageUrl(currentTrack));
    const artwork = [96, 128, 192, 256, 384, 512].map((size) => ({
      src: artworkUrl,
      sizes: `${size}x${size}`,
      type: 'image/jpeg',
    }));

    const meta = {
      title: currentTrack.title,
      artist,
      album: currentTrack.album?.title || getAppName(),
      artwork,
      liked,
    };

    if (native) {
      void MediaSession.setMetadata(meta);
      void MediaSession.setLiked({ liked });
      return;
    }

    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: meta.title,
      artist: meta.artist,
      album: meta.album,
      artwork: meta.artwork,
    });
  }, [
    native,
    currentTrack?.id,
    currentTrack?.title,
    currentTrack?.thumbnailUrl,
    currentTrack?.album?.title,
    liked,
  ]);

  useEffect(() => {
    const state = isPlaying ? 'playing' : currentTrack ? 'paused' : 'none';
    if (native) {
      void MediaSession.setPlaybackState({ playbackState: state });
      return;
    }
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = state;
  }, [native, isPlaying, currentTrack?.id]);

  useEffect(() => {
    if (!duration || duration <= 0) return;

    const pushPosition = () => {
      const { currentTime: t, duration: d } = usePlayerStore.getState();
      if (!d || d <= 0) return;
      const payload = {
        duration: d,
        playbackRate: 1,
        position: Math.min(Math.max(0, t), d),
      };
      if (native) {
        void MediaSession.setPositionState(payload);
        return;
      }
      if (!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return;
      try {
        navigator.mediaSession.setPositionState({
          duration: payload.duration,
          playbackRate: 1,
          position: payload.position,
        });
      } catch {
        /* ignore during transitions */
      }
    };

    pushPosition();
    // Native notification progress needs frequent updates while backgrounded
    const id = window.setInterval(pushPosition, native ? 1000 : 1500);
    return () => window.clearInterval(id);
  }, [native, duration, currentTrack?.id, isPlaying]);
}
