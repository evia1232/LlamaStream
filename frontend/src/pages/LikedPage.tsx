import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import api from '../api/client';
import TrackRow from '../components/tracks/TrackRow';
import { Track } from '../types';
import { usePlayerStore } from '../store';

export default function LikedPage() {
  const { t } = useTranslation();
  const [tracks, setTracks] = useState<Track[]>([]);
  const playTrack = usePlayerStore((s) => s.playTrack);

  useEffect(() => {
    api.get('/tracks/liked').then(({ data }) => {
      setTracks(data.tracks);
      data.tracks.forEach((t: Track) => usePlayerStore.getState().addToLiked(t.id));
    }).catch(console.error);
  }, []);

  return (
    <div>
      <div className="gradient-bg px-6 pt-8 pb-6 flex items-end gap-6">
        <div className="w-48 h-48 rounded-md shadow-2xl bg-gradient-to-br from-indigo-700 to-purple-300 shrink-0 flex items-center justify-center">
          <span className="text-7xl">💜</span>
        </div>
        <div>
          <p className="text-sm font-medium uppercase">{t('playlists')}</p>
          <h1 className="text-5xl font-bold mb-4">{t('likedSongs')}</h1>
          <p className="text-sm text-spotify-text">{t('trackCount', { count: tracks.length })}</p>
        </div>
      </div>

      <div className="px-6 py-4">
        <button
          onClick={() => tracks[0] && playTrack(tracks[0])}
          className="w-14 h-14 bg-spotify-green rounded-full flex items-center justify-center hover:scale-105 transition-transform"
        >
          <Play className="w-6 h-6 fill-black text-black ms-1" />
        </button>
      </div>

      <div className="px-2">
        {tracks.map((track, i) => (
          <TrackRow key={track.id} track={track} index={i} />
        ))}
      </div>
    </div>
  );
}
