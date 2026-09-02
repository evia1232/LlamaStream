import dotenv from 'dotenv';
dotenv.config();

const storageRoot = (process.env.STORAGE_PATH || './storage').replace(/\/$/, '');

function resolveStoragePath(subdir: string, override?: string): string {
  const custom = override?.trim();
  if (custom) return custom;
  return `${storageRoot}/${subdir}`;
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  allowPublicRegistration: process.env.ALLOW_PUBLIC_REGISTRATION === 'true',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  musicStoragePath: resolveStoragePath('music', process.env.MUSIC_STORAGE_PATH),
  cachePath: resolveStoragePath('cache', process.env.CACHE_PATH),
  /** Hours to keep unpinned prefetch/autoplay downloads before deleting the file */
  cacheMaxAgeHours: Math.max(1, parseInt(process.env.CACHE_MAX_AGE_HOURS || '12', 10)),
  /** How often to scan and evict stale cache files (minutes) */
  cacheEvictionIntervalMinutes: Math.max(5, parseInt(process.env.CACHE_EVICTION_INTERVAL_MINUTES || '30', 10)),
  avatarPath: resolveStoragePath('avatars', process.env.AVATAR_PATH),
  defaultAudioQuality: (process.env.DEFAULT_AUDIO_QUALITY || 'high').toUpperCase() as 'LOW' | 'NORMAL' | 'HIGH',
  adminEmail: process.env.ADMIN_EMAIL || 'admin@llamastream.local',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123456',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  spotifyClientId: (process.env.SPOTIFY_CLIENT_ID || '').trim(),
  spotifyClientSecret: (process.env.SPOTIFY_CLIENT_SECRET || '').trim(),
  spotifyMarket: (process.env.SPOTIFY_MARKET || 'IL').trim().toUpperCase(),
  spotifyRedirectUri: (process.env.SPOTIFY_REDIRECT_URI || '').trim(),
  frontendUrl: (process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:3000').replace(/\/$/, ''),
  appName: (process.env.APP_NAME || 'LlamaStream').trim(),
};

export const qualityBitrates: Record<string, string> = {
  LOW: '96',
  NORMAL: '192',
  HIGH: '320',
};

/** yt-dlp --audio-quality scale for MP3 (0 = best VBR, 9 = worst) */
export const qualityAudioScale: Record<string, string> = {
  LOW: '7',
  NORMAL: '4',
  HIGH: '0',
};
