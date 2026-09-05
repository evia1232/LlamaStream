import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore, usePlayerStore } from '../store';
import { getWsUrl } from '../lib/apiUrl';
import { getDeviceId, getDeviceName } from '../lib/deviceId';
import { normalizeTrack } from '../lib/trackUtils';
import { Track } from '../types';

import { setPlaybackSyncSender } from '../lib/playbackSyncClient';
export function usePlaybackSync() {
  const token = useAuthStore((s) => s.token);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>();

  const handleMessage = useCallback((raw: string) => {
    try {
      const msg = JSON.parse(raw) as {
        type: string;
        devices?: Array<{ deviceId: string; deviceName: string }>;
        activeDeviceId?: string | null;
        activeDeviceName?: string | null;
        track?: Track | null;
        trackId?: string;
        position?: number;
        isPlaying?: boolean;
        volume?: number;
        deviceId?: string;
        deviceName?: string;
        action?: string;
        fromDeviceId?: string;
        targetDeviceId?: string;
        seekTime?: number;
      };

      const store = usePlayerStore.getState();
      const localId = store.localDeviceId;

      if (msg.type === 'sync' || msg.type === 'devices') {
        store.setSyncDevices(msg.devices ?? [], msg.activeDeviceId ?? null, msg.activeDeviceName ?? null);
      }

      if (msg.type === 'sync') {
        store.applyRemoteSync({
          track: msg.track ?? null,
          position: msg.position ?? 0,
          isPlaying: !!msg.isPlaying,
          activeDeviceId: msg.activeDeviceId ?? null,
          activeDeviceName: msg.activeDeviceName ?? null,
        });
      }

      if (msg.type === 'playback' && msg.deviceId && msg.deviceId !== localId) {
        store.applyRemoteSync({
          trackId: msg.trackId,
          position: msg.position ?? 0,
          isPlaying: !!msg.isPlaying,
          activeDeviceId: msg.deviceId,
          activeDeviceName: msg.deviceName ?? null,
        }, { assumeOnline: true });
      }

      if (msg.type === 'command') {
        store.handleSyncCommand(msg);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!token) return;

    const deviceId = getDeviceId();
    const deviceName = getDeviceName();
    usePlayerStore.getState().initLocalDevice(deviceId, deviceName);

    const connect = () => {
      const ws = new WebSocket(getWsUrl(token));
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'register', deviceId, deviceName }));
      };

      ws.onmessage = (ev) => handleMessage(ev.data as string);

      ws.onclose = () => {
        setPlaybackSyncSender(null);
        reconnectRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => ws.close();

      setPlaybackSyncSender((payload) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ ...payload, deviceId, deviceName }));
        }
      });
    };

    connect();

    return () => {
      clearTimeout(reconnectRef.current);
      setPlaybackSyncSender(null);
      wsRef.current?.close();
    };
  }, [token, handleMessage]);

  useEffect(() => {
    const interval = setInterval(() => {
      const s = usePlayerStore.getState();
      if (s.isPlaying && !s.isRemoteActive && s.currentTrack) {
        s.broadcastPlaybackSync();
      }
    }, 1500);
    return () => clearInterval(interval);
  }, []);
}
