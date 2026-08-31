import { Router, Response, Request } from 'express';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { body, query } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/auth';
import { config } from '../config';
import prisma from '../lib/prisma';
import { resolveAndDownload, downloadLibraryTrack, prefetchLibraryTrack, researchTrack, resolveYouTubeSource, upsertPendingTrack } from '../services/downloader';
import { ensureBackgroundDownload, trackStreamUrl, isDownloadInProgress } from '../services/trackDownload';
import { fetchLyricsForTrack } from '../services/lyrics';
import { unifiedSearch } from '../services/search';
import { isSpotifyUrl, isYouTubeUrl, parseSpotifyUrl } from '../services/spotify';
import { ytDlpVersion } from '../services/ytdlp';
import { getSpotifyStatus } from '../services/spotifyApi';
import { cleanupLibrary, deleteTrackById, getLibraryStats } from '../services/trackCleanup';

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
    isDownloading: !track.isDownloaded && !!track.sourceUrl && isDownloadInProgress(track.id),
    artist: track.artist,
    album: track.album || null,
    streamUrl: trackStreamUrl(track),
  };
}

router.get('/library/stats', authenticate, async (_req, res) => {
  try {
    const stats = await getLibraryStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.delete(
  '/library/cleanup',
  authenticate,
  body('mode').isIn(['all', 'recent']),
  async (req: AuthRequest, res) => {
    const { mode, days } = req.body as { mode: 'all' | 'recent'; days?: number };
    try {
      const result = await cleanupLibrary({ mode, days });
      res.json(result);
    } catch (err) {
      console.error('Library cleanup error:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

router.get('/search', authenticate, query('q').notEmpty(), async (req: AuthRequest, res) => {
  try {
    const q = req.query.q as string;
    const limit = parseInt(req.query.limit as string) || 20;
    const results = await unifiedSearch(q, req.user!.userId, limit);

    res.json({
      // Local library (downloaded + cached tracks)
      library: results.library,
      tracks: results.library,
      artists: results.artists,
      albums: results.albums,
      playlists: results.playlists,
      // External sources
      youtube: results.youtube,
      spotify: results.spotify,
      spotifyUrlTracks: results.spotifyUrlTracks,
      detectedUrl: results.detectedUrl,
      spotifyError: results.spotifyError,
      spotifyConfigured: results.spotifyConfigured,
      external: results.youtube,
    });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
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

router.get('/health/media', authenticate, async (_req, res) => {
  try {
    const [version, spotify] = await Promise.all([
      ytDlpVersion(),
      getSpotifyStatus(),
    ]);
    res.json({ ok: true, ytdlp: version, spotify });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

router.get('/playback-state', authenticate, async (req: AuthRequest, res) => {
  const state = await prisma.userPlayback.findUnique({
    where: { userId: req.user!.userId },
    include: { track: { include: { artist: true, album: true } } },
  });

  if (!state) {
    return res.json({ track: null, position: 0, isPlaying: false, volume: 0.7 });
  }

  if (state.track && !state.track.isDownloaded && !state.track.sourceUrl) {
    return res.json({
      track: null,
      position: 0,
      isPlaying: false,
      volume: state.volume ?? 0.7,
    });
  }

  if (!state.track) {
    return res.json({
      track: null,
      position: 0,
      isPlaying: false,
      volume: state.volume ?? 0.7,
    });
  }

  res.json({
    track: formatTrack(state.track),
    position: state.position,
    isPlaying: state.isPlaying,
    volume: state.volume ?? 0.7,
  });
});

router.put('/playback-state', authenticate, async (req: AuthRequest, res) => {
  const { trackId, position, isPlaying, volume } = req.body as {
    trackId?: string | null;
    position?: number;
    isPlaying?: boolean;
    volume?: number;
  };

  const clampedVolume = volume !== undefined
    ? Math.min(1, Math.max(0, volume))
    : undefined;

  if (!trackId) {
    if (clampedVolume !== undefined) {
      await prisma.userPlayback.upsert({
        where: { userId: req.user!.userId },
        create: { userId: req.user!.userId, volume: clampedVolume },
        update: { volume: clampedVolume },
      });
    } else {
      await prisma.userPlayback.deleteMany({ where: { userId: req.user!.userId } });
    }
    return res.json({ success: true });
  }

  const track = await prisma.track.findUnique({ where: { id: trackId }, include: { artist: true, album: true } });
  if (!track || (!track.isDownloaded && !track.sourceUrl)) {
    return res.status(400).json({ error: 'Track not available' });
  }

  await prisma.userPlayback.upsert({
    where: { userId: req.user!.userId },
    create: {
      userId: req.user!.userId,
      trackId,
      position: Math.max(0, position ?? 0),
      isPlaying: !!isPlaying,
      ...(clampedVolume !== undefined && { volume: clampedVolume }),
    },
    update: {
      trackId,
      position: Math.max(0, position ?? 0),
      isPlaying: !!isPlaying,
      ...(clampedVolume !== undefined && { volume: clampedVolume }),
    },
  });

  res.json({ success: true });
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
  async (req: AuthRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    const quality = user?.audioQuality || 'HIGH';
    const { query: searchQuery, url, title, artist, duration, album } = req.body;

    try {
      let input = searchQuery || url || '';
      if (!input && !title) {
        return res.status(400).json({ error: 'Provide query, url, title, or artist' });
      }

      // Spotify/YouTube URL or search query
      if (url || isSpotifyUrl(input) || isYouTubeUrl(input)) {
        const targetUrl = url || input;

        if (isYouTubeUrl(targetUrl)) {
          const track = await resolveAndDownload(targetUrl, quality, { url: targetUrl, title, artist, duration, album });
          return res.status(201).json({ track: formatTrack(track) });
        }

        if (isSpotifyUrl(targetUrl)) {
          if (title && artist) {
            const track = await resolveAndDownload(`${artist} - ${title}`, quality, { title, artist, duration, album });
            return res.status(201).json({ track: formatTrack(track) });
          }
          const parsed = await parseSpotifyUrl(targetUrl);
          if (parsed.tracks.length === 0) throw new Error('No tracks found in Spotify URL');
          const first = parsed.tracks[0];
          const track = await resolveAndDownload(
            `${first.artist} - ${first.name}`,
            quality,
            { title: first.name, artist: first.artist, duration: first.duration, album: first.album }
          );
          return res.status(201).json({ track: formatTrack(track) });
        }
      }

      const track = await resolveAndDownload(
        input || `${artist} - ${title}`,
        quality,
        { title, artist, duration, album }
      );
      return res.status(201).json({ track: formatTrack(track) });
    } catch (err) {
      console.error('Download error:', err);
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
  if (!track) return res.status(404).json({ error: 'Track not found' });

  if (track.isDownloaded && track.filePath && fs.existsSync(track.filePath)) {
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
    return;
  }

  return res.status(404).json({ error: 'Track not downloaded yet' });
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
  let lyrics = await prisma.lyrics.findUnique({ where: { trackId: req.params.id } });
  if (!lyrics) {
    lyrics = await fetchLyricsForTrack(req.params.id);
  }
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

router.post('/:id/download', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    const quality = user?.audioQuality || 'HIGH';
    const track = await downloadLibraryTrack(req.params.id, quality);
    res.json({ track: formatTrack(track) });
  } catch (err) {
    console.error('Download track error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/prefetch', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    const quality = user?.audioQuality || 'HIGH';
    const { url, title, artist, duration } = req.body as {
      url?: string;
      title?: string;
      artist?: string;
      duration?: number;
    };
    if (!url) return res.status(400).json({ error: 'url required' });

    const source = await resolveYouTubeSource(url, { url, title, artist, duration, relaxed: true });
    const track = await upsertPendingTrack(source, quality, title, artist);
    ensureBackgroundDownload(track.id, source.url, quality, { title, artist });
    res.json({ trackId: track.id, status: 'prefetching' });
  } catch (err) {
    console.error('Prefetch error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/:id/prefetch', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    const quality = user?.audioQuality || 'HIGH';
    const result = await prefetchLibraryTrack(req.params.id, quality);
    res.json(result);
  } catch (err) {
    console.error('Prefetch track error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/:id/research', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    const quality = user?.audioQuality || 'HIGH';
    const track = await researchTrack(req.params.id, quality);
    res.json({ track: formatTrack(track) });
  } catch (err) {
    console.error('Research track error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const deleted = await deleteTrackById(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Track not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete track error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
