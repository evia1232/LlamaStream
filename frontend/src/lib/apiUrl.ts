declare global {
  interface Window {
    __LLAMASTREAM_CONFIG__?: {
      /** Full API base including /api, e.g. '/api' or 'https://api.example.com/api' */
      apiBase?: string;
      /** Display name shown in UI, PWA title, etc. */
      appName?: string;
    };
  }
}

/**
 * Resolve API base URL for requests and audio streaming.
 * Priority: runtime config.js → VITE_API_URL build arg → same-origin /api
 * Automatically upgrades http→https when page is served over HTTPS (fixes mixed content).
 */
export function getApiBase(): string {
  if (typeof window !== 'undefined' && window.__LLAMASTREAM_CONFIG__?.apiBase) {
    return normalizeApiBase(window.__LLAMASTREAM_CONFIG__.apiBase);
  }

  const envUrl = import.meta.env.VITE_API_URL?.trim();
  if (!envUrl) return '/api';

  return normalizeApiBase(envUrl.endsWith('/api') ? envUrl : `${envUrl}/api`);
}

/** Base URL without /api suffix — for stream paths like /api/tracks/... */
export function getApiOrigin(): string {
  const base = getApiBase();
  if (base === '/api') return '';
  return base.replace(/\/api\/?$/, '');
}

function normalizeApiBase(url: string): string {
  let base = url.trim();

  // Mixed content: never call HTTP from an HTTPS page
  if (typeof window !== 'undefined' && window.location.protocol === 'https:' && base.startsWith('http://')) {
    base = base.replace(/^http:/, 'https:');
  }

  if (base.startsWith('/')) {
    return base.endsWith('/api') ? base : `${base.replace(/\/$/, '')}/api`.replace('//api', '/api');
  }

  if (!base.endsWith('/api')) {
    base = `${base.replace(/\/$/, '')}/api`;
  }

  return base;
}

export function streamUrl(trackId: string, token: string | null): string {
  const origin = getApiOrigin();
  const path = `/api/tracks/${trackId}/stream?token=${encodeURIComponent(token || '')}`;
  return origin ? `${origin}${path}` : path;
}

/** WebSocket URL for cross-device playback sync */
export function getWsUrl(token: string): string {
  const envUrl = import.meta.env.VITE_WS_URL?.trim();
  if (envUrl) {
    const base = envUrl.replace(/\/$/, '');
    return `${base}?token=${encodeURIComponent(token)}`;
  }
  if (typeof window === 'undefined') return '';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
}
