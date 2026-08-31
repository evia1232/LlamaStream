import { useEffect, useRef } from 'react';
import { usePlayerStore } from '../store';

/**
 * Resume playback after system interrupts (phone call, etc.).
 * Only resumes when the store still expects playing and audio was paused externally.
 */
export function useAudioInterruptResume() {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playbackEngine = usePlayerStore((s) => s.playbackEngine);
  const interruptedRef = useRef(false);

  useEffect(() => {
    if (playbackEngine !== 'local') return;
    const audio = document.querySelector('footer.player-bar audio') as HTMLAudioElement | null;
    if (!audio) return;

    const onPause = () => {
      if (usePlayerStore.getState().isPlaying) {
        interruptedRef.current = true;
      }
    };

    const onPlay = () => {
      interruptedRef.current = false;
    };

    const tryResume = () => {
      if (!interruptedRef.current) return;
      const { isPlaying: wantPlay, isPreparingPlayback } = usePlayerStore.getState();
      if (wantPlay && !isPreparingPlayback && audio.paused) {
        audio.play().catch(() => { /* user may have paused manually */ });
        interruptedRef.current = false;
      }
    };

    audio.addEventListener('pause', onPause);
    audio.addEventListener('play', onPlay);
    document.addEventListener('visibilitychange', tryResume);
    window.addEventListener('focus', tryResume);

    return () => {
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('play', onPlay);
      document.removeEventListener('visibilitychange', tryResume);
      window.removeEventListener('focus', tryResume);
    };
  }, [playbackEngine, isPlaying]);
}
