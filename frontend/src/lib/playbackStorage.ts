const VOLUME_KEY = 'llamastream_volume';
const AUTOPLAY_KEY = 'llamastream_autoplay';
const STORAGE_KEY = 'llamastream_playback';
const CROSSFADE_ENABLED_KEY = 'llamastream_crossfade';
const CROSSFADE_DURATION_KEY = 'llamastream_crossfade_duration';

export interface SavedPlayback {
  trackId: string;
  position: number;
  isPlaying: boolean;
  volume?: number;
  savedAt: number;
}

export function loadSavedVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw) {
      const v = parseFloat(raw);
      if (!Number.isNaN(v)) return Math.min(1, Math.max(0, v));
    }
    const legacy = localStorage.getItem('volume');
    if (legacy) {
      const v = parseFloat(legacy);
      if (!Number.isNaN(v)) return Math.min(1, Math.max(0, v));
    }
  } catch { /* ignore */ }
  return 0.7;
}

export function saveVolume(volume: number): void {
  const v = Math.min(1, Math.max(0, volume));
  localStorage.setItem(VOLUME_KEY, String(v));
  localStorage.setItem('volume', String(v));
}

export function loadLocalPlayback(): SavedPlayback | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SavedPlayback;
    if (!data.trackId) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveLocalPlayback(state: SavedPlayback): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, savedAt: Date.now() }));
}

export function clearLocalPlayback(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function loadAutoplayEnabled(): boolean {
  try {
    const raw = localStorage.getItem(AUTOPLAY_KEY);
    if (raw === 'false') return false;
  } catch { /* ignore */ }
  return true;
}

export function saveAutoplayEnabled(enabled: boolean): void {
  localStorage.setItem(AUTOPLAY_KEY, String(enabled));
}

export function loadCrossfadeEnabled(): boolean {
  try {
    return localStorage.getItem(CROSSFADE_ENABLED_KEY) === 'true';
  } catch { return false; }
}

export function saveCrossfadeEnabled(enabled: boolean): void {
  localStorage.setItem(CROSSFADE_ENABLED_KEY, String(enabled));
}

export function loadCrossfadeDuration(): number {
  try {
    const raw = localStorage.getItem(CROSSFADE_DURATION_KEY);
    if (raw) {
      const v = parseInt(raw, 10);
      if (v >= 1 && v <= 12) return v;
    }
  } catch { /* ignore */ }
  return 5;
}

export function saveCrossfadeDuration(seconds: number): void {
  localStorage.setItem(CROSSFADE_DURATION_KEY, String(Math.max(1, Math.min(12, seconds))));
}
