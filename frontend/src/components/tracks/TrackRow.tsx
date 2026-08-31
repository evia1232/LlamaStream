import { Track } from '../../types';
import { Play, Heart, Plus, MoreHorizontal, Download } from 'lucide-react';
import clsx from 'clsx';
import { usePlayerStore } from '../../store';
import { getArtistName, getTrackImageUrl } from '../../lib/trackUtils';
import { useTranslation } from 'react-i18next';
import api from '../../api/client';
import { useState } from 'react';

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface TrackRowProps {
  track: Track;
  index?: number;
  showIndex?: boolean;
}

function TrackArtwork({
  imageUrl,
  isCurrent,
  isPlaying,
  onPlay,
}: {
  imageUrl: string | null;
  isCurrent: boolean;
  isPlaying: boolean;
  onPlay: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onPlay(); }}
      className="relative w-10 h-10 shrink-0 rounded overflow-hidden bg-spotify-lightgray shadow-sm"
      aria-label="Play"
    >
      {imageUrl ? (
        <img src={imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-spotify-text text-sm">♪</div>
      )}

      {isCurrent && isPlaying ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="playing-indicator flex justify-center gap-0.5">
            {[1, 2, 3, 4].map((i) => (
              <span key={i} style={{ height: `${6 + i * 2}px` }} />
            ))}
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
          <Play className="w-4 h-4 fill-white text-white play-icon-nudge" />
        </div>
      )}
    </button>
  );
}

export default function TrackRow({ track, index, showIndex = true }: TrackRowProps) {
  const { t } = useTranslation();
  const { currentTrack, isPlaying, playTrack, toggleLike, likedTrackIds, addToQueue } = usePlayerStore();
  const [downloading, setDownloading] = useState(false);

  const isCurrent = currentTrack?.id === track.id;
  const isLiked = likedTrackIds.has(track.id);
  const artistName = getArtistName(track.artist);
  const imageUrl = getTrackImageUrl(track);

  const handleDownload = async () => {
    if (track.isDownloaded) return;
    setDownloading(true);
    try {
      const { data } = await api.post('/tracks/download', { query: `${artistName} - ${track.title}` });
      playTrack(data.track);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('error');
      alert(msg);
    } finally {
      setDownloading(false);
    }
  };

  const handlePlay = async () => {
    if (track.isDownloaded || track.streamUrl) {
      playTrack(track);
    } else {
      await handleDownload();
    }
  };

  return (
    <div
      className={clsx(
        'flex md:grid md:grid-cols-[16px_4fr_3fr_1fr_80px] gap-2 md:gap-4 items-center px-2 md:px-4 py-2 rounded-md group card-hover',
        isCurrent && 'bg-white/10'
      )}
    >
      {/* Index — desktop only (Spotify-style # column) */}
      <div className="hidden md:block text-spotify-text text-sm text-center">
        {isCurrent && isPlaying ? (
          <div className="playing-indicator flex justify-center gap-0.5">
            {[1, 2, 3, 4].map((i) => (
              <span key={i} style={{ height: `${6 + i * 2}px` }} />
            ))}
          </div>
        ) : showIndex ? (
          <>
            <span className="group-hover:hidden tabular-nums">{index !== undefined ? index + 1 : ''}</span>
            <button type="button" onClick={handlePlay} className="hidden group-hover:block mx-auto">
              <Play className="w-4 h-4 fill-current text-white" />
            </button>
          </>
        ) : (
          <button type="button" onClick={handlePlay} className="mx-auto">
            <Play className="w-4 h-4 fill-current text-white opacity-0 group-hover:opacity-100" />
          </button>
        )}
      </div>

      {/* Title + artwork */}
      <div className="flex flex-1 md:flex-none items-center gap-3 min-w-0 cursor-pointer" onClick={handlePlay}>
        <TrackArtwork
          imageUrl={imageUrl}
          isCurrent={isCurrent}
          isPlaying={isPlaying}
          onPlay={handlePlay}
        />
        <div className="min-w-0 text-start">
          <p className={clsx('text-base truncate', isCurrent ? 'text-spotify-green' : 'text-white font-normal')}>
            {track.title}
          </p>
          <p className="text-body truncate">{artistName}</p>
        </div>
      </div>

      <p className="text-body truncate hidden md:block text-start">{track.album?.title || '—'}</p>
      <div className="hidden md:block" />

      <div className="flex items-center gap-1 md:gap-2 shrink-0 ms-auto md:ms-0 md:justify-self-end">
        {!track.isDownloaded && !track.streamUrl && (
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="icon-btn md:opacity-0 md:group-hover:opacity-100 p-1"
            title={t('download')}
          >
            <Download className={clsx('w-4 h-4', downloading && 'animate-pulse')} />
          </button>
        )}
        <button
          onClick={() => toggleLike(track.id)}
          className={clsx('icon-btn md:opacity-0 md:group-hover:opacity-100 p-1', isLiked && 'text-spotify-green md:opacity-100')}
        >
          <Heart className="w-4 h-4" fill={isLiked ? 'currentColor' : 'none'} />
        </button>
        <button
          onClick={() => addToQueue(track.id)}
          className="icon-btn hidden sm:block md:opacity-0 md:group-hover:opacity-100 p-1"
          title={t('addToQueue')}
        >
          <Plus className="w-4 h-4" />
        </button>
        <span className="text-caption tabular-nums">{formatTime(track.duration)}</span>
        <button className="icon-btn hidden md:block opacity-0 group-hover:opacity-100 p-1">
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
