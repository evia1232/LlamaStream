import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Signal } from 'lucide-react';
import clsx from 'clsx';
import { Track, PlaybackEngine } from '../../types';
import { usePlayerStore, useAuthStore } from '../../store';

const QUALITY_KBPS: Record<string, string> = {
  LOW: '96',
  NORMAL: '192',
  HIGH: '320',
};

function resolvePlaybackLabel(
  track: Track,
  engine: PlaybackEngine,
  t: (key: string) => string,
  isPreparing: boolean,
  isBuffering: boolean,
): string {
  if (isPreparing && !track.isDownloaded && engine !== 'spotify') return t('downloading');
  if (isBuffering) return t('preparingPlayback');
  if (engine === 'spotify') return t('spotifyStreaming');
  if (track.isDownloaded) return t('playbackLocal');
  if (track.isDownloading) return t('downloading');
  return t('playbackRemote');
}

export default function PlaybackMeta({
  track,
  className,
}: {
  track: Track;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const playbackEngine = usePlayerStore((s) => s.playbackEngine);
  const isPreparingPlayback = usePlayerStore((s) => s.isPreparingPlayback);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const userQuality = useAuthStore((s) => s.user?.audioQuality || 'HIGH');

  const trackQuality = track.quality || userQuality;
  const kbps = QUALITY_KBPS[trackQuality] || QUALITY_KBPS.HIGH;
  const label = resolvePlaybackLabel(track, playbackEngine, t, isPreparingPlayback, isBuffering);
  const qualityLabel = trackQuality === 'LOW'
    ? t('qualityLow')
    : trackQuality === 'NORMAL'
      ? t('qualityNormal')
      : t('qualityHigh');

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={popRef} className={clsx('relative inline-flex items-center gap-1.5 max-w-full', className)}>
      <span className="text-2xs text-spotify-green truncate">{label}</span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="inline-flex items-center gap-0.5 text-2xs font-bold text-spotify-green bg-spotify-green/15 rounded px-1 py-0.5 shrink-0"
        aria-label={t('playbackQualityDetail')}
      >
        <Signal className="w-3 h-3" />
        {trackQuality === 'HIGH' ? 'HQ' : trackQuality === 'NORMAL' ? 'NQ' : 'LQ'}
      </button>
      {open && (
        <div className="absolute bottom-full mb-1 start-0 z-50 min-w-[11rem] bg-[#282828] border border-white/10 rounded-md shadow-xl p-3 text-start text-xs space-y-1.5">
          <p><span className="text-spotify-text">{t('playbackSource')}:</span> {label}</p>
          <p><span className="text-spotify-text">{t('audioQuality')}:</span> {qualityLabel} ({kbps} kbps)</p>
          <p><span className="text-spotify-text">{t('downloaded')}:</span> {track.isDownloaded ? t('yes') : t('no')}</p>
          {playbackEngine === 'spotify' && (
            <p className="text-spotify-text">{t('spotifyStreamNote')}</p>
          )}
        </div>
      )}
    </div>
  );
}
