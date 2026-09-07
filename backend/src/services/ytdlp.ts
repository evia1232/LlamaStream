import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { config, qualityAudioScale } from '../config';
import {
  buildProfileArgs,
  getActiveProfile,
  getActiveProfileSync,
  getLegacyProfile,
  isMultiProfileEnabled,
  isMultiProfileEnabledCached,
  noteSuccessfulSongFetch,
  rotateProfileNow,
} from './ytdlpProfiles';

export interface YtDlpResult {
  stdout: string;
  stderr: string;
  code: number;
}

const BASE_ARGS = [
  '--no-warnings',
  '--no-playlist',
  '--retries', '5',
  '--fragment-retries', '5',
  '--socket-timeout', '30',
  // Node 22+ in the backend image solves YouTube EJS signature challenges
  '--js-runtimes', 'node',
  '--remote-components', 'ejs:github',
];

let multiEnabledCache = false;

/** Global YouTube rate-limit gate (session banned). */
let ytRateLimitUntil = 0;
let lastYtSearchAt = 0;
let lastYtDownloadAt = 0;
let ytSearchQueue: Promise<void> = Promise.resolve();
let ytDownloadQueue: Promise<void> = Promise.resolve();
const YT_SEARCH_GAP_MS = Math.max(400, parseInt(process.env.YTDLP_SEARCH_GAP_MS || '900', 10) || 900);
const YT_DOWNLOAD_GAP_MS = Math.max(800, parseInt(process.env.YTDLP_MIN_GAP_MS || '1600', 10) || 1600);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isYouTubeRateLimited(): boolean {
  return Date.now() < ytRateLimitUntil;
}

export function youtubeRateLimitRemainingMs(): number {
  return Math.max(0, ytRateLimitUntil - Date.now());
}

export function noteYouTubeRateLimit(reason = 'rate-limit'): void {
  // Keep gate short — long pauses make the whole app feel dead
  const mins = Math.max(8, parseInt(process.env.YTDLP_RATE_LIMIT_MINUTES || '15', 10) || 15);
  ytRateLimitUntil = Date.now() + mins * 60 * 1000;
  console.warn(`[yt-dlp] YouTube ${reason} — pausing yt-dlp until ${new Date(ytRateLimitUntil).toISOString()}`);
  void rotateProfileNow(reason).catch(() => null);
}

export function clearYouTubeRateLimit(): void {
  ytRateLimitUntil = 0;
}

export function isYouTubeRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /rate-?limited by YouTube|current session has been rate-limited|try again later/i.test(msg);
}

export type YtDlpSlotKind = 'search' | 'download';

/** Serialize yt-dlp; search/download use separate queues so UI search is not stuck behind downloads. */
export async function waitForYtDlpSlot(kind: YtDlpSlotKind = 'download'): Promise<void> {
  const run = async () => {
    if (isYouTubeRateLimited()) {
      const mins = Math.ceil(youtubeRateLimitRemainingMs() / 60000);
      throw new Error(
        `YouTube rate-limited (~${mins} min left). Wait, rotate proxy/cookies profile, or retry later.`,
      );
    }
    const last = kind === 'search' ? lastYtSearchAt : lastYtDownloadAt;
    const gapMs = kind === 'search' ? YT_SEARCH_GAP_MS : YT_DOWNLOAD_GAP_MS;
    const gap = Math.max(0, gapMs - (Date.now() - last));
    if (gap > 0) await sleep(gap);
    if (kind === 'search') lastYtSearchAt = Date.now();
    else lastYtDownloadAt = Date.now();
  };

  if (kind === 'search') {
    const next = ytSearchQueue.then(run, run);
    ytSearchQueue = next.then(() => undefined, () => undefined);
    await next;
    return;
  }

  const next = ytDownloadQueue.then(run, run);
  ytDownloadQueue = next.then(() => undefined, () => undefined);
  await next;
}

/** Shared auth / network args (cookies, proxy) — respects multi-profile when enabled. */
export async function ytDlpAuthArgsAsync(): Promise<string[]> {
  const enabled = await isMultiProfileEnabled();
  multiEnabledCache = enabled;
  if (!enabled) return buildProfileArgs(getLegacyProfile());
  return buildProfileArgs(await getActiveProfile());
}

/** Sync auth args using cached multi-profile flag (refreshed by async calls). */
export function ytDlpAuthArgs(): string[] {
  const enabled = multiEnabledCache || isMultiProfileEnabledCached();
  if (!enabled) return buildProfileArgs(getLegacyProfile());
  return buildProfileArgs(getActiveProfileSync(true));
}

async function resolveAuthArgs(): Promise<string[]> {
  return ytDlpAuthArgsAsync();
}

function resolveYtDlpBin(): string {
  const candidates = [
    (process.env.YTDLP_BIN || '').trim(),
    '/usr/local/bin/yt-dlp',
    path.join(config.cachePath, '..', 'bin', 'yt-dlp'),
    'yt-dlp',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === 'yt-dlp' || fs.existsSync(candidate)) {
      if (candidate !== 'yt-dlp') {
        try { fs.chmodSync(candidate, 0o755); } catch { /* ignore */ }
      }
      return candidate;
    }
  }
  return 'yt-dlp';
}

