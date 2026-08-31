import { ReactNode } from 'react';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import PlayerBar from '../player/PlayerBar';
import QueueDrawer from '../queue/QueueDrawer';
import LyricsPanel from '../lyrics/LyricsPanel';
import InstallPrompt from '../pwa/InstallPrompt';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="h-screen flex flex-col bg-spotify-black safe-area">
      <div className="flex flex-1 overflow-hidden min-h-0">
        <Sidebar />
        <main className="flex-1 overflow-y-auto main-panel md:mx-2 md:mt-2 scrollbar-spotify">
          {children}
        </main>
      </div>
      <PlayerBar />
      <MobileNav />
      <QueueDrawer />
      <LyricsPanel />
      <InstallPrompt />
    </div>
  );
}
