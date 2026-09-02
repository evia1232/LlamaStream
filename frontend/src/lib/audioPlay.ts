/** Play audio with retries — browsers may block play() in background tabs between tracks. */
export function safeAudioPlay(
  audio: HTMLAudioElement,
  onGiveUp?: () => void,
): void {
  let retries = 0;
  const maxRetries = 12;

  const attempt = () => {
    audio.play().catch(() => {
      retries += 1;
      if (retries >= maxRetries) {
        if (document.visibilityState === 'visible') {
          onGiveUp?.();
        }
        return;
      }
      const delay = Math.min(1500, 200 + retries * 150);
      window.setTimeout(attempt, delay);
    });
  };

  attempt();
}

/** Resume when tab becomes visible if playback is still intended. */
export function resumeAudioIfNeeded(
  audio: HTMLAudioElement | null,
  wantPlay: boolean,
  isPreparing: boolean,
): void {
  if (!audio || !wantPlay || isPreparing || !audio.paused || !audio.src) return;
  safeAudioPlay(audio);
}
