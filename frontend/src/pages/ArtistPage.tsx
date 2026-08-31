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
  album?: string;
  duration: number;
  thumbnailUrl: string;
  spotifyUrl: string;
}

interface ArtistLocalData {
  artist: {
    id: string | null;
    name: string;
    imageUrl: string | null;
    bio: string | null;
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
}

interface SpotifySection {
  configured: boolean;
  artist: SpotifyArtistInfo | null;
  topTracks: SpotifyTrackInfo[];
  albums: SpotifyAlbumInfo[];
}

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function spotifyUrlForName(name: string, hints?: { spotifyArtistId?: string; spotifyTrackId?: string }): string {
  const base = `/home/artists/by-name/${encodeURIComponent(name)}/spotify`;
  const params = new URLSearchParams();
  if (hints?.spotifyArtistId) params.set('spotifyArtistId', hints.spotifyArtistId);
  if (hints?.spotifyTrackId) params.set('spotifyTrackId', hints.spotifyTrackId);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export default function ArtistPage() {
  const { id, name: nameParam } = useParams<{ id?: string; name?: string }>();
  const [searchParams] = useSearchParams();
  const spotifyArtistId = searchParams.get('spotifyArtistId') ?? undefined;
  const spotifyTrackId = searchParams.get('spotifyTrackId') ?? undefined;
  const { t } = useTranslation();
  const [local, setLocal] = useState<ArtistLocalData | null>(null);
  const [spotify, setSpotify] = useState<SpotifySection | null>(null);
  const [loadingLocal, setLoadingLocal] = useState(true);
  const [spotifyLoading, setSpotifyLoading] = useState(true);
  const [error, setError] = useState('');
  const playTracks = usePlayerStore((s) => s.playTracks);

  const searchName = useMemo(() => {
    if (nameParam) return decodeURIComponent(nameParam);
    return null;
  }, [nameParam]);

  const localPath = searchName
    ? `/home/artists/by-name/${encodeURIComponent(searchName)}`
    : id
      ? `/home/artists/${id}`
      : null;

  const fetchSpotify = useCallback(async (name: string, hints?: { spotifyArtistId?: string; spotifyTrackId?: string }) => {
    setSpotifyLoading(true);
    try {
      const { data } = await api.get(spotifyUrlForName(name, hints));
      setSpotify(data.spotify);
    } catch {
      setSpotify({ configured: true, artist: null, topTracks: [], albums: [] });
    } finally {
      setSpotifyLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    if (!localPath) return;
    setLoadingLocal(true);
    setError('');
    setLocal(null);
    setSpotify(null);

    const spotifyName = searchName;
    const spotifyHints = { spotifyArtistId, spotifyTrackId };

    try {
      const requests: [Promise<{ data: ArtistLocalData }>, Promise<void> | null] = [
        api.get(localPath),
        spotifyName ? fetchSpotify(spotifyName, spotifyHints) : null,
      ];

      const [localRes] = await Promise.all([
        requests[0],
        requests[1] ?? Promise.resolve(),
      ]);
      setLocal(localRes.data);

      if (!spotifyName && localRes.data.artist.name) {
        void fetchSpotify(localRes.data.artist.name, spotifyHints);
      } else if (!spotifyName) {
        setSpotifyLoading(false);
      }
    } catch {
      setError(t('artistLoadError'));
      setSpotifyLoading(false);
    } finally {
      setLoadingLocal(false);
    }
  }, [localPath, searchName, spotifyArtistId, spotifyTrackId, fetchSpotify, t]);

  useEffect(() => { void load(); }, [load]);

  const displayName = spotify?.artist?.name || local?.artist.name || searchName || '';
  const imageUrl = spotify?.artist?.imageUrl || local?.artist.imageUrl || null;

  const normalizedLocal = (local?.localTracks ?? []).map((t) => normalizeTrack(t));
  const normalizedListened = (local?.listenedTracks ?? []).map((t) => normalizeTrack(t));
  const spotifyAsTracks = (spotify?.topTracks ?? []).map((t) =>
    externalTrack(t.id, t.name, t.artist, t.duration, t.thumbnailUrl, t.album, { spotifyUrl: t.spotifyUrl }),
  );

  const hasContent = normalizedLocal.length > 0
    || spotifyAsTracks.length > 0
    || normalizedListened.length > 0
    || (local?.localAlbums.length ?? 0) > 0
    || (spotify?.albums.length ?? 0) > 0;

  if (loadingLocal && !local) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <div className="w-8 h-8 border-2 border-spotify-green border-t-transparent rounded-full animate-spin" />
        <p className="text-caption">{t('loadingArtist')}</p>
      </div>
    );
  }

  if (error && !local) {
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
          ) : spotifyLoading ? (
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
          {spotifyLoading && !spotify?.artist && (
            <p className="text-caption text-spotify-text">{t('loadingSpotifyArtist')}</p>
          )}
          {!spotifyLoading && spotify?.configured === false && (
            <p className="text-caption text-spotify-text">{t('spotifyNotConfigured')}</p>
          )}
          {!spotifyLoading && spotify?.configured && !spotify.artist && (
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

        {spotifyLoading && spotifyAsTracks.length === 0 && (
          <section className="px-4">
            <h2 className="text-heading-sm mb-3">{t('topTracks')}</h2>
            <div className="flex items-center gap-2 text-caption text-spotify-text">
              <div className="w-4 h-4 border-2 border-spotify-green border-t-transparent rounded-full animate-spin" />
              {t('loadingSpotifyArtist')}
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

        {normalizedLocal.length > 0 && (
          <section>
            <div className="flex items-center gap-4 mb-3 px-2">
              <h2 className="text-heading-sm">{t('localLibrary')}</h2>
              <button
                type="button"
                onClick={() => handlePlayAll(normalizedLocal)}
                className="w-10 h-10 bg-spotify-green rounded-full flex items-center justify-center hover:scale-105 transition-transform"
                aria-label={t('playAll')}
              >
                <Play className="w-5 h-5 fill-black text-black play-icon-nudge" />
              </button>
            </div>
            {normalizedLocal.map((track, i) => (
              <TrackRow key={track.id} track={track} index={i} onDeleted={load} contextTracks={normalizedLocal} />
            ))}
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

        {!hasContent && !spotifyLoading && (
          <p className="text-spotify-text text-center py-12">{t('artistNoContent')}</p>
        )}
      </div>
    </div>
  );
}
