import jwt from 'jsonwebtoken';
import { config } from '../config';
import prisma from '../lib/prisma';
import { isSpotifyConfigured } from './spotifyApi';

const SPOTIFY_SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ');

export function getSpotifyRedirectUri(): string {
  if (config.spotifyRedirectUri) return config.spotifyRedirectUri;
  const base = config.corsOrigin.replace(/\/$/, '');
  return `${base}/api/auth/spotify/callback`;
}

export function isSpotifyOAuthConfigured(): boolean {
  return isSpotifyConfigured() && !!getSpotifyRedirectUri();
}

export function buildSpotifyAuthUrl(userId: string): string {
  const state = jwt.sign({ userId, purpose: 'spotify-connect' }, config.jwtSecret, { expiresIn: '10m' });
  const params = new URLSearchParams({
    client_id: config.spotifyClientId,
    response_type: 'code',
    redirect_uri: getSpotifyRedirectUri(),
    scope: SPOTIFY_SCOPES,
    state,
    show_dialog: 'true',
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

export function verifySpotifyState(state: string): string {
  const payload = jwt.verify(state, config.jwtSecret) as { userId?: string; purpose?: string };
  if (!payload.userId || payload.purpose !== 'spotify-connect') {
    throw new Error('Invalid OAuth state');
  }
  return payload.userId;
}

async function exchangeCode(code: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}> {
  const credentials = Buffer.from(`${config.spotifyClientId}:${config.spotifyClientSecret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: getSpotifyRedirectUri(),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Spotify token exchange failed: ${body}`);
  }
  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  }>;
}

async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}> {
  const credentials = Buffer.from(`${config.spotifyClientId}:${config.spotifyClientSecret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Spotify token refresh failed: ${body}`);
  }
  return res.json() as Promise<{
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  }>;
}

async function fetchSpotifyProfile(accessToken: string): Promise<{ id: string; product: string }> {
  const res = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Failed to fetch Spotify profile');
  const data = await res.json() as { id: string; product?: string };
  return { id: data.id, product: data.product || 'free' };
}

export async function connectSpotifyUser(userId: string, code: string) {
  const tokens = await exchangeCode(code);
  const profile = await fetchSpotifyProfile(tokens.access_token);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await prisma.user.update({
    where: { id: userId },
    data: {
      spotifyUserId: profile.id,
      spotifyAccessToken: tokens.access_token,
      spotifyRefreshToken: tokens.refresh_token,
      spotifyTokenExpiresAt: expiresAt,
      spotifyProduct: profile.product,
      spotifyConnectedAt: new Date(),
    },
  });

  return { product: profile.product };
}

export async function disconnectSpotifyUser(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      spotifyUserId: null,
      spotifyAccessToken: null,
      spotifyRefreshToken: null,
      spotifyTokenExpiresAt: null,
      spotifyProduct: null,
      spotifyConnectedAt: null,
    },
  });
}

export async function getSpotifyAccessTokenForUser(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.spotifyRefreshToken) {
    throw new Error('Spotify not connected');
  }

  const bufferMs = 60_000;
  if (user.spotifyAccessToken && user.spotifyTokenExpiresAt
    && user.spotifyTokenExpiresAt.getTime() > Date.now() + bufferMs) {
    return user.spotifyAccessToken;
  }

  const tokens = await refreshAccessToken(user.spotifyRefreshToken);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await prisma.user.update({
    where: { id: userId },
    data: {
      spotifyAccessToken: tokens.access_token,
      spotifyTokenExpiresAt: expiresAt,
      ...(tokens.refresh_token ? { spotifyRefreshToken: tokens.refresh_token } : {}),
    },
  });

  return tokens.access_token;
}

export function getSpotifyStatusForUser(user: {
  spotifyUserId: string | null;
  spotifyProduct: string | null;
  spotifyConnectedAt: Date | null;
}) {
  return {
    connected: !!user.spotifyUserId && !!user.spotifyConnectedAt,
    premium: user.spotifyProduct === 'premium',
    product: user.spotifyProduct,
  };
}
