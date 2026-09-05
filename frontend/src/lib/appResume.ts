import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { usePlayerStore } from '../store';
import { resumeAudioIfNeeded, resumePlayerAudio, safeAudioPlay } from './audioPlay';
import { recoverLocalPlayback } from './playbackRecovery';
import { configureAudioSession } from './backgroundPlayback';

function getPlayerAudio(): HTMLAudioElement | null {
  return document.querySelector('footer.player-bar audio') as HTMLAudioElement | null;
}

/**
 * Strong resume after returning to the app / unlocking the phone.
 * Reloads stream if needed and forces play when isPlaying is still true.
 */
export async function forceResumeLocalPlayback(): Promise<void> {
  configureAudioSession();
  const state = usePlayerStore.getState();
  if (state.playbackEngine !== 'local' || state.isRemoteActive) return;
  if (!state.isPlaying || state.isPreparingPlayback) return;
  const track = state.currentTrack;
  if (!track) return;

  const audio = getPlayerAudio();
  if (!audio) return;

  const token = localStorage.getItem('token');
  const blobHolder = { current: audio.src.startsWith('blob:') ? audio.src : null };
  const needsRecover =
    !!audio.error
    || !audio.src
    || audio.networkState === HTMLMediaElement.NETWORK_NO_SOURCE
    || (audio.paused && audio.readyState < 2);

  if (needsRecover) {
    await recoverLocalPlayback(
      audio,
      track.id,
      token,
      blobHolder,
      state.currentTime || 0,
    );
  } else {
    resumeAudioIfNeeded(audio, true, false);
    if (audio.paused) {
      safeAudioPlay(audio, undefined, { persistent: true });
    }
  }

  // Re-assert media session playing so notification controls stay alive
  try {
    const { MediaSession, isNativeShell } = await import('./nativeMediaSession');
    if (isNativeShell()) {
      void MediaSession.setPlaybackState({ playbackState: 'playing' });
    }
  } catch { /* ignore */ }
}

/** Wire Capacitor appStateChange + visibility for reliable resume. */
export function startAppResumeListeners(): () => void {
  const onVisible = () => {
    if (document.visibilityState === 'hidden') return;
    void forceResumeLocalPlayback();
    // Re-fetch lyrics if panel open / track has none
    const { currentTrack, lyrics, fetchLyrics, showLyrics } = usePlayerStore.getState();
    if (currentTrack && (!lyrics || showLyrics)) {
      void fetchLyrics(currentTrack.id);
    }
  };

  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pageshow', onVisible);
  window.addEventListener('focus', onVisible);

  let removeCap: (() => void) | undefined;
  if (Capacitor.isNativePlatform()) {
    void App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        // Small delay so WebView finishes onResume
        window.setTimeout(() => {
          void forceResumeLocalPlayback();
          resumePlayerAudio();
          const { currentTrack, lyrics, fetchLyrics } = usePlayerStore.getState();
          if (currentTrack && !lyrics) void fetchLyrics(currentTrack.id);
        }, 120);
      }
    }).then((handle) => {
      removeCap = () => { void handle.remove(); };
    });
  }

  // Aggressive keeper while intended to play but audio paused (WebView quirk)
  const interval = window.setInterval(() => {
    const state = usePlayerStore.getState();
    if (!state.isPlaying || state.playbackEngine !== 'local' || state.isRemoteActive) return;
    const audio = getPlayerAudio();
    if (!audio) return;
    if (audio.paused && audio.src && !audio.ended) {
      safeAudioPlay(audio, undefined, { persistent: true });
    }
  }, document.hidden ? 800 : 2000);

  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pageshow', onVisible);
    window.removeEventListener('focus', onVisible);
    removeCap?.();
    window.clearInterval(interval);
  };
}
