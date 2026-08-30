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
    createdAt: user.createdAt,
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
  async (req: AuthRequest, res) => {
    const { displayName, language, audioQuality } = req.body;
    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: {
        ...(displayName !== undefined && { displayName }),
        ...(language !== undefined && { language }),
        ...(audioQuality !== undefined && { audioQuality }),
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

export default router;
