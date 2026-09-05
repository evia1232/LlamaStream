import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WifiOff } from 'lucide-react';

export default function OfflineBadge() {
  const { t } = useTranslation();
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);

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

  if (!offline) return null;

  return (
    <div
      className="fixed top-3 left-1/2 z-[70] -translate-x-1/2 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-1.5 rounded-full bg-black/80 px-3 py-1 text-xs font-bold text-white shadow-lg border border-white/10">
        <WifiOff className="w-3.5 h-3.5 shrink-0" />
        {t('offlineBadge')}
      </div>
    </div>
  );
}
