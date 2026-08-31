import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Play, Download, Trash2 } from 'lucide-react';
import api from '../api/client';
import TrackRow from '../components/tracks/TrackRow';
import { Track, Playlist } from '../types';
import { normalizeTrack } from '../lib/trackUtils';
import { usePlayerStore } from '../store';
import PlaylistCover from '../components/playlists/PlaylistCover';
import ImportStatusList from '../components/playlists/ImportStatusList';
import { ImportJobStatus } from '../types';

export default function PlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const playTracks = usePlayerStore((s) => s.playTracks);

  const [importJob, setImportJob] = useState<ImportJobStatus | null>(null);

  const loadPlaylist = useCallback(() => {
    if (!id) return;
    api.get(`/playlists/${id}`).then(({ data }) => {
      setPlaylist(data.playlist);
      setImportJob(data.playlist.importJob ?? null);
    }).catch(console.error);
  }, [id]);

  useEffect(() => { loadPlaylist(); }, [loadPlaylist]);

  useEffect(() => {
    if (!importJob || !['parsing', 'pending', 'running'].includes(importJob.status)) return;
    const timer = window.setInterval(loadPlaylist, 3000);
    return () => window.clearInterval(timer);
  }, [importJob, loadPlaylist]);

  const normalizedTracks = (playlist?.tracks ?? []).map((t) => normalizeTrack(t as Track));

  const handlePlayAll = () => {
    if (normalizedTracks.length > 0) void playTracks(normalizedTracks, 0);
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
          <PlaylistCover
            coverUrl={playlist.coverUrl}
            coverImages={playlist.coverImages}
            className="w-full h-full"
            fallback={<span className="text-6xl">♪</span>}
          />
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

      {importJob && ['parsing', 'pending', 'running'].includes(importJob.status) && (
        <div className="px-6 pb-2">
          <ImportStatusList jobs={[{ ...importJob, playlist: { id: playlist.id, name: playlist.name } }]} />
        </div>
      )}

      <div className="px-2">
        <div className="grid grid-cols-[16px_4fr_3fr_1fr_80px] gap-4 px-4 py-2 border-b border-white/10 text-spotify-text text-sm">
          <span>#</span>
          <span>{t('name')}</span>
          <span className="hidden md:block">{t('albums')}</span>
          <span />
          <span className="text-end">⏱</span>
        </div>
        {normalizedTracks.map((track, i) => (
          <TrackRow
            key={track.id}
            track={track}
            index={i}
            contextTracks={normalizedTracks}
            playlistId={id}
            onRemovedFromPlaylist={loadPlaylist}
            onDeleted={loadPlaylist}
          />
        ))}
      </div>
    </div>
  );
}
