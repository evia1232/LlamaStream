/* Spotify Web Playback SDK types */
export interface SpotifyPlayer {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  addListener: (event: string, cb: (...args: unknown[]) => void) => void;
  removeListener: (event: string, cb?: (...args: unknown[]) => void) => void;
  getCurrentState: () => Promise<SpotifyPlaybackState | null>;
  setVolume: (volume: number) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  activateElement: () => Promise<void>;
}

export interface SpotifyPlaybackState {
  paused: boolean;
  position: number;
  duration: number;
  track_window: { current_track: { uri: string; name: string } };
}

declare global {
  interface Window {
    Spotify?: {
      Player: new (options: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume?: number;
      }) => SpotifyPlayer;
    };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

let sdkPromise: Promise<void> | null = null;

export function loadSpotifySdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src="https://sdk.scdn.co/spotify-player.js"]');
    if (existing) {
      window.onSpotifyWebPlaybackSDKReady = () => resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load Spotify SDK'));
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    document.body.appendChild(script);
  });

  return sdkPromise;
}
