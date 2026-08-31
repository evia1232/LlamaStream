import { WebSocket } from 'ws';
import prisma from '../lib/prisma';

export interface ConnectedDevice {
  deviceId: string;
  deviceName: string;
}

interface DeviceClient {
  ws: WebSocket;
  deviceId: string;
  deviceName: string;
  userId: string;
}

const clientsByUser = new Map<string, Map<string, DeviceClient>>();

function userClients(userId: string): Map<string, DeviceClient> {
  let map = clientsByUser.get(userId);
  if (!map) {
    map = new Map();
    clientsByUser.set(userId, map);
  }
  return map;
}

export function listDevices(userId: string): ConnectedDevice[] {
  return [...userClients(userId).values()].map((c) => ({
    deviceId: c.deviceId,
    deviceName: c.deviceName,
  }));
}

export function isDeviceConnected(userId: string, deviceId: string): boolean {
  return userClients(userId).has(deviceId);
}

/** Clear active device in DB when it is no longer connected. */
export async function getValidatedActiveDevice(userId: string): Promise<{
  activeDeviceId: string | null;
  activeDeviceName: string | null;
}> {
  const state = await getSharedPlaybackState(userId);
  const activeId = state?.activeDeviceId ?? null;
  if (!activeId) {
    return { activeDeviceId: null, activeDeviceName: null };
  }
  if (isDeviceConnected(userId, activeId)) {
    return { activeDeviceId: activeId, activeDeviceName: state?.activeDeviceName ?? null };
  }
  await updateSharedPlayback(userId, {
    activeDeviceId: null,
    activeDeviceName: null,
    isPlaying: false,
  });
  return { activeDeviceId: null, activeDeviceName: null };
}

export async function onDeviceDisconnected(userId: string, deviceId: string): Promise<{
  activeDeviceId: string | null;
  activeDeviceName: string | null;
}> {
  const state = await getSharedPlaybackState(userId);
  if (state?.activeDeviceId === deviceId) {
    await updateSharedPlayback(userId, {
      activeDeviceId: null,
      activeDeviceName: null,
      isPlaying: false,
    });
    return { activeDeviceId: null, activeDeviceName: null };
  }
  return getValidatedActiveDevice(userId);
}

export function registerDevice(userId: string, deviceId: string, deviceName: string, ws: WebSocket) {
  userClients(userId).set(deviceId, { ws, deviceId, deviceName, userId });
}

export function unregisterDevice(userId: string, deviceId: string) {
  userClients(userId).delete(deviceId);
  if (userClients(userId).size === 0) clientsByUser.delete(userId);
}

export function broadcastToUser(
  userId: string,
  message: unknown,
  exceptDeviceId?: string,
) {
  const payload = JSON.stringify(message);
  for (const client of userClients(userId).values()) {
    if (exceptDeviceId && client.deviceId === exceptDeviceId) continue;
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

export async function getSharedPlaybackState(userId: string) {
  const state = await prisma.userPlayback.findUnique({
    where: { userId },
    include: { track: { include: { artist: true, album: true } } },
  });
  return state;
}

export async function updateSharedPlayback(userId: string, data: {
  trackId?: string | null;
  position?: number;
  isPlaying?: boolean;
  volume?: number;
  activeDeviceId?: string | null;
  activeDeviceName?: string | null;
}) {
  const existing = await prisma.userPlayback.findUnique({ where: { userId } });
  if (!data.trackId && existing) {
    await prisma.userPlayback.update({
      where: { userId },
      data: {
        ...(data.position !== undefined && { position: data.position }),
        ...(data.isPlaying !== undefined && { isPlaying: data.isPlaying }),
        ...(data.volume !== undefined && { volume: data.volume }),
        ...(data.activeDeviceId !== undefined && { activeDeviceId: data.activeDeviceId }),
        ...(data.activeDeviceName !== undefined && { activeDeviceName: data.activeDeviceName }),
      },
    });
    return;
  }

  if (!data.trackId) return;

  await prisma.userPlayback.upsert({
    where: { userId },
    create: {
      userId,
      trackId: data.trackId,
      position: Math.max(0, data.position ?? 0),
      isPlaying: !!data.isPlaying,
      volume: data.volume ?? 0.7,
      activeDeviceId: data.activeDeviceId ?? null,
      activeDeviceName: data.activeDeviceName ?? null,
    },
    update: {
      trackId: data.trackId,
      position: Math.max(0, data.position ?? 0),
      isPlaying: !!data.isPlaying,
      ...(data.volume !== undefined && { volume: data.volume }),
      ...(data.activeDeviceId !== undefined && { activeDeviceId: data.activeDeviceId }),
      ...(data.activeDeviceName !== undefined && { activeDeviceName: data.activeDeviceName }),
    },
  });
}
