import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Play, Download, Trash2 } from 'lucide-react';
import api from '../api/client';
import TrackRow from '../components/tracks/TrackRow';
import { Track, Playlist } from '../types';
import { normalizeTrack } from '../lib/trackUtils';
import { usePlayerStore } from '../store';

export default function PlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const playTrack = usePlayerStore((s) => s.playTrack);

  useEffect(() => {
    if (id) {
      api.get(`/playlists/${id}`).then(({ data }) => setPlaylist(data.playlist)).catch(console.error);
    }
  }, [id]);

  const handlePlayAll = () => {
    if (playlist?.tracks?.[0]) playTrack(playlist.tracks[0]);
  };

  const handleExport = async (format: 'json' | 'm3u' | 'txt') => {
    const token = localStorage.getItem('token');
    window.open(`/api/playlists/${id}/export?format=${format}&token=${token}`, '_blank');
  };

  const handleDelete = async () => {
    if (!confirm(t('confirmDelete'))) return;
    await api.delete(`/playlists/${id}`);
    window.location.href = '/library';
  };

  if (!playlist) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-spotify-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="gradient-bg px-4 md:px-8 pt-8 md:pt-12 pb-8 flex flex-col sm:flex-row items-end gap-6">
        <div className="w-36 h-36 md:w-48 md:h-48 rounded-spotify shadow-card bg-spotify-lightgray shrink-0 overflow-hidden">
          {playlist.coverUrl ? (
            <img src={playlist.coverUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-6xl">♪</div>
          )}
        </div>
        <div className="min-w-0 pb-2">
          <p className="text-label mb-2">{t('playlists')}</p>
          <h1 className="text-hero mb-3 md:mb-4">{playlist.name}</h1>
          {playlist.description && <p className="text-body mb-2">{playlist.description}</p>}
          <p className="text-caption">{t('trackCount', { count: playlist.tracks?.length || 0 })}</p>
        </div>
      </div>

      <div className="px-6 py-4 flex items-center gap-4">
        <button onClick={handlePlayAll} className="w-14 h-14 bg-spotify-green rounded-full flex items-center justify-center hover:scale-105 transition-transform hover:bg-spotify-green-hover">
          <Play className="w-6 h-6 fill-black text-black play-icon-nudge" />
        </button>
        <div className="flex gap-2 ms-auto">
          <button onClick={() => handleExport('json')} className="icon-btn flex items-center gap-2 px-3">
            <Download className="w-4 h-4" />
            JSON
          </button>
          <button onClick={() => handleExport('m3u')} className="icon-btn flex items-center gap-2 px-3">
            M3U
          </button>
          <button onClick={handleDelete} className="icon-btn text-red-400 px-3">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="px-2">
        <div className="grid grid-cols-[16px_4fr_3fr_1fr_80px] gap-4 px-4 py-2 border-b border-white/10 text-spotify-text text-sm">
          <span>#</span>
          <span>{t('name')}</span>
          <span className="hidden md:block">{t('albums')}</span>
          <span />
          <span className="text-end">⏱</span>
        </div>
        {playlist.tracks?.map((track, i) => (
          <TrackRow key={track.id} track={normalizeTrack(track as Track)} index={i} />
        ))}
      </div>
    </div>
  );
}
