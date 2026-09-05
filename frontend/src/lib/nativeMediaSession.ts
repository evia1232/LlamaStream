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

const BATTERY_PROMPT_KEY = 'llamastream_battery_opt_prompted_v3';

export function isNativeShell(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Request notifications + unrestricted battery (native Android). */
export async function ensureBackgroundPlaybackPermissions(force = false): Promise<void> {
  if (!isNativeShell()) return;
  try {
    await MediaSession.requestNotificationPermission();
  } catch {
    /* notifications may already be decided */
  }
  try {
    const status = await MediaSession.getBatteryOptimizationStatus();
    if (status.ignoring) {
      localStorage.setItem(BATTERY_PROMPT_KEY, 'granted');
      return;
    }
    const prev = localStorage.getItem(BATTERY_PROMPT_KEY);
    if (!force && prev === 'prompted') {
      const at = Number(localStorage.getItem(`${BATTERY_PROMPT_KEY}_at`) || '0');
      // Re-ask at most every 2 hours if still restricted
      if (Date.now() - at < 2 * 60 * 60 * 1000) return;
    }
    localStorage.setItem(BATTERY_PROMPT_KEY, 'prompted');
    localStorage.setItem(`${BATTERY_PROMPT_KEY}_at`, String(Date.now()));
    // Let the notification dialog settle before opening battery prompt
    await new Promise((r) => setTimeout(r, 600));
    await MediaSession.requestIgnoreBatteryOptimizations();
  } catch {
    /* ignore */
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
