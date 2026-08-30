import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/client';
import TrackRow from '../components/tracks/TrackRow';
import { Track } from '../types';

export default function ArtistPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const [artist, setArtist] = useState<{
    id: string; name: string; imageUrl?: string;
    tracks: Track[];
  } | null>(null);

  useEffect(() => {
    if (id) {
      api.get(`/home/artists/${id}`).then(({ data }) => setArtist(data.artist)).catch(console.error);
    }
  }, [id]);

  if (!artist) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-spotify-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="gradient-bg px-6 pt-8 pb-6 flex items-end gap-6">
        <div className="w-48 h-48 rounded-full shadow-2xl bg-spotify-lightgray shrink-0 overflow-hidden">
          {artist.imageUrl ? (
            <img src={artist.imageUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-6xl">🎤</div>
          )}
        </div>
        <div>
          <p className="text-sm font-medium uppercase">{t('artists')}</p>
          <h1 className="text-5xl font-bold">{artist.name}</h1>
        </div>
      </div>

      <div className="px-2 mt-4">
        <h2 className="text-xl font-bold px-4 mb-2">{t('tracks')}</h2>
        {artist.tracks.map((track, i) => (
          <TrackRow key={track.id} track={track} index={i} />
        ))}
      </div>
    </div>
  );
}
