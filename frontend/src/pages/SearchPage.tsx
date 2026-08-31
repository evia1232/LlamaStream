import { useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search as SearchIcon, Download, Play, AlertCircle, HardDrive } from 'lucide-react';
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
  library: Track[];
  tracks: Track[];
  youtube: YouTubeResult[];
  spotify: SpotifyResult[];
  spotifyUrlTracks: SpotifyUrlTrack[];
  spotifyError?: string;
  spotifyConfigured?: boolean;
  detectedUrl?: { type: 'spotify' | 'youtube'; url: string };
  artists: { id: string; name: string; imageUrl?: string | null }[];
  albums: { id: string; title: string; coverUrl?: string | null; artist: { id: string; name: string } }[];
  playlists: { id: string; name: string; coverUrl?: string | null; trackCount?: number }[];
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
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

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

  const handleQueryChange = (value: string) => {
    setQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 350);
  };

  const handlePlay = async (opts: {
    id: string; title: string; artist: string; url?: string; duration?: number; album?: string;
  }) => {
    setDownloadingId(opts.id);
    setError('');
    try {
      const { data } = await api.post('/tracks/download', {
        query: `${opts.artist} - ${opts.title}`,
        url: opts.url,
        title: opts.title,
        artist: opts.artist,
        duration: opts.duration,
        album: opts.album,
      });
      playTrack(data.track);
      search(query);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('error'));
    } finally {
      setDownloadingId(null);
    }
  };

  const localTracks = results?.library || results?.tracks || [];

  const renderExternalRow = (
    id: string, title: string, artist: string, thumbnailUrl: string,
    duration: number, url?: string, badge?: string, album?: string
  ) => (
    <div key={id} className="flex items-center gap-3 md:gap-4 p-2 md:p-3 rounded-md card-hover group">
      <div className="w-11 h-11 md:w-12 md:h-12 rounded overflow-hidden bg-spotify-lightgray shrink-0">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-spotify-text">♪</div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-base font-normal truncate">{title}</p>
        <p className="text-body truncate">{artist}</p>
        {badge && <span className="text-caption">{badge}</span>}
      </div>
      <span className="text-caption hidden sm:inline tabular-nums">{formatTime(duration)}</span>
      <button
        onClick={() => handlePlay({ id, title, artist, url, duration, album })}
        disabled={downloadingId === id}
        className="green-btn py-2 px-3 md:px-4 text-xs md:text-sm flex items-center gap-1.5 shrink-0"
      >
        {downloadingId === id ? (
          <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
        ) : (
          <Play className="w-4 h-4 fill-black" />
        )}
        <span className="hidden sm:inline">{downloadingId === id ? t('downloading') : t('play')}</span>
      </button>
    </div>
  );

  const hasLocal = localTracks.length > 0 ||
    (results?.artists.length ?? 0) > 0 ||
    (results?.albums.length ?? 0) > 0 ||
    (results?.playlists.length ?? 0) > 0;

  const hasExternal = (results?.youtube.length ?? 0) > 0 ||
    (results?.spotify.length ?? 0) > 0 ||
    (results?.spotifyUrlTracks.length ?? 0) > 0 ||
    !!results?.detectedUrl;

  return (
    <div className="p-4 md:p-8 pb-4">
      <h1 className="text-heading mb-6 md:mb-8">{t('search')}</h1>
      <div className="relative mb-3">
        <SearchIcon className="absolute start-4 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-500" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="search-input"
          autoFocus
          dir="auto"
        />
      </div>

      <p className="text-caption mb-6 md:mb-8">{t('searchHint')}</p>

      {error && (
        <div className="flex items-center gap-2 bg-red-900/40 border border-red-500/50 rounded-lg p-3 mb-4 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
          {error}
        </div>
      )}

      {results?.spotifyError && (
        <div className="flex items-start gap-2 bg-amber-900/30 border border-amber-500/40 rounded-lg p-3 mb-4 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
          <div>
            <p>{results.spotifyError}</p>
            <p className="text-xs text-spotify-text mt-1">{t('spotifySetupHint')}</p>
          </div>
        </div>
      )}

      {!results?.spotifyError && results?.spotifyConfigured === false && query.trim() && !loading && (
        <div className="flex items-start gap-2 bg-spotify-lightgray rounded-lg p-3 mb-4 text-sm text-spotify-text">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <p>{t('spotifyNotConfigured')}</p>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-spotify-green border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && results && (
        <>
          {/* ── LOCAL RESULTS (always shown first) ── */}
          {hasLocal && (
            <section className="mb-10">
              <h2 className="text-heading-sm mb-4 flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-spotify-green" />
                {t('localLibrary')}
              </h2>

              {localTracks.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-label mb-2">{t('tracks')}</h3>
                  {localTracks.map((track, i) => (
                    <TrackRow key={track.id} track={track} index={i} />
                  ))}
                </div>
              )}

              {(results.artists?.length ?? 0) > 0 && (
                <div className="mb-6">
                  <h3 className="text-label mb-3">{t('artists')}</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 md:gap-4">
                    {results.artists.map((artist) => (
                      <Link key={artist.id} to={`/artist/${artist.id}`} className="text-center card-hover p-3 rounded-lg">
                        <div className="w-full aspect-square rounded-full bg-spotify-lightgray mb-2 overflow-hidden">
                          {artist.imageUrl ? (
                            <img src={artist.imageUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-2xl">🎤</div>
                          )}
                        </div>
                        <p className="text-title truncate text-sm">{artist.name}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {(results.playlists?.length ?? 0) > 0 && (
                <div className="mb-6">
                  <h3 className="text-label mb-3">{t('playlists')}</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {results.playlists.map((pl) => (
                      <Link key={pl.id} to={`/playlist/${pl.id}`} className="bg-spotify-lightgray p-3 rounded-lg card-hover">
                        <div className="aspect-square rounded-md bg-spotify-gray mb-2 overflow-hidden">
                          {pl.coverUrl ? (
                            <img src={pl.coverUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-3xl">♪</div>
                          )}
                        </div>
                        <p className="text-title truncate text-sm">{pl.name}</p>
                        {pl.trackCount !== undefined && (
                          <p className="text-xs text-spotify-text">{t('trackCount', { count: pl.trackCount })}</p>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ── SPOTIFY URL tracks ── */}
          {(results.spotifyUrlTracks?.length ?? 0) > 0 && (
            <section className="mb-8">
              <h2 className="text-heading-sm mb-4">{t('spotifyResults')}</h2>
              {results.spotifyUrlTracks.map((item, i) =>
                renderExternalRow(`sp-url-${i}`, item.name, item.artist, '', item.duration || 0, undefined, 'Spotify', item.album)
              )}
            </section>
          )}

          {/* ── YouTube URL ── */}
          {results.detectedUrl?.type === 'youtube' && (
            <section className="mb-8">
              <h2 className="text-heading-sm mb-4">{t('youtubeResults')}</h2>
              <button
                onClick={() => handlePlay({ id: 'yt-url', title: query, artist: '', url: results.detectedUrl!.url })}
                className="green-btn flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                {t('download')} & {t('play')}
              </button>
            </section>
          )}

          {/* ── SPOTIFY text search ── */}
          {(results.spotify?.length ?? 0) > 0 && (
            <section className="mb-8">
              <h2 className="text-heading-sm mb-4">{t('spotifyResults')}</h2>
              {results.spotify.map((item) =>
                renderExternalRow(item.id, item.name, item.artist, item.thumbnailUrl, item.duration, undefined, item.album, item.album)
              )}
            </section>
          )}

          {/* ── YOUTUBE text search ── */}
          {(results.youtube?.length ?? 0) > 0 && (
            <section className="mb-8">
              <h2 className="text-heading-sm mb-4">{t('youtubeResults')}</h2>
              {results.youtube.map((item) =>
                renderExternalRow(item.id, item.title, item.artist, item.thumbnailUrl, item.duration, item.url)
              )}
            </section>
          )}

          {!hasLocal && !hasExternal && (
            <p className="text-spotify-text text-center py-12">{t('noResults')}</p>
          )}
        </>
      )}
    </div>
  );
}
