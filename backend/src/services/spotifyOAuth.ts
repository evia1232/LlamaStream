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
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
].join(' ');

/** Must match Spotify Developer Dashboard → Redirect URIs exactly (https, no trailing slash). */
export function getSpotifyRedirectUri(): string {
  const uri = config.spotifyRedirectUri
    ? config.spotifyRedirectUri.trim()
    : `${config.corsOrigin.replace(/\/$/, '')}/api/auth/spotify/callback`;
  return uri.replace(/\/$/, '');
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
    access_type: 'offline',
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

export type SpotifyConnectErrorCode =
  | 'PROFILE_FAILED'
  | 'NOT_ALLOWLISTED'
  | 'ALREADY_LINKED'
  | 'TOKEN_EXCHANGE_FAILED';

export class SpotifyConnectError extends Error {
  code: SpotifyConnectErrorCode;

  constructor(code: SpotifyConnectErrorCode, message: string) {
    super(message);
    this.name = 'SpotifyConnectError';
    this.code = code;
  }
}

async function fetchSpotifyProfile(accessToken: string): Promise<{ id: string; product: string }> {
  const res = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[Spotify OAuth] GET /me failed:', res.status, body.slice(0, 300));
    if (res.status === 403) {
      throw new SpotifyConnectError(
        'NOT_ALLOWLISTED',
        'Spotify account is not allowlisted for this app (Development Mode)',
      );
    }
    throw new SpotifyConnectError(
      'PROFILE_FAILED',
      `Failed to fetch Spotify profile (${res.status})`,
    );
  }
  const data = await res.json() as { id?: string; product?: string };
  if (!data.id) {
    throw new SpotifyConnectError('PROFILE_FAILED', 'Spotify profile response missing user id');
  }
  return { id: data.id, product: data.product || 'free' };
}

export async function connectSpotifyUser(userId: string, code: string) {
  let tokens: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    tokens = await exchangeCode(code);
  } catch (err) {
    throw new SpotifyConnectError(
      'TOKEN_EXCHANGE_FAILED',
      err instanceof Error ? err.message : 'Spotify token exchange failed',
    );
  }

  const profile = await fetchSpotifyProfile(tokens.access_token);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  const linkedElsewhere = await prisma.user.findUnique({
    where: { spotifyUserId: profile.id },
    select: { id: true, username: true },
  });
  if (linkedElsewhere && linkedElsewhere.id !== userId) {
    throw new SpotifyConnectError(
      'ALREADY_LINKED',
      `Spotify account already linked to user ${linkedElsewhere.username}`,
    );
  }

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { spotifyRefreshToken: true },
  });

  await prisma.user.update({
    where: { id: userId },
    data: {
      spotifyUserId: profile.id,
      spotifyAccessToken: tokens.access_token,
      spotifyTokenExpiresAt: expiresAt,
      spotifyProduct: profile.product,
      spotifyConnectedAt: new Date(),
      ...(tokens.refresh_token ? { spotifyRefreshToken: tokens.refresh_token } : {}),
    },
  });

  if (!tokens.refresh_token && !existing?.spotifyRefreshToken) {
    console.warn(`[Spotify OAuth] User ${userId} connected without refresh token`);
  }

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
