import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { config } from './config';
import { errorHandler, notFound } from './middleware/errorHandler';
import { AuthPayload } from './middleware/auth';
import prisma from './lib/prisma';
import bcrypt from 'bcryptjs';

import authRoutes from './routes/auth';
import trackRoutes from './routes/tracks';
import playlistRoutes from './routes/playlists';
import queueRoutes from './routes/queue';
import homeRoutes from './routes/home';
import mediaRoutes from './routes/media';

const app = express();
const server = http.createServer(app);

// Trust reverse proxy (nginx, traefik, cloudflare) for HTTPS detection
app.set('trust proxy', 1);

// WebSocket for real-time playback sync
const wss = new WebSocketServer({ server, path: '/ws' });

interface WSClient extends WebSocket {
  userId?: string;
  isAlive?: boolean;
}

wss.on('connection', (ws: WSClient, req) => {
  ws.isAlive = true;

  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret) as AuthPayload;
      ws.userId = payload.userId;
    } catch {
      ws.close(4001, 'Invalid token');
      return;
    }
  }

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      // Broadcast playback state to user's other devices
      if (ws.userId && message.type === 'playback') {
        wss.clients.forEach((client) => {
          const c = client as WSClient;
          if (c !== ws && c.userId === ws.userId && c.readyState === WebSocket.OPEN) {
            c.send(JSON.stringify(message));
          }
        });
      }
    } catch {
      // ignore malformed messages
    }
  });
});

// Heartbeat
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    const client = ws as WSClient;
    if (!client.isAlive) return client.terminate();
    client.isAlive = false;
    client.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(interval));

app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/tracks', trackRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api/queue', queueRoutes);
app.use('/api/home', homeRoutes);
app.use('/api/media', mediaRoutes);

app.use(notFound);
app.use(errorHandler);

async function seedAdmin() {
  const adminEmail = config.adminEmail;
  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existing) return;

  const passwordHash = await bcrypt.hash(config.adminPassword, 12);
  await prisma.user.create({
    data: {
      email: adminEmail,
      username: config.adminUsername,
      passwordHash,
      displayName: 'Administrator',
      role: 'ADMIN',
      language: 'he',
    },
  });
  console.log(`Admin user seeded: ${adminEmail}`);
}

async function start() {
  await seedAdmin();
  server.listen(config.port, () => {
    console.log(`LlamaStream backend running on port ${config.port}`);
  });
}

start().catch(console.error);

export default app;
