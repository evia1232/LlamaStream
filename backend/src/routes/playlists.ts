import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { body, validationResult } from 'express-validator';
import { authenticate, AuthRequest, optionalAuth } from '../middleware/auth';
import prisma from '../lib/prisma';
import { exportPlaylist } from '../services/spotify';
import { startPlaylistImport, getImportJobStatus, importSpotifyPlaylist } from '../services/playlistImport';
import { addTrackToPlaylist, nextPlaylistPosition } from '../lib/playlistTracks';
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
const upload = multer({ storage: coverStorage, limits: { fileSize: 5 * 1024 * 1024 } });

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

  res.json({
    playlist: {
      ...formatPlaylist(playlist),
      tracks: playlist.tracks.map((pt) => ({
        id: pt.track.id,
        title: pt.track.title,
        duration: pt.track.duration,
        thumbnailUrl: pt.track.thumbnailUrl,
        streamUrl: pt.track.isDownloaded ? `/api/tracks/${pt.track.id}/stream` : null,
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
  const playlist = await prisma.playlist.findUnique({ where: { id: req.params.id } });
  if (!playlist || playlist.userId !== req.user!.userId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  await prisma.playlist.delete({ where: { id: req.params.id } });
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
