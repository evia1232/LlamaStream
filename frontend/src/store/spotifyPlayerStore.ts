import { create } from 'zustand';
import api from '../api/client';
import { loadSpotifySdk, SpotifyPlayer } from '../lib/spotifySdk';
import { getAppName } from '../lib/appName';

type SpotifyEngine = {
  player: SpotifyPlayer;
  deviceId: string;
};

interface SpotifyPlayerState {
  ready: boolean;
  deviceId: string | null;
  engine: SpotifyEngine | null;
  initError: string | null;
  lastUri: string | null;
  lastPositionMs: number;
  resumeInFlight: boolean;
  init: (volume: number) => Promise<boolean>;
  destroy: () => void;
  playUri: (uri: string, positionMs?: number) => Promise<void>;
  pause: () => Promise<void>;
  resume: (positionMs?: number) => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
}

async function fetchSpotifyToken(): Promise<string> {
  const { data } = await api.get('/auth/spotify/token');
  return data.accessToken as string;
}

async function transferPlayToDevice(
  deviceId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const token = await fetchSpotifyToken();
  const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Spotify playback failed');
  }
}

export const useSpotifyPlayerStore = create<SpotifyPlayerState>((set, get) => ({
  ready: false,
  deviceId: null,
  engine: null,
  initError: null,
  lastUri: null,
  lastPositionMs: 0,
  resumeInFlight: false,

  init: async (volume) => {
    if (get().engine) return true;

    try {
      await loadSpotifySdk();
      if (!window.Spotify) throw new Error('Spotify SDK unavailable');

      const player = new window.Spotify.Player({
        name: getAppName(),
        volume,
        getOAuthToken: (cb) => {
          fetchSpotifyToken().then(cb).catch(() => cb(''));
        },
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          reject(new Error('Spotify init timeout'));
        }, 12000);

        const onReady = ({ device_id }: { device_id: string }) => {
          window.clearTimeout(timeout);
          set({
            ready: true,
            deviceId: device_id,
            engine: { player, deviceId: device_id },
            initError: null,
          });
          resolve();
        };

        const onError = ({ message }: { message: string }) => {
          window.clearTimeout(timeout);
          set({ initError: message });
          reject(new Error(message));
        };

        player.addListener('ready', onReady as (...args: unknown[]) => void);
        player.addListener('initialization_error', onError as (...args: unknown[]) => void);
        player.addListener('authentication_error', onError as (...args: unknown[]) => void);
        player.addListener('account_error', onError as (...args: unknown[]) => void);
        player.addListener('playback_error', onError as (...args: unknown[]) => void);

        player.connect().catch((err) => {
          window.clearTimeout(timeout);
          reject(err);
        });
      });

      return true;
    } catch (err) {
      set({ initError: (err as Error).message });
      return false;
    }
  },

  destroy: () => {
    const { engine } = get();
    engine?.player.disconnect();
    set({ ready: false, deviceId: null, engine: null, lastUri: null, lastPositionMs: 0 });
  },

  playUri: async (uri, positionMs = 0) => {
    const active = get().engine;
    if (!active) throw new Error('Spotify player not ready');

    await active.player.activateElement();
    set({ lastUri: uri, lastPositionMs: Math.max(0, positionMs) });
    await transferPlayToDevice(active.deviceId, {
      uris: [uri],
      position_ms: Math.max(0, positionMs),
    });
  },

  pause: async () => {
    const active = get().engine;
    if (!active) return;
    await active.player.pause();
  },

  resume: async (positionMs?: number) => {
    const active = get().engine;
    if (!active) throw new Error('Spotify player not ready');

    const pos = positionMs ?? get().lastPositionMs;
    if (positionMs !== undefined) set({ lastPositionMs: pos });

    set({ resumeInFlight: true });
    try {
      await active.player.activateElement();

      try {
        await active.player.resume();
        const state = await active.player.getCurrentState();
        if (state && !state.paused) return;
      } catch {
        /* SDK resume failed — fall through to Web API */
      }

      const { lastUri } = get();
      if (lastUri) {
        await transferPlayToDevice(active.deviceId, {
          uris: [lastUri],
          position_ms: Math.max(0, pos),
        });
        return;
      }

      await transferPlayToDevice(active.deviceId, {});
    } finally {
      window.setTimeout(() => set({ resumeInFlight: false }), 600);
    }
  },

  seek: async (positionMs) => {
    const ms = Math.max(0, positionMs);
    set({ lastPositionMs: ms });
    await get().engine?.player.seek(ms);
  },

  setVolume: async (volume) => {
    await get().engine?.player.setVolume(volume);
  },
}));
