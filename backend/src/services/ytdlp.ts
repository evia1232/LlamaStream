import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

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
  '--extractor-args', 'youtube:player_client=android,web',
];

export function runYtDlp(args: string[], timeoutMs = 300000): Promise<YtDlpResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', [...BASE_ARGS, ...args], {
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

export function findFileByPrefix(dir: string, prefix: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix));
  const mp3 = files.find((f) => f.endsWith('.mp3'));
  if (mp3) return path.join(dir, mp3);
  const audio = files.find((f) => /\.(mp3|m4a|opus|webm|ogg)$/i.test(f));
  return audio ? path.join(dir, audio) : null;
}

export function lastLines(text: string, count = 5): string {
  return text.split('\n').filter(Boolean).slice(-count).join('\n');
}
