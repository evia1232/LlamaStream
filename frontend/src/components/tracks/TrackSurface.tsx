import { ReactNode } from 'react';
import clsx from 'clsx';
import { Track } from '../../types';
import { openTrackContextMenu, TrackMenuOptions } from '../../store/trackMenuStore';

interface TrackSurfaceProps {
  track: Track;
  options?: TrackMenuOptions;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}

/** Wrap any song UI — right-click anywhere opens the track action menu */
export default function TrackSurface({
  track,
  options,
  onClick,
  className,
  children,
}: TrackSurfaceProps) {
  return (
    <div
      className={clsx(className)}
      onClick={onClick}
      onContextMenu={(e) => openTrackContextMenu(e, track, options)}
    >
      {children}
    </div>
  );
}
