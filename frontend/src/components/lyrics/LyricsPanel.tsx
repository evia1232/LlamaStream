import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { usePlayerStore } from '../../store';

export default function LyricsPanel() {
  const { t } = useTranslation();
  const activeLineRef = useRef<HTMLDivElement>(null);
  const {
    showLyrics, setShowLyrics, lyrics, currentTrack, currentTime,
  } = usePlayerStore();

  useEffect(() => {
    if (activeLineRef.current) {
      activeLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentTime]);

  if (!showLyrics || !currentTrack) return null;

  const lines = lyrics?.lines || [];
  const activeIndex = lines.findIndex((line, i) => {
    const next = lines[i + 1];
    return currentTime >= line.time && (!next || currentTime < next.time);
  });

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex flex-col">
      <div className="flex items-center justify-between p-6">
        <div>
          <h2 className="text-2xl font-bold">{currentTrack.title}</h2>
          <p className="text-spotify-text">
            {'name' in currentTrack.artist ? currentTrack.artist.name : ''}
          </p>
        </div>
        <button onClick={() => setShowLyrics(false)} className="icon-btn">
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-32">
        {lines.length > 0 ? (
          <div className="max-w-2xl mx-auto space-y-1">
            {lines.map((line, i) => (
              <div
                key={i}
                ref={i === activeIndex ? activeLineRef : undefined}
                className={clsx('lyrics-line', i === activeIndex && 'active')}
              >
                {line.text || '♪'}
              </div>
            ))}
          </div>
        ) : lyrics?.content ? (
          <pre className="max-w-2xl mx-auto text-lg text-spotify-text whitespace-pre-wrap font-sans leading-relaxed">
            {lyrics.content}
          </pre>
        ) : (
          <p className="text-center text-spotify-text text-lg mt-20">{t('noLyrics')}</p>
        )}
      </div>
    </div>
  );
}
