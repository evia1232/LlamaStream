import { create } from 'zustand';
import api from '../api/client';
import { loadSpotifySdk, SpotifyPlayer } from '../lib/spotifySdk';

type SpotifyEngine = {
  player: SpotifyPlayer;
  deviceId: string;
};

interface SpotifyPlayerState {
  ready: boolean;
  deviceId: string | null;
  engine: SpotifyEngine | null;
  initError: string | null;
  init: (volume: number) => Promise<boolean>;
  destroy: () => void;
  playUri: (uri: string, positionMs?: number) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
}

async function fetchSpotifyToken(): Promise<string> {
  const { data } = await api.get('/auth/spotify/token');
  return data.accessToken as string;
}

export const useSpotifyPlayerStore = create<SpotifyPlayerState>((set, get) => ({
  ready: false,
  deviceId: null,
  engine: null,
  initError: null,

  init: async (volume) => {
    if (get().engine) return true;

    try {
      await loadSpotifySdk();
      if (!window.Spotify) throw new Error('Spotify SDK unavailable');

      const player = new window.Spotify.Player({
        name: 'LlamaStream',
        volume,
        getOAuthToken: (cb) => {
          fetchSpotifyToken().then(cb).catch(() => cb(''));
        },
      });

      await new Promise<void>((resolve, reject) => {
        const onReady = ({ device_id }: { device_id: string }) => {
          set({
            ready: true,
            deviceId: device_id,
            engine: { player, deviceId: device_id },
            initError: null,
          });
          resolve();
        };

        const onError = ({ message }: { message: string }) => {
          set({ initError: message });
          reject(new Error(message));
        };

        player.addListener('ready', onReady as (...args: unknown[]) => void);
        player.addListener('initialization_error', onError as (...args: unknown[]) => void);
        player.addListener('authentication_error', onError as (...args: unknown[]) => void);
        player.addListener('account_error', onError as (...args: unknown[]) => void);
        player.addListener('playback_error', onError as (...args: unknown[]) => void);

        player.connect().catch(reject);
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
    set({ ready: false, deviceId: null, engine: null });
  },

  playUri: async (uri, positionMs = 0) => {
    const active = get().engine;
    if (!active) throw new Error('Spotify player not ready');

    await active.player.activateElement();
    const token = await fetchSpotifyToken();
    const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${active.deviceId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        uris: [uri],
        position_ms: Math.max(0, positionMs),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(body || 'Spotify playback failed');
    }
  },

  pause: async () => {
    await get().engine?.player.pause();
  },

  resume: async () => {
    await get().engine?.player.resume();
  },

  seek: async (positionMs) => {
    await get().engine?.player.seek(positionMs);
  },

  setVolume: async (volume) => {
    await get().engine?.player.setVolume(volume);
  },
}));
