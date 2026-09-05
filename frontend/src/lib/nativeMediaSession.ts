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
  getBatteryOptimizationStatus(): Promise<{ ignoring: boolean; needsRequest: boolean }>;
  requestIgnoreBatteryOptimizations(): Promise<{
    ignoring: boolean;
    prompted: boolean;
    fallback?: boolean;
  }>;
}

const MediaSession = registerPlugin<MediaSessionPlugin>('MediaSession');

const BATTERY_PROMPT_KEY = 'llamastream_battery_opt_prompted';

/** Ask once (per install) to disable battery optimizations for background audio. */
export async function ensureBackgroundPlaybackPermissions(): Promise<void> {
  if (!isNativeShell()) return;
  try {
    await MediaSession.requestNotificationPermission();
    const status = await MediaSession.getBatteryOptimizationStatus();
    if (status.ignoring) return;
    // Always re-prompt if still restricted — OEMs kill background audio otherwise
    const last = Number(localStorage.getItem(BATTERY_PROMPT_KEY) || '0');
    if (Date.now() - last < 12 * 60 * 60 * 1000) return; // at most every 12h
    localStorage.setItem(BATTERY_PROMPT_KEY, String(Date.now()));
    await MediaSession.requestIgnoreBatteryOptimizations();
  } catch {
    /* ignore */
  }
}

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
