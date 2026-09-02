import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './i18n';
import './index.css';
import { applyDocumentDirection } from './lib/direction';
import { applyAppBranding } from './lib/appName';
import { loadAndApplyTheme } from './lib/theme';

applyDocumentDirection();
applyAppBranding();
void loadAndApplyTheme();

// PWA: activate new service worker immediately and reload to pick up fresh CSS/JS
const updateSW = registerSW({
  immediate: true,
  onOfflineReady() {
    console.log('[PWA] App ready for offline use');
  },
  onNeedRefresh() {
    updateSW(true);
  },
  onRegisteredSW(_swUrl, registration) {
    if (registration) {
      // Check for updates when user returns to the app
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          registration.update();
        }
      });
      // Periodic update check
      setInterval(() => registration.update(), 60 * 60 * 1000);
    }
  },
  onRegisterError(error) {
    console.error('[PWA] Service worker registration failed:', error);
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
