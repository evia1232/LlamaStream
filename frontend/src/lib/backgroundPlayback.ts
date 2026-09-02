import { usePlayerStore } from '../store';
import { safeAudioPlay } from './audioPlay';

/** Tell mobile OS this app is a media player (iOS 17+). */
export function configureAudioSession(): void {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = 'playback';
  } catch {
    /* unsupported */
  }
}

const PLAYER_AUDIO_SELECTOR = 'footer.player-bar audio';

export function getPlayerAudioElement(): HTMLAudioElement | null {
  return document.querySelector(PLAYER_AUDIO_SELECTOR) as HTMLAudioElement | null;
}

/**
 * Keep playback alive in background / lock screen / between tracks.
 * Retries play() when intent is playing but audio paused; safety-net for missed ended events.
 */
export function startPlaybackKeeper(): () => void {
  configureAudioSession();

  let lastEndedTrackId: string | null = null;

  const tick = () => {
    const state = usePlayerStore.getState();
    if (state.playbackEngine !== 'local' || state.isRemoteActive) return;

    const audio = getPlayerAudioElement();
    if (!audio) return;

    if (state.isPlaying) {
      if (audio.paused && audio.src && !audio.ended) {
        safeAudioPlay(audio, undefined, { persistent: true });
      }

      const trackId = state.currentTrack?.id ?? null;
      if (audio.ended && trackId && lastEndedTrackId !== trackId) {
        lastEndedTrackId = trackId;
        state.playNext();
      }
    } else {
      lastEndedTrackId = null;
    }
  };

  const intervalMs = () => (document.hidden ? 700 : 1800);
  let timer = window.setInterval(tick, intervalMs());

  const onVisibility = () => {
    window.clearInterval(timer);
    timer = window.setInterval(tick, intervalMs());
    tick();
  };

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pageshow', tick);
  window.addEventListener('focus', tick);

  tick();

  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pageshow', tick);
    window.removeEventListener('focus', tick);
  };
}
