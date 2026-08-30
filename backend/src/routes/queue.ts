import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';

const router = Router();

function formatQueueItem(item: {
  id: string;
  position: number;
  track: {
    id: string;
    title: string;
    duration: number;
    thumbnailUrl: string | null;
    isDownloaded: boolean;
    artist: { id: string; name: string };
    album?: { id: string; title: string } | null;
  };
}) {
  return {
    id: item.id,
    position: item.position,
    track: {
      id: item.track.id,
      title: item.track.title,
      duration: item.track.duration,
      thumbnailUrl: item.track.thumbnailUrl,
      isDownloaded: item.track.isDownloaded,
      streamUrl: item.track.isDownloaded ? `/api/tracks/${item.track.id}/stream` : null,
      artist: item.track.artist,
      album: item.track.album,
    },
  };
}

router.get('/', authenticate, async (req: AuthRequest, res) => {
  const items = await prisma.queueItem.findMany({
    where: { userId: req.user!.userId },
    include: { track: { include: { artist: true, album: true } } },
    orderBy: { position: 'asc' },
  });
  res.json({ queue: items.map(formatQueueItem) });
});

router.post('/', authenticate, async (req: AuthRequest, res) => {
  const { trackId, playNext } = req.body;

  const existing = await prisma.queueItem.findMany({
    where: { userId: req.user!.userId },
    orderBy: { position: 'asc' },
  });

  let position: number;
  if (playNext) {
    position = 0;
    // Shift all items down
    for (const item of existing) {
      await prisma.queueItem.update({
        where: { id: item.id },
        data: { position: item.position + 1 },
      });
    }
  } else {
    position = existing.length > 0 ? Math.max(...existing.map((i) => i.position)) + 1 : 0;
  }

  const item = await prisma.queueItem.create({
    data: { userId: req.user!.userId, trackId, position },
    include: { track: { include: { artist: true, album: true } } },
  });
  res.status(201).json({ item: formatQueueItem(item) });
});

router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
  const item = await prisma.queueItem.findUnique({ where: { id: req.params.id } });
  if (!item || item.userId !== req.user!.userId) {
    return res.status(404).json({ error: 'Queue item not found' });
  }

  await prisma.queueItem.delete({ where: { id: req.params.id } });

  // Reorder remaining
  const remaining = await prisma.queueItem.findMany({
    where: { userId: req.user!.userId },
    orderBy: { position: 'asc' },
  });
  for (let i = 0; i < remaining.length; i++) {
    await prisma.queueItem.update({ where: { id: remaining[i].id }, data: { position: i } });
  }

  res.json({ success: true });
});

router.put('/reorder', authenticate, async (req: AuthRequest, res) => {
  const { itemIds } = req.body as { itemIds: string[] };
  for (let i = 0; i < itemIds.length; i++) {
    await prisma.queueItem.updateMany({
      where: { id: itemIds[i], userId: req.user!.userId },
      data: { position: i },
    });
  }
  res.json({ success: true });
});

router.delete('/', authenticate, async (req: AuthRequest, res) => {
  await prisma.queueItem.deleteMany({ where: { userId: req.user!.userId } });
  res.json({ success: true });
});

export default router;
