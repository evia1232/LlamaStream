import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  allowPublicRegistration: process.env.ALLOW_PUBLIC_REGISTRATION === 'true',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  musicStoragePath: process.env.MUSIC_STORAGE_PATH || './storage/music',
  cachePath: process.env.CACHE_PATH || './storage/cache',
  avatarPath: process.env.AVATAR_PATH || './storage/avatars',
  defaultAudioQuality: (process.env.DEFAULT_AUDIO_QUALITY || 'high').toUpperCase() as 'LOW' | 'NORMAL' | 'HIGH',
  adminEmail: process.env.ADMIN_EMAIL || 'admin@llamastream.local',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123456',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  spotifyClientId: (process.env.SPOTIFY_CLIENT_ID || '').trim(),
  spotifyClientSecret: (process.env.SPOTIFY_CLIENT_SECRET || '').trim(),
  spotifyMarket: (process.env.SPOTIFY_MARKET || 'IL').trim().toUpperCase(),
};

export const qualityBitrates: Record<string, string> = {
  LOW: '96',
  NORMAL: '192',
  HIGH: '320',
};
