import { useEffect } from 'react';
import { usePlayerStore } from '../store';
import { getArtistName, getTrackImageUrl, isTrackLiked } from '../lib/trackUtils';
import { getAppName } from '../lib/appName';
import { resumePlayerAudio } from '../lib/audioPlay';
import {
  MediaSession,
  absoluteMediaUrl,
  isNativeShell,
  ensureBackgroundPlaybackPermissions,
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
  const isRemoteActive = usePlayerStore((s) => s.isRemoteActive);
  const likedTrackIds = usePlayerStore((s) => s.likedTrackIds);
  const likedPendingTracks = usePlayerStore((s) => s.likedPendingTracks);
  const native = isNativeShell();

  const liked = currentTrack
    ? isTrackLiked(currentTrack, likedTrackIds, likedPendingTracks)
    : false;

  // Battery / notifications only when THIS device is actually playing
  useEffect(() => {
    if (!native || !isPlaying || isRemoteActive) return;
    void ensureBackgroundPlaybackPermissions();
  }, [native, isPlaying, isRemoteActive]);

  useEffect(() => {
    const onPlay = () => {
      const s = usePlayerStore.getState();
      if (s.isRemoteActive) {
        s.sendRemoteCommand('play');
        return;
      }
      s.setIsPlaying(true);
      resumePlayerAudio();
    };
    const onPause = () => {
      const s = usePlayerStore.getState();
      if (s.isRemoteActive) {
        s.sendRemoteCommand('pause');
        return;
      }
      s.setIsPlaying(false);
    };
    const onPrev = () => {
      const s = usePlayerStore.getState();
      if (s.isRemoteActive) s.sendRemoteCommand('prev');
      else s.playPrevious();
    };
    const onNext = () => {
      const s = usePlayerStore.getState();
      if (s.isRemoteActive) s.sendRemoteCommand('next');
      else s.playNext();
    };
    const onSeekTo = (details: { seekTime?: number | null }) => {
      if (details.seekTime == null) return;
      const s = usePlayerStore.getState();
      if (s.isRemoteActive) s.sendRemoteCommand('seek', { seekTime: details.seekTime });
      else s.seekTo(details.seekTime);
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
      if (native && !usePlayerStore.getState().isRemoteActive) {
        void MediaSession.setLiked({ liked: nowLiked });
      }
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
    // Observer device: don't drive the system media notification as if we own audio
    if (isRemoteActive) return;

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
    isRemoteActive,
    currentTrack?.id,
    currentTrack?.title,
    currentTrack?.thumbnailUrl,
    currentTrack?.album?.title,
    liked,
  ]);

  useEffect(() => {
    // Clear native Now Playing while only observing another device
    if (native && isRemoteActive) {
      void MediaSession.setPlaybackState({ playbackState: 'none' });
      return;
    }
    const state = isPlaying ? 'playing' : currentTrack ? 'paused' : 'none';
    if (native) {
      void MediaSession.setPlaybackState({ playbackState: state });
      return;
    }
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = state;
  }, [native, isPlaying, isRemoteActive, currentTrack?.id]);

  useEffect(() => {
    if (!duration || duration <= 0) return;
    if (isRemoteActive) return; // don't spam notification progress while observing

    const pushPosition = () => {
      if (usePlayerStore.getState().isRemoteActive) return;
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
    const id = window.setInterval(pushPosition, native ? 1000 : 1500);
    return () => window.clearInterval(id);
  }, [native, duration, currentTrack?.id, isPlaying, isRemoteActive]);
}
