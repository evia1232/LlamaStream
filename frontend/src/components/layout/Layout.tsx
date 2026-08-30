import { ReactNode } from 'react';
import Sidebar from './Sidebar';
import PlayerBar from '../player/PlayerBar';
import QueueDrawer from '../queue/QueueDrawer';
import LyricsPanel from '../lyrics/LyricsPanel';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="h-screen flex flex-col bg-spotify-black">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto bg-gradient-to-b from-spotify-gray to-spotify-black rounded-lg mx-2 mt-2 mb-0">
          {children}
        </main>
      </div>
      <PlayerBar />
      <QueueDrawer />
      <LyricsPanel />
    </div>
  );
}
