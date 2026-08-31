import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Search as SearchIcon, Download, Play, AlertCircle } from 'lucide-react';
import api from '../api/client';
import TrackRow from '../components/tracks/TrackRow';
import { Track } from '../types';
import { usePlayerStore } from '../store';

interface YouTubeResult {
  id: string; title: string; artist: string; duration: number;
  thumbnailUrl: string; url: string; source: 'youtube';
}

interface SpotifyResult {
  id: string; name: string; artist: string; album?: string;
  duration: number; thumbnailUrl: string; spotifyUrl: string; source: 'spotify';
}

interface SpotifyUrlTrack {
  name: string; artist: string; album?: string; duration?: number; source: 'spotify';
}

interface SearchResults {
  tracks: Track[];
  youtube: YouTubeResult[];
  spotify: SpotifyResult[];
  spotifyUrlTracks: SpotifyUrlTrack[];
  detectedUrl?: { type: 'spotify' | 'youtube'; url: string };
  artists: { id: string; name: string; imageUrl?: string }[];
  albums: { id: string; title: string; coverUrl?: string; artist: { name: string } }[];
  playlists: { id: string; name: string; coverUrl?: string }[];
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function SearchPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const playTrack = usePlayerStore((s) => s.playTrack);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults(null); setError(''); return; }
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/tracks/search', { params: { q } });
      setResults(data);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const handlePlay = async (opts: {
    id: string; title: string; artist: string; url?: string;
  }) => {
    setDownloadingId(opts.id);
    setError('');
    try {
      const { data } = await api.post('/tracks/download', {
        query: `${opts.artist} - ${opts.title}`,
        url: opts.url,
        title: opts.title,
        artist: opts.artist,
      });
      playTrack(data.track);
      search(query);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('error');
      setError(msg);
    } finally {
      setDownloadingId(null);
    }
  };

  const renderExternalRow = (
    id: string,
    title: string,
    artist: string,
    thumbnailUrl: string,
    duration: number,
    url?: string,
    badge?: string
  ) => (
    <div key={id} className="flex items-center gap-4 p-3 rounded-md card-hover group">
      <div className="w-12 h-12 rounded overflow-hidden bg-spotify-lightgray shrink-0">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-spotify-text">♪</div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{title}</p>
        <p className="text-sm text-spotify-text truncate">{artist}</p>
        {badge && <span className="text-xs text-spotify-green">{badge}</span>}
      </div>
      <span className="text-xs text-spotify-text">{formatTime(duration)}</span>
      <button
        onClick={() => handlePlay({ id, title, artist, url })}
        disabled={downloadingId === id}
        className="green-btn py-2 px-4 text-sm flex items-center gap-2"
      >
        {downloadingId === id ? (
          <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
        ) : (
          <Play className="w-4 h-4 fill-black" />
        )}
        {downloadingId === id ? t('downloading') : t('play')}
      </button>
    </div>
  );

  return (
    <div className="p-6">
      <div className="relative mb-4">
        <SearchIcon className="absolute start-4 top-1/2 -translate-y-1/2 w-5 h-5 text-spotify-text" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); search(e.target.value); }}
          placeholder={t('searchPlaceholder')}
          className="w-full bg-white rounded-full py-3.5 ps-12 pe-4 text-black text-base focus:outline-none focus:ring-2 focus:ring-white"
          autoFocus
          dir="auto"
        />
      </div>

      <p className="text-xs text-spotify-text mb-6">{t('searchHint')}</p>

      {error && (
        <div className="flex items-center gap-2 bg-red-900/40 border border-red-500/50 rounded-lg p-3 mb-4 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
          {error}
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-spotify-green border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && results && (
        <>
          {results.detectedUrl?.type === 'youtube' && (
            <section className="mb-8">
              <h2 className="text-xl font-bold mb-4">YouTube</h2>
              <button
                onClick={() => handlePlay({
                  id: 'yt-url', title: query, artist: '', url: results.detectedUrl!.url,
                })}
                className="green-btn flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                {t('download')} & {t('play')}
              </button>
            </section>
          )}

          {results.spotifyUrlTracks.length > 0 && (
            <section className="mb-8">
              <h2 className="text-xl font-bold mb-4">Spotify</h2>
              {results.spotifyUrlTracks.map((item, i) =>
                renderExternalRow(
                  `sp-url-${i}`, item.name, item.artist, '', item.duration || 0,
                  undefined, 'Spotify'
                )
              )}
            </section>
          )}

          {results.tracks.length > 0 && (
            <section className="mb-8">
              <h2 className="text-xl font-bold mb-4">{t('library')}</h2>
              {results.tracks.map((track, i) => (
                <TrackRow key={track.id} track={track} index={i} />
              ))}
            </section>
          )}

          {results.spotify.length > 0 && (
            <section className="mb-8">
              <h2 className="text-xl font-bold mb-4">Spotify</h2>
              {results.spotify.map((item) =>
                renderExternalRow(
                  item.id, item.name, item.artist, item.thumbnailUrl, item.duration,
                  undefined, item.album
                )
              )}
            </section>
          )}

          {results.youtube.length > 0 && (
            <section className="mb-8">
              <h2 className="text-xl font-bold mb-4">YouTube</h2>
              {results.youtube.map((item) =>
                renderExternalRow(
                  item.id, item.title, item.artist, item.thumbnailUrl, item.duration, item.url
                )
              )}
            </section>
          )}

          {results.tracks.length === 0 &&
            results.youtube.length === 0 &&
            results.spotify.length === 0 &&
            results.spotifyUrlTracks.length === 0 && (
            <p className="text-spotify-text text-center py-12">{t('noResults')}</p>
          )}
        </>
      )}
    </div>
  );
}
