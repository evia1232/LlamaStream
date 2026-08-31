import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Play, ExternalLink } from 'lucide-react';
import api from '../api/client';
import TrackRow from '../components/tracks/TrackRow';
import { Track } from '../types';
import { normalizeTrack, externalTrack } from '../lib/trackUtils';
import { usePlayerStore } from '../store';

interface SpotifyArtistInfo {
  id: string;
  name: string;
  imageUrl: string;
  followers: number;
  genres: string[];
  spotifyUrl: string;
}

interface SpotifyAlbumInfo {
  id: string;
  name: string;
  imageUrl: string;
  releaseYear: number | null;
  totalTracks: number;
  spotifyUrl: string;
  albumType: string;
}

interface SpotifyTrackInfo {
  id: string;
  name: string;
  artist: string;
  primaryArtistId?: string;
  album?: string;
  duration: number;
  thumbnailUrl: string;
  spotifyUrl: string;
}

interface ArtistPageData {
  artist: {
    id: string | null;
    name: string;
    imageUrl: string | null;
    bio: string | null;
    spotifyArtistId: string | null;
  };
  localTracks: Track[];
  localAlbums: {
    id: string;
    title: string;
    coverUrl: string | null;
    releaseYear: number | null;
    trackCount: number;
    artist: { id: string; name: string };
  }[];
  listenedTracks: Track[];
  spotify: {
    configured: boolean;
    artist: SpotifyArtistInfo | null;
    topTracks: SpotifyTrackInfo[];
    albums: SpotifyAlbumInfo[];
    error?: string;
  };
}

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function artistApiPath(
  searchName: string | null,
  id: string | undefined,
  hints: { spotifyArtistId?: string; spotifyTrackId?: string },
): string | null {
  const params = new URLSearchParams();
  if (hints.spotifyArtistId) params.set('spotifyArtistId', hints.spotifyArtistId);
  if (hints.spotifyTrackId) params.set('spotifyTrackId', hints.spotifyTrackId);
  const qs = params.toString() ? `?${params.toString()}` : '';

  if (searchName) return `/home/artists/by-name/${encodeURIComponent(searchName)}${qs}`;
  if (id) return `/home/artists/${id}${qs}`;
  return null;
}

