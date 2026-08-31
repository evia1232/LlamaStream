import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './i18n';
import './index.css';
import { applyDocumentDirection } from './lib/direction';

applyDocumentDirection();

// PWA: auto-update service worker when new version is deployed
registerSW({
  immediate: true,
  onOfflineReady() {
    console.log('[PWA] App ready for offline use');
  },
  onNeedRefresh() {
    const msg = document.documentElement.lang === 'he'
      ? 'גרסה חדשה זמינה. לרענן?'
      : 'A new version is available. Reload?';
    if (confirm(msg)) window.location.reload();
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
