import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/client';
import CardGrid from '../components/common/CardGrid';
import { Track } from '../types';
import { normalizeTrack } from '../lib/trackUtils';
import TrackRow from '../components/tracks/TrackRow';
import TrackSurface from '../components/tracks/TrackSurface';
import { usePlayerStore } from '../store';

interface HomeData {
  greeting: string;
  recentlyPlayed: Track[];
  likedCount: number;
  yourPlaylists: { id: string; name: string; coverUrl?: string; trackCount: number }[];
  madeForYou: { id: string; name: string; coverUrl?: string; trackCount: number }[];
  topArtists: { id: string; name: string; imageUrl?: string }[];
  history: (Track & { playedAt?: string })[];
}

export default function HomePage() {
  const { t } = useTranslation();
  const [data, setData] = useState<HomeData | null>(null);
  const playTrack = usePlayerStore((s) => s.playTrack);

  useEffect(() => {
    api.get('/home').then(({ data: d }) => setData(d)).catch(console.error);
  }, []);

  const refresh = () => {
    api.get('/home').then(({ data: d }) => setData(d)).catch(console.error);
  };

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-spotify-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="pb-8">
      {/* Hero */}
      <div className="gradient-bg px-4 md:px-8 pt-6 md:pt-10 pb-8">
        <h1 className="text-display mb-6 md:mb-8">{t(data.greeting)}</h1>
        {data.recentlyPlayed.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-3">
            {data.recentlyPlayed.slice(0, 6).map((track) => {
              const normalized = normalizeTrack(track);
              return (
                <TrackSurface
                  key={track.id}
                  track={normalized}
                  onClick={() => playTrack(normalized)}
                  className="flex items-center gap-0 bg-white/10 hover:bg-white/20 rounded-spotify overflow-hidden transition-all duration-200 group text-start cursor-pointer"
                >
                  <div className="w-16 h-16 md:w-[4.5rem] md:h-[4.5rem] shrink-0 shadow-card">
                    {track.thumbnailUrl ? (
                      <img src={track.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-spotify-lightgray flex items-center justify-center">♪</div>
                    )}
                  </div>
                  <span className="text-sm font-bold truncate px-4 group-hover:text-white">{track.title}</span>
                </TrackSurface>
              );
            })}
          </div>
        )}
      </div>

      <CardGrid
        title={t('yourPlaylists')}
        items={data.yourPlaylists.map((p) => ({ ...p, type: 'playlist' as const }))}
      />

      <CardGrid
        title={t('madeForYou')}
        items={data.madeForYou.map((p) => ({ ...p, type: 'playlist' as const }))}
      />

      <CardGrid
        title={t('topArtists')}
        items={data.topArtists.map((a) => ({ id: a.id, name: a.name, imageUrl: a.imageUrl, type: 'artist' as const }))}
        linkPrefix="/artist"
      />

      {data.history.length > 0 && (
        <section className="px-4 md:px-6 mb-8">
          <h2 className="text-heading mb-4">{t('history')}</h2>
          <div>
            {data.history.slice(0, 10).map((track, i) => (
              <TrackRow key={`${track.id}-${i}`} track={normalizeTrack(track)} index={i} onDeleted={refresh} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
