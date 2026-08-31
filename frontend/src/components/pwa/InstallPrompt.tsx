import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isAndroid(): boolean {
  return /android/i.test(navigator.userAgent);
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export default function InstallPrompt() {
  const { t } = useTranslation();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() =>
    localStorage.getItem('pwa-install-dismissed') === 'true'
  );
  const [isInstalled, setIsInstalled] = useState(false);
  const [showManual, setShowManual] = useState(false);

  useEffect(() => {
    if (isStandalone()) {
      setIsInstalled(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowManual(false);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // On Android, if install prompt never fires, show manual instructions after a delay
    const timer = window.setTimeout(() => {
      if (!isStandalone() && (isAndroid() || isIos())) {
        setShowManual(true);
      }
    }, 8000);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.clearTimeout(timer);
    };
  }, []);

  if (isInstalled || dismissed) return null;
  if (!deferredPrompt && !showManual) return null;

  const handleInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') setDeferredPrompt(null);
      return;
    }
    setShowManual(true);
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem('pwa-install-dismissed', 'true');
    setDeferredPrompt(null);
    setShowManual(false);
  };

  const hint = deferredPrompt
    ? t('installAppHint')
    : isIos()
      ? t('installIosHint')
      : t('installAndroidHint');

  return (
    <div className="fixed bottom-24 start-4 end-4 md:start-auto md:end-4 md:w-80 bg-spotify-lightgray border border-white/10 rounded-xl p-4 shadow-2xl z-40 flex items-start gap-3">
      <div className="w-10 h-10 bg-spotify-green rounded-lg flex items-center justify-center shrink-0 text-lg">
        🦙
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm">{t('installApp')}</p>
        <p className="text-xs text-spotify-text mt-0.5">{hint}</p>
        {deferredPrompt && (
          <button
            onClick={handleInstall}
            className="mt-2 green-btn py-1.5 px-4 text-xs flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            {t('install')}
          </button>
        )}
      </div>
      <button onClick={handleDismiss} className="icon-btn p-1 shrink-0" aria-label={t('close')}>
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
