import { Capacitor, registerPlugin } from '@capacitor/core';

export interface MediaSessionPlugin {
  setMetadata(options: {
    title?: string;
    artist?: string;
    album?: string;
    artwork?: { src: string; sizes?: string; type?: string }[];
    liked?: boolean;
  }): Promise<void>;
  setPlaybackState(options: { playbackState: 'none' | 'paused' | 'playing' }): Promise<void>;
  setActionHandler(
    options: { action: string },
    handler: ((details: { action: string; seekTime?: number | null }) => void) | null,
  ): Promise<void>;
  setPositionState(options: {
    duration?: number;
    playbackRate?: number;
    position?: number;
  }): Promise<void>;
  setLiked(options: { liked: boolean }): Promise<void>;
  requestNotificationPermission(): Promise<void>;
}

const MediaSession = registerPlugin<MediaSessionPlugin>('MediaSession');

export function isNativeShell(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export { MediaSession };

export function absoluteMediaUrl(url: string | null | undefined, fallbackPath = '/icon-192.png'): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  if (!url) return `${origin}${fallbackPath}`;
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url;
  if (url.startsWith('//')) return `${window.location.protocol}${url}`;
  try {
    return new URL(url, origin).href;
  } catch {
    return `${origin}${fallbackPath}`;
  }
}
