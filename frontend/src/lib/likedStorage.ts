const LIKED_IDS_KEY = 'llamastream_liked_ids';

export function loadLikedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(LIKED_IDS_KEY);
    if (!raw) return new Set();
    const ids = JSON.parse(raw) as string[];
    return new Set(ids.filter(Boolean));
  } catch {
    return new Set();
  }
}

export function saveLikedIds(ids: Set<string>): void {
  localStorage.setItem(LIKED_IDS_KEY, JSON.stringify([...ids]));
}
