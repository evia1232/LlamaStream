import { useEffect, useState } from 'react';
import { resolveCachedImageSrc } from '../../lib/offlineStore';
import { normalizeCoverUrl } from '../../lib/trackUtils';

/**
 * Image with offline cache support.
 * Online: always use the real URL (never opaque Cache API blobs — those break display).
 * Offline: try Cache API, fall back to original URL, then placeholder on error.
 */
export default function CachedImage({
  src,
  alt = '',
  className,
}: {
  src: string | null | undefined;
  alt?: string;
  className?: string;
}) {
  const normalized = normalizeCoverUrl((src || '').trim()) || null;
  const [display, setDisplay] = useState<string | null>(normalized);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let blobUrl: string | null = null;
    setFailed(false);
    setDisplay(normalized);

    if (!normalized) return;

    // Online: keep network URL; optionally warm the cache in the background
    if (typeof navigator === 'undefined' || navigator.onLine) {
      void resolveCachedImageSrc(normalized);
      return () => { cancelled = true; };
    }

    void resolveCachedImageSrc(normalized).then((resolved) => {
      if (cancelled || !resolved) return;
      if (resolved.startsWith('blob:')) {
        blobUrl = resolved;
      }
      setDisplay(resolved);
    });

    return () => {
      cancelled = true;
      if (blobUrl) {
        try { URL.revokeObjectURL(blobUrl); } catch { /* ignore */ }
      }
    };
  }, [normalized]);

  if (!display || failed) {
    return (
      <div className={className} aria-hidden>
        <div className="w-full h-full flex items-center justify-center bg-spotify-lightgray text-spotify-text text-sm">♪</div>
      </div>
    );
  }

  return (
    <img
      src={display}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => {
        // Offline blob failed → try original URL once; then placeholder
        if (normalized && display !== normalized) {
          setDisplay(normalized);
          return;
        }
        // hqdefault failed → try mqdefault
        if (normalized && /\/hqdefault\.jpg$/i.test(normalized)) {
          const fallback = normalized.replace(/\/hqdefault\.jpg$/i, '/mqdefault.jpg');
          if (display !== fallback) {
            setDisplay(fallback);
            return;
          }
        }
        setFailed(true);
      }}
    />
  );
}
