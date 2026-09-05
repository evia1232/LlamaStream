import { useEffect } from 'react';
import { usePlayerStore } from '../store';
import { resumeAudioIfNeeded } from '../lib/audioPlay';

/**
 * Resume playback after system interrupts or background-tab autoplay blocks.
 */
export function useAudioInterruptResume() {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playbackEngine = usePlayerStore((s) => s.playbackEngine);
  const isPreparingPlayback = usePlayerStore((s) => s.isPreparingPlayback);

  useEffect(() => {
    if (playbackEngine !== 'local') return;

    const getAudio = () =>
      document.querySelector('footer.player-bar audio') as HTMLAudioElement | null;

    const tryResume = () => {
      const audio = getAudio();
      if (!audio) return;
      const { isPlaying: wantPlay, isPreparingPlayback: preparing, currentTrack, currentTime } = usePlayerStore.getState();
      if (!wantPlay || preparing) return;
      if (!audio.src || audio.error) {
        if (currentTrack) {
          void import('../lib/appResume').then(({ forceResumeLocalPlayback }) => {
            void forceResumeLocalPlayback();
          });
        }
        return;
      }
      resumeAudioIfNeeded(audio, wantPlay, preparing);
      if (audio.paused && wantPlay) {
        // Extra kick — WebView often leaves paused=true after background
        audio.play().catch(() => {
          resumeAudioIfNeeded(audio, true, false);
        });
      }
      void currentTime;
    };

    document.addEventListener('visibilitychange', tryResume);
    window.addEventListener('pageshow', tryResume);
    window.addEventListener('focus', tryResume);

    const interval = window.setInterval(tryResume, document.hidden ? 700 : 2500);

    return () => {
      document.removeEventListener('visibilitychange', tryResume);
      window.removeEventListener('pageshow', tryResume);
      window.removeEventListener('focus', tryResume);
      window.clearInterval(interval);
    };
  }, [playbackEngine, isPlaying, isPreparingPlayback]);
}
