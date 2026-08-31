import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import prisma from '../lib/prisma';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import {
  buildSpotifyAuthUrl,
  verifySpotifyState,
  connectSpotifyUser,
  disconnectSpotifyUser,
  getSpotifyAccessTokenForUser,
  getSpotifyStatusForUser,
  getSpotifyRedirectUri,
  isSpotifyOAuthConfigured,
} from '../services/spotifyOAuth';

const router = Router();

const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(config.avatarPath)) fs.mkdirSync(config.avatarPath, { recursive: true });
    cb(null, config.avatarPath);
  },
  filename: (_req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  },
});
const upload = multer({ storage: avatarStorage, limits: { fileSize: 5 * 1024 * 1024 } });

function signToken(userId: string, role: 'USER' | 'ADMIN') {
  return jwt.sign({ userId, role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'] });
}

function sanitizeUser(user: {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: string;
  audioQuality: string;
  language: string;
  createdAt: Date;
  searchSpotifyEnabled?: boolean;
  searchYoutubeEnabled?: boolean;
  spotifyUserId?: string | null;
  spotifyProduct?: string | null;
  spotifyConnectedAt?: Date | null;
}) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    audioQuality: user.audioQuality,
    language: user.language,
    searchSpotifyEnabled: user.searchSpotifyEnabled ?? true,
    searchYoutubeEnabled: user.searchYoutubeEnabled ?? true,
    createdAt: user.createdAt,
    spotify: getSpotifyStatusForUser({
      spotifyUserId: user.spotifyUserId ?? null,
      spotifyProduct: user.spotifyProduct ?? null,
      spotifyConnectedAt: user.spotifyConnectedAt ?? null,
    }),
  };
}

router.post(
  '/register',
  body('email').isEmail(),
  body('username').isLength({ min: 3 }),
  body('password').isLength({ min: 8 }),
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, username, password, displayName } = req.body;

    // Public registration disabled unless explicitly enabled
    if (!config.allowPublicRegistration) {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(403).json({ error: 'Public registration is disabled. Contact an administrator.' });
      }
      try {
        const payload = jwt.verify(authHeader.slice(7), config.jwtSecret) as { role: string };
        if (payload.role !== 'ADMIN') {
          return res.status(403).json({ error: 'Only administrators can create accounts.' });
        }
      } catch {
        return res.status(403).json({ error: 'Only administrators can create accounts.' });
      }
    }

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });
    if (existing) return res.status(409).json({ error: 'Email or username already exists' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, username, passwordHash, displayName: displayName || username },
    });

    const token = signToken(user.id, user.role);
    res.status(201).json({ user: sanitizeUser(user), token });
  }
);

router.post(
  '/login',
  body('email').isEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user.id, user.role);
    res.json({ user: sanitizeUser(user), token });
  }
);

router.get('/me', authenticate, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: sanitizeUser(user) });
});

router.put(
  '/profile',
  authenticate,
  body('displayName').optional().isString(),
  body('language').optional().isIn(['he', 'en']),
  body('audioQuality').optional().isIn(['LOW', 'NORMAL', 'HIGH']),
  body('searchSpotifyEnabled').optional().isBoolean(),
  body('searchYoutubeEnabled').optional().isBoolean(),
  async (req: AuthRequest, res) => {
    const { displayName, language, audioQuality, searchSpotifyEnabled, searchYoutubeEnabled } = req.body;
    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: {
        ...(displayName !== undefined && { displayName }),
        ...(language !== undefined && { language }),
        ...(audioQuality !== undefined && { audioQuality }),
        ...(searchSpotifyEnabled !== undefined && { searchSpotifyEnabled }),
        ...(searchYoutubeEnabled !== undefined && { searchYoutubeEnabled }),
      },
    });
    res.json({ user: sanitizeUser(user) });
  }
);

router.post('/avatar', authenticate, upload.single('avatar'), async (req: AuthRequest, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const avatarUrl = `/api/media/avatars/${req.file.filename}`;
  const user = await prisma.user.update({
    where: { id: req.user!.userId },
    data: { avatarUrl },
  });
  res.json({ user: sanitizeUser(user) });
});

// Admin: list users
router.get('/users', authenticate, requireAdmin, async (_req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true, email: true, username: true, displayName: true,
      avatarUrl: true, role: true, createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ users });
});

// Admin: create user
router.post(
  '/users',
  authenticate,
  requireAdmin,
  body('email').isEmail(),
  body('username').isLength({ min: 3 }),
  body('password').isLength({ min: 8 }),
  body('role').optional().isIn(['USER', 'ADMIN']),
  async (req: AuthRequest, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, username, password, displayName, role } = req.body;
    const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] } });
    if (existing) return res.status(409).json({ error: 'Email or username already exists' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, username, passwordHash, displayName: displayName || username, role: role || 'USER' },
    });
    res.status(201).json({ user: sanitizeUser(user) });
  }
);

// Admin: update user
router.put('/users/:id', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  const { displayName, role, password } = req.body;
  const data: Record<string, unknown> = {};
  if (displayName !== undefined) data.displayName = displayName;
  if (role !== undefined) data.role = role;
  if (password) data.passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data,
  });
  res.json({ user: sanitizeUser(user) });
});

// Admin: delete user
router.delete('/users/:id', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  if (req.params.id === req.user!.userId) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  await prisma.user.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

router.get('/spotify/status', authenticate, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    configured: isSpotifyOAuthConfigured(),
    redirectUri: getSpotifyRedirectUri(),
    ...getSpotifyStatusForUser(user),
  });
});

router.get('/spotify/connect', authenticate, async (req: AuthRequest, res) => {
  if (!isSpotifyOAuthConfigured()) {
    return res.status(503).json({ error: 'Spotify OAuth not configured' });
  }
  res.json({ url: buildSpotifyAuthUrl(req.user!.userId) });
});

router.get('/spotify/callback', async (req, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  const redirectBase = `${config.frontendUrl}/settings`;

  if (error || !code || !state) {
    return res.redirect(`${redirectBase}?spotify=error`);
  }

  try {
    const userId = verifySpotifyState(state);
    const { product } = await connectSpotifyUser(userId, code);
    const status = product === 'premium' ? 'connected' : 'no_premium';
    return res.redirect(`${redirectBase}?spotify=${status}`);
  } catch (err) {
    console.error('Spotify OAuth callback error:', err);
    return res.redirect(`${redirectBase}?spotify=error`);
  }
});

router.delete('/spotify/disconnect', authenticate, async (req: AuthRequest, res) => {
  await disconnectSpotifyUser(req.user!.userId);
  res.json({ success: true });
});

router.get('/spotify/token', authenticate, async (req: AuthRequest, res) => {
  try {
    const accessToken = await getSpotifyAccessTokenForUser(req.user!.userId);
    res.json({ accessToken });
  } catch (err) {
    res.status(401).json({ error: (err as Error).message });
  }
});

export default router;
