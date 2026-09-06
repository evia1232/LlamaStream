import { useEffect, useState } from 'react';
import { resolveCachedImageSrc } from '../../lib/offlineStore';

/** Image that falls back to Cache API blobs when offline. */
export default function CachedImage({
  src,
  alt = '',
  className,
}: {
  src: string | null | undefined;
  alt?: string;
  className?: string;
}) {
  const [display, setDisplay] = useState<string | null>(src || null);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    setDisplay(src || null);
    if (!src) return;
    void resolveCachedImageSrc(src).then((resolved) => {
      if (cancelled || !resolved) return;
      if (resolved.startsWith('blob:') && resolved !== src) revoked = resolved;
      setDisplay(resolved);
    });
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [src]);

  if (!display) return null;
  return <img src={display} alt={alt} className={className} loading="lazy" decoding="async" />;
}
