import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ChevronDown, ChevronUp } from 'lucide-react';
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

function parseImportError(error: string): { label: string; reason: string } {
  const idx = error.indexOf(': ');
  if (idx === -1) return { label: error, reason: '' };
  return { label: error.slice(0, idx), reason: error.slice(idx + 2) };
}

function ImportFailedList({ errors }: { errors: string[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);

  if (errors.length === 0) return null;

  return (
    <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10 transition-colors"
      >
        <span>{t('importFailedListTitle', { count: errors.length })}</span>
        {open ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
      </button>
      {open && (
        <ul className="max-h-56 overflow-y-auto border-t border-red-500/20 divide-y divide-red-500/10">
          {errors.map((error, i) => {
            const { label, reason } = parseImportError(error);
            return (
              <li key={`${label}-${i}`} className="px-3 py-2 text-xs">
                <p className="text-white/90 font-medium truncate">{label}</p>
                {reason && <p className="text-spotify-text mt-0.5 line-clamp-2">{reason}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
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
        const finished = ['completed', 'failed'].includes(job.status);
        const errors = Array.isArray(job.errors) ? job.errors : [];

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

            {(finished || job.failedTracks > 0) && job.totalTracks > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="px-2.5 py-1 rounded-full bg-spotify-green/15 text-spotify-green">
                  {t('importSucceededCount', { count: job.completedTracks })}
                </span>
                {job.failedTracks > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-red-500/15 text-red-300">
                    {t('importFailedCount', { count: job.failedTracks })}
                  </span>
                )}
              </div>
            )}

            {job.failedTracks > 0 && errors.length > 0 && (
              <ImportFailedList errors={errors} />
            )}
          </div>
        );
      })}
    </div>
  );
}
