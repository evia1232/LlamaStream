import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Play, Download, Trash2, Camera, X, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import api from '../api/client';
import TrackRow from '../components/tracks/TrackRow';
import { Track, Playlist, FailedImportItem, ImportJobStatus } from '../types';
import { normalizeTrack } from '../lib/trackUtils';
import { usePlayerStore } from '../store';
import PlaylistCover from '../components/playlists/PlaylistCover';
import ImportStatusList from '../components/playlists/ImportStatusList';

type PlaylistRow =
  | { kind: 'track'; position: number; track: Track }
  | { kind: 'failed'; position: number; item: FailedImportItem };

export default function PlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const [playlist, setPlaylist] = useState<(Playlist & { failedItems?: FailedImportItem[] }) | null>(null);
  const playTracks = usePlayerStore((s) => s.playTracks);

  const [importJob, setImportJob] = useState<ImportJobStatus | null>(null);
  const [retryingPos, setRetryingPos] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const loadPlaylist = useCallback(() => {
    if (!id) return;
    api.get(`/playlists/${id}`).then(({ data }) => {
      setPlaylist(data.playlist);
      setImportJob(data.playlist.importJob ?? null);
      void import('../lib/offlineStore').then(({ saveOfflineSnapshot }) => {
        void saveOfflineSnapshot(`playlist:${id}`, data.playlist);
      });
    }).catch(async () => {
      const { loadOfflineSnapshot } = await import('../lib/offlineStore');
      const cached = await loadOfflineSnapshot<Playlist>(`playlist:${id}`);
      if (cached) setPlaylist(cached);
    });
  }, [id]);

  useEffect(() => { loadPlaylist(); }, [loadPlaylist]);

  useEffect(() => {
    if (!importJob || !['parsing', 'pending', 'running'].includes(importJob.status)) return;
    const timer = window.setInterval(loadPlaylist, 3000);
    return () => window.clearInterval(timer);
  }, [importJob?.status, loadPlaylist]);

  const importActive = importJob && ['parsing', 'pending', 'running'].includes(importJob.status);
  const importFinished = importJob && ['completed', 'failed'].includes(importJob.status);

  const normalizedTracks = (playlist?.tracks ?? []).map((t) => normalizeTrack(t as Track));

  const rows: PlaylistRow[] = useMemo(() => {
    const map = new Map<number, PlaylistRow>();
    for (const track of normalizedTracks) {
      const position = typeof (track as Track & { position?: number }).position === 'number'
        ? (track as Track & { position?: number }).position!
        : map.size;
      map.set(position, { kind: 'track', position, track: { ...track, position } as Track });
    }
    const failed = playlist?.failedItems?.length
      ? playlist.failedItems
      : importJob?.failedItems || [];
    for (const item of failed) {
      if (map.has(item.position)) continue;
      map.set(item.position, { kind: 'failed', position: item.position, item });
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, row]) => row);
  }, [normalizedTracks, playlist?.failedItems, importJob?.failedItems]);

  const playableTracks = rows
    .filter((r): r is Extract<PlaylistRow, { kind: 'track' }> => r.kind === 'track')
    .map((r) => r.track);

  const handlePlayAll = () => {
    if (playableTracks.length > 0) void playTracks(playableTracks, 0);
  };

  const handleRetryFailed = async (item: FailedImportItem) => {
    if (!id || retryingPos !== null || restoring) return;
    setRetryingPos(item.position);
    try {
      await api.post(`/playlists/${id}/retry-failed`, { position: item.position });
      loadPlaylist();
    } catch (err: unknown) {
      alert((err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('error'));
    } finally {
      setRetryingPos(null);
    }
  };

  const failedCount = (playlist?.failedItems?.length
    || importJob?.failedItems?.length
    || importJob?.failedTracks
    || 0);

  const handleRestorePlaylist = async () => {
    if (!id || restoring || retryingPos !== null) return;
    setRestoring(true);
    try {
      const { data } = await api.post(`/playlists/${id}/restore-failed`);
      if (!data.started && data.totalFailed === 0) {
        alert(t('restorePlaylistNone'));
      }
      loadPlaylist();
    } catch (err: unknown) {
      alert((err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('error'));
    } finally {
      setRestoring(false);
    }
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

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    const form = new FormData();
    form.append('cover', file);
    try {
      const { data } = await api.post(`/playlists/${id}/cover`, form);
      setPlaylist((prev) => prev ? { ...prev, coverUrl: data.playlist.coverUrl, coverImages: data.playlist.coverImages } : data.playlist);
    } catch { /* ignore */ }
    if (coverInputRef.current) coverInputRef.current.value = '';
  };

  const handleRemoveCover = async () => {
    if (!id) return;
    try {
      const { data } = await api.delete(`/playlists/${id}/cover`);
      setPlaylist((prev) => prev ? { ...prev, coverUrl: null, coverImages: data.playlist.coverImages } : data.playlist);
    } catch { /* ignore */ }
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
      <div className="gradient-bg px-4 md:px-8 pt-8 md:pt-12 pb-8 flex flex-col sm:flex-row items-start sm:items-end gap-6">
        <div className="shrink-0 space-y-3">
          <div className="w-36 h-36 md:w-48 md:h-48 rounded-spotify shadow-card bg-spotify-lightgray overflow-hidden">
            <PlaylistCover
              coverUrl={playlist.coverUrl}
              coverImages={playlist.coverImages}
              className="w-full h-full"
              fallback={<span className="text-6xl">♪</span>}
            />
          </div>
          <div className="flex flex-wrap gap-2 max-w-48">
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              className="icon-btn flex items-center gap-1.5 px-3 py-1.5 text-xs"
            >
              <Camera className="w-3.5 h-3.5" />
              {t('changePlaylistCover')}
            </button>
            {playlist.coverUrl && (
              <button
                type="button"
                onClick={handleRemoveCover}
                className="icon-btn flex items-center gap-1.5 px-3 py-1.5 text-xs"
              >
                <X className="w-3.5 h-3.5" />
                {t('autoPlaylistCover')}
              </button>
            )}
          </div>
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleCoverUpload}
          />
        </div>
        <div className="min-w-0 pb-2 text-start">
          <p className="text-label mb-2">{t('playlists')}</p>
          <h1 className="text-hero mb-3 md:mb-4">{playlist.name}</h1>
          {playlist.description && <p className="text-body mb-2">{playlist.description}</p>}
          <p className="text-caption">{t('trackCount', { count: playableTracks.length })}</p>
        </div>
      </div>

      <div className="px-6 py-4 flex items-center gap-4 flex-wrap">
        <button onClick={handlePlayAll} className="w-14 h-14 bg-spotify-green rounded-full flex items-center justify-center hover:scale-105 transition-transform hover:bg-spotify-green-hover">
          <Play className="w-6 h-6 fill-black text-black play-icon-nudge" />
        </button>
        {failedCount > 0 && (
          <button
            type="button"
            onClick={() => void handleRestorePlaylist()}
            disabled={restoring || retryingPos !== null || !!importActive}
            title={t('restorePlaylistHint')}
            className="green-btn !py-2.5 !px-4 !text-sm flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className={clsx('w-4 h-4', (restoring || importActive) && 'animate-spin')} />
            {restoring || importActive ? t('restorePlaylistRunning') : t('restorePlaylist')}
          </button>
        )}
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

      {importJob && (importActive || importFinished) && (
        <div className="px-6 pb-2">
          <ImportStatusList
            jobs={[{ ...importJob, playlist: { id: playlist.id, name: playlist.name }, failedItems: playlist.failedItems || importJob.failedItems }]}
            onRetrySuccess={loadPlaylist}
          />
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
        {rows.map((row) => {
          if (row.kind === 'track') {
            return (
              <TrackRow
                key={row.track.id}
                track={row.track}
                index={row.position}
                contextTracks={playableTracks}
                playlistId={id}
                onRemovedFromPlaylist={loadPlaylist}
                onDeleted={loadPlaylist}
              />
            );
          }

          return (
            <div
              key={`failed-${row.position}`}
              className="grid grid-cols-[16px_1fr_auto] md:grid-cols-[16px_4fr_3fr_auto] gap-4 px-4 py-2 items-center rounded-md bg-red-500/[0.06] border border-transparent hover:border-red-500/20"
            >
              <span className="text-caption tabular-nums text-red-300/80">{row.position + 1}</span>
              <div className="min-w-0">
                <p className="text-sm text-white/80 truncate">{row.item.name}</p>
                <p className="text-caption truncate">{row.item.artist}</p>
                <p className="text-[11px] text-red-300/80 mt-0.5 line-clamp-1">{row.item.error}</p>
              </div>
              <p className="hidden md:block text-caption truncate text-spotify-text">{row.item.album || '—'}</p>
              <button
                type="button"
                onClick={() => void handleRetryFailed(row.item)}
                disabled={retryingPos !== null || restoring}
                className="green-btn !py-1.5 !px-3 !text-xs flex items-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw className={clsx('w-3.5 h-3.5', retryingPos === row.position && 'animate-spin')} />
                {retryingPos === row.position ? t('retryingDownload') : t('retryImportTrack')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
