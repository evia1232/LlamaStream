/** Split a stored artist field into individual artist tokens (handles Spotify comma / feat. style). */
export function splitArtistNames(name: string): string[] {
  return name
    .split(/,\s*|;\s*|&\s*|\s+feat\.?\s+|\s+ft\.?\s+|\s+featuring\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function normalizeArtistToken(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when `storedName` lists `queryName` as one of its artists (comma-separated aware). */
export function artistNameMatches(storedName: string, queryName: string): boolean {
  const q = normalizeArtistToken(queryName);
  if (!q) return false;

  const storedNorm = normalizeArtistToken(storedName);
  if (storedNorm === q) return true;

  const parts = splitArtistNames(storedName).map(normalizeArtistToken).filter(Boolean);
  return parts.some((p) => p === q || p.includes(q) || q.includes(p));
}
