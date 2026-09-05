import { Router } from 'express';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import {
  getPublicAppSettings,
  setThemePresetId,
  isThemePreset,
  THEME_PRESETS,
} from '../services/appSettings';
import {
  getYtdlpProfileStatus,
  setMultiProfileEnabled,
} from '../services/ytdlpProfiles';

const router = Router();

router.get('/public', async (_req, res) => {
  try {
    const settings = await getPublicAppSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/theme', authenticate, requireAdmin, async (_req, res) => {
  try {
    const settings = await getPublicAppSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.put('/theme', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { preset } = req.body as { preset?: string };
    if (!preset || !isThemePreset(preset)) {
      return res.status(400).json({
        error: 'Invalid preset',
        presets: Object.keys(THEME_PRESETS),
      });
    }
    await setThemePresetId(preset);
    const settings = await getPublicAppSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/ytdlp', authenticate, requireAdmin, async (_req, res) => {
  try {
    const status = await getYtdlpProfileStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.put('/ytdlp', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { multiProfile } = req.body as { multiProfile?: boolean };
    if (typeof multiProfile !== 'boolean') {
      return res.status(400).json({ error: 'multiProfile boolean required' });
    }
    await setMultiProfileEnabled(multiProfile);
    const status = await getYtdlpProfileStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
