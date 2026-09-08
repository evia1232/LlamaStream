import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { usePlayerStore } from '../store';
import { useTrackMenuStore } from '../store/trackMenuStore';

/** Close the top-most overlay; return true if something was closed. */
function consumeOverlayBack(): boolean {
  const menu = useTrackMenuStore.getState();
  if (menu.playlistModalOpen) {
    menu.closePlaylistModal();
    return true;
  }
  if (menu.menuOpen) {
    menu.closeMenu();
    return true;
  }

  const player = usePlayerStore.getState();
  if (player.showDevicePicker) {
    player.setShowDevicePicker(false);
    return true;
  }
  if (player.showQueue) {
    player.setShowQueue(false);
    return true;
  }
  if (player.showLyrics) {
    player.setShowLyrics(false);
    return true;
  }
  if (player.showNowPlaying) {
    player.setShowNowPlaying(false);
    return true;
  }
  return false;
}

/**
 * Android system back: close sheets/menus first, then SPA history,
 * and only minimize the app at the navigation root (keeps music playing).
 */
export function startAndroidBackNavigation(): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};

  let remove: (() => void) | undefined;

  void App.addListener('backButton', ({ canGoBack }) => {
    if (consumeOverlayBack()) return;

    if (canGoBack) {
      window.history.back();
      return;
    }

    // Root route — send to background instead of killing playback
    void App.minimizeApp().catch(() => {
      /* older Capacitor: ignore */
    });
  }).then((handle) => {
    remove = () => {
      void handle.remove();
    };
  });

  return () => {
    remove?.();
  };
}
