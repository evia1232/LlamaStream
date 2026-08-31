import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';

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
      include: { _count: { select: { tracks: true } } },
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
    include: { _count: { select: { tracks: true } } },
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
      trackCount: p._count.tracks,
    })),
    madeForYou: publicPlaylists.map((p) => ({
      id: p.id,
      name: p.name,
      coverUrl: p.coverUrl,
      trackCount: p._count.tracks,
    })),
    topArtists: artists.map((a) => ({
      id: a.id,
      name: a.name,
      imageUrl: a.imageUrl,
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
  artist: { id: string; name: string };
  album?: { id: string; title: string; coverUrl: string | null } | null;
}) {
  return {
    id: track.id,
    title: track.title,
    duration: track.duration,
    thumbnailUrl: track.thumbnailUrl,
    isDownloaded: track.isDownloaded,
    streamUrl: track.isDownloaded ? `/api/tracks/${track.id}/stream` : null,
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

router.get('/artists/:id', authenticate, async (req, res) => {
  const artist = await prisma.artist.findUnique({
    where: { id: req.params.id },
    include: {
      albums: { include: { tracks: { include: { artist: true } } } },
      tracks: { include: { artist: true, album: true } },
    },
  });
  if (!artist) return res.status(404).json({ error: 'Artist not found' });
  res.json({ artist });
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
