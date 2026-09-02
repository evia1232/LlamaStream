import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { trackStreamUrl } from '../services/trackDownload';
import { effectiveDownloadedFlag } from '../services/trackIntegrity';
import { buildArtistPage, fetchArtistSpotifyData } from '../services/artistPage';
import prisma from '../lib/prisma';
import { extractPlaylistCoverImages, playlistCoverTracksQuery } from '../lib/playlistCovers';

const router = Router();

router.get('/', authenticate, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;

  const [recentTracks, likedCount, playlists, recentHistory] = await Promise.all([
    prisma.playHistory.findMany({
      where: { userId },
      include: { track: { include: { artist: true } } },
      orderBy: { playedAt: 'desc' },
      take: 10,
      distinct: ['trackId'],
    }),
    prisma.likedTrack.count({ where: { userId } }),
    prisma.playlist.findMany({
      where: { userId },
      include: {
        _count: { select: { tracks: true } },
        tracks: playlistCoverTracksQuery,
      },
      orderBy: { updatedAt: 'desc' },
      take: 6,
    }),
    prisma.playHistory.findMany({
      where: { userId },
      include: { track: { include: { artist: true, album: true } } },
      orderBy: { playedAt: 'desc' },
      take: 20,
    }),
  ]);

  const artists = await prisma.artist.findMany({
    take: 8,
    orderBy: { updatedAt: 'desc' },
  });

  const publicPlaylists = await prisma.playlist.findMany({
    where: { visibility: 'PUBLIC' },
    include: {
      _count: { select: { tracks: true } },
      tracks: playlistCoverTracksQuery,
    },
    take: 6,
  });

  res.json({
    greeting: getGreeting(),
    recentlyPlayed: recentTracks.map((h) => formatHomeTrack(h.track)),
    likedCount,
    yourPlaylists: playlists.map((p) => ({
      id: p.id,
      name: p.name,
      coverUrl: p.coverUrl,
      coverImages: extractPlaylistCoverImages(p),
      trackCount: p._count.tracks,
    })),
    madeForYou: publicPlaylists.map((p) => ({
      id: p.id,
      name: p.name,
      coverUrl: p.coverUrl,
      coverImages: extractPlaylistCoverImages(p),
      trackCount: p._count.tracks,
    })),
    topArtists: artists.map((a) => ({
      id: a.id,
      name: a.name,
      imageUrl: a.imageUrl,
      spotifyArtistId: a.spotifyArtistId,
    })),
    history: recentHistory.map((h) => ({
      ...formatHomeTrack(h.track),
      playedAt: h.playedAt,
    })),
  });
});

function formatHomeTrack(track: {
  id: string;
  title: string;
  duration: number;
  thumbnailUrl: string | null;
  isDownloaded: boolean;
  filePath: string | null;
  sourceUrl: string | null;
  artist: { id: string; name: string };
  album?: { id: string; title: string; coverUrl: string | null } | null;
}) {
  const isDownloaded = effectiveDownloadedFlag(track);
  return {
    id: track.id,
    title: track.title,
    duration: track.duration,
    thumbnailUrl: track.thumbnailUrl,
    isDownloaded,
    streamUrl: trackStreamUrl({ id: track.id, isDownloaded, sourceUrl: track.sourceUrl }),
    artist: { id: track.artist.id, name: track.artist.name },
    album: track.album ? { id: track.album.id, title: track.album.title, coverUrl: track.album.coverUrl } : null,
  };
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'goodMorning';
  if (hour < 18) return 'goodAfternoon';
  return 'goodEvening';
}

router.get('/artists/by-name/:name/spotify', authenticate, async (req: AuthRequest, res) => {
  const name = decodeURIComponent(req.params.name);
  if (!name.trim()) return res.status(400).json({ error: 'Artist name required' });
  const spotifyArtistId = typeof req.query.spotifyArtistId === 'string' ? req.query.spotifyArtistId : undefined;
  const spotifyTrackId = typeof req.query.spotifyTrackId === 'string' ? req.query.spotifyTrackId : undefined;
  const spotify = await fetchArtistSpotifyData(name, { spotifyArtistId, spotifyTrackId });
  res.json({ spotify });
});

router.get('/artists/by-name/:name', authenticate, async (req: AuthRequest, res) => {
  const name = decodeURIComponent(req.params.name);
  if (!name.trim()) return res.status(400).json({ error: 'Artist name required' });
  const spotifyArtistId = typeof req.query.spotifyArtistId === 'string' ? req.query.spotifyArtistId : undefined;
  const spotifyTrackId = typeof req.query.spotifyTrackId === 'string' ? req.query.spotifyTrackId : undefined;
  try {
    const data = await buildArtistPage(req.user!.userId, name, undefined, { spotifyArtistId, spotifyTrackId });
    res.json(data);
  } catch (err) {
    console.error('[Artist] by-name failed:', err);
    res.status(500).json({ error: 'Failed to load artist' });
  }
});

router.get('/artists/:id/spotify', authenticate, async (req: AuthRequest, res) => {
  const artist = await prisma.artist.findUnique({ where: { id: req.params.id } });
  if (!artist) return res.status(404).json({ error: 'Artist not found' });
  const spotify = await fetchArtistSpotifyData(artist.name, { spotifyArtistId: artist.spotifyArtistId }, artist.id);
  res.json({ spotify });
});

router.get('/artists/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const artist = await prisma.artist.findUnique({ where: { id: req.params.id } });
    if (artist) {
      const spotifyArtistId = typeof req.query.spotifyArtistId === 'string' ? req.query.spotifyArtistId : undefined;
      const spotifyTrackId = typeof req.query.spotifyTrackId === 'string' ? req.query.spotifyTrackId : undefined;
      const data = await buildArtistPage(req.user!.userId, artist.name, artist.id, { spotifyArtistId, spotifyTrackId });
      return res.json(data);
    }
    // Fallback: load by treating param as encoded name (legacy / malformed links)
    const fallbackName = decodeURIComponent(req.params.id);
    const data = await buildArtistPage(req.user!.userId, fallbackName);
    res.json(data);
  } catch (err) {
    console.error('[Artist] load failed:', err);
    res.status(500).json({ error: 'Failed to load artist' });
  }
});

router.get('/albums/:id', authenticate, async (req, res) => {
  const album = await prisma.album.findUnique({
    where: { id: req.params.id },
    include: {
      artist: true,
      tracks: { include: { artist: true, album: true } },
    },
  });
  if (!album) return res.status(404).json({ error: 'Album not found' });
  res.json({ album });
});

export default router;
