import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { config, qualityAudioScale } from '../config';

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

/** Shared auth / network args (cookies, proxy) for every yt-dlp invocation. */
export function ytDlpAuthArgs(): string[] {
  const args: string[] = [];
  const cookies = config.ytdlpCookiesFile;
  if (cookies && fs.existsSync(cookies)) {
    args.push('--cookies', cookies);
  }
  const proxy = config.ytdlpProxy;
  if (proxy) {
    args.push('--proxy', proxy);
  }
  return args;
}

function resolveYtDlpBin(): string {
  const fromEnv = (process.env.YTDLP_BIN || '').trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const storageBin = path.join(config.cachePath, '..', 'bin', 'yt-dlp');
  if (fs.existsSync(storageBin)) return storageBin;
  return 'yt-dlp';
}

export function ytDlpCommand(): string {
  return resolveYtDlpBin();
}

export function runYtDlp(args: string[], timeoutMs = 300000): Promise<YtDlpResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(resolveYtDlpBin(), [...BASE_ARGS, ...ytDlpAuthArgs(), ...args], {
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

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 1 });
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

  return [
    {
      label: 'android+web m4a',
      args: [
        '--extractor-args', 'youtube:player_client=android,web',
        '-f', 'bestaudio[ext=m4a]/bestaudio/best',
        ...extract,
      ],
    },
    {
      label: 'ios+android best',
      args: [
        '--extractor-args', 'youtube:player_client=ios,android,web',
        '-f', 'bestaudio/best',
        ...extract,
      ],
    },
    {
      label: 'tv_embedded best',
      args: [
        '--extractor-args', 'youtube:player_client=tv_embedded,web',
        '-f', 'bestaudio/best',
        ...extract,
      ],
    },
    {
      label: 'default best',
      args: [
        '-f', 'ba/b',
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
  return /403|Forbidden|Sign in to confirm|confirm you.?re not a bot/i.test(msg);
}
