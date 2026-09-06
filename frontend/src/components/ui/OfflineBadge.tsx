import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WifiOff } from 'lucide-react';
import { formatCacheBytes, getAudioCacheStats } from '../../lib/offlineStore';

export default function OfflineBadge() {
  const { t } = useTranslation();
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);
  const [stats, setStats] = useState({ bytes: 0, count: 0 });

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  useEffect(() => {
    const refresh = () => {
      void getAudioCacheStats().then(setStats);
    };
    refresh();
    window.addEventListener('ls-audio-cache-changed', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    const id = window.setInterval(refresh, 15000);
    return () => {
      window.removeEventListener('ls-audio-cache-changed', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
      window.clearInterval(id);
    };
  }, []);

  // Only while offline — include how much audio is on-device
  if (!offline) return null;

  const cacheLabel = stats.count > 0
    ? t('offlineCacheBadge', { count: stats.count, size: formatCacheBytes(stats.bytes) })
    : null;

  return (
    <div
      className="fixed top-3 left-1/2 z-[70] -translate-x-1/2 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-1.5 rounded-full bg-black/80 px-3 py-1 text-xs font-bold text-white shadow-lg border border-white/10 max-w-[90vw]">
        <WifiOff className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">
          {t('offlineBadge')}
          {cacheLabel ? ` · ${cacheLabel}` : null}
        </span>
      </div>
    </div>
  );
}
