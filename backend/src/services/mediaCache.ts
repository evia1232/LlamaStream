import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config';

const ART_DIR = path.join(config.cachePath, 'covers');

function ensureArtDir() {
  fs.mkdirSync(ART_DIR, { recursive: true });
}

function extFromUrl(url: string, contentType?: string | null): string {
  if (contentType?.includes('png')) return '.png';
  if (contentType?.includes('webp')) return '.webp';
  if (contentType?.includes('jpeg') || contentType?.includes('jpg')) return '.jpg';
  const m = url.match(/\.(jpe?g|png|webp|gif)(\?|$)/i);
  return m ? `.${m[1].toLowerCase().replace('jpeg', 'jpg')}` : '.jpg';
}

/** Already a local media URL we serve ourselves. */
export function isLocalMediaUrl(url?: string | null): boolean {
  if (!url) return false;
  return /\/api\/media\/covers\//i.test(url);
}

/**
 * Download a remote image once and return a stable local `/api/media/covers/...` URL.
 * If download fails, returns the original URL.
 */
export async function cacheRemoteImage(remoteUrl?: string | null, keyHint?: string): Promise<string | null> {
  const url = (remoteUrl || '').trim();
  if (!url) return null;
  if (isLocalMediaUrl(url)) return url;
  if (!/^https?:\/\//i.test(url)) return url;

  try {
    ensureArtDir();
    const hash = crypto
      .createHash('sha1')
      .update(`${keyHint || ''}|${url}`)
      .digest('hex')
      .slice(0, 24);

    // Reuse existing file with any extension
    const existing = fs.readdirSync(ART_DIR).find((f) => f.startsWith(hash + '.'));
    if (existing) return `/api/media/covers/${existing}`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'LlamaStream/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return url;

    const ext = extFromUrl(url, res.headers.get('content-type'));
    const filename = `${hash}${ext}`;
    const filePath = path.join(ART_DIR, filename);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 200) return url;
    fs.writeFileSync(filePath, buf);
    return `/api/media/covers/${filename}`;
  } catch {
    return url;
  }
}
