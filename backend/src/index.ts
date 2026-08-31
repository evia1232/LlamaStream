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
import {
  registerDevice,
  unregisterDevice,
  listDevices,
  broadcastToUser,
  getSharedPlaybackState,
  updateSharedPlayback,
} from './services/playbackSync';

import authRoutes from './routes/auth';
import trackRoutes from './routes/tracks';
import playlistRoutes from './routes/playlists';
import queueRoutes from './routes/queue';
import homeRoutes from './routes/home';
import discoverRoutes from './routes/discover';
import mediaRoutes from './routes/media';
import { resumePendingImports } from './services/playlistImport';
import { evictStaleCache } from './services/trackStorage';

const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1);

const wss = new WebSocketServer({ server, path: '/ws' });

interface WSClient extends WebSocket {
  userId?: string;
  deviceId?: string;
  isAlive?: boolean;
}

function formatTrackForSync(track: {
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
    isDownloaded: track.isDownloaded,
    quality: track.quality,
    artist: track.artist,
    album: track.album || null,
  };
}

async function sendSyncState(userId: string, ws: WebSocket) {
  const state = await getSharedPlaybackState(userId);
  const devices = listDevices(userId);
  ws.send(JSON.stringify({
    type: 'sync',
    devices,
    activeDeviceId: state?.activeDeviceId ?? null,
    activeDeviceName: state?.activeDeviceName ?? null,
    track: state?.track ? formatTrackForSync(state.track) : null,
    position: state?.position ?? 0,
    isPlaying: state?.isPlaying ?? false,
    volume: state?.volume ?? 0.7,
  }));
}

wss.on('connection', (ws: WSClient, req) => {
  ws.isAlive = true;

  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token) {
    ws.close(4001, 'Missing token');
    return;
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret) as AuthPayload;
    ws.userId = payload.userId;
  } catch {
    ws.close(4001, 'Invalid token');
    return;
  }

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString()) as {
        type: string;
        deviceId?: string;
        deviceName?: string;
        trackId?: string;
        position?: number;
        isPlaying?: boolean;
        volume?: number;
        action?: string;
        targetDeviceId?: string;
        seekTime?: number;
      };

      if (!ws.userId) return;

      if (message.type === 'register' && message.deviceId && message.deviceName) {
        ws.deviceId = message.deviceId;
        registerDevice(ws.userId, message.deviceId, message.deviceName, ws);
        await sendSyncState(ws.userId, ws);
        broadcastToUser(ws.userId, {
          type: 'devices',
          devices: listDevices(ws.userId),
          activeDeviceId: (await getSharedPlaybackState(ws.userId))?.activeDeviceId ?? null,
        }, message.deviceId);
        return;
      }

      if (message.type === 'playback' && message.deviceId) {
        await updateSharedPlayback(ws.userId, {
          trackId: message.trackId ?? null,
          position: message.position,
          isPlaying: message.isPlaying,
          volume: message.volume,
          activeDeviceId: message.deviceId,
          activeDeviceName: message.deviceName ?? null,
        });
        broadcastToUser(ws.userId, {
          type: 'playback',
          deviceId: message.deviceId,
          deviceName: message.deviceName,
          trackId: message.trackId,
          position: message.position,
          isPlaying: message.isPlaying,
          volume: message.volume,
        }, message.deviceId);
        return;
      }

      if (message.type === 'command' && message.deviceId && message.action) {
        broadcastToUser(ws.userId, {
          type: 'command',
          fromDeviceId: message.deviceId,
          targetDeviceId: message.targetDeviceId,
          action: message.action,
          seekTime: message.seekTime,
          trackId: message.trackId,
          position: message.position,
          isPlaying: message.isPlaying,
        }, message.deviceId);

        if (message.action === 'transfer' && message.deviceId) {
          await updateSharedPlayback(ws.userId, {
            trackId: message.trackId,
            position: message.position,
            isPlaying: message.isPlaying,
            activeDeviceId: message.deviceId,
            activeDeviceName: message.deviceName ?? null,
          });
        }
      }
    } catch {
      // ignore malformed messages
    }
  });

  ws.on('close', () => {
    if (ws.userId && ws.deviceId) {
      unregisterDevice(ws.userId, ws.deviceId);
      broadcastToUser(ws.userId, {
        type: 'devices',
        devices: listDevices(ws.userId),
      });
    }
  });
});

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
app.use('/api/discover', discoverRoutes);
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
  await resumePendingImports();
  const evicted = await evictStaleCache().catch(() => 0);
  if (evicted > 0) console.log(`[Storage] Evicted ${evicted} stale cache tracks`);
  server.listen(config.port, () => {
    console.log(`LlamaStream backend running on port ${config.port}`);
  });
}

start().catch(console.error);

export default app;
