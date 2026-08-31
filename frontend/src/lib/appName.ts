export const DEFAULT_APP_NAME = 'LlamaStream';

/** App display name — runtime config.js → VITE_APP_NAME build arg → default */
export function getAppName(): string {
  if (typeof window !== 'undefined' && window.__LLAMASTREAM_CONFIG__?.appName?.trim()) {
    return window.__LLAMASTREAM_CONFIG__.appName.trim();
  }
  const envName = import.meta.env.VITE_APP_NAME?.trim();
  if (envName) return envName;
  return DEFAULT_APP_NAME;
}

/** Set document title and PWA meta tags from configured app name */
export function applyAppBranding(): void {
  if (typeof document === 'undefined') return;
  const name = getAppName();
  document.title = name;
  document.querySelector('meta[name="description"]')?.setAttribute(
    'content',
    `${name} — self-hosted music streaming with Spotify-like UI`,
  );
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', name);
}
