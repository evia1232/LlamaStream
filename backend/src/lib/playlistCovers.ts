/** First N playlist tracks used only to derive auto cover art. */
export const COVER_TRACKS_TAKE = 8;

export const playlistCoverTracksQuery = {
  orderBy: { position: 'asc' as const },
  take: COVER_TRACKS_TAKE,
  include: {
    track: {
      select: {
        thumbnailUrl: true,
        album: { select: { coverUrl: true } },
      },
    },
  },
};

type CoverSource = {
  coverUrl: string | null;
  tracks?: Array<{
    track: {
      thumbnailUrl: string | null;
      album?: { coverUrl: string | null } | null;
    };
  }>;
};

export type { CoverSource };

export function extractPlaylistCoverImages(playlist: CoverSource): string[] {
  if (playlist.coverUrl) return [];

  const urls: string[] = [];
  for (const pt of playlist.tracks ?? []) {
    const url = pt.track.thumbnailUrl || pt.track.album?.coverUrl;
    if (url) {
      urls.push(url);
      if (urls.length >= 4) break;
    }
  }
  return urls;
}
