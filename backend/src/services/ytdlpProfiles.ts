import fs from 'fs';
import prisma from '../lib/prisma';
import { config } from '../config';

export interface YtDlpProfile {
  id: string;
  label: string;
  proxy?: string;
  cookiesFile?: string;
  userAgent?: string;
  /** yt-dlp youtube player_client list, e.g. "android,web" */
  playerClient?: string;
}

const SETTING_KEY = 'ytdlpMultiProfile';
const ROTATE_EVERY = Math.max(1, parseInt(process.env.YTDLP_ROTATE_EVERY || '6', 10) || 6);

let cachedEnabled: boolean | null = null;
let cachedEnabledAt = 0;
let songCounter = 0;
let activeIndex = 0;

function parseProfilesFromEnv(): YtDlpProfile[] {
  const rawJson = (process.env.YTDLP_PROFILES || '').trim();
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as Array<Partial<YtDlpProfile>>;
      if (Array.isArray(parsed)) {
        return parsed
          .map((p, i) => ({
            id: p.id || `p${i + 1}`,
            label: p.label || `Profile ${i + 1}`,
            proxy: (p.proxy || '').trim() || undefined,
            cookiesFile: (p.cookiesFile || '').trim() || undefined,
            userAgent: (p.userAgent || '').trim() || undefined,
            playerClient: (p.playerClient || '').trim() || undefined,
          }))
          .filter((p) => p.proxy || p.cookiesFile);
      }
    } catch (err) {
      console.error('[yt-dlp] Failed to parse YTDLP_PROFILES JSON:', err);
    }
  }

  const profiles: YtDlpProfile[] = [];
  for (let i = 1; i <= 4; i++) {
    const proxy = (process.env[`YTDLP_PROFILE_${i}_PROXY`] || '').trim();
    const cookiesFile = (process.env[`YTDLP_PROFILE_${i}_COOKIES`] || '').trim();
    const userAgent = (process.env[`YTDLP_PROFILE_${i}_UA`] || '').trim();
    const playerClient = (process.env[`YTDLP_PROFILE_${i}_CLIENT`] || '').trim();
    if (!proxy && !cookiesFile) continue;
    profiles.push({
      id: `p${i}`,
      label: (process.env[`YTDLP_PROFILE_${i}_LABEL`] || `Profile ${i}`).trim(),
      proxy: proxy || undefined,
      cookiesFile: cookiesFile || undefined,
      userAgent: userAgent || undefined,
      playerClient: playerClient || undefined,
    });
  }
  return profiles;
}

/** Default/single-profile mode (current behavior). */
export function getLegacyProfile(): YtDlpProfile {
  return {
    id: 'legacy',
    label: 'Default',
    proxy: config.ytdlpProxy || undefined,
    cookiesFile: config.ytdlpCookiesFile || undefined,
  };
}

export function getConfiguredProfiles(): YtDlpProfile[] {
  const multi = parseProfilesFromEnv();
  return multi.length > 0 ? multi : [getLegacyProfile()];
}

export async function isMultiProfileEnabled(): Promise<boolean> {
  const now = Date.now();
  if (cachedEnabled != null && now - cachedEnabledAt < 5000) return cachedEnabled;

  const envDefault = process.env.YTDLP_MULTI_PROFILE === 'true';
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
    if (row?.value === 'true') cachedEnabled = true;
    else if (row?.value === 'false') cachedEnabled = false;
    else cachedEnabled = envDefault;
  } catch {
    cachedEnabled = envDefault;
  }
  cachedEnabledAt = now;
  return cachedEnabled;
}

/** Last known multi-profile flag (for sync yt-dlp arg builders). */
export function isMultiProfileEnabledCached(): boolean {
  return cachedEnabled === true;
}

export async function setMultiProfileEnabled(enabled: boolean): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: enabled ? 'true' : 'false' },
    update: { value: enabled ? 'true' : 'false' },
  });
  cachedEnabled = enabled;
  cachedEnabledAt = Date.now();
  if (!enabled) {
    songCounter = 0;
    activeIndex = 0;
  }
  console.log(`[yt-dlp] Multi-profile ${enabled ? 'ENABLED' : 'disabled (legacy mode)'}`);
}

export function getActiveProfileSync(multiEnabled: boolean): YtDlpProfile {
  if (!multiEnabled) return getLegacyProfile();
  const profiles = getConfiguredProfiles();
  if (profiles.length === 0) return getLegacyProfile();
  return profiles[activeIndex % profiles.length];
}

export async function getActiveProfile(): Promise<YtDlpProfile> {
  const enabled = await isMultiProfileEnabled();
  return getActiveProfileSync(enabled);
}

/** Call after a successful song extract/download to rotate every N songs. */
export async function noteSuccessfulSongFetch(): Promise<void> {
  if (!(await isMultiProfileEnabled())) return;
  const profiles = getConfiguredProfiles();
  if (profiles.length < 2) return;
  songCounter += 1;
  if (songCounter >= ROTATE_EVERY) {
    songCounter = 0;
    activeIndex = (activeIndex + 1) % profiles.length;
    const next = profiles[activeIndex];
    console.log(`[yt-dlp] Rotated to profile ${next.id} (${next.label}) after ${ROTATE_EVERY} songs`);
  }
}

