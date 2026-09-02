/** Play audio with retries — browsers may block play() in background tabs between tracks. */
import { usePlayerStore } from '../store';

export function safeAudioPlay(
  audio: HTMLAudioElement,
  onGiveUp?: () => void,
  options?: { persistent?: boolean },
): () => void {
  let cancelled = false;
  let retries = 0;
  const maxRetries = options?.persistent ? Number.POSITIVE_INFINITY : 12;

  const attempt = () => {
    if (cancelled || !audio.src) return;
    audio.play().catch(() => {
      retries += 1;
      if (!options?.persistent && retries >= maxRetries) {
        if (document.visibilityState === 'visible') {
          onGiveUp?.();
        }
        return;
      }
      const hidden = document.visibilityState === 'hidden';
      const base = hidden ? 400 : 200;
      const delay = Math.min(options?.persistent ? (hidden ? 2000 : 5000) : 1500, base + retries * (hidden ? 100 : 150));
      window.setTimeout(attempt, delay);
    });
  };

  attempt();
  return () => { cancelled = true; };
}

/** Resume the main player element when lock-screen / notification play is pressed. */
export function resumePlayerAudio(): void {
  const audio = document.querySelector('footer.player-bar audio') as HTMLAudioElement | null;
  if (!audio) return;
  const { isPlaying, isPreparingPlayback } = usePlayerStore.getState();
  resumeAudioIfNeeded(audio, isPlaying, isPreparingPlayback);
}

/** Resume when tab becomes visible if playback is still intended. */
export function resumeAudioIfNeeded(
  audio: HTMLAudioElement | null,
  wantPlay: boolean,
  isPreparing: boolean,
): void {
  if (!audio || !wantPlay || isPreparing || !audio.paused || !audio.src) return;
  safeAudioPlay(audio, undefined, { persistent: true });
}
