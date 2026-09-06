/**
 * Prefer real album artwork over YouTube video frames.
 * Order: caller hint (non-YT) → Spotify → iTunes Search → YouTube fallback.
 */

const YT_THUMB_RE = /ytimg\.com|i\.ytimg\.com|youtube\.com\/vi\/|ggpht\.com|googleusercontent\.com/i;

export function isYouTubeThumbnail(url?: string | null): boolean {
  if (!url) return false;
  return YT_THUMB_RE.test(url);
}

export function needsBetterAlbumArt(url?: string | null): boolean {
  return !url || isYouTubeThumbnail(url);
}

function itunesHiRes(url: string): string {
  // artworkUrl100 → larger square (common pattern on Apple CDN)
  return url
    .replace(/\/\d+x\d+bb\./, '/600x600bb.')
    .replace(/100x100bb/, '600x600bb')
    .replace(/60x60bb/, '600x600bb');
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreItunesHit(
  trackName: string,
  artistName: string,
  wantTitle: string,
  wantArtist: string,
): number {
  const t = norm(trackName);
  const a = norm(artistName);
  const wt = norm(wantTitle);
  const wa = norm(wantArtist).split(/[,;&/]/)[0]?.trim() || '';
  let score = 0;
  if (t === wt) score += 40;
  else if (t.includes(wt) || wt.includes(t)) score += 25;
  if (wa && (a.includes(wa) || wa.includes(a))) score += 40;
  else if (wa && a.split(/\s+/).some((w) => wa.includes(w) && w.length > 2)) score += 15;
  return score;
}

async function fetchItunesArtwork(title: string, artist: string, album?: string): Promise<string | null> {
  const queries = [
    album ? `${artist} ${album}` : '',
    `${artist} ${title}`,
    title,
  ].filter(Boolean);

  for (const term of queries) {
    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=8`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'LlamaStream/1.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        results?: Array<{
          trackName?: string;
          artistName?: string;
          collectionName?: string;
          artworkUrl100?: string;
        }>;
      };
      const results = data.results || [];
      let best: { score: number; art: string } | null = null;
      for (const r of results) {
        const art = r.artworkUrl100;
        if (!art) continue;
        const score = scoreItunesHit(r.trackName || '', r.artistName || '', title, artist);
        if (album && r.collectionName && norm(r.collectionName).includes(norm(album))) {
          // slight boost for album match
        }
        if (!best || score > best.score) best = { score, art };
      }
      if (best && best.score >= 40) {
        return itunesHiRes(best.art);
      }
    } catch {
      /* try next query */
    }
  }
  return null;
}

async function fetchSpotifyArtwork(title: string, artist: string, spotifyUrl?: string): Promise<string | null> {
  try {
    const { isSpotifyConfigured, fetchSpotifyTrackByUrl, lookupSpotifyTrack } = await import('./spotifyApi');
    if (!(await isSpotifyConfigured())) return null;

    if (spotifyUrl) {
      const byUrl = await fetchSpotifyTrackByUrl(spotifyUrl);
      if (byUrl?.thumbnailUrl && !isYouTubeThumbnail(byUrl.thumbnailUrl)) {
        return byUrl.thumbnailUrl;
      }
    }

    const hit = await lookupSpotifyTrack(title, artist);
    if (hit?.thumbnailUrl && !isYouTubeThumbnail(hit.thumbnailUrl)) {
      return hit.thumbnailUrl;
    }
  } catch {
    /* spotify optional */
  }
  return null;
}

export interface AlbumArtInput {
  title: string;
  artist: string;
  album?: string | null;
  /** Existing / preferred URL (Spotify search result, etc.) */
  preferredUrl?: string | null;
  spotifyUrl?: string | null;
}

/**
 * Resolve the best available album cover.
 * Spotify → iTunes → original/YouTube preferred URL (never leave empty if we had a source).
 */
export async function resolveAlbumArt(input: AlbumArtInput): Promise<string | null> {
  const title = (input.title || '').trim();
  const artist = (input.artist || '').trim();
  const preferred = (input.preferredUrl || '').trim() || null;

  if (preferred && !isYouTubeThumbnail(preferred)) {
    return preferred;
  }

  if (title && artist) {
    try {
      const fromSpotify = await fetchSpotifyArtwork(title, artist, input.spotifyUrl || undefined);
      if (fromSpotify) return fromSpotify;
    } catch { /* fall through */ }

    try {
      const fromItunes = await fetchItunesArtwork(title, artist, input.album || undefined);
      if (fromItunes) return fromItunes;
    } catch { /* fall through */ }
  }

  // No better art — keep YouTube frame / original source thumbnail
  return preferred;
}

/** Fire-and-forget: upgrade a track's thumbnail if it's still a YouTube frame. */
export function upgradeTrackAlbumArtInBackground(
  trackId: string,
  input: AlbumArtInput,
): void {
  void (async () => {
    try {
      const { default: prisma } = await import('../lib/prisma');
      const track = await prisma.track.findUnique({ where: { id: trackId } });
      if (!track) return;
      if (!needsBetterAlbumArt(track.thumbnailUrl)) return;

      const art = await resolveAlbumArt({
        ...input,
        preferredUrl: input.preferredUrl || track.thumbnailUrl,
      });
      if (!art || isYouTubeThumbnail(art)) return;
      if (art === track.thumbnailUrl) return;

      await prisma.track.update({
        where: { id: trackId },
        data: { thumbnailUrl: art },
      });
    } catch (err) {
      console.warn('[AlbumArt] Upgrade failed:', (err as Error).message);
    }
  })();
}
