/** Live playback clock for lyrics sync — prefers the real media element over store lag. */

import { usePlayerStore } from '../store';
import { getRemoteProgressNow } from './remoteProgress';

function getLocalAudio(): HTMLAudioElement | null {
  return document.querySelector('footer.player-bar audio') as HTMLAudioElement | null;
}

let spotifyClock = { position: 0, atMs: 0, playing: false };

/**
 * Current playback position in seconds, as accurate as possible for karaoke sync.
 */
export function getLivePlaybackTime(): number {
  const s = usePlayerStore.getState();

  if (s.isRemoteActive) {
    const dur = s.duration || s.currentTrack?.duration || 0;
    return getRemoteProgressNow(dur);
  }

  if (s.playbackEngine === 'spotify') {
    const now = performance.now();
    const jumped = Math.abs(s.currentTime - spotifyClock.position) > 0.35;
    if (jumped || s.isPlaying !== spotifyClock.playing) {
      spotifyClock = { position: s.currentTime, atMs: now, playing: s.isPlaying };
    } else if (!s.isPlaying) {
      spotifyClock = { position: s.currentTime, atMs: now, playing: false };
    }
    if (spotifyClock.playing) {
      return Math.max(0, spotifyClock.position + (now - spotifyClock.atMs) / 1000);
    }
    return Math.max(0, spotifyClock.position);
  }

  const audio = getLocalAudio();
  if (audio && Number.isFinite(audio.currentTime)) {
    return Math.max(0, audio.currentTime);
  }

  return Math.max(0, s.currentTime);
}

/**
 * If our file is longer/shorter than the lyrics source, shift the comparison clock.
 * Positive offset = our audio has extra intro → lyrics should wait.
 */
export function estimateLyricsOffset(
  lines: { time: number }[] | null | undefined,
  trackDuration: number | null | undefined,
  sourceDuration?: number | null,
): number {
  if (sourceDuration && trackDuration && sourceDuration > 0 && trackDuration > 0) {
    const delta = trackDuration - sourceDuration;
    if (Math.abs(delta) >= 0.35 && Math.abs(delta) <= 18) return delta;
  }

  if (!lines?.length || !trackDuration || trackDuration <= 0) return 0;

  const last = lines[lines.length - 1]?.time ?? 0;
  if (last <= 0) return 0;

  // LRC ends well before our file — often a longer YouTube intro/outro; nudge if gap is moderate
  const tail = trackDuration - last;
  if (tail > 6 && tail < 25) {
    // Only shift a portion — full tail would overshoot when outro is just silence after last line
    const firstSung = lines.find((l) => (l as { text?: string }).text)?.time ?? lines[0].time;
    if (firstSung < 2.5 && tail > 8) {
      // Lyrics start immediately in LRC but our file may have intro
      return Math.min(12, Math.max(0, tail * 0.35));
    }
  }

  return 0;
}

export function findActiveLyricIndex(
  lines: { time: number; text?: string }[],
  playbackTime: number,
  offset = 0,
): number {
  if (!lines.length) return -1;
  const t = playbackTime - offset;
  // Slight lead so the line lands as it is sung (feels tighter than trailing)
  const lead = 0.08;
  const clock = t + lead;

  if (clock < lines[0].time) return -1;

  // Binary search: last line with time <= clock
  let lo = 0;
  let hi = lines.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= clock) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
