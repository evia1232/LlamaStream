import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../api/client';
import { ImportJobStatus } from '../../types';
import ImportStatusList from './ImportStatusList';

const POLL_MS = 4000;

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

  const hasActive = jobs.some((j) => ['parsing', 'pending', 'running'].includes(j.status));

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled || !hasActive) return;
    const id = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(id);
  }, [enabled, hasActive, refresh]);

  return { jobs, refresh, hasActive };
}

interface ImportStatusPanelProps {
  className?: string;
  onUpdate?: () => void;
}

export default function ImportStatusPanel({ className, onUpdate }: ImportStatusPanelProps) {
  const { jobs, refresh, hasActive } = useActiveImports(true);
  const wasActiveRef = useRef(false);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (wasActiveRef.current && !hasActive) {
      onUpdateRef.current?.();
    }
    wasActiveRef.current = hasActive;
  }, [hasActive]);

  return <ImportStatusList jobs={jobs} className={className} onRefresh={refresh} />;
}
