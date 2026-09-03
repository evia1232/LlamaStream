import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { body, validationResult } from 'express-validator';
import { authenticate, AuthRequest, optionalAuth } from '../middleware/auth';
import prisma from '../lib/prisma';
import { exportPlaylist, listUserSpotifyPlaylists } from '../services/spotify';
import { startPlaylistImport, startSpotifyPlaylistsImport, getImportJobStatus, importSpotifyPlaylist, listActiveImportJobs } from '../services/playlistImport';
import { trackStreamUrl } from '../services/trackDownload';
import { addTrackToPlaylist, nextPlaylistPosition } from '../lib/playlistTracks';
import { prefetchLibraryTrack } from '../services/downloader';
import { promoteTrackToLibrary, syncTracksAfterUnpin } from '../services/trackStorage';
import { extractPlaylistCoverImages, playlistCoverTracksQuery } from '../lib/playlistCovers';
import { config } from '../config';

const router = Router();

const coverStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(config.cachePath, 'covers');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage: coverStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

function formatPlaylist(playlist: {
  id: string;
  name: string;
  description: string | null;
  coverUrl: string | null;
  visibility: string;
  userId: string;
  createdAt: Date;
  tracks?: Array<{
    track: {
      id?: string;
      title?: string;
      duration?: number;
      thumbnailUrl: string | null;
      artist?: { name: string };
      album?: { coverUrl: string | null } | null;
    };
  }>;
  _count?: { tracks: number };
}, options?: { withTracks?: boolean }) {
  const coverImages = extractPlaylistCoverImages(playlist);
  const hasFullTracks = options?.withTracks && playlist.tracks?.some((pt) => pt.track.title);

  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    coverUrl: playlist.coverUrl,
    coverImages,
    visibility: playlist.visibility,
    userId: playlist.userId,
    createdAt: playlist.createdAt,
    trackCount: playlist._count?.tracks ?? (hasFullTracks ? playlist.tracks?.length : undefined) ?? 0,
    ...(hasFullTracks && playlist.tracks
      ? {
          tracks: playlist.tracks.map((pt) => ({
            id: pt.track.id!,
            title: pt.track.title!,
            duration: pt.track.duration!,
            thumbnailUrl: pt.track.thumbnailUrl,
            artist: pt.track.artist!.name,
          })),
        }
      : {}),
  };
}

router.get('/', authenticate, async (req: AuthRequest, res) => {
  const playlists = await prisma.playlist.findMany({
    where: { userId: req.user!.userId },
    include: {
      _count: { select: { tracks: true } },
      tracks: playlistCoverTracksQuery,
    },
    orderBy: { updatedAt: 'desc' },
  });
  res.json({ playlists: playlists.map((p) => formatPlaylist(p)) });
});

/** Playlist IDs that already contain this track (for add-to-playlist UI). */
router.get('/membership/:trackId', authenticate, async (req: AuthRequest, res) => {
  const trackId = req.params.trackId;
  const userId = req.user!.userId;

  const track = await prisma.track.findUnique({
    where: { id: trackId },
    select: { id: true, sourceId: true },
  });

  const trackIds = new Set<string>([trackId]);
  if (track?.sourceId) {
    const siblings = await prisma.track.findMany({
      where: { sourceId: track.sourceId },
      select: { id: true },
    });
    for (const s of siblings) trackIds.add(s.id);
  }

  const rows = await prisma.playlistTrack.findMany({
    where: {
      trackId: { in: [...trackIds] },
      playlist: { userId },
    },
    select: { playlistId: true },
    distinct: ['playlistId'],
  });

  res.json({ playlistIds: rows.map((r) => r.playlistId) });
});

router.get('/public', optionalAuth, async (_req, res) => {
  const playlists = await prisma.playlist.findMany({
    where: { visibility: 'PUBLIC' },
    include: {
      _count: { select: { tracks: true } },
      tracks: playlistCoverTracksQuery,
    },
    take: 20,
  });
  res.json({ playlists: playlists.map((p) => formatPlaylist(p)) });
});

router.post(
  '/',
  authenticate,
  body('name').notEmpty(),
  async (req: AuthRequest, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, description, visibility } = req.body;
    const playlist = await prisma.playlist.create({
      data: {
        name,
        description,
        visibility: visibility || 'PRIVATE',
        userId: req.user!.userId,
      },
      include: { _count: { select: { tracks: true } } },
    });
    res.status(201).json({ playlist: formatPlaylist(playlist) });
  }
);

