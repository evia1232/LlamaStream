const STORAGE_KEY = 'llamastream_playback';

export interface SavedPlayback {
  trackId: string;
  position: number;
  isPlaying: boolean;
  savedAt: number;
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
