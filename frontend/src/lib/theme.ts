import { getApiBase } from './apiUrl';

export interface ThemePreset {
  id: string;
  label: string;
  accent: string;
  accentHover: string;
}

export interface AppTheme {
  preset: string;
  accent: string;
  accentHover: string;
}

const DEFAULT_THEME: AppTheme = {
  preset: 'green',
  accent: '#1db954',
  accentHover: '#1ed760',
};

let cachedTheme: AppTheme = DEFAULT_THEME;

export function getTheme(): AppTheme {
  return cachedTheme;
}

/** Parse #rrggbb to "r g b" for Tailwind opacity modifiers. */
function hexToRgbComponents(hex: string): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `${r} ${g} ${b}`;
}

/** Apply accent colors to CSS variables — affects all spotify-green classes. */
export function applyTheme(theme: AppTheme): void {
  if (typeof document === 'undefined') return;
  cachedTheme = theme;
  const root = document.documentElement;
  root.style.setProperty('--color-accent', theme.accent);
  root.style.setProperty('--color-accent-hover', theme.accentHover);
  root.style.setProperty('--color-accent-rgb', hexToRgbComponents(theme.accent));
  root.style.setProperty('--color-accent-hover-rgb', hexToRgbComponents(theme.accentHover));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#121212');
}

export async function loadAndApplyTheme(): Promise<AppTheme> {
  try {
    const base = getApiBase();
    const res = await fetch(`${base}/settings/public`, { credentials: 'include' });
    if (!res.ok) {
      applyTheme(DEFAULT_THEME);
      return DEFAULT_THEME;
    }
    const data = await res.json();
    const theme: AppTheme = data.theme ?? DEFAULT_THEME;
    applyTheme(theme);
    return theme;
  } catch {
    applyTheme(DEFAULT_THEME);
    return DEFAULT_THEME;
  }
}

export async function updateThemePreset(preset: string): Promise<AppTheme> {
  const { default: api } = await import('../api/client');
  const { data } = await api.put('/settings/theme', { preset });
  const theme: AppTheme = data.theme ?? DEFAULT_THEME;
  applyTheme(theme);
  return theme;
}

export type ThemePresetsResponse = {
  theme: AppTheme;
  presets: ThemePreset[];
};

export async function fetchThemeSettings(): Promise<ThemePresetsResponse> {
  const { default: api } = await import('../api/client');
  const { data } = await api.get('/settings/theme');
  return data;
}
