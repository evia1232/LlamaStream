import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import api from '../api/client';
import TrackRow from '../components/tracks/TrackRow';
import { Track } from '../types';
import { normalizeTrack } from '../lib/trackUtils';
import { usePlayerStore } from '../store';

export default function LikedPage() {
  const { t } = useTranslation();
  const [tracks, setTracks] = useState<Track[]>([]);
  const playTracks = usePlayerStore((s) => s.playTracks);

  useEffect(() => {
    api.get('/tracks/liked').then(({ data }) => {
      setTracks(data.tracks.map((t: Track) => normalizeTrack(t)));
      data.tracks.forEach((t: Track) => usePlayerStore.getState().addToLiked(t.id));
    }).catch(console.error);
  }, []);

  const refresh = () => {
    api.get('/tracks/liked').then(({ data }) => {
      setTracks(data.tracks.map((t: Track) => normalizeTrack(t)));
    }).catch(console.error);
  };

  return (
    <div>
      <div className="gradient-bg px-4 md:px-8 pt-8 md:pt-12 pb-8 flex flex-col sm:flex-row items-end gap-6">
        <div className="w-36 h-36 md:w-48 md:h-48 rounded-spotify shadow-card bg-gradient-to-br from-indigo-700 to-purple-300 shrink-0 flex items-center justify-center">
          <span className="text-6xl md:text-7xl">💜</span>
        </div>
        <div className="min-w-0 pb-2">
          <p className="text-label mb-2">{t('playlists')}</p>
          <h1 className="text-hero mb-3 md:mb-4">{t('likedSongs')}</h1>
          <p className="text-caption">{t('trackCount', { count: tracks.length })}</p>
        </div>
      </div>

      <div className="px-6 py-4">
        <button
          onClick={() => tracks.length > 0 && void playTracks(tracks, 0)}
          className="w-14 h-14 bg-spotify-green rounded-full flex items-center justify-center hover:scale-105 transition-transform"
        >
          <Play className="w-6 h-6 fill-black text-black play-icon-nudge" />
        </button>
      </div>

      <div className="px-2">
        {tracks.map((track, i) => (
          <TrackRow key={track.id} track={track} index={i} contextTracks={tracks} onDeleted={refresh} />
        ))}
      </div>
    </div>
  );
}
