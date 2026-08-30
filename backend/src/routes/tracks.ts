import { Router, Response, Request } from 'express';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { body, query, validationResult } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/auth';
import { config } from '../config';
import prisma from '../lib/prisma';
import { searchTracks, downloadTrack, getOrCreateTrackFromSearch, fetchLyricsForTrack } from '../services/downloader';

const router = Router();

function formatTrack(track: {
  id: string;
  title: string;
  duration: number;
  filePath: string | null;
  sourceUrl: string | null;
  sourceId: string | null;
  thumbnailUrl: string | null;
  quality: string;
  isDownloaded: boolean;
  artist: { id: string; name: string; imageUrl: string | null };
  album?: { id: string; title: string; coverUrl: string | null } | null;
}) {
  return {
    id: track.id,
    title: track.title,
    duration: track.duration,
    thumbnailUrl: track.thumbnailUrl,
    sourceUrl: track.sourceUrl,
    sourceId: track.sourceId,
    quality: track.quality,
    isDownloaded: track.isDownloaded,
    artist: track.artist,
    album: track.album || null,
    streamUrl: track.isDownloaded ? `/api/tracks/${track.id}/stream` : null,
  };
}

router.get('/search', authenticate, query('q').notEmpty(), async (req: AuthRequest, res) => {
  const q = req.query.q as string;
  const limit = parseInt(req.query.limit as string) || 20;

  // Search local library
  const localTracks = await prisma.track.findMany({
    where: {
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { artist: { name: { contains: q, mode: 'insensitive' } } },
      ],
    },
    include: { artist: true, album: true },
    take: limit,
  });

  // Search external sources
  let external: Awaited<ReturnType<typeof searchTracks>> = [];
  try {
    external = await searchTracks(q, limit);
  } catch (err) {
    console.error('External search failed:', err);
  }

  const artists = await prisma.artist.findMany({
    where: { name: { contains: q, mode: 'insensitive' } },
    take: 10,
  });

  const albums = await prisma.album.findMany({
    where: { title: { contains: q, mode: 'insensitive' } },
    include: { artist: true },
    take: 10,
  });

  const playlists = await prisma.playlist.findMany({
    where: {
      name: { contains: q, mode: 'insensitive' },
      OR: [{ visibility: 'PUBLIC' }, { userId: req.user!.userId }],
    },
    take: 10,
  });

  res.json({
    tracks: localTracks.map(formatTrack),
    external,
    artists,
    albums,
    playlists,
  });
});

router.get('/liked', authenticate, async (req: AuthRequest, res) => {
  const liked = await prisma.likedTrack.findMany({
    where: { userId: req.user!.userId },
    include: { track: { include: { artist: true, album: true } } },
    orderBy: { likedAt: 'desc' },
  });
  res.json({ tracks: liked.map((l) => formatTrack(l.track)) });
});

router.get('/history', authenticate, async (req: AuthRequest, res) => {
  const history = await prisma.playHistory.findMany({
    where: { userId: req.user!.userId },
    include: { track: { include: { artist: true, album: true } } },
    orderBy: { playedAt: 'desc' },
    take: 50,
    distinct: ['trackId'],
  });
  res.json({ tracks: history.map((h) => formatTrack(h.track)) });
});

router.get('/recent', authenticate, async (req: AuthRequest, res) => {
  const recent = await prisma.playHistory.findMany({
    where: { userId: req.user!.userId },
    include: { track: { include: { artist: true, album: true } } },
    orderBy: { playedAt: 'desc' },
    take: 20,
  });
  res.json({ tracks: recent.map((h) => formatTrack(h.track)) });
});

router.get('/:id', authenticate, async (req, res) => {
  const track = await prisma.track.findUnique({
    where: { id: req.params.id },
    include: { artist: true, album: true, lyrics: true },
  });
  if (!track) return res.status(404).json({ error: 'Track not found' });
  res.json({ track: { ...formatTrack(track), lyrics: track.lyrics } });
});

router.post(
  '/download',
  authenticate,
  body('query').optional().isString(),
  body('url').optional().isURL(),
  async (req: AuthRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    const quality = user?.audioQuality || 'HIGH';

    try {
      if (req.body.url) {
        const download = await downloadTrack(req.body.url, quality);
        let artist = await prisma.artist.findUnique({ where: { name: download.artist } });
        if (!artist) artist = await prisma.artist.create({ data: { name: download.artist } });

        const track = await prisma.track.create({
          data: {
            title: download.title,
            artistId: artist.id,
            duration: download.duration,
            filePath: download.filePath,
            sourceUrl: download.sourceUrl,
            sourceId: download.sourceId,
            thumbnailUrl: download.thumbnailUrl,
            quality,
            isDownloaded: true,
          },
          include: { artist: true, album: true },
        });

        fetchLyricsForTrack(track.id, download.title, download.artist).catch(console.error);
        return res.status(201).json({ track: formatTrack(track) });
      }

      if (req.body.query) {
        const track = await getOrCreateTrackFromSearch(req.body.query, quality);
        return res.status(201).json({ track: formatTrack(track) });
      }

      return res.status(400).json({ error: 'Provide query or url' });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  }
);

function streamAuth(req: Request, res: Response, next: () => void) {
  const header = req.headers.authorization;
  const queryToken = req.query.token as string | undefined;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : queryToken;

  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

router.get('/:id/stream', streamAuth, async (req, res) => {
  const track = await prisma.track.findUnique({ where: { id: req.params.id } });
  if (!track?.filePath || !track.isDownloaded) {
    return res.status(404).json({ error: 'Track not available for streaming' });
  }

  if (!fs.existsSync(track.filePath)) {
    return res.status(404).json({ error: 'Audio file not found on disk' });
  }

  const stat = fs.statSync(track.filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'audio/mpeg',
    });
    fs.createReadStream(track.filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(track.filePath).pipe(res);
  }
});

router.post('/:id/like', authenticate, async (req: AuthRequest, res) => {
  const existing = await prisma.likedTrack.findUnique({
    where: { userId_trackId: { userId: req.user!.userId, trackId: req.params.id } },
  });

  if (existing) {
    await prisma.likedTrack.delete({ where: { id: existing.id } });
    return res.json({ liked: false });
  }

  await prisma.likedTrack.create({
    data: { userId: req.user!.userId, trackId: req.params.id },
  });
  res.json({ liked: true });
});

router.post('/:id/play', authenticate, async (req: AuthRequest, res) => {
  await prisma.playHistory.create({
    data: { userId: req.user!.userId, trackId: req.params.id },
  });
  res.json({ success: true });
});

router.get('/:id/lyrics', authenticate, async (req, res) => {
  const lyrics = await prisma.lyrics.findUnique({ where: { trackId: req.params.id } });
  if (!lyrics) return res.status(404).json({ error: 'Lyrics not found' });
  res.json({ lyrics });
});

router.put('/:id/lyrics', authenticate, async (req: AuthRequest, res) => {
  const { content, synced, lines } = req.body;
  const lyrics = await prisma.lyrics.upsert({
    where: { trackId: req.params.id },
    create: { trackId: req.params.id, content, synced: synced || false, lines, source: 'manual' },
    update: { content, synced, lines, source: 'manual' },
  });
  res.json({ lyrics });
});

export default router;
