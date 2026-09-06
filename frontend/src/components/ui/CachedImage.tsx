import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { resolveCachedImageSrc } from '../../lib/offlineStore';
import { normalizeCoverUrl } from '../../lib/trackUtils';

/**
 * Cover image. Online uses the URL directly; offline may use a Cache API blob.
 * On error: remove the <img> (avoids repeated onError storms that freeze the UI).
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
  const blobRef = useRef<string | null>(null);
  const failOnceRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    failOnceRef.current = false;
    setFailed(false);
    setDisplay(normalized);

    if (blobRef.current) {
      try { URL.revokeObjectURL(blobRef.current); } catch { /* ignore */ }
      blobRef.current = null;
    }

    if (!normalized) return;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      void resolveCachedImageSrc(normalized).then((resolved) => {
        if (cancelled || !resolved) return;
        if (resolved.startsWith('blob:')) {
          blobRef.current = resolved;
          setDisplay(resolved);
        }
      });
    } else {
      void resolveCachedImageSrc(normalized);
    }

    return () => {
      cancelled = true;
    };
  }, [normalized]);

  useEffect(() => () => {
    if (blobRef.current) {
      try { URL.revokeObjectURL(blobRef.current); } catch { /* ignore */ }
      blobRef.current = null;
    }
  }, []);

  if (!normalized || failed || !display) {
    return (
      <div
        className={clsx(className, 'flex items-center justify-center bg-spotify-lightgray text-spotify-text text-sm')}
        aria-hidden
      >
        ♪
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
        if (failOnceRef.current) return;
        failOnceRef.current = true;

        // One YouTube quality fallback, then give up (unmount img — no error loop)
        if (normalized && display === normalized && /\/hqdefault\.jpg$/i.test(normalized)) {
          failOnceRef.current = false;
          setDisplay(normalized.replace(/\/hqdefault\.jpg$/i, '/mqdefault.jpg'));
          return;
        }
        setFailed(true);
      }}
    />
  );
}