export default function ArtistPage() {
  const { id, name: nameParam } = useParams<{ id?: string; name?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const spotifyArtistId = searchParams.get('spotifyArtistId') ?? undefined;
  const spotifyTrackId = searchParams.get('spotifyTrackId') ?? undefined;
  const { t } = useTranslation();
  const [data, setData] = useState<ArtistPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const playTracks = usePlayerStore((s) => s.playTracks);

  const searchName = useMemo(() => {
    if (nameParam) return decodeURIComponent(nameParam);
    return null;
  }, [nameParam]);

  const load = useCallback(async () => {
    const path = artistApiPath(searchName, id, { spotifyArtistId, spotifyTrackId });
    if (!path) return;

    setLoading(true);
    setError('');
    setData(null);

    try {
      const { data: page } = await api.get<ArtistPageData>(path);
      setData(page);

      // Persist resolved Spotify artist id in URL for reliable reloads / sharing
      const resolvedId = page.artist.spotifyArtistId || page.spotify.artist?.id;
      if (resolvedId && resolvedId !== spotifyArtistId && searchName) {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set('spotifyArtistId', resolvedId);
          return next;
        }, { replace: true });
      }
    } catch {
      setError(t('artistLoadError'));
    } finally {
      setLoading(false);
    }
  }, [searchName, id, spotifyArtistId, spotifyTrackId, setSearchParams, t]);

  useEffect(() => { void load(); }, [load]);

  const spotify = data?.spotify ?? null;
  const local = data;

  const displayName = spotify?.artist?.name || local?.artist.name || searchName || '';
  const imageUrl = spotify?.artist?.imageUrl || local?.artist.imageUrl || null;

  const normalizedLocal = (local?.localTracks ?? []).map((t) => normalizeTrack(t));
  const normalizedListened = (local?.listenedTracks ?? []).map((t) => normalizeTrack(t));

  const listenedIds = new Set(normalizedListened.map((t) => t.id));
  const localOnly = normalizedLocal.filter((t) => !listenedIds.has(t.id));

  const spotifyAsTracks = (spotify?.topTracks ?? []).map((t) =>
    externalTrack(t.id, t.name, t.artist, t.duration, t.thumbnailUrl, t.album, {
      spotifyUrl: t.spotifyUrl,
      spotifyArtistId: t.primaryArtistId || spotify?.artist?.id,
    }),
  );

  const hasContent = spotifyAsTracks.length > 0
    || normalizedListened.length > 0
    || localOnly.length > 0
    || (local?.localAlbums.length ?? 0) > 0
    || (spotify?.albums.length ?? 0) > 0
    || !!spotify?.artist;

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <div className="w-8 h-8 border-2 border-spotify-green border-t-transparent rounded-full animate-spin" />
        <p className="text-caption">{t('loadingArtist')}</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
        <p className="text-spotify-text">{error}</p>
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

  const handlePlayAll = (tracks: Track[]) => {
    if (tracks.length > 0) void playTracks(tracks, 0);
  };

  return (
    <div>
      <div className="gradient-bg px-4 md:px-8 pt-8 md:pt-12 pb-8 flex flex-col sm:flex-row items-end gap-6">
        <div className="w-36 h-36 md:w-48 md:h-48 rounded-full shadow-card bg-spotify-lightgray shrink-0 overflow-hidden">
          {imageUrl ? (
            <img src={imageUrl} alt="" className="w-full h-full object-cover" />
          ) : loading ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-10 h-10 border-2 border-spotify-green border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-6xl">🎤</div>
          )}
        </div>
        <div className="min-w-0 pb-2 flex-1">
          <p className="text-label mb-2">{t('artists')}</p>
          <h1 className="text-hero mb-2">{displayName || '—'}</h1>
          {loading && !spotify?.artist && (
            <p className="text-caption text-spotify-text">{t('loadingSpotifyArtist')}</p>
          )}
          {!loading && spotify?.configured === false && (
            <p className="text-caption text-spotify-text">{t('spotifyNotConfigured')}</p>
          )}
          {!loading && spotify?.configured && !spotify.artist && (
            <p className="text-caption text-spotify-text">{t('artistSpotifyNotFound')}</p>
          )}
          {spotify?.artist && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption">
              <span>{formatFollowers(spotify.artist.followers)} {t('followersLabel')}</span>
              {spotify.artist.genres.slice(0, 3).map((g) => (
                <span key={g} className="capitalize">{g}</span>
              ))}
              <a
                href={spotify.artist.spotifyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-spotify-green hover:underline"
              >
                Spotify <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
          {local?.artist.bio && <p className="text-body mt-3 max-w-2xl">{local.artist.bio}</p>}
        </div>
      </div>

      <div className="px-2 md:px-4 py-6 space-y-10">
        {spotifyAsTracks.length > 0 && (
          <section>
            <div className="flex items-center gap-4 mb-3 px-2">
              <h2 className="text-heading-sm">{t('topTracks')}</h2>
              <button
                type="button"
                onClick={() => handlePlayAll(spotifyAsTracks)}
                className="w-10 h-10 bg-spotify-green rounded-full flex items-center justify-center hover:scale-105 transition-transform"
                aria-label={t('playAll')}
              >
                <Play className="w-5 h-5 fill-black text-black play-icon-nudge" />
              </button>
            </div>
            {spotifyAsTracks.map((track, i) => (
              <TrackRow key={track.id} track={track} index={i} contextTracks={spotifyAsTracks} />
            ))}
          </section>
        )}

        {loading && spotifyAsTracks.length === 0 && (
          <section className="px-4">
            <h2 className="text-heading-sm mb-3">{t('topTracks')}</h2>
            <div className="flex items-center gap-2 text-caption text-spotify-text">
              <div className="w-4 h-4 border-2 border-spotify-green border-t-transparent rounded-full animate-spin" />
              {t('loadingSpotifyArtist')}
            </div>
          </section>
        )}

        {(spotify?.albums.length ?? 0) > 0 && (
          <section className="px-4">
            <h2 className="text-heading-sm mb-4">{t('spotifyAlbums')}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {spotify!.albums.map((album) => (
                <a
                  key={album.id}
                  href={album.spotifyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="surface-card group"
                >
                  <div className="aspect-square rounded-spotify overflow-hidden bg-spotify-gray mb-3 shadow-card">
                    {album.imageUrl ? (
                      <img src={album.imageUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-3xl text-spotify-text">♪</div>
                    )}
                  </div>
                  <p className="text-title truncate">{album.name}</p>
                  <p className="text-caption capitalize">
                    {album.albumType}
                    {album.releaseYear ? ` · ${album.releaseYear}` : ''}
                  </p>
                </a>
              ))}
            </div>
          </section>
        )}

        {normalizedListened.length > 0 && (
          <section>
            <h2 className="text-heading-sm mb-3 px-4">{t('listenedTracks')}</h2>
            {normalizedListened.map((track, i) => (
              <TrackRow key={track.id} track={track} index={i} contextTracks={normalizedListened} />
            ))}
          </section>
        )}

        {localOnly.length > 0 && (
          <section>
            <div className="flex items-center gap-4 mb-3 px-2">
              <h2 className="text-heading-sm">{t('localLibrary')}</h2>
              <button
                type="button"
                onClick={() => handlePlayAll(localOnly)}
                className="w-10 h-10 bg-spotify-green rounded-full flex items-center justify-center hover:scale-105 transition-transform"
                aria-label={t('playAll')}
              >
                <Play className="w-5 h-5 fill-black text-black play-icon-nudge" />
              </button>
            </div>
            {localOnly.map((track, i) => (
              <TrackRow key={track.id} track={track} index={i} onDeleted={load} contextTracks={localOnly} />
            ))}
          </section>
        )}

        {local && local.localAlbums.length > 0 && (
          <section className="px-4">
            <h2 className="text-heading-sm mb-4">{t('localAlbums')}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {local.localAlbums.map((album) => (
                <div key={album.id} className="surface-card">
                  <div className="aspect-square rounded-spotify overflow-hidden bg-spotify-gray mb-3 shadow-card">
                    {album.coverUrl ? (
                      <img src={album.coverUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-3xl text-spotify-text">♪</div>
                    )}
                  </div>
                  <p className="text-title truncate">{album.title}</p>
                  <p className="text-caption">
                    {album.releaseYear ? `${album.releaseYear} · ` : ''}
                    {t('trackCount', { count: album.trackCount })}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {!hasContent && !loading && (
          <p className="text-spotify-text text-center py-12">{t('artistNoContent')}</p>
        )}
      </div>
    </div>
  );
}
