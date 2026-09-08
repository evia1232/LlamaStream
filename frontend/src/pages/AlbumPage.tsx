import { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import api from '../api/client';
import TrackRow from '../components/tracks/TrackRow';
import { Track } from '../types';
import { normalizeTrack } from '../lib/trackUtils';
import { usePlayerStore } from '../store';

interface AlbumPageData {
  album: {
    id: string;
    title: string;
    coverUrl: string | null;
    releaseYear: number | null;
    spotifyAlbumId?: string | null;
    artist: {
      id: string;
      name: string;
      imageUrl: string | null;
      spotifyArtistId?: string | null;
    };
    trackCount: number;
  };
  tracks: Track[];
}

export default function AlbumPage() {
  const { id, spotifyAlbumId } = useParams<{ id?: string; spotifyAlbumId?: string }>();
  const { t } = useTranslation();
  const [data, setData] = useState<AlbumPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const playTracks = usePlayerStore((s) => s.playTracks);

  const load = useCallback(async () => {
    const path = spotifyAlbumId
      ? `/albums/spotify/${encodeURIComponent(spotifyAlbumId)}`
      : id
        ? `/albums/${encodeURIComponent(id)}`
        : null;
    if (!path) {
      setLoading(false);
      setError(t('albumLoadError'));
      return;
    }

    setLoading(true);
    setError('');
    try {
      const { data: page } = await api.get(path);
      setData({
        album: page.album,
        tracks: (page.tracks || []).map((tr: Track) => normalizeTrack(tr)),
      });
      void import('../lib/offlineStore').then(({ saveOfflineSnapshot }) => {
        void saveOfflineSnapshot(`album:${page.album.id}`, page);
      });
    } catch (err: unknown) {
      const cachedKey = id ? `album:${id}` : spotifyAlbumId ? `album:spotify:${spotifyAlbumId}` : null;
      if (cachedKey) {
        const { loadOfflineSnapshot } = await import('../lib/offlineStore');
        const cached = await loadOfflineSnapshot<AlbumPageData>(cachedKey);
        if (cached) {
          setData({
            album: cached.album,
            tracks: (cached.tracks || []).map((tr) => normalizeTrack(tr)),
          });
          setLoading(false);
          return;
        }
      }
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error
          || t('albumLoadError'),
      );
    } finally {
      setLoading(false);
    }
  }, [id, spotifyAlbumId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-10 h-10 border-2 border-spotify-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 px-4">
        <p className="text-spotify-text text-center">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="px-6 py-2 rounded-full text-sm bg-spotify-green text-black font-bold hover:bg-spotify-green-hover"
        >
          {t('retry')}
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { album, tracks } = data;
  const artistPath = album.artist.spotifyArtistId
    ? `/artist/${album.artist.id}?spotifyArtistId=${encodeURIComponent(album.artist.spotifyArtistId)}`
    : `/artist/${album.artist.id}`;

  return (
    <div>
      <div className="gradient-bg px-4 md:px-8 pt-8 md:pt-12 pb-8 flex flex-col sm:flex-row items-start sm:items-end gap-6">
        <div className="w-36 h-36 md:w-48 md:h-48 rounded-spotify shadow-card bg-spotify-lightgray shrink-0 overflow-hidden">
          {album.coverUrl ? (
            <img src={album.coverUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-6xl text-spotify-text">♪</div>
          )}
        </div>
        <div className="min-w-0 pb-2 flex-1 text-start">
          <p className="text-label mb-2">{t('albums')}</p>
          <h1 className="text-hero mb-2">{album.title}</h1>
          <p className="text-body">
            <Link to={artistPath} className="hover:underline font-semibold">
              {album.artist.name}
            </Link>
            {album.releaseYear ? ` · ${album.releaseYear}` : ''}
            {` · ${t('trackCount', { count: album.trackCount || tracks.length })}`}
          </p>
          {tracks.length > 0 && (
            <button
              type="button"
              onClick={() => void playTracks(tracks, 0)}
              className="mt-4 w-12 h-12 bg-spotify-green rounded-full flex items-center justify-center hover:scale-105 transition-transform"
              aria-label={t('playAll')}
            >
              <Play className="w-6 h-6 fill-black text-black play-icon-nudge" />
            </button>
          )}
        </div>
      </div>

      <div className="px-2 md:px-4 py-6">
        {tracks.length === 0 ? (
          <p className="text-spotify-text text-center py-12">{t('albumNoTracks')}</p>
        ) : (
          tracks.map((track, i) => (
            <TrackRow key={track.id} track={track} index={i} contextTracks={tracks} onDeleted={load} />
          ))
        )}
      </div>
    </div>
  );
}
