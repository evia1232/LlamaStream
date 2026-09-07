import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { FailedImportItem, ImportJobStatus } from '../../types';
import api from '../../api/client';

interface ImportStatusListProps {
  jobs: ImportJobStatus[];
  className?: string;
  onRetrySuccess?: () => void;
  onRefresh?: () => void;
}

function statusLabel(status: string, t: (key: string) => string): string {
  switch (status) {
    case 'parsing': return t('importStatusParsing');
    case 'pending': return t('importStatusPending');
    case 'running': return t('importStatusRunning');
    case 'completed': return t('importStatusCompleted');
    case 'failed': return t('importStatusFailed');
    default: return status;
  }
}

function toFailedItems(job: ImportJobStatus): FailedImportItem[] {
  if (job.failedItems?.length) return job.failedItems;
  const errors = Array.isArray(job.errors) ? job.errors : [];
  return errors
    .map((e, i) => {
      if (e && typeof e === 'object' && 'position' in e) return e as FailedImportItem;
      if (typeof e !== 'string') return null;
      const idx = e.indexOf(': ');
      const label = idx === -1 ? e : e.slice(0, idx);
      const reason = idx === -1 ? '' : e.slice(idx + 2);
      const dash = label.indexOf(' - ');
      return {
        position: i,
        artist: dash >= 0 ? label.slice(0, dash) : '',
        name: dash >= 0 ? label.slice(dash + 3) : label,
        error: reason || e,
      } as FailedImportItem;
    })
    .filter(Boolean) as FailedImportItem[];
}

function ImportFailedList({
  job,
  onRetrySuccess,
}: {
  job: ImportJobStatus;
  onRetrySuccess?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [retryingPos, setRetryingPos] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  const items = toFailedItems(job);

  if (items.length === 0) return null;

  const handleRetry = async (item: FailedImportItem) => {
    if (retryingPos !== null || restoring) return;
    setRetryingPos(item.position);
    try {
      await api.post(`/playlists/${job.playlist.id}/retry-failed`, { position: item.position });
      onRetrySuccess?.();
    } catch (err: unknown) {
      alert((err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('error'));
    } finally {
      setRetryingPos(null);
    }
  };

  const handleRestoreAll = async () => {
    if (restoring || retryingPos !== null) return;
    setRestoring(true);
    try {
      const { data } = await api.post(`/playlists/${job.playlist.id}/restore-failed`);
      if (!data.started && data.totalFailed === 0) {
        alert(t('restorePlaylistNone'));
      }
      onRetrySuccess?.();
    } catch (err: unknown) {
      alert((err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('error'));
    } finally {
      setRestoring(false);
    }
  };

  const busy = restoring || retryingPos !== null || ['parsing', 'pending', 'running'].includes(job.status);

  return (
    <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-red-500/20">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex-1 flex items-center justify-between gap-2 text-sm text-red-300 hover:text-red-200 transition-colors text-start"
        >
          <span>{t('importFailedListTitle', { count: items.length })}</span>
          {open ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
        </button>
        <button
          type="button"
          onClick={() => void handleRestoreAll()}
          disabled={busy}
          title={t('restorePlaylistHint')}
          className="shrink-0 green-btn !py-1.5 !px-2.5 !text-xs flex items-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCw className={clsx('w-3.5 h-3.5', (restoring || ['running', 'pending'].includes(job.status)) && 'animate-spin')} />
          <span className="hidden sm:inline">
            {restoring || job.status === 'running' ? t('restorePlaylistRunning') : t('restorePlaylist')}
          </span>
        </button>
      </div>
      {open && (
        <ul className="max-h-72 overflow-y-auto divide-y divide-red-500/10">
          {items.map((item) => (
            <li key={`${item.position}-${item.name}`} className="px-3 py-2 text-xs flex items-start gap-2">
              <span className="text-spotify-text tabular-nums w-6 shrink-0 pt-0.5">{item.position + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-white/90 font-medium truncate">{item.artist} - {item.name}</p>
                {item.error && <p className="text-spotify-text mt-0.5 line-clamp-2">{item.error}</p>}
              </div>
              <button
                type="button"
                onClick={() => void handleRetry(item)}
                disabled={busy}
                className="shrink-0 icon-btn px-2 py-1 text-spotify-green disabled:opacity-50 flex items-center gap-1"
                title={t('retryImportTrack')}
              >
                <RefreshCw className={clsx('w-3.5 h-3.5', retryingPos === item.position && 'animate-spin')} />
                <span className="hidden sm:inline">{retryingPos === item.position ? t('retryingDownload') : t('retryImportTrack')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ImportStatusList({ jobs, className, onRetrySuccess, onRefresh }: ImportStatusListProps) {
  const { t } = useTranslation();
  if (jobs.length === 0) return null;
  const afterRetry = () => {
    onRetrySuccess?.();
    onRefresh?.();
  };

  return (
    <div className={clsx('space-y-3', className)}>
      {jobs.map((job) => {
        const done = job.completedTracks + job.failedTracks;
        const total = job.totalTracks || done || 1;
        const pct = Math.min(100, Math.round((done / total) * 100));
        const active = ['parsing', 'pending', 'running'].includes(job.status);
        const finished = ['completed', 'failed'].includes(job.status);
        const failedCount = Math.max(job.failedTracks, toFailedItems(job).length);

        return (
          <div key={job.id} className="surface-elevated p-4 rounded-spotify">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="min-w-0">
                <p className="text-sm font-bold truncate">
                  {active ? t('importInProgress') : t('importFinished')}:{' '}
                  <Link to={`/playlist/${job.playlist.id}`} className="hover:underline text-spotify-green">
                    {job.playlist.name}
                  </Link>
                </p>
                <p className="text-caption mt-0.5">{statusLabel(job.status, t)}</p>
              </div>
              <span className="text-caption shrink-0 tabular-nums">
                {job.totalTracks > 0
                  ? t('importProgress', { done, total: job.totalTracks, failed: failedCount })
                  : t('importPreparing')}
              </span>
            </div>

            <div className="h-1.5 bg-spotify-gray rounded-full overflow-hidden">
              <div
                className={clsx(
                  'h-full transition-all duration-500',
                  job.status === 'failed' && job.completedTracks === 0 ? 'bg-red-500' : 'bg-spotify-green'
                )}
                style={{ width: `${active && job.totalTracks === 0 ? 8 : pct}%` }}
              />
            </div>

            {(finished || failedCount > 0) && job.totalTracks > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="px-2.5 py-1 rounded-full bg-spotify-green/15 text-spotify-green">
                  {t('importSucceededCount', { count: job.completedTracks })}
                </span>
                {failedCount > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-red-500/15 text-red-300">
                    {t('importFailedCount', { count: failedCount })}
                  </span>
                )}
              </div>
            )}

            {failedCount > 0 && (
              <ImportFailedList job={job} onRetrySuccess={afterRetry} />
            )}
          </div>
        );
      })}
    </div>
  );
}