router.get('/:id', authenticate, async (req: AuthRequest, res) => {
  const playlist = await prisma.playlist.findUnique({
    where: { id: req.params.id },
    include: {
      importJob: true,
      tracks: {
        orderBy: { position: 'asc' },
        include: { track: { include: { artist: true, album: true } } },
      },
    },
  });

  if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
  if (playlist.visibility === 'PRIVATE' && playlist.userId !== req.user!.userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const importJob = playlist.importJob
    ? {
        id: playlist.importJob.id,
        status: playlist.importJob.status,
        totalTracks: playlist.importJob.totalTracks,
        completedTracks: playlist.importJob.completedTracks,
        failedTracks: playlist.importJob.failedTracks,
        errors: playlist.importJob.errors,
      }
    : null;

  res.json({
    playlist: {
      ...formatPlaylist(playlist),
      importJob,
      tracks: playlist.tracks.map((pt) => ({
        id: pt.track.id,
        title: pt.track.title,
        duration: pt.track.duration,
        thumbnailUrl: pt.track.thumbnailUrl,
        streamUrl: trackStreamUrl(pt.track),
        isDownloaded: pt.track.isDownloaded,
        artist: pt.track.artist,
        album: pt.track.album,
        position: pt.position,
      })),
    },
  });
});

router.put('/:id', authenticate, async (req: AuthRequest, res) => {
  const playlist = await prisma.playlist.findUnique({ where: { id: req.params.id } });
  if (!playlist || playlist.userId !== req.user!.userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { name, description, visibility } = req.body;
  const updated = await prisma.playlist.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(visibility !== undefined && { visibility }),
    },
    include: { _count: { select: { tracks: true } } },
  });
  res.json({ playlist: formatPlaylist(updated) });
});

router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
  const playlist = await prisma.playlist.findUnique({
    where: { id: req.params.id },
    include: { tracks: { select: { trackId: true } } },
  });
  if (!playlist || playlist.userId !== req.user!.userId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const trackIds = playlist.tracks.map((t) => t.trackId);
  await prisma.playlist.delete({ where: { id: req.params.id } });
  void syncTracksAfterUnpin(trackIds).catch(console.error);
  res.json({ success: true });
});

