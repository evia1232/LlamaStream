import { ReactNode, useState } from 'react';
import clsx from 'clsx';
import { Track } from '../../types';
import { openTrackContextMenu, TrackMenuOptions } from '../../store/trackMenuStore';
import { useTrackSwipe } from '../../hooks/useTrackSwipe';
import { useTranslation } from 'react-i18next';

interface TrackSurfaceProps {
  track: Track;
  options?: TrackMenuOptions;
  onClick?: () => void;
  onSwipeRight?: () => void;
  className?: string;
  children: ReactNode;
}

/** Wrap any song UI — right-click menu; swipe right adds to queue on touch devices */
export default function TrackSurface({
  track,
  options,
  onClick,
  onSwipeRight,
  className,
  children,
}: TrackSurfaceProps) {
  const { t } = useTranslation();
  const [swipeHint, setSwipeHint] = useState(false);
  const swipe = useTrackSwipe(onSwipeRight ? () => {
    setSwipeHint(true);
    onSwipeRight();
    window.setTimeout(() => setSwipeHint(false), 700);
  } : undefined);

  return (
    <div
      className={clsx('relative', className, swipeHint && 'bg-spotify-green/15 ring-1 ring-spotify-green/40')}
      onClick={onClick}
      onContextMenu={(e) => openTrackContextMenu(e, track, options)}
      onTouchStart={swipe.onTouchStart}
      onTouchEnd={swipe.onTouchEnd}
    >
      {swipeHint && (
        <span className="absolute inset-y-0 end-2 flex items-center text-2xs text-spotify-green font-medium pointer-events-none z-10">
          {t('addedToQueue')}
        </span>
      )}
      {children}
    </div>
  );
}
