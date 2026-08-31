import { useCallback, useEffect, useState } from 'react';
import api from '../../api/client';
import { ImportJobStatus } from '../../types';
import ImportStatusList from './ImportStatusList';

const POLL_MS = 3000;

export function useActiveImports(enabled = true) {
  const [jobs, setJobs] = useState<ImportJobStatus[]>([]);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get('/playlists/import/active');
      setJobs(data.jobs ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const id = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(id);
  }, [enabled, refresh]);

  const hasActive = jobs.some((j) => ['parsing', 'pending', 'running'].includes(j.status));

  return { jobs, refresh, hasActive };
}

interface ImportStatusPanelProps {
  className?: string;
  onUpdate?: () => void;
}

export default function ImportStatusPanel({ className, onUpdate }: ImportStatusPanelProps) {
  const { jobs, refresh, hasActive } = useActiveImports(true);

  useEffect(() => {
    if (!hasActive) onUpdate?.();
  }, [hasActive, onUpdate]);

  return <ImportStatusList jobs={jobs} className={className} onRefresh={refresh} />;
}