router.post('/:id/cover', authenticate, upload.single('cover'), async (req: AuthRequest, res) => {
  const playlist = await prisma.playlist.findUnique({ where: { id: req.params.id } });
  if (!playlist || playlist.userId !== req.user!.userId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const coverUrl = `/api/media/covers/${req.file.filename}`;
  const updated = await prisma.playlist.update({
    where: { id: req.params.id },
    data: { coverUrl },
    include: { _count: { select: { tracks: true } } },
  });
  res.json({ playlist: formatPlaylist(updated) });
});

router.delete('/:id/cover', authenticate, async (req: AuthRequest, res) => {
  const playlist = await prisma.playlist.findUnique({ where: { id: req.params.id } });
  if (!playlist || playlist.userId !== req.user!.userId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const updated = await prisma.playlist.update({
    where: { id: req.params.id },
    data: { coverUrl: null },
    include: { _count: { select: { tracks: true } }, tracks: { include: { track: { include: { album: true } } }, orderBy: { position: 'asc' }, take: 4 } },
  });
  res.json({ playlist: formatPlaylist(updated) });
});

router.post('/:id/tracks', authenticate, async (req: AuthRequest, res) => {
  const playlist = await prisma.playlist.findUnique({
    where: { id: req.params.id },
    include: { tracks: true },
  });
  if (!playlist || playlist.userId !== req.user!.userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { trackId, position } = req.body;
  const pos = position ?? await nextPlaylistPosition(req.params.id);

  const { added } = await addTrackToPlaylist(req.params.id, trackId, pos);
  if (!added) {
    return res.status(409).json({ error: 'Track already in playlist' });
  }

  await promoteTrackToLibrary(trackId);

  const [track, user] = await Promise.all([
    prisma.track.findUnique({ where: { id: trackId }, select: { isDownloaded: true } }),
    prisma.user.findUnique({ where: { id: req.user!.userId }, select: { audioQuality: true } }),
  ]);
  if (track && !track.isDownloaded) {
    void prefetchLibraryTrack(trackId, user?.audioQuality || 'HIGH').catch(console.error);
  }

  res.status(201).json({ success: true });
});

router.delete('/:id/tracks/:trackId', authenticate, async (req: AuthRequest, res) => {
  const playlist = await prisma.playlist.findUnique({ where: { id: req.params.id } });
  if (!playlist || playlist.userId !== req.user!.userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  await prisma.playlistTrack.deleteMany({
    where: { playlistId: req.params.id, trackId: req.params.trackId },
  });
  void syncTracksAfterUnpin([req.params.trackId]).catch(console.error);
  res.json({ success: true });
});

router.put('/:id/tracks/reorder', authenticate, async (req: AuthRequest, res) => {
  const playlist = await prisma.playlist.findUnique({ where: { id: req.params.id } });
  if (!playlist || playlist.userId !== req.user!.userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { trackIds } = req.body as { trackIds: string[] };
  for (let i = 0; i < trackIds.length; i++) {
    await prisma.playlistTrack.updateMany({
      where: { playlistId: req.params.id, trackId: trackIds[i] },
      data: { position: i },
    });
  }
  res.json({ success: true });
});

router.get('/spotify/library', authenticate, async (req: AuthRequest, res) => {
  try {
    const playlists = await listUserSpotifyPlaylists(req.user!.userId);
    res.json({ playlists });
  } catch (err) {
    const message = (err as Error).message;
    const status = message.includes('not connected') ? 401 : 500;
    res.status(status).json({ error: message });
  }
});

router.post('/import/spotify/selected', authenticate, async (req: AuthRequest, res) => {
  const { playlistIds } = req.body as { playlistIds?: string[] };
  if (!Array.isArray(playlistIds) || playlistIds.length === 0) {
    return res.status(400).json({ error: 'playlistIds array required' });
  }

  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });

  try {
    const result = await startSpotifyPlaylistsImport(
      playlistIds,
      req.user!.userId,
      user?.audioQuality || 'HIGH',
    );
    res.status(202).json(result);
  } catch (err) {
    const message = (err as Error).message;
    const status = message.includes('Connect Spotify') ? 401 : 500;
    res.status(status).json({ error: message });
  }
});

router.post('/import/spotify', authenticate, async (req: AuthRequest, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Playlist URL required' });

  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });

  try {
    const result = await startPlaylistImport(url, req.user!.userId, user?.audioQuality || 'HIGH');
    res.status(202).json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/import', authenticate, async (req: AuthRequest, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Playlist URL required' });

  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });

  try {
    const result = await startPlaylistImport(url, req.user!.userId, user?.audioQuality || 'HIGH');
    res.status(202).json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/import/active', authenticate, async (req: AuthRequest, res) => {
  const jobs = await listActiveImportJobs(req.user!.userId);
  res.json({ jobs });
});

router.get('/import/:jobId', authenticate, async (req: AuthRequest, res) => {
  const status = await getImportJobStatus(req.params.jobId, req.user!.userId);
  if (!status) return res.status(404).json({ error: 'Import job not found' });
  res.json(status);
});

router.post('/import/spotify/sync', authenticate, async (req: AuthRequest, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Spotify playlist URL required' });

  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });

  try {
    const result = await importSpotifyPlaylist(url, req.user!.userId, user?.audioQuality || 'HIGH');
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/:id/export', optionalAuth, async (req: AuthRequest, res) => {
  // Support token via query param for download links
  let userId = req.user?.userId;
  if (!userId && req.query.token) {
    try {
      const payload = jwt.verify(req.query.token as string, config.jwtSecret) as { userId: string };
      userId = payload.userId;
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }
  if (!userId) return res.status(401).json({ error: 'Authentication required' });

  const playlist = await prisma.playlist.findUnique({ where: { id: req.params.id } });
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
  if (playlist.visibility === 'PRIVATE' && playlist.userId !== userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const format = (req.query.format as 'json' | 'm3u' | 'txt') || 'json';
  try {
    const exported = await exportPlaylist(req.params.id, format);
    res.setHeader('Content-Type', exported.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    res.send(exported.content);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
