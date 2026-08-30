import { Track } from '../../types';
import { Play, Heart, Plus, MoreHorizontal, Download } from 'lucide-react';
import clsx from 'clsx';
import { usePlayerStore } from '../../store';
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

export default function TrackRow({ track, index, showIndex = true }: TrackRowProps) {
  const { t } = useTranslation();
  const { currentTrack, isPlaying, playTrack, toggleLike, likedTrackIds, addToQueue } = usePlayerStore();
  const [downloading, setDownloading] = useState(false);

  const isCurrent = currentTrack?.id === track.id;
  const isLiked = likedTrackIds.has(track.id);
  const artistName = 'name' in track.artist ? track.artist.name : '';

  const handleDownload = async () => {
    if (track.isDownloaded) return;
    setDownloading(true);
    try {
      const { data } = await api.post('/tracks/download', { query: `${artistName} - ${track.title}` });
      playTrack(data.track);
    } catch (err) {
      console.error(err);
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
        'grid grid-cols-[16px_4fr_3fr_1fr_80px] gap-4 items-center px-4 py-2 rounded-md group card-hover',
        isCurrent && 'bg-white/10'
      )}
    >
      <div className="text-spotify-text text-sm text-center">
        {isCurrent && isPlaying ? (
          <div className="playing-indicator flex justify-center gap-0.5">
            {[1, 2, 3, 4].map((i) => (
              <span key={i} style={{ height: `${6 + i * 2}px` }} />
            ))}
          </div>
        ) : showIndex ? (
          <>
            <span className="group-hover:hidden">{index !== undefined ? index + 1 : ''}</span>
            <button onClick={handlePlay} className="hidden group-hover:block">
              <Play className="w-4 h-4 fill-current text-white" />
            </button>
          </>
        ) : (
          <button onClick={handlePlay}>
            <Play className="w-4 h-4 fill-current text-white opacity-0 group-hover:opacity-100" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-3 min-w-0 cursor-pointer" onClick={handlePlay}>
        {!showIndex && track.thumbnailUrl && (
          <img src={track.thumbnailUrl} alt="" className="w-10 h-10 rounded object-cover" />
        )}
        <div className="min-w-0">
          <p className={clsx('text-sm truncate', isCurrent ? 'text-spotify-green' : 'text-white')}>
            {track.title}
          </p>
          <p className="text-xs text-spotify-text truncate">{artistName}</p>
        </div>
      </div>

      <p className="text-sm text-spotify-text truncate hidden md:block">{track.album?.title || '—'}</p>
      <div />

      <div className="flex items-center justify-end gap-2">
        {!track.isDownloaded && !track.streamUrl && (
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="icon-btn opacity-0 group-hover:opacity-100 p-1"
            title={t('download')}
          >
            <Download className={clsx('w-4 h-4', downloading && 'animate-pulse')} />
          </button>
        )}
        <button
          onClick={() => toggleLike(track.id)}
          className={clsx('icon-btn opacity-0 group-hover:opacity-100 p-1', isLiked && 'opacity-100 text-spotify-green')}
        >
          <Heart className="w-4 h-4" fill={isLiked ? 'currentColor' : 'none'} />
        </button>
        <button
          onClick={() => addToQueue(track.id)}
          className="icon-btn opacity-0 group-hover:opacity-100 p-1"
          title={t('addToQueue')}
        >
          <Plus className="w-4 h-4" />
        </button>
        <span className="text-sm text-spotify-text group-hover:hidden">{formatTime(track.duration)}</span>
        <button className="icon-btn opacity-0 group-hover:opacity-100 p-1">
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
