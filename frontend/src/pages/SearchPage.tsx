import { useState, useCallback, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search as SearchIcon, Play, AlertCircle, HardDrive, Import, Clock } from 'lucide-react';
import api from '../api/client';
import TrackRow from '../components/tracks/TrackRow';
import TrackSurface from '../components/tracks/TrackSurface';
import PlaybackMeta from '../components/player/PlaybackMeta';
import { externalTrack } from '../lib/trackUtils';
import {
  addRecentQuery,
  addRecentSearchTrack,
  loadRecentQueries,
  loadRecentSearchTracks,
  recentTrackToTrack,
  RecentSearchTrack,
} from '../lib/searchHistory';
import { Track } from '../types';
import { usePlayerStore } from '../store';
import PlaylistCover from '../components/playlists/PlaylistCover';
import clsx from 'clsx';

interface YouTubeResult {
  id: string; title: string; artist: string; duration: number;
  thumbnailUrl: string; url: string; source: 'youtube';
}

interface SpotifyResult {
  id: string; name: string; artist: string; album?: string;
  duration: number; thumbnailUrl: string; spotifyUrl: string; source: 'spotify';
}

interface SpotifyUrlTrack {
  name: string; artist: string; album?: string; duration?: number;
  spotifyUrl?: string; thumbnailUrl?: string; source: 'spotify';
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
  playlists: { id: string; name: string; coverUrl?: string | null; coverImages?: string[]; trackCount?: number }[];
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
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const playTrack = usePlayerStore((s) => s.playTrack);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  const [recentTracks, setRecentTracks] = useState<RecentSearchTrack[]>([]);

  const refreshRecent = useCallback(() => {
    setRecentQueries(loadRecentQueries());
    setRecentTracks(loadRecentSearchTracks());
  }, []);

