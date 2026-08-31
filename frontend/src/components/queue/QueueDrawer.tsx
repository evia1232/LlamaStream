import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, GripVertical, Trash2 } from 'lucide-react';
import { usePlayerStore } from '../../store';
import { getArtistName } from '../../lib/trackUtils';

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function QueueDrawer() {
  const { t } = useTranslation();
  const {
    showQueue, setShowQueue, queue, currentTrack,
    fetchQueue, removeFromQueue, clearQueue, playTrack,
  } = usePlayerStore();

  useEffect(() => {
    if (showQueue) fetchQueue();
  }, [showQueue, fetchQueue]);

  if (!showQueue) return null;

  return (
    <div className="fixed inset-y-0 start-0 w-80 bg-spotify-gray shadow-2xl z-50 flex flex-col border-e border-black/30">
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <h2 className="text-lg font-bold">{t('queue')}</h2>
        <div className="flex gap-2">
          {queue.length > 0 && (
            <button onClick={clearQueue} className="text-xs text-spotify-text hover:text-white">
              {t('clearQueue')}
            </button>
          )}
          <button onClick={() => setShowQueue(false)} className="icon-btn">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {currentTrack && (
        <div className="p-4 border-b border-white/10">
          <p className="text-xs text-spotify-text uppercase mb-2">{t('nowPlaying')}</p>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded bg-spotify-lightgray overflow-hidden shrink-0">
              {currentTrack.thumbnailUrl && (
                <img src={currentTrack.thumbnailUrl} alt="" className="w-full h-full object-cover" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{currentTrack.title}</p>
              <p className="text-xs text-spotify-text truncate">{getArtistName(currentTrack.artist)}</p>
            </div>
            <div className="playing-indicator flex gap-0.5 ms-auto">
              {[1, 2, 3, 4].map((i) => (
                <span key={i} style={{ height: `${8 + i * 3}px` }} />
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {queue.length === 0 ? (
          <p className="text-spotify-text text-sm text-center py-8">{t('queue')} —</p>
        ) : (
          queue.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 p-2 rounded-md card-hover group"
            >
              <GripVertical className="w-4 h-4 text-spotify-text opacity-0 group-hover:opacity-100 cursor-grab" />
              <div
                className="w-10 h-10 rounded bg-spotify-lightgray overflow-hidden shrink-0 cursor-pointer"
                onClick={() => playTrack(item.track)}
              >
                {item.track.thumbnailUrl && (
                  <img src={item.track.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                )}
              </div>
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => playTrack(item.track)}>
                <p className="text-sm truncate">{item.track.title}</p>
                <p className="text-xs text-spotify-text truncate">{getArtistName(item.track.artist)}</p>
              </div>
              <span className="text-xs text-spotify-text">{formatTime(item.track.duration)}</span>
              <button
                onClick={() => removeFromQueue(item.id)}
                className="icon-btn opacity-0 group-hover:opacity-100 p-1"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
