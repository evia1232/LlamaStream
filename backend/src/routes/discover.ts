import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';
import { getDiscoverRecommendations, getNextDiscoverTrack } from '../services/discover';

const router = Router();

router.get('/recommendations', authenticate, async (req: AuthRequest, res) => {
  try {
    const seedTrackId = req.query.seedTrackId as string | undefined;
    const limit = Math.min(20, parseInt(req.query.limit as string, 10) || 12);
    const result = await getDiscoverRecommendations(req.user!.userId, seedTrackId, limit);
    res.json(result);
  } catch (err) {
    console.error('Discover recommendations error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/next', authenticate, async (req: AuthRequest, res) => {
  try {
    const seedTrackId = req.query.seedTrackId as string;
    if (!seedTrackId) return res.status(400).json({ error: 'seedTrackId required' });

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    const quality = user?.audioQuality || 'HIGH';
    const result = await getNextDiscoverTrack(req.user!.userId, seedTrackId, quality);
    res.json(result);
  } catch (err) {
    console.error('Discover next error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
