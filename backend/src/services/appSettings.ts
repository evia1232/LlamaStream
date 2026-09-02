import prisma from '../lib/prisma';

export const THEME_PRESETS = {
  green: { accent: '#1db954', accentHover: '#1ed760', label: 'Green' },
  blue: { accent: '#1e88e5', accentHover: '#42a5f5', label: 'Blue' },
  purple: { accent: '#9c27b0', accentHover: '#ba68c8', label: 'Purple' },
  pink: { accent: '#e91e63', accentHover: '#f06292', label: 'Pink' },
  orange: { accent: '#ff5722', accentHover: '#ff8a65', label: 'Orange' },
  cyan: { accent: '#00bcd4', accentHover: '#4dd0e1', label: 'Cyan' },
  red: { accent: '#f44336', accentHover: '#ef5350', label: 'Red' },
  yellow: { accent: '#ffc107', accentHover: '#ffca28', label: 'Yellow' },
} as const;

export type ThemePresetId = keyof typeof THEME_PRESETS;

const THEME_KEY = 'themePreset';
const DEFAULT_PRESET: ThemePresetId = 'green';

export function isThemePreset(value: string): value is ThemePresetId {
  return value in THEME_PRESETS;
}

export function resolveThemePreset(presetId: string) {
  const id = isThemePreset(presetId) ? presetId : DEFAULT_PRESET;
  return { id, ...THEME_PRESETS[id] };
}

export async function getThemePresetId(): Promise<ThemePresetId> {
  const row = await prisma.appSetting.findUnique({ where: { key: THEME_KEY } });
  if (row?.value && isThemePreset(row.value)) return row.value;
  return DEFAULT_PRESET;
}

export async function setThemePresetId(presetId: ThemePresetId): Promise<void> {
  if (!isThemePreset(presetId)) throw new Error('Invalid theme preset');
  await prisma.appSetting.upsert({
    where: { key: THEME_KEY },
    create: { key: THEME_KEY, value: presetId },
    update: { value: presetId },
  });
}

export async function getPublicAppSettings() {
  const presetId = await getThemePresetId();
  const theme = resolveThemePreset(presetId);
  return {
    theme: {
      preset: theme.id,
      accent: theme.accent,
      accentHover: theme.accentHover,
    },
    presets: Object.entries(THEME_PRESETS).map(([id, p]) => ({
      id,
      label: p.label,
      accent: p.accent,
      accentHover: p.accentHover,
    })),
  };
}
