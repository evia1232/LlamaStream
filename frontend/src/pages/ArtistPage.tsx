import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
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

interface ArtistPageData {
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
  spotify: {
    configured: boolean;
    artist: SpotifyArtistInfo | null;
    topTracks: SpotifyTrackInfo[];
    albums: SpotifyAlbumInfo[];
  };
}

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export default function ArtistPage() {
  const { id, name: nameParam } = useParams<{ id?: string; name?: string }>();
  const { t } = useTranslation();
  const [data, setData] = useState<ArtistPageData | null>(null);
  const playTracks = usePlayerStore((s) => s.playTracks);

  const load = useCallback(() => {
    const req = nameParam
      ? api.get(`/home/artists/by-name/${encodeURIComponent(nameParam)}`)
      : id
        ? api.get(`/home/artists/${id}`)
        : null;
    if (!req) return;
    req.then(({ data: res }) => setData(res)).catch(console.error);
  }, [id, nameParam]);

  useEffect(() => { load(); }, [load]);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-spotify-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const { artist, localTracks, localAlbums, listenedTracks, spotify } = data;
  const displayName = spotify.artist?.name || artist.name;
  const imageUrl = artist.imageUrl || spotify.artist?.imageUrl || null;

  const normalizedLocal = localTracks.map((t) => normalizeTrack(t));
  const normalizedListened = listenedTracks.map((t) => normalizeTrack(t));

  const spotifyAsTracks = spotify.topTracks.map((t) =>
    externalTrack(t.id, t.name, t.artist, t.duration, t.thumbnailUrl, t.album, { spotifyUrl: t.spotifyUrl }),
  );

  const handlePlayAll = (tracks: Track[]) => {
    if (tracks.length > 0) void playTracks(tracks, 0);
  };

  return (
    <div>
      <div className="gradient-bg px-4 md:px-8 pt-8 md:pt-12 pb-8 flex flex-col sm:flex-row items-end gap-6">
        <div className="w-36 h-36 md:w-48 md:h-48 rounded-full shadow-card bg-spotify-lightgray shrink-0 overflow-hidden">
          {imageUrl ? (
            <img src={imageUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-6xl">🎤</div>
          )}
        </div>
        <div className="min-w-0 pb-2 flex-1">
          <p className="text-label mb-2">{t('artists')}</p>
          <h1 className="text-hero mb-2">{displayName}</h1>
          {spotify.artist && (
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
          {artist.bio && <p className="text-body mt-3 max-w-2xl">{artist.bio}</p>}
        </div>
      </div>

      <div className="px-2 md:px-4 py-6 space-y-10">
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

        {spotify.topTracks.length > 0 && (
          <section>
            <h2 className="text-heading-sm mb-3 px-4">{t('topTracks')}</h2>
            {spotifyAsTracks.map((track, i) => (
              <TrackRow key={track.id} track={track} index={i} contextTracks={spotifyAsTracks} />
            ))}
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

        {localAlbums.length > 0 && (
          <section className="px-4">
            <h2 className="text-heading-sm mb-4">{t('localAlbums')}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {localAlbums.map((album) => (
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

        {spotify.albums.length > 0 && (
          <section className="px-4">
            <h2 className="text-heading-sm mb-4">{t('spotifyAlbums')}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {spotify.albums.map((album) => (
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

        {normalizedLocal.length === 0 && spotify.topTracks.length === 0 && normalizedListened.length === 0 && (
          <p className="text-spotify-text text-center py-12">{t('noResults')}</p>
        )}
      </div>
    </div>
  );
}