/** Force next profile immediately (e.g. on 403). */
export async function rotateProfileNow(reason = 'manual'): Promise<YtDlpProfile | null> {
  if (!(await isMultiProfileEnabled())) return null;
  const profiles = getConfiguredProfiles();
  if (profiles.length < 2) return null;
  songCounter = 0;
  activeIndex = (activeIndex + 1) % profiles.length;
  const next = profiles[activeIndex];
  console.log(`[yt-dlp] Forced rotate → ${next.id} (${next.label}) reason=${reason}`);
  return next;
}

export function buildProfileArgs(profile: YtDlpProfile): string[] {
  const args: string[] = [];
  // Fall back to default cookies when a rotation profile has proxy but no cookies file
  const cookiesPath = (profile.cookiesFile && fs.existsSync(profile.cookiesFile))
    ? profile.cookiesFile
    : (config.ytdlpCookiesFile && fs.existsSync(config.ytdlpCookiesFile) ? config.ytdlpCookiesFile : undefined);

  if (cookiesPath) {
    args.push('--cookies', cookiesPath);
  } else if (profile.cookiesFile || config.ytdlpCookiesFile) {
    const missing = profile.cookiesFile || config.ytdlpCookiesFile;
    console.error(`[yt-dlp] Cookies path set but FILE NOT FOUND: ${missing}`);
  }

  const proxy = profile.proxy || config.ytdlpProxy || undefined;
  if (proxy) {
    args.push('--proxy', proxy);
  }

  if (profile.userAgent) {
    args.push('--user-agent', profile.userAgent);
  }
  if (profile.playerClient) {
    args.push('--extractor-args', `youtube:player_client=${profile.playerClient}`);
  }
  return args;
}

function maskProxy(proxy?: string): string | null {
  if (!proxy) return null;
  try {
    // socks5://user:pass@host:1080 → socks5://***@host:1080
    return proxy.replace(/(:\/\/)([^@/]+@)/, '$1***@');
  } catch {
    return '(set)';
  }
}

export async function getYtdlpProfileStatus() {
  const enabled = await isMultiProfileEnabled();
  const profiles = getConfiguredProfiles();
  const active = getActiveProfileSync(enabled);
  const legacy = getLegacyProfile();
  const cookiesPath = config.ytdlpCookiesFile || '';
  const cookiesExist = !!(cookiesPath && fs.existsSync(cookiesPath));
  const activeArgs = buildProfileArgs(active);
  const activeUsesCookies = activeArgs.includes('--cookies');
  const activeUsesProxy = activeArgs.includes('--proxy');

  return {
    enabled,
    rotateEvery: ROTATE_EVERY,
    songCounter,
    activeProfileId: active.id,
    activeProfileLabel: active.label,
    profileCount: profiles.length,
    /** What is actually applied to yt-dlp right now */
    active: {
      id: active.id,
      label: active.label,
      usesProxy: activeUsesProxy,
      usesCookies: activeUsesCookies,
      proxy: maskProxy(active.proxy || config.ytdlpProxy),
    },
    /** Default .env auth (YTDLP_PROXY / YTDLP_COOKIES_FILE) */
    defaultAuth: {
      proxyConfigured: !!config.ytdlpProxy,
      proxy: maskProxy(config.ytdlpProxy),
      cookiesConfigured: !!cookiesPath,
      cookiesExist,
      cookiesPath: cookiesPath || null,
      ok: !!(config.ytdlpProxy || cookiesExist),
      warning: !cookiesPath
        ? 'YTDLP_COOKIES_FILE not set'
        : (!cookiesExist ? `Cookies file missing inside container: ${cookiesPath}` : null),
    },
    profiles: profiles.map((p) => ({
      id: p.id,
      label: p.label,
      hasProxy: !!p.proxy,
      hasCookies: !!(p.cookiesFile && fs.existsSync(p.cookiesFile)),
      cookiesMissing: !!(p.cookiesFile && !fs.existsSync(p.cookiesFile)),
      playerClient: p.playerClient || null,
    })),
    legacy: {
      hasProxy: !!legacy.proxy,
      hasCookies: !!(legacy.cookiesFile && fs.existsSync(legacy.cookiesFile)),
    },
  };
}

/** Quick live check: does yt-dlp reach YouTube with current proxy/cookies? */
export async function testYtdlpConnectivity(): Promise<{
  ok: boolean;
  message: string;
  usesProxy: boolean;
  usesCookies: boolean;
  proxy: string | null;
}> {
  const { runYtDlp } = await import('./ytdlp');
  const active = await getActiveProfile();
  const args = buildProfileArgs(active);
  const usesProxy = args.includes('--proxy');
  const usesCookies = args.includes('--cookies');
  const proxy = maskProxy(active.proxy || config.ytdlpProxy);

  try {
    const result = await runYtDlp([
      '--flat-playlist',
      '--print', '%(id)s',
      '--playlist-end', '1',
      'ytsearch1:official audio',
    ], 35000, { kind: 'search' });

    if (result.code === 0 && result.stdout.trim()) {
      return {
        ok: true,
        message: `OK — YouTube search works (got id ${result.stdout.trim().split('\n')[0]})`,
        usesProxy,
        usesCookies,
        proxy,
      };
    }

    const tip = (result.stderr || result.stdout || 'yt-dlp failed').split('\n').filter(Boolean).slice(-3).join(' | ');
    return {
      ok: false,
      message: tip,
      usesProxy,
      usesCookies,
      proxy,
    };
  } catch (err) {
    return {
      ok: false,
      message: (err as Error).message,
      usesProxy,
      usesCookies,
      proxy,
    };
  }
}
