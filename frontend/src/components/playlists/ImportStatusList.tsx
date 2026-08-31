import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ImportJobStatus } from '../../types';

interface ImportStatusListProps {
  jobs: ImportJobStatus[];
  className?: string;
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

export default function ImportStatusList({ jobs, className }: ImportStatusListProps) {
  const { t } = useTranslation();
  if (jobs.length === 0) return null;

  return (
    <div className={clsx('space-y-3', className)}>
      {jobs.map((job) => {
        const done = job.completedTracks + job.failedTracks;
        const total = job.totalTracks || done || 1;
        const pct = Math.min(100, Math.round((done / total) * 100));
        const active = ['parsing', 'pending', 'running'].includes(job.status);

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
                  ? t('importProgress', { done, total: job.totalTracks, failed: job.failedTracks })
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

            {job.failedTracks > 0 && Array.isArray(job.errors) && job.errors.length > 0 && (
              <p className="text-xs text-spotify-text mt-2 truncate" title={job.errors.slice(-3).join('; ')}>
                {t('importFailedCount', { count: job.failedTracks })}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