export function ytDlpCommand(): string {
  return resolveYtDlpBin();
}

export function runYtDlp(
  args: string[],
  timeoutMs = 300000,
  opts?: { kind?: YtDlpSlotKind },
): Promise<YtDlpResult> {
  return new Promise(async (resolve, reject) => {
    try {
      await waitForYtDlpSlot(opts?.kind || 'download');
    } catch (err) {
      reject(err);
      return;
    }

    let authArgs: string[];
    try {
      authArgs = await resolveAuthArgs();
    } catch {
      authArgs = ytDlpAuthArgs();
    }

    const proc = spawn(resolveYtDlpBin(), [...BASE_ARGS, ...authArgs, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`yt-dlp timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('error', (err) => {
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('yt-dlp is not installed or not in PATH'));
      } else {
        reject(err);
      }
    });

    proc.on('close', async (code) => {
      clearTimeout(timer);
      const result = { stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 1 };
      const combined = `${result.stderr}\n${result.stdout}`;
      if (result.code !== 0 && isYouTubeRateLimitError(combined)) {
        noteYouTubeRateLimit('rate-limit');
      } else if (result.code !== 0 && /403|Forbidden|Sign in to confirm|confirm you.?re not a bot|confirm your age/i.test(combined)) {
        const usedProxy = authArgs.includes('--proxy');
        const usedCookies = authArgs.includes('--cookies');
        console.warn(`[yt-dlp] 403 — auth applied: proxy=${usedProxy} cookies=${usedCookies}`);
        await rotateProfileNow('403').catch(() => null);
      }
      resolve(result);
    });
  });
}

export async function ytDlpVersion(): Promise<string> {
  const result = await runYtDlp(['--version'], 10000);
  if (result.code !== 0) throw new Error(result.stderr || 'yt-dlp version check failed');
  return result.stdout.split('\n')[0];
}

/** Format/client combos — YouTube often breaks one client; try several. */
export function ytDlpAudioExtractAttempts(quality: 'LOW' | 'NORMAL' | 'HIGH' = 'HIGH'): Array<{
  label: string;
  args: string[];
}> {
  const audioQuality = qualityAudioScale[quality] || '0';
  const extract = [
    '-x', '--audio-format', 'mp3',
    '--audio-quality', audioQuality,
    '--postprocessor-args', 'ffmpeg:-ar 44100 -ac 2',
    '--concurrent-fragments', '1',
  ];

  // Prefer loose selectors — strict bestaudio often yields "Requested format is not available"
  // when a client exposes only combined streams or empty format lists under proxy/cookies.
  return [
    {
      label: 'default loose',
      args: [
        '-f', 'ba/b/bestaudio/best',
        ...extract,
      ],
    },
    {
      label: 'android+web loose',
      args: [
        '--extractor-args', 'youtube:player_client=android,web',
        '-f', 'ba/b/bestaudio/best',
        ...extract,
      ],
    },
    {
      label: 'web+android best',
      args: [
        '--extractor-args', 'youtube:player_client=web,android',
        '-f', 'bestaudio*/best',
        ...extract,
      ],
    },
    {
      label: 'ios+android best',
      args: [
        '--extractor-args', 'youtube:player_client=ios,android,web',
        '-f', 'ba/b/bestaudio/best',
        ...extract,
      ],
    },
    {
      label: 'tv_embedded best',
      args: [
        '--extractor-args', 'youtube:player_client=tv_embedded,web',
        '-f', 'ba/b/bestaudio/best',
        ...extract,
      ],
    },
    {
      label: 'mweb any',
      args: [
        '--extractor-args', 'youtube:player_client=mweb,web',
        '-f', 'ba/b',
        ...extract,
      ],
    },
    {
      label: 'no format filter',
      args: [
        ...extract,
      ],
    },
  ];
}

/** @deprecated Prefer ytDlpAudioExtractAttempts for retries */
export function ytDlpAudioExtractArgs(quality: 'LOW' | 'NORMAL' | 'HIGH' = 'HIGH'): string[] {
  return ytDlpAudioExtractAttempts(quality)[0].args;
}

export function findFileByPrefix(dir: string, prefix: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const mp3 = fs.readdirSync(dir).find((f) => f.startsWith(prefix) && f.endsWith('.mp3'));
  if (!mp3) return null;
  const fullPath = path.join(dir, mp3);
  try {
    const stat = fs.statSync(fullPath);
    if (stat.size < 1024) return null;
  } catch {
    return null;
  }
  return fullPath;
}

export function lastLines(text: string, count = 5): string {
  return text.split('\n').filter(Boolean).slice(-count).join('\n');
}

export function isFormatUnavailableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Requested format is not available|format is not available|Only images are available/i.test(msg);
}

export function isYouTubeBlockedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /403|Forbidden|Sign in to confirm|confirm you.?re not a bot|confirm your age|age.?restrict|rate-?limited by YouTube/i.test(msg);
}

export { noteSuccessfulSongFetch };
