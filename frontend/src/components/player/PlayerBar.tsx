import { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  Volume2, VolumeX, Heart, Mic2, ListMusic,
} from 'lucide-react';
import clsx from 'clsx';
import { usePlayerStore } from '../../store';
import { streamUrl } from '../../lib/apiUrl';
import { getArtistName, getTrackImageUrl } from '../../lib/trackUtils';
import { progressGradient } from '../../lib/direction';
import { openTrackContextMenu } from '../../store/trackMenuStore';

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function PlayIcon({ className }: { className?: string }) {
  return <Play className={clsx(className, 'play-icon-nudge')} />;
}

export default function PlayerBar() {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement>(null);

  const {
    currentTrack, isPlaying, currentTime, duration, volume,
    shuffle, repeat, likedTrackIds, pendingSeekTime,
    setIsPlaying, setCurrentTime, setDuration, setVolume,
    toggleShuffle, cycleRepeat, playNext, playPrevious,
    toggleLike, setShowQueue, setShowLyrics, showLyrics,
    clearPendingSeek, persistPlayback, registerSeek, seekTo, setShowNowPlaying,
  } = usePlayerStore();

  const isLiked = currentTrack ? likedTrackIds.has(currentTrack.id) : false;
  const lastPersistRef = useRef(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    const token = localStorage.getItem('token');
    audio.src = streamUrl(currentTrack.id, token);
    if (isPlaying) audio.play().catch(() => setIsPlaying(false));
  }, [currentTrack?.id]);

  useEffect(() => {
    registerSeek((time) => {
      if (audioRef.current) audioRef.current.currentTime = time;
    });
    return () => registerSeek(null);
  }, [registerSeek]);

  useEffect(() => {
    const onUnload = () => { persistPlayback(); };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [persistPlayback]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) audio.play().catch(() => setIsPlaying(false));
    else audio.pause();
  }, [isPlaying]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    const time = audioRef.current.currentTime;
    setCurrentTime(time);
    const now = Date.now();
    if (now - lastPersistRef.current > 4000) {
      lastPersistRef.current = now;
      persistPlayback();
    }
  };

  const handleLoadedMetadata = () => {
    if (!audioRef.current) return;
    setDuration(audioRef.current.duration);
    if (pendingSeekTime > 0) {
      const t = Math.min(pendingSeekTime, audioRef.current.duration || pendingSeekTime);
      audioRef.current.currentTime = t;
      setCurrentTime(t);
      clearPendingSeek();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    seekTo(parseFloat(e.target.value));
  };

  const handleEnded = () => playNext();

  const progressPct = (currentTime / (duration || 1)) * 100;
  const volumePct = volume * 100;

  const transportControls = (
    <>
      <button type="button" onClick={toggleShuffle} className={clsx('icon-btn', shuffle && 'active text-spotify-green')}>
        <Shuffle className="w-4 h-4" />
      </button>
      <button type="button" onClick={playPrevious} className="icon-btn" aria-label={t('previous')}>
        <SkipBack className="w-5 h-5 fill-current" />
      </button>
      <button
        type="button"
        onClick={() => setIsPlaying(!isPlaying)}
        className="w-8 h-8 bg-white rounded-full flex items-center justify-center hover:scale-105 transition-transform"
        aria-label={isPlaying ? t('pause') : t('play')}
      >
        {isPlaying ? (
          <Pause className="w-4 h-4 text-black fill-black" />
        ) : (
          <PlayIcon className="w-4 h-4 text-black fill-black" />
        )}
      </button>
      <button type="button" onClick={playNext} className="icon-btn" aria-label={t('next')}>
        <SkipForward className="w-5 h-5 fill-current" />
      </button>
      <button type="button" onClick={cycleRepeat} className={clsx('icon-btn', repeat !== 'off' && 'active text-spotify-green')}>
        {repeat === 'one' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
      </button>
    </>
  );

  if (!currentTrack) {
    return (
      <footer className="player-bar player-bar-empty shrink-0" dir="ltr">
        <p className="text-spotify-text text-sm hidden md:block">{t('appName')}</p>
      </footer>
    );
  }

  const artistName = getArtistName(currentTrack?.artist);
  const imageUrl = getTrackImageUrl(currentTrack);

  return (
    <footer className="player-bar shrink-0" dir="ltr">
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        crossOrigin="anonymous"
      />

      {/* Mobile progress */}
      <div className="md:hidden absolute top-0 inset-x-0 h-0.5 bg-spotify-hover">
        <div className="h-full bg-white transition-all" style={{ width: `${progressPct}%` }} />
      </div>

      {/* Mobile layout */}
      <div className="md:hidden flex items-center gap-3 px-3 h-full min-w-0">
        <button
          type="button"
          onClick={() => setShowNowPlaying(true)}
          onContextMenu={(e) => openTrackContextMenu(e, currentTrack)}
          className="flex items-center gap-3 flex-1 min-w-0 text-start active:opacity-80"
        >
          <div className="w-11 h-11 rounded bg-spotify-gray shrink-0 overflow-hidden shadow-sm">
            {imageUrl ? (
              <img src={imageUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-spotify-text text-sm">♪</div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-normal truncate">{currentTrack.title}</p>
            <p className="text-caption truncate">{artistName}</p>
          </div>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleLike(currentTrack.id); }}
            className={clsx('icon-btn p-1', isLiked && 'text-spotify-green')}
          >
            <Heart className="w-5 h-5" fill={isLiked ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setIsPlaying(!isPlaying); }}
            className="w-9 h-9 bg-white rounded-full flex items-center justify-center"
            aria-label={isPlaying ? t('pause') : t('play')}
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 text-black fill-black" />
            ) : (
              <PlayIcon className="w-4 h-4 text-black fill-black" />
            )}
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); playNext(); }}
            className="icon-btn p-1"
            aria-label={t('next')}
          >
            <SkipForward className="w-5 h-5 fill-current" />
          </button>
        </div>
      </div>

      {/* Desktop — Spotify-style: sides + absolutely centered transport */}
      <div className="player-bar-desktop hidden md:block relative h-full w-full overflow-visible">
        {/* Left: now playing */}
        <div
          className="absolute inset-y-0 start-0 flex items-center gap-3 min-w-0 max-w-[30%] ps-4 pe-2 z-10 cursor-default"
          onContextMenu={(e) => openTrackContextMenu(e, currentTrack)}
        >
          <div className="w-14 h-14 rounded bg-spotify-gray shrink-0 overflow-hidden">
            {currentTrack.thumbnailUrl ? (
              <img src={currentTrack.thumbnailUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-spotify-text">♪</div>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-normal truncate">{currentTrack.title}</p>
            <p className="text-caption truncate">{artistName}</p>
          </div>
          <button
            type="button"
            onClick={() => toggleLike(currentTrack.id)}
            className={clsx('icon-btn shrink-0', isLiked && 'text-spotify-green')}
          >
            <Heart className="w-4 h-4" fill={isLiked ? 'currentColor' : 'none'} />
          </button>
        </div>

        {/* Center: transport + timeline (always screen-centered) */}
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 flex flex-col items-center justify-center gap-2 w-full max-w-[40rem] px-4 pointer-events-none z-20">
          <div className="pointer-events-auto flex items-center gap-4">
            {transportControls}
          </div>
          <div className="player-slider-row pointer-events-auto flex items-center gap-2 w-full">
            <span className="text-caption w-10 text-end tabular-nums shrink-0">{formatTime(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              value={currentTime}
              onChange={handleSeek}
              className="player-progress flex-1 min-w-0"
              style={{ background: progressGradient(progressPct) }}
            />
            <span className="text-caption w-10 tabular-nums shrink-0">{formatTime(duration)}</span>
          </div>
        </div>

        {/* Right: lyrics, queue, volume */}
        <div className="absolute inset-y-0 end-0 flex items-center justify-end gap-2 pe-4 ps-2 z-10">
          <button
            type="button"
            onClick={() => setShowLyrics(!showLyrics)}
            className={clsx('icon-btn shrink-0', showLyrics && 'text-spotify-green')}
            aria-label={t('lyrics')}
          >
            <Mic2 className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => setShowQueue(true)} className="icon-btn shrink-0" aria-label={t('queue')}>
            <ListMusic className="w-4 h-4" />
          </button>
          <div className="player-slider-row flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setVolume(volume === 0 ? 0.7 : 0)}
              className="icon-btn shrink-0"
              aria-label={t('volume')}
            >
              {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="player-progress w-[6.5rem] shrink-0"
              style={{ background: progressGradient(volumePct) }}
            />
          </div>
        </div>
      </div>
    </footer>
  );
}
