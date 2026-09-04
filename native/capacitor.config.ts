import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Thin native shell around the hosted PWA.
 * Change NATIVE_APP_URL / server.url to your deployed site.
 */
const appUrl = process.env.NATIVE_APP_URL?.trim() || 'https://music24.apbs.link';

const config: CapacitorConfig = {
  appId: 'link.apbs.llamastream',
  appName: 'Music24',
  webDir: 'www',
  server: {
    url: appUrl, // default https://music24.apbs.link
    cleartext: false,
    allowNavigation: [
      'music24.apbs.link',
      'llamastream.apbs.link',
      '*.apbs.link',
      'accounts.spotify.com',
      'api.spotify.com',
    ],
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#121212',
    // Keep WebView alive; audio continues when app is backgrounded
    webContentsDebuggingEnabled: false,
  },
  ios: {
    backgroundColor: '#121212',
    contentInset: 'automatic',
    allowsLinkPreview: false,
    preferredContentMode: 'mobile',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#121212',
    },
  },
};

export default config;
