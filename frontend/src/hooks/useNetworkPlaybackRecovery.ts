import { useEffect, useRef, type RefObject } from 'react';
import { usePlayerStore } from '../store';
import { isLibraryId, canStreamTrackLocally } from '../lib/ensureDownload';
import { recoverLocalPlayback } from '../lib/playbackRecovery';

/**
 * Keep local playback alive through network drops — auto-resume when online returns.
 */
export function useNetworkPlaybackRecovery(
  audioRef: RefObject<HTMLAudioElement | null>,
  blobRef: RefObject<string | null>,
) {
  const recoveringRef = useRef(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const setOffline = (offline: boolean) => usePlayerStore.getState().setOffline(offline);
    const setReconnecting = (v: boolean) => usePlayerStore.getState().setReconnecting(v);

    const tryRecover = async () => {
      if (recoveringRef.current) return;

      const state = usePlayerStore.getState();
      if (!state.isPlaying || state.playbackEngine !== 'local' || state.isRemoteActive) return;
      const track = state.currentTrack;
      if (!track || !isLibraryId(track.id) || !canStreamTrackLocally(track)) return;

      const el = audioRef.current;
      if (!el) return;

      // Already playing smoothly
      if (!el.error && !el.paused && el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return;

      recoveringRef.current = true;
      setReconnecting(true);
      const resumeTime = el.currentTime > 0 ? el.currentTime : state.currentTime;
      const token = localStorage.getItem('token');

      try {
        await recoverLocalPlayback(el, track.id, token, blobRef, resumeTime);
      } catch {
        /* retry on next interval / online event */
      } finally {
        recoveringRef.current = false;
        setReconnecting(false);
      }
    };

    const onOnline = () => {
      setOffline(false);
      void tryRecover();
    };

    const onOffline = () => {
      setOffline(true);
      // Keep isPlaying — user did not pause
      usePlayerStore.getState().setIsBuffering(true);
    };

    const onAudioError = () => {
      if (usePlayerStore.getState().isPlaying) void tryRecover();
    };

    const onStalled = () => {
      if (usePlayerStore.getState().isPlaying) {
        usePlayerStore.getState().setIsBuffering(true);
      }
    };

    const onPlaying = () => {
      usePlayerStore.getState().setIsBuffering(false);
      setReconnecting(false);
    };

    setOffline(!navigator.onLine);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    audio.addEventListener('error', onAudioError);
    audio.addEventListener('stalled', onStalled);
    audio.addEventListener('playing', onPlaying);

    const interval = window.setInterval(() => {
      const { isPlaying, playbackEngine } = usePlayerStore.getState();
      if (!isPlaying || playbackEngine !== 'local') return;
      const el = audioRef.current;
      if (!el) return;
      if (el.error || el.paused) {
        void tryRecover();
      }
    }, 2500);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      audio.removeEventListener('error', onAudioError);
      audio.removeEventListener('stalled', onStalled);
      audio.removeEventListener('playing', onPlaying);
      window.clearInterval(interval);
    };
  }, [audioRef, blobRef]);
}
