import { useTranslation } from 'react-i18next';
import {
  ChevronDown, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  Heart, Mic2, ListMusic, ListPlus, MoreHorizontal,
} from 'lucide-react';
import clsx from 'clsx';
import { useRef, useState, useCallback, useEffect } from 'react';
import { usePlayerStore } from '../../store';
import { getArtistName, getTrackImageUrl, isTrackLiked } from '../../lib/trackUtils';
import { ArtistLinks } from '../artists/ArtistLink';
import { progressGradient } from '../../lib/direction';
import { DevicePickerButton } from './DevicePicker';
import PlaybackMeta from './PlaybackMeta';
import AddToPlaylistModal from '../tracks/AddToPlaylistModal';
import TrackContextMenu, { TrackMenuAction } from '../tracks/TrackContextMenu';

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function PlayIcon({ className }: { className?: string }) {
  return <Play className={clsx(className, 'play-icon-nudge')} />;
}

export default function NowPlayingSheet() {
  const { t } = useTranslation();

  const {
    currentTrack, showNowPlaying, setShowNowPlaying,
    isPlaying, currentTime, duration,
    shuffle, repeat, likedTrackIds, likedPendingTracks,
    setIsPlaying, toggleShuffle, cycleRepeat,
    playNext, playPrevious, toggleLike, setShowQueue, setShowLyrics, seekTo,
    addToQueue, isPreparingPlayback, isBuffering, isRemoteActive, activeDeviceName,
  } = usePlayerStore();

  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuAnchorRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);

  useEffect(() => {
    const el = sheetRef.current;
    if (!el || !showNowPlaying) return;

    let startY = 0;
    let startScrollTop = 0;
    let fromHeader = false;
    let active = false;
    let currentDrag = 0;

    const canStart = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      if (target.closest('input[type="range"]')) return false;
      return true;
    };

    const onStart = (e: TouchEvent) => {
      if (!canStart(e.target)) return;
      fromHeader = !!(e.target as Element).closest('[data-np-header]');
      startScrollTop = scrollRef.current?.scrollTop ?? 0;
      startY = e.touches[0].clientY;
      active = true;
      currentDrag = 0;
    };

    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const delta = e.touches[0].clientY - startY;
      if (!fromHeader && startScrollTop > 0) return;
      if (!fromHeader && scrollRef.current && scrollRef.current.scrollTop > 0) return;
      if (delta <= 0) return;

      currentDrag = delta;
      setDragY(delta);
      e.preventDefault();
    };

    const onEnd = () => {
      if (!active) return;
      active = false;
      if (currentDrag > 100) {
        setShowNowPlaying(false);
      }
      currentDrag = 0;
      setDragY(0);
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);

    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [showNowPlaying, setShowNowPlaying]);

  const openMenu = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = menuAnchorRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuPos({ x: rect.right - 240, y: rect.bottom + 4 });
    }
    setMenuOpen(true);
  }, []);

  if (!showNowPlaying || !currentTrack) return null;

  const artistName = getArtistName(currentTrack.artist);
  const imageUrl = getTrackImageUrl(currentTrack);
  const isLiked = isTrackLiked(currentTrack, likedTrackIds, likedPendingTracks);
  const showPreparing = isPreparingPlayback || isBuffering;
  const preparingHint = isBuffering && !isPreparingPlayback
    ? t('switchingTrack')
    : isPreparingPlayback && isBuffering
      ? t('preparingPlayback')
      : null;
  const progressPct = (currentTime / (duration || 1)) * 100;

  const transportControls = (
    <>
      <button type="button" onClick={toggleShuffle} className={clsx('icon-btn p-3', shuffle && 'text-spotify-green')}>
        <Shuffle className="w-6 h-6" />
      </button>
      <button type="button" onClick={playPrevious} className="icon-btn p-3" aria-label={t('previous')}>
        <SkipBack className="w-8 h-8 fill-current" />
      </button>
      <button
        type="button"
        onClick={() => !showPreparing && setIsPlaying(!isPlaying)}
        disabled={showPreparing}
        className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-play-btn active:scale-95 transition-transform disabled:opacity-60"
        aria-label={isPlaying ? t('pause') : t('play')}
      >
        {showPreparing ? (
          <div className="w-7 h-7 border-2 border-black/30 border-t-black rounded-full animate-spin" />
        ) : isPlaying ? (
          <Pause className="w-7 h-7 text-black fill-black" />
        ) : (
          <PlayIcon className="w-7 h-7 text-black fill-black" />
        )}
      </button>
      <button type="button" onClick={playNext} className="icon-btn p-3" aria-label={t('next')}>
        <SkipForward className="w-8 h-8 fill-current" />
      </button>
      <button type="button" onClick={cycleRepeat} className={clsx('icon-btn p-3', repeat !== 'off' && 'text-spotify-green')}>
        {repeat === 'one' ? <Repeat1 className="w-6 h-6" /> : <Repeat className="w-6 h-6" />}
      </button>
    </>
  );

  const menuActions: TrackMenuAction[] = [
    {
      id: 'addToPlaylist',
      label: t('addToPlaylist'),
      icon: <ListPlus className="w-4 h-4" />,
      onClick: () => setShowPlaylistModal(true),
    },
    {
      id: 'addToQueue',
      label: t('addToQueue'),
      icon: <ListMusic className="w-4 h-4" />,
      onClick: () => { void addToQueue(currentTrack.id); },
    },
    {
      id: 'playNext',
      label: t('playNext'),
      icon: <ListMusic className="w-4 h-4" />,
      onClick: () => { void addToQueue(currentTrack.id, true); },
    },
  ];

  return (
    <div
      ref={sheetRef}
      className={clsx(
        'md:hidden fixed inset-0 z-[60] flex flex-col bg-gradient-to-b from-[#333] via-spotify-dark to-spotify-black',
        dragY === 0 && 'animate-slide-up',
      )}
      style={{
        transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
        transition: dragY > 0 ? 'none' : 'transform 0.25s ease-out',
        opacity: dragY > 0 ? Math.max(0.5, 1 - dragY / 500) : 1,
      }}
    >
      {/* Header */}
      <div data-np-header className="flex flex-col shrink-0">
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/30" aria-hidden />
        </div>
        <div className="flex items-center justify-between px-4 pt-1 pb-2">
        <button
          onClick={() => setShowNowPlaying(false)}
          className="icon-btn p-2"
          aria-label={t('close')}
        >
          <ChevronDown className="w-7 h-7" />
        </button>
        <p className="text-caption uppercase tracking-widest">{t('nowPlaying')}</p>
        <div className="flex items-center gap-1">
          <DevicePickerButton />
          <button
            ref={menuAnchorRef}
            type="button"
            onClick={openMenu}
            className={clsx('icon-btn p-2', menuOpen && 'text-white bg-white/10')}
            aria-label={t('more')}
          >
            <MoreHorizontal className="w-6 h-6" />
          </button>
        </div>
        </div>
      </div>

      {/* Artwork */}
      <div ref={scrollRef} className="flex-1 flex flex-col justify-center px-6 min-h-0 overflow-y-auto pb-4">
        <div className="w-full max-w-sm mx-auto aspect-square rounded-lg shadow-card overflow-hidden bg-spotify-lightgray mb-8">
          {imageUrl ? (
            <img src={imageUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-6xl text-spotify-text">♪</div>
          )}
        </div>

        <div className="text-start mb-6 px-1">
          <h2 className="text-2xl font-bold truncate mb-1">{currentTrack.title}</h2>
          <ArtistLinks artist={currentTrack.artist} track={currentTrack} className="text-body text-base truncate block" linkClassName="text-body" />
          {preparingHint && (
            <p className="text-sm text-spotify-green truncate mt-1">{preparingHint}</p>
          )}
          {isRemoteActive && activeDeviceName && (
            <p className="text-sm text-spotify-green truncate mt-1">{t('playingOnDevice', { device: activeDeviceName })}</p>
          )}
          <PlaybackMeta track={currentTrack} className="mt-1" />
        </div>

        {/* Progress + transport — LTR controls (Spotify-style) */}
        <div dir="ltr" className="player-slider-row px-1 mb-2">
          <input
            type="range"
            min={0}
            max={duration || currentTrack?.duration || 0}
            value={currentTime}
            onChange={(e) => seekTo(parseFloat(e.target.value))}
            disabled={showPreparing}
            className="player-progress w-full h-1 mb-2 disabled:opacity-50"
            style={{ background: progressGradient((currentTime / ((duration || currentTrack?.duration || 1))) * 100) }}
          />
          <div className="flex justify-between text-caption tabular-nums">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration || currentTrack?.duration || 0)}</span>
          </div>
        </div>

        <div dir="ltr" className="flex items-center justify-center gap-2 mb-8">
          {transportControls}
        </div>

        {/* Secondary actions */}
        <div className="flex items-center justify-around px-4 mb-6 pb-[env(safe-area-inset-bottom)]">
          <button
            onClick={() => toggleLike(currentTrack.id, currentTrack)}
            className={clsx('icon-btn p-3', isLiked && 'text-spotify-green')}
          >
            <Heart className="w-6 h-6" fill={isLiked ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={() => setShowPlaylistModal(true)}
            className="icon-btn p-3"
            aria-label={t('addToPlaylist')}
          >
            <ListPlus className="w-6 h-6" />
          </button>
          <button
            onClick={() => setShowLyrics(true)}
            className="icon-btn p-3"
          >
            <Mic2 className="w-6 h-6" />
          </button>
          <button
            onClick={() => setShowQueue(true)}
            className="icon-btn p-3"
          >
            <ListMusic className="w-6 h-6" />
          </button>
        </div>
      </div>

      <TrackContextMenu
        open={menuOpen}
        position={menuPos}
        actions={menuActions}
        onClose={() => setMenuOpen(false)}
      />

      <AddToPlaylistModal
        track={currentTrack}
        open={showPlaylistModal}
        onClose={() => setShowPlaylistModal(false)}
      />
    </div>
  );
}
