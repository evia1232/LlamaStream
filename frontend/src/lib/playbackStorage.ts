const VOLUME_KEY = 'llamastream_volume';
const AUTOPLAY_KEY = 'llamastream_autoplay';
const STORAGE_KEY = 'llamastream_playback';

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
