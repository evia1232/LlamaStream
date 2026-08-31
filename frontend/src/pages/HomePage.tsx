import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/client';
import CardGrid from '../components/common/CardGrid';
import { Track } from '../types';
import { normalizeTrack } from '../lib/trackUtils';
import TrackRow from '../components/tracks/TrackRow';
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
      <div className="gradient-bg px-6 pt-8 pb-6">
        <h1 className="text-3xl font-bold mb-6">{t(data.greeting)}</h1>
        {data.recentlyPlayed.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {data.recentlyPlayed.slice(0, 6).map((track) => (
              <button
                key={track.id}
                onClick={() => playTrack(normalizeTrack(track))}
                className="flex items-center gap-3 bg-white/10 hover:bg-white/20 rounded-md overflow-hidden transition-colors group"
              >
                <div className="w-16 h-16 shrink-0">
                  {track.thumbnailUrl ? (
                    <img src={track.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-spotify-lightgray flex items-center justify-center">♪</div>
                  )}
                </div>
                <span className="font-semibold truncate pe-4">{track.title}</span>
              </button>
            ))}
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
        <section className="px-6">
          <h2 className="text-2xl font-bold mb-4">{t('history')}</h2>
          <div>
            {data.history.slice(0, 10).map((track, i) => (
              <TrackRow key={`${track.id}-${i}`} track={normalizeTrack(track)} index={i} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