  useEffect(() => {
    refreshRecent();
  }, [refreshRecent]);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults(null); setError(''); return; }
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/tracks/search', { params: { q } });
      setResults(data);
      addRecentQuery(q);
      refreshRecent();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('error'));
    } finally {
      setLoading(false);
    }
  }, [t, refreshRecent]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setResults(null);
      setError('');
      refreshRecent();
      return;
    }
    debounceRef.current = setTimeout(() => search(value), 350);
  };

  const playExternal = async (opts: {
    id: string;
    title: string;
    artist: string;
    duration: number;
    thumbnailUrl?: string;
    album?: string;
    youtubeUrl?: string;
    spotifyUrl?: string;
  }) => {
    setError('');
    const track = externalTrack(
      opts.id,
      opts.title,
      opts.artist,
      opts.duration,
      opts.thumbnailUrl,
      opts.album,
      { youtubeUrl: opts.youtubeUrl, spotifyUrl: opts.spotifyUrl }
    );
    try {
      await playTrack(track);
      addRecentSearchTrack(track);
      refreshRecent();
      if (query.trim()) search(query);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('error'));
    }
  };

  const importSpotifyPlaylist = async (url: string) => {
    setImporting(true);
    setError('');
    try {
      await api.post('/playlists/import', { url });
      setQuery('');
      setResults(null);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('error'));
    } finally {
      setImporting(false);
    }
  };

  const localTracks = results?.library || results?.tracks || [];

  const renderExternalRow = (
    id: string,
    title: string,
    artist: string,
    thumbnailUrl: string,
    duration: number,
    opts?: { youtubeUrl?: string; spotifyUrl?: string; badge?: string; album?: string }
  ) => {
    const externalId = `external-${id}`;
    const isCurrent = currentTrack?.id === externalId;
    const track = externalTrack(id, title, artist, duration, thumbnailUrl, opts?.album, {
      youtubeUrl: opts?.youtubeUrl,
      spotifyUrl: opts?.spotifyUrl,
    });

    const play = () => {
      void playExternal({
        id,
        title,
        artist,
        duration,
        thumbnailUrl,
        album: opts?.album,
        youtubeUrl: opts?.youtubeUrl,
        spotifyUrl: opts?.spotifyUrl,
      });
    };

    return (
      <TrackSurface
        key={id}
        track={track}
        onClick={play}
        onSwipeRight={() => addToQueue(track.id, false, track)}
        options={{
          external: { url: opts?.youtubeUrl, spotifyUrl: opts?.spotifyUrl, album: opts?.album },
          onRefresh: () => search(query),
        }}
        className="flex items-center gap-3 md:gap-4 p-2 md:p-3 rounded-md card-hover group cursor-pointer"
      >
        <div className="relative w-11 h-11 md:w-12 md:h-12 rounded overflow-hidden bg-spotify-lightgray shrink-0">
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-spotify-text">♪</div>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
            <Play className="w-4 h-4 fill-white text-white play-icon-nudge" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p className={clsx('text-base font-normal truncate', isCurrent && 'text-spotify-green')}>{title}</p>
          <p className="text-body truncate">{artist}</p>
          {isCurrent && <PlaybackMeta track={track} className="mt-0.5" />}
          {opts?.badge && !isCurrent && <span className="text-caption">{opts.badge}</span>}
        </div>
        <span className="text-caption hidden sm:inline tabular-nums">{formatTime(duration)}</span>
      </TrackSurface>
    );
  };

  const hasLocal = localTracks.length > 0 ||
    (results?.artists.length ?? 0) > 0 ||
    (results?.albums.length ?? 0) > 0 ||
    (results?.playlists.length ?? 0) > 0;

  const hasExternal = (results?.youtube.length ?? 0) > 0 ||
    (results?.spotify.length ?? 0) > 0 ||
    (results?.spotifyUrlTracks.length ?? 0) > 0 ||
    !!results?.detectedUrl;

  const isSpotifyPlaylistUrl = results?.detectedUrl?.type === 'spotify'
    && /\/playlist\//i.test(results.detectedUrl.url);

  return (
    <div className="p-4 md:p-8 pb-4 max-w-full overflow-x-hidden">
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
        <div className="flex items-start gap-2 bg-red-900/40 border border-red-500/50 rounded-lg p-3 mb-4 text-sm max-w-full overflow-hidden">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
          <p className="min-w-0 break-words">{error}</p>
        </div>
      )}

      {results?.spotifyError && (
        <div className="flex items-start gap-2 bg-amber-900/30 border border-amber-500/40 rounded-lg p-3 mb-4 text-sm max-w-full overflow-hidden">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
          <div className="min-w-0 break-words">
            <p>{results.spotifyError}</p>
            <p className="text-xs text-spotify-text mt-1 break-words">{t('spotifySetupHint')}</p>
          </div>
        </div>
      )}

      {!results?.spotifyError && results?.spotifyConfigured === false && query.trim() && !loading && (
        <div className="flex items-start gap-2 bg-spotify-lightgray rounded-lg p-3 mb-4 text-sm text-spotify-text max-w-full overflow-hidden">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="min-w-0 break-words">{t('spotifyNotConfigured')}</p>
        </div>
      )}

      {loading && query.trim() && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-spotify-green border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && !query.trim() && (recentQueries.length > 0 || recentTracks.length > 0) && (
        <section className="mb-10">
          <h2 className="text-heading-sm mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-spotify-green" />
            {t('recentSearches')}
          </h2>
          {recentQueries.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-6">
              {recentQueries.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => handleQueryChange(q)}
                  className="px-3 py-1.5 rounded-full bg-spotify-lightgray text-sm hover:bg-white/10 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
          {recentTracks.length > 0 && (
            <div>
              <h3 className="text-label mb-2">{t('tracks')}</h3>
              {recentTracks.map((item) => {
                const track = recentTrackToTrack(item);
                const isCurrent = currentTrack?.id === track.id;
                return (
                  <TrackSurface
                    key={`${item.id}-${item.searchedAt}`}
                    track={track}
                    onClick={() => { void playTrack(track); addRecentSearchTrack(track); refreshRecent(); }}
                    onSwipeRight={() => addToQueue(track.id, false, track)}
                    className="flex items-center gap-3 p-2 rounded-md card-hover cursor-pointer"
                  >
                    <div className="w-11 h-11 rounded overflow-hidden bg-spotify-lightgray shrink-0">
                      {item.thumbnailUrl ? (
                        <img src={item.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-spotify-text">♪</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 text-start">
                      <p className={clsx('truncate', isCurrent && 'text-spotify-green')}>{item.title}</p>
                      <p className="text-body truncate">{item.artist}</p>
                      {isCurrent && <PlaybackMeta track={track} className="mt-0.5" />}
                    </div>
                    <span className="text-caption tabular-nums">{formatTime(item.duration)}</span>
                  </TrackSurface>
                );
              })}
            </div>
          )}
        </section>
      )}

      {!loading && results && query.trim() && (
        <>
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
                    <TrackRow key={track.id} track={track} index={i} onDeleted={() => search(query)} />
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
                          <PlaylistCover
                            coverUrl={pl.coverUrl}
                            coverImages={pl.coverImages}
                            className="w-full h-full"
                            fallback={<span className="text-3xl">♪</span>}
                          />
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

          {isSpotifyPlaylistUrl && (
            <section className="mb-8">
              <button
                type="button"
                onClick={() => void importSpotifyPlaylist(results.detectedUrl!.url)}
                disabled={importing}
                className="green-btn flex items-center gap-2 disabled:opacity-50"
              >
                <Import className="w-4 h-4" />
                {importing ? t('importing') : t('importPlaylist')}
              </button>
            </section>
          )}

          {(results.spotifyUrlTracks?.length ?? 0) > 0 && (
            <section className="mb-8">
              <h2 className="text-heading-sm mb-4">{t('spotifyResults')}</h2>
              {results.spotifyUrlTracks.map((item, i) =>
                renderExternalRow(
                  `sp-url-${i}`,
                  item.name,
                  item.artist,
                  item.thumbnailUrl || '',
                  item.duration || 0,
                  { spotifyUrl: item.spotifyUrl, badge: 'Spotify', album: item.album }
                )
              )}
            </section>
          )}

          {results.detectedUrl?.type === 'youtube' && (
            <section className="mb-8">
              <h2 className="text-heading-sm mb-4">{t('youtubeResults')}</h2>
              <button
                type="button"
                onClick={() => void playExternal({
                  id: 'yt-url',
                  title: query,
                  artist: '',
                  duration: 0,
                  youtubeUrl: results.detectedUrl!.url,
                })}
                className="green-btn flex items-center gap-2"
              >
                <Play className="w-4 h-4 fill-black" />
                {t('play')}
              </button>
            </section>
          )}

          {(results.spotify?.length ?? 0) > 0 && (
            <section className="mb-8">
              <h2 className="text-heading-sm mb-4">{t('spotifyResults')}</h2>
              {results.spotify.map((item) =>
                renderExternalRow(
                  item.id,
                  item.name,
                  item.artist,
                  item.thumbnailUrl,
                  item.duration,
                  { spotifyUrl: item.spotifyUrl, album: item.album }
                )
              )}
            </section>
          )}

          {(results.youtube?.length ?? 0) > 0 && (
            <section className="mb-8">
              <h2 className="text-heading-sm mb-4">{t('youtubeResults')}</h2>
              {results.youtube.map((item) =>
                renderExternalRow(
                  item.id,
                  item.title,
                  item.artist,
                  item.thumbnailUrl,
                  item.duration,
                  { youtubeUrl: item.url }
                )
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
