import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { loadAlbumPage, openSpotifyAlbumInApp } from '../services/albumCatalog';

const router = Router();

router.get('/spotify/:spotifyAlbumId', authenticate, async (req, res) => {
  try {
    const page = await openSpotifyAlbumInApp(req.params.spotifyAlbumId);
    if (!page) return res.status(404).json({ error: 'Album not found' });
    res.json(page);
  } catch (err) {
    console.error('Open Spotify album:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const page = await loadAlbumPage(req.params.id);
    if (!page) return res.status(404).json({ error: 'Album not found' });
    res.json(page);
  } catch (err) {
    console.error('Get album:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
