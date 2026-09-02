import { streamUrl } from './apiUrl';
import { getCachedStreamBlobUrl, revokeBlobUrl } from './audioStreamCache';
import { safeAudioPlay } from './audioPlay';

export async function reloadAudioStreamSource(
  audio: HTMLAudioElement,
  trackId: string,
  token: string | null,
  blobHolder: { current: string | null },
  resumeTime: number,
): Promise<boolean> {
  revokeBlobUrl(blobHolder.current);
  blobHolder.current = null;

  const cached = await getCachedStreamBlobUrl(trackId);
  if (cached) {
    blobHolder.current = cached;
    audio.src = cached;
  } else if (navigator.onLine) {
    audio.src = streamUrl(trackId, token);
  } else {
    return false;
  }

  audio.load();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(ok);
    };

    const onReady = () => {
      if (resumeTime > 0) {
        try {
          const max = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : resumeTime;
          audio.currentTime = Math.min(resumeTime, max);
        } catch { /* ignore seek errors */ }
      }
      finish(true);
    };

    const cleanup = () => {
      audio.removeEventListener('loadeddata', onReady);
      audio.removeEventListener('canplay', onReady);
      audio.removeEventListener('error', onFail);
      window.clearTimeout(timer);
    };

    const onFail = () => finish(false);

    audio.addEventListener('loadeddata', onReady);
    audio.addEventListener('canplay', onReady);
    audio.addEventListener('error', onFail);
    const timer = window.setTimeout(() => finish(false), 20000);
  });
}

/** Reload stream if needed and resume — keeps isPlaying intent. */
export async function recoverLocalPlayback(
  audio: HTMLAudioElement,
  trackId: string,
  token: string | null,
  blobHolder: { current: string | null },
  resumeTime: number,
): Promise<boolean> {
  const needsReload = !!audio.error || !audio.src || audio.networkState === HTMLMediaElement.NETWORK_NO_SOURCE;
  if (needsReload) {
    const ok = await reloadAudioStreamSource(audio, trackId, token, blobHolder, resumeTime);
    if (!ok) return false;
  } else if (resumeTime > 0 && Math.abs(audio.currentTime - resumeTime) > 1.5) {
    try {
      audio.currentTime = resumeTime;
    } catch { /* ignore */ }
  }

  safeAudioPlay(audio, undefined, { persistent: true });
  return true;
}
