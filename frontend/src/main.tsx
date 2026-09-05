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
import { configureAudioSession } from './lib/backgroundPlayback';
import { usePlayerStore } from './store';

applyDocumentDirection();
applyAppBranding();
configureAudioSession();
void loadAndApplyTheme();

// PWA: update in background — never hard-reload while music is playing
const updateSW = registerSW({
  immediate: true,
  onOfflineReady() {
    console.log('[PWA] App ready for offline use');
  },
  onNeedRefresh() {
    const playing = usePlayerStore.getState().isPlaying;
    if (playing) {
      // Defer until playback stops / user leaves
      const wait = () => {
        if (!usePlayerStore.getState().isPlaying) {
          updateSW(true);
          return;
        }
        window.setTimeout(wait, 15000);
      };
      wait();
      return;
    }
    updateSW(true);
  },
  onRegisteredSW(_swUrl, registration) {
    if (registration) {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && !usePlayerStore.getState().isPlaying) {
          registration.update();
        }
      });
      setInterval(() => {
        if (!usePlayerStore.getState().isPlaying) registration.update();
      }, 60 * 60 * 1000);
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
