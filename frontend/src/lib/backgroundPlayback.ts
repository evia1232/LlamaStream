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
 * Critical: when hidden, never rely on React re-renders or crossfade —
 * advance via store + imperative audio load.
 */
export function startPlaybackKeeper(): () => void {
  configureAudioSession();

  let lastEndedTrackId: string | null = null;
  let lastNearEndTrackId: string | null = null;

  const advance = (reason: 'ended' | 'near-end') => {
    const state = usePlayerStore.getState();
    if (!state.isPlaying || state.isRemoteActive || state.playbackEngine !== 'local') return;
    const trackId = state.currentTrack?.id ?? null;
    if (!trackId) return;

    if (reason === 'ended') {
      if (lastEndedTrackId === trackId) return;
      lastEndedTrackId = trackId;
    } else {
      if (lastNearEndTrackId === trackId || lastEndedTrackId === trackId) return;
      lastNearEndTrackId = trackId;
    }

    // Hard cut in background — crossfade freezes and stops playback on mobile
    state.playNext({ crossfade: !document.hidden });
  };

  const tick = () => {
    const state = usePlayerStore.getState();
    if (state.playbackEngine !== 'local' || state.isRemoteActive) return;

    const audio = getPlayerAudioElement();
    if (!audio) return;

    if (!state.isPlaying) {
      lastEndedTrackId = null;
      lastNearEndTrackId = null;
      return;
    }

    configureAudioSession();

    if (audio.paused && audio.src && !audio.ended) {
      safeAudioPlay(audio, undefined, { persistent: true });
    }

    const trackId = state.currentTrack?.id ?? null;
    if (audio.ended && trackId) {
      advance('ended');
      return;
    }

    // Near end: timeupdate is throttled when locked — poll the element directly
    const d = audio.duration;
    const t = audio.currentTime;
    if (Number.isFinite(d) && d > 1 && Number.isFinite(t) && t >= d - 1.25) {
      advance('near-end');
    }

    // Track changed successfully — allow future advances
    if (trackId && lastEndedTrackId && lastEndedTrackId !== trackId) {
      lastEndedTrackId = null;
      lastNearEndTrackId = null;
    }
  };

  const onAudioEnded = () => advance('ended');

  const bindAudio = () => {
    const audio = getPlayerAudioElement();
    if (!audio) return null;
    audio.addEventListener('ended', onAudioEnded);
    return audio;
  };

  let bound: HTMLAudioElement | null = bindAudio();

  // Aggressive while hidden (OS may still throttle; best-effort)
  const intervalMs = () => (document.hidden ? 400 : 1500);
  let timer = window.setInterval(tick, intervalMs());

  const onVisibility = () => {
    window.clearInterval(timer);
    timer = window.setInterval(tick, intervalMs());
    if (!document.hidden) {
      lastNearEndTrackId = null;
      configureAudioSession();
      tick();
    }
  };

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pageshow', tick);
  window.addEventListener('focus', tick);

  // Re-bind if player mounts later
  const remountTimer = window.setInterval(() => {
    const audio = getPlayerAudioElement();
    if (audio && audio !== bound) {
      bound?.removeEventListener('ended', onAudioEnded);
      bound = bindAudio();
    }
  }, 5000);

  tick();

  return () => {
    window.clearInterval(timer);
    window.clearInterval(remountTimer);
    bound?.removeEventListener('ended', onAudioEnded);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pageshow', tick);
    window.removeEventListener('focus', tick);
  };
}
