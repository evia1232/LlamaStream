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

/** Remote transport commands waiting for a device whose WS briefly dropped (screen off / Doze). */
const pendingCommandsByDevice = new Map<string, object[]>();
const MAX_PENDING_COMMANDS = 25;

/** Don't clear "active player" on a blip — phone lock often drops WS for a few seconds. */
const DISCONNECT_GRACE_MS = 60_000;
const disconnectGraceTimers = new Map<string, ReturnType<typeof setTimeout>>();

function userClients(userId: string): Map<string, DeviceClient> {
  let map = clientsByUser.get(userId);
  if (!map) {
    map = new Map();
    clientsByUser.set(userId, map);
  }
  return map;
}

function graceKey(userId: string, deviceId: string) {
  return `${userId}:${deviceId}`;
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
  // Still within grace — keep reporting the last active player
  if (disconnectGraceTimers.has(graceKey(userId, activeId))) {
    return { activeDeviceId: activeId, activeDeviceName: state?.activeDeviceName ?? null };
  }
  await updateSharedPlayback(userId, {
    activeDeviceId: null,
    activeDeviceName: null,
    isPlaying: false,
  });
  return { activeDeviceId: null, activeDeviceName: null };
}

/**
 * Soft-disconnect: keep active player for a grace period so lock-screen Doze
 * does not wipe host status / drop remote skip commands.
 * Returns current validated active device immediately (may still be the old host).
 */
export async function onDeviceDisconnected(userId: string, deviceId: string): Promise<{
  activeDeviceId: string | null;
  activeDeviceName: string | null;
}> {
  const state = await getSharedPlaybackState(userId);
  if (state?.activeDeviceId !== deviceId) {
    return getValidatedActiveDevice(userId);
  }

  const key = graceKey(userId, deviceId);
  const existing = disconnectGraceTimers.get(key);
  if (existing) clearTimeout(existing);

  disconnectGraceTimers.set(
    key,
    setTimeout(() => {
      void (async () => {
        disconnectGraceTimers.delete(key);
        if (isDeviceConnected(userId, deviceId)) return;
        const latest = await getSharedPlaybackState(userId);
        if (latest?.activeDeviceId === deviceId) {
          await updateSharedPlayback(userId, {
            activeDeviceId: null,
            activeDeviceName: null,
            isPlaying: false,
          });
          broadcastToUser(userId, {
            type: 'devices',
            devices: listDevices(userId),
            activeDeviceId: null,
            activeDeviceName: null,
          });
        }
      })();
    }, DISCONNECT_GRACE_MS),
  );

  return {
    activeDeviceId: deviceId,
    activeDeviceName: state.activeDeviceName ?? null,
  };
}

/** Cancel grace period when the device comes back. */
export function cancelDisconnectGrace(userId: string, deviceId: string) {
  const key = graceKey(userId, deviceId);
  const timer = disconnectGraceTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    disconnectGraceTimers.delete(key);
  }
}

export function enqueuePendingCommand(deviceId: string, message: object) {
  const list = pendingCommandsByDevice.get(deviceId) ?? [];
  list.push(message);
  while (list.length > MAX_PENDING_COMMANDS) list.shift();
  pendingCommandsByDevice.set(deviceId, list);
}

export function flushPendingCommands(deviceId: string, ws: WebSocket) {
  const list = pendingCommandsByDevice.get(deviceId);
  if (!list?.length) return;
  pendingCommandsByDevice.delete(deviceId);
  for (const message of list) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch {
        enqueuePendingCommand(deviceId, message);
        break;
      }
    } else {
      enqueuePendingCommand(deviceId, message);
      break;
    }
  }
}

/**
 * Deliver a command to all other devices. If a specific target is offline,
 * queue it until that device re-registers (common when phone screen is off).
 */
export function deliverCommand(
  userId: string,
  message: {
    type: 'command';
    fromDeviceId?: string;
    targetDeviceId?: string;
    action?: string;
    seekTime?: number;
    trackId?: string;
    position?: number;
    isPlaying?: boolean;
  },
  exceptDeviceId?: string,
) {
  const target = message.targetDeviceId;
  let deliveredToTarget = false;

  const payload = JSON.stringify(message);
  for (const client of userClients(userId).values()) {
    if (exceptDeviceId && client.deviceId === exceptDeviceId) continue;
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    try {
      client.ws.send(payload);
      if (target && client.deviceId === target) deliveredToTarget = true;
    } catch {
      /* ignore */
    }
  }

  if (target && !deliveredToTarget) {
    enqueuePendingCommand(target, message);
  }
}

export function registerDevice(userId: string, deviceId: string, deviceName: string, ws: WebSocket) {
  cancelDisconnectGrace(userId, deviceId);
  userClients(userId).set(deviceId, { ws, deviceId, deviceName, userId });
  flushPendingCommands(deviceId, ws);
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

  const trackExists = await prisma.track.count({ where: { id: data.trackId } });
  if (!trackExists) return;

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
