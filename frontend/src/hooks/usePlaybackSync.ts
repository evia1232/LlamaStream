import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore, usePlayerStore } from '../store';
import { getWsUrl } from '../lib/apiUrl';
import { getDeviceId, getDeviceName } from '../lib/deviceId';
import { Track } from '../types';

import { setPlaybackSyncSender } from '../lib/playbackSyncClient';

export function usePlaybackSync() {
  const token = useAuthStore((s) => s.token);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>();
  const connectRef = useRef<() => void>(() => undefined);

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

    let closedOnPurpose = false;

    const connect = () => {
      if (closedOnPurpose) return;
      clearTimeout(reconnectRef.current);

      const prev = wsRef.current;
      if (prev && (prev.readyState === WebSocket.OPEN || prev.readyState === WebSocket.CONNECTING)) {
        return;
      }

      const ws = new WebSocket(getWsUrl(token));
      wsRef.current = ws;

      const attachSender = () => {
        setPlaybackSyncSender((payload) => {
          if (ws.readyState !== WebSocket.OPEN) return false;
          ws.send(JSON.stringify({ ...payload, deviceId, deviceName }));
          return true;
        });
      };

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'register', deviceId, deviceName }));
        attachSender();
      };

      ws.onmessage = (ev) => handleMessage(ev.data as string);

      ws.onclose = () => {
        setPlaybackSyncSender(null);
        if (closedOnPurpose) return;
        const hostPlaying = (() => {
          const s = usePlayerStore.getState();
          return s.isPlaying && !s.isRemoteActive;
        })();
        // Reconnect fast while this device is the player (screen-off Doze)
        reconnectRef.current = setTimeout(connect, hostPlaying ? 800 : 2500);
      };

      ws.onerror = () => {
        try { ws.close(); } catch { /* ignore */ }
      };

      attachSender();
    };

    connectRef.current = connect;
    connect();

    const ensureConnected = () => {
      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        connect();
      }
    };

    const onKeepAlive = () => {
      ensureConnected();
      const s = usePlayerStore.getState();
      // Host with frozen timers: still try to advance if a command already mutated state
      if (s.isPlaying && !s.isRemoteActive && s.currentTrack) {
        // Soft re-register keeps server mapping fresh after Doze
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: 'register', deviceId, deviceName }));
          } catch { /* ignore */ }
        }
      }
    };

    window.addEventListener('ls-keepalive', onKeepAlive);
    document.addEventListener('visibilitychange', ensureConnected);
    window.addEventListener('focus', ensureConnected);

    return () => {
      closedOnPurpose = true;
      clearTimeout(reconnectRef.current);
      setPlaybackSyncSender(null);
      window.removeEventListener('ls-keepalive', onKeepAlive);
      document.removeEventListener('visibilitychange', ensureConnected);
      window.removeEventListener('focus', ensureConnected);
      try { wsRef.current?.close(); } catch { /* ignore */ }
    };
  }, [token, handleMessage]);

  useEffect(() => {
    const interval = setInterval(() => {
      const s = usePlayerStore.getState();
      if (s.isPlaying && !s.isRemoteActive && s.currentTrack) {
        s.broadcastPlaybackSync();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, []);
}
