import { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  Volume2, VolumeX, Heart, Mic2, ListMusic,
} from 'lucide-react';
import clsx from 'clsx';
import { usePlayerStore } from '../../store';
import { streamUrl } from '../../lib/apiUrl';
import { getArtistName } from '../../lib/trackUtils';

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function PlayerBar() {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement>(null);

  const {
    currentTrack, isPlaying, currentTime, duration, volume,
    shuffle, repeat, likedTrackIds,
    setIsPlaying, setCurrentTime, setDuration, setVolume,
    toggleShuffle, cycleRepeat, playNext, playPrevious,
    toggleLike, setShowQueue, setShowLyrics, showLyrics,
  } = usePlayerStore();

  const isLiked = currentTrack ? likedTrackIds.has(currentTrack.id) : false;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    const token = localStorage.getItem('token');
    audio.src = streamUrl(currentTrack.id, token);
    if (isPlaying) audio.play().catch(() => setIsPlaying(false));
  }, [currentTrack?.id]);

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
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) setDuration(audioRef.current.duration);
  };

  const handleEnded = () => playNext();

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  if (!currentTrack) {
    return (
      <footer className="h-[90px] bg-spotify-lightgray border-t border-black/30 flex items-center justify-center">
        <p className="text-spotify-text text-sm">{t('appName')}</p>
      </footer>
    );
  }

  const artistName = getArtistName(currentTrack?.artist);

  return (
    <footer className="h-[90px] bg-spotify-lightgray border-t border-black/30 px-4 grid grid-cols-3 items-center gap-4 shrink-0">
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        crossOrigin="anonymous"
      />

      {/* Track Info */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-14 h-14 rounded bg-spotify-gray shrink-0 overflow-hidden">
          {currentTrack.thumbnailUrl ? (
            <img src={currentTrack.thumbnailUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-spotify-text">♪</div>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate hover:underline cursor-pointer">{currentTrack.title}</p>
          <p className="text-xs text-spotify-text truncate">{artistName}</p>
        </div>
        <button
          onClick={() => toggleLike(currentTrack.id)}
          className={clsx('icon-btn shrink-0', isLiked && 'text-spotify-green')}
        >
          <Heart className="w-4 h-4" fill={isLiked ? 'currentColor' : 'none'} />
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-4">
          <button onClick={toggleShuffle} className={clsx('icon-btn', shuffle && 'active text-spotify-green')}>
            <Shuffle className="w-4 h-4" />
          </button>
          <button onClick={playPrevious} className="icon-btn">
            <SkipBack className="w-5 h-5 fill-current" />
          </button>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="w-8 h-8 bg-white rounded-full flex items-center justify-center hover:scale-105 transition-transform"
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 text-black fill-black" />
            ) : (
              <Play className="w-4 h-4 text-black fill-black ms-0.5" />
            )}
          </button>
          <button onClick={playNext} className="icon-btn">
            <SkipForward className="w-5 h-5 fill-current" />
          </button>
          <button onClick={cycleRepeat} className={clsx('icon-btn', repeat !== 'off' && 'active text-spotify-green')}>
            {repeat === 'one' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
          </button>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 w-full max-w-md">
          <span className="text-xs text-spotify-text w-10 text-end">{formatTime(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={currentTime}
            onChange={handleSeek}
            className="player-progress flex-1"
            style={{
              background: `linear-gradient(to right, #fff ${(currentTime / (duration || 1)) * 100}%, #4d4d4d ${(currentTime / (duration || 1)) * 100}%)`,
            }}
          />
          <span className="text-xs text-spotify-text w-10">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Extra Controls */}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => setShowLyrics(!showLyrics)}
          className={clsx('icon-btn', showLyrics && 'text-spotify-green')}
        >
          <Mic2 className="w-4 h-4" />
        </button>
        <button onClick={() => setShowQueue(true)} className="icon-btn">
          <ListMusic className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 w-28">
          <button onClick={() => setVolume(volume === 0 ? 0.7 : 0)} className="icon-btn">
            {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
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
    </footer>
  );
}
