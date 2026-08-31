import { useTranslation } from 'react-i18next';
import {
  ChevronDown, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  Heart, Mic2, ListMusic, Volume2, VolumeX, ListPlus, MoreHorizontal,
} from 'lucide-react';
import clsx from 'clsx';
import { useRef, useState, useCallback } from 'react';
import { usePlayerStore } from '../../store';
import { getArtistName, getTrackImageUrl } from '../../lib/trackUtils';
import { useDirection } from '../../hooks/useDirection';
import { progressGradient } from '../../lib/direction';
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
  const { isRtl } = useDirection();

  const {
    currentTrack, showNowPlaying, setShowNowPlaying,
    isPlaying, currentTime, duration, volume,
    shuffle, repeat, likedTrackIds,
    setIsPlaying, setVolume, toggleShuffle, cycleRepeat,
    playNext, playPrevious, toggleLike, setShowQueue, setShowLyrics, seekTo,
    addToQueue,
  } = usePlayerStore();

  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);
  const menuAnchorRef = useRef<HTMLButtonElement>(null);

  const openMenu = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuRect(menuAnchorRef.current?.getBoundingClientRect() ?? null);
    setMenuOpen((v) => !v);
  }, []);

  if (!showNowPlaying || !currentTrack) return null;

  const artistName = getArtistName(currentTrack.artist);
  const imageUrl = getTrackImageUrl(currentTrack);
  const isLiked = likedTrackIds.has(currentTrack.id);
  const progressPct = (currentTime / (duration || 1)) * 100;

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

  const transportControls = isRtl ? (
    <>
      <button onClick={toggleShuffle} className={clsx('icon-btn p-3', shuffle && 'text-spotify-green')}>
        <Shuffle className="w-6 h-6" />
      </button>
      <button onClick={playNext} className="icon-btn p-3" aria-label={t('next')}>
        <SkipForward className="w-8 h-8 fill-current flip-rtl" />
      </button>
      <button
        onClick={() => setIsPlaying(!isPlaying)}
        className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-play-btn active:scale-95 transition-transform"
      >
        {isPlaying ? (
          <Pause className="w-7 h-7 text-black fill-black" />
        ) : (
          <PlayIcon className="w-7 h-7 text-black fill-black" />
        )}
      </button>
      <button onClick={playPrevious} className="icon-btn p-3" aria-label={t('previous')}>
        <SkipBack className="w-8 h-8 fill-current flip-rtl" />
      </button>
      <button onClick={cycleRepeat} className={clsx('icon-btn p-3', repeat !== 'off' && 'text-spotify-green')}>
        {repeat === 'one' ? <Repeat1 className="w-6 h-6" /> : <Repeat className="w-6 h-6" />}
      </button>
    </>
  ) : (
    <>
      <button onClick={toggleShuffle} className={clsx('icon-btn p-3', shuffle && 'text-spotify-green')}>
        <Shuffle className="w-6 h-6" />
      </button>
      <button onClick={playPrevious} className="icon-btn p-3" aria-label={t('previous')}>
        <SkipBack className="w-8 h-8 fill-current" />
      </button>
      <button
        onClick={() => setIsPlaying(!isPlaying)}
        className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-play-btn active:scale-95 transition-transform"
      >
        {isPlaying ? (
          <Pause className="w-7 h-7 text-black fill-black" />
        ) : (
          <PlayIcon className="w-7 h-7 text-black fill-black" />
        )}
      </button>
      <button onClick={playNext} className="icon-btn p-3" aria-label={t('next')}>
        <SkipForward className="w-8 h-8 fill-current" />
      </button>
      <button onClick={cycleRepeat} className={clsx('icon-btn p-3', repeat !== 'off' && 'text-spotify-green')}>
        {repeat === 'one' ? <Repeat1 className="w-6 h-6" /> : <Repeat className="w-6 h-6" />}
      </button>
    </>
  );

  return (
    <div className="md:hidden fixed inset-0 z-[60] flex flex-col bg-gradient-to-b from-[#333] via-spotify-dark to-spotify-black animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0">
        <button
          onClick={() => setShowNowPlaying(false)}
          className="icon-btn p-2"
          aria-label={t('close')}
        >
          <ChevronDown className="w-7 h-7" />
        </button>
        <p className="text-caption uppercase tracking-widest">{t('nowPlaying')}</p>
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

      {/* Artwork */}
      <div className="flex-1 flex flex-col justify-center px-6 min-h-0 overflow-y-auto pb-4">
        <div className="w-full max-w-sm mx-auto aspect-square rounded-lg shadow-card overflow-hidden bg-spotify-lightgray mb-8">
          {imageUrl ? (
            <img src={imageUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-6xl text-spotify-text">♪</div>
          )}
        </div>

        <div className="text-start mb-6 px-1">
          <h2 className="text-2xl font-bold truncate mb-1">{currentTrack.title}</h2>
          <p className="text-body text-base truncate">{artistName}</p>
        </div>

        {/* Progress */}
        <div dir="ltr" className="slider-ltr px-1 mb-2">
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={currentTime}
            onChange={(e) => seekTo(parseFloat(e.target.value))}
            className="player-progress w-full h-1 mb-2"
            style={{ background: progressGradient(progressPct) }}
          />
          <div className="flex justify-between text-caption tabular-nums">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Transport */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {transportControls}
        </div>

        {/* Secondary actions */}
        <div className="flex items-center justify-around px-4 mb-6">
          <button
            onClick={() => toggleLike(currentTrack.id)}
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
            onClick={() => { setShowNowPlaying(false); setShowLyrics(true); }}
            className="icon-btn p-3"
          >
            <Mic2 className="w-6 h-6" />
          </button>
          <button
            onClick={() => { setShowNowPlaying(false); setShowQueue(true); }}
            className="icon-btn p-3"
          >
            <ListMusic className="w-6 h-6" />
          </button>
        </div>

        {/* Volume */}
        <div dir="ltr" className="slider-ltr flex items-center gap-3 px-4 pb-[env(safe-area-inset-bottom)]">
          <button
            onClick={() => setVolume(volume === 0 ? 0.7 : 0)}
            className="icon-btn p-2 shrink-0"
          >
            {volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="player-progress flex-1"
          />
        </div>
      </div>

      <TrackContextMenu
        open={menuOpen}
        anchorRect={menuRect}
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
