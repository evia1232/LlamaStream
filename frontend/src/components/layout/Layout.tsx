import { ReactNode, useEffect } from 'react';
import clsx from 'clsx';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import PlayerBar from '../player/PlayerBar';
import NowPlayingSheet from '../player/NowPlayingSheet';
import QueueDrawer from '../queue/QueueDrawer';
import LyricsPanel from '../lyrics/LyricsPanel';
import InstallPrompt from '../pwa/InstallPrompt';
import TrackMenuHost from '../tracks/TrackMenuHost';
import { usePlayerStore } from '../../store';
import { useAudioInterruptResume } from '../../hooks/useAudioInterruptResume';
import { usePlaybackSync } from '../../hooks/usePlaybackSync';
import DevicePicker from '../player/DevicePicker';
import { startPlaybackKeeper } from '../../lib/backgroundPlayback';
import { startAppResumeListeners } from '../../lib/appResume';
import AppToast from '../ui/AppToast';
import OfflineBadge from '../ui/OfflineBadge';

export default function Layout({ children }: { children: ReactNode }) {
  const hasTrack = usePlayerStore((s) => !!s.currentTrack);
  useAudioInterruptResume();
  usePlaybackSync();

  useEffect(() => {
    const stopKeeper = startPlaybackKeeper();
    const stopResume = startAppResumeListeners();
    return () => {
      stopKeeper();
      stopResume();
    };
  }, []);

  return (
    <div className="h-screen flex flex-col bg-spotify-black safe-area">
      <div className="flex flex-1 overflow-hidden min-h-0">
        <Sidebar />
        <main
          className={clsx(
            'flex-1 overflow-y-auto overflow-x-hidden main-panel md:mx-2 md:mt-2 scrollbar-spotify min-w-0',
            hasTrack ? 'pb-mobile-with-player' : 'pb-mobile-nav-only'
          )}
        >
          {children}
        </main>
      </div>
      <PlayerBar />
      <DevicePicker />
      <MobileNav />
      <NowPlayingSheet />
      <QueueDrawer />
      <LyricsPanel />
      <InstallPrompt />
      <TrackMenuHost />
      <AppToast />
      <OfflineBadge />
    </div>
  );
}
