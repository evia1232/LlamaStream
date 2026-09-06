import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { usePlayerStore } from '../../store';
import { getArtistName } from '../../lib/trackUtils';
import {
  estimateLyricsOffset,
  findActiveLyricIndex,
  getLivePlaybackTime,
} from '../../lib/lyricsSync';

function normalizeLines(
  raw: unknown,
): { time: number; text: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { time: number; text: string }[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const time = Number((row as { time?: unknown }).time);
    const text = String((row as { text?: unknown }).text ?? '').trim();
    if (!Number.isFinite(time)) continue;
    out.push({ time, text });
  }
  return out.sort((a, b) => a.time - b.time);
}

export default function LyricsPanel() {
  const { t } = useTranslation();
  const activeLineRef = useRef<HTMLDivElement>(null);
  const lastActiveRef = useRef(-2);
  const {
    showLyrics, setShowLyrics, lyrics, currentTrack, duration, fetchLyrics, isPlaying,
  } = usePlayerStore();

  const lines = useMemo(() => normalizeLines(lyrics?.lines), [lyrics?.lines]);

  const offset = useMemo(() => {
    const trackDur = duration || currentTrack?.duration || 0;
    return estimateLyricsOffset(lines, trackDur);
  }, [lines, duration, currentTrack?.duration]);

  const [activeIndex, setActiveIndex] = useState(-1);

  // Always try to load lyrics when panel opens / track changes
  useEffect(() => {
    if (!showLyrics || !currentTrack?.id) return;
    void fetchLyrics(currentTrack.id);
  }, [showLyrics, currentTrack?.id, fetchLyrics]);

  // Drive highlight from the live media clock (not throttled store updates)
  useEffect(() => {
    if (!showLyrics || lines.length === 0) {
      setActiveIndex(-1);
      return;
    }

    let raf = 0;
    const tick = () => {
      const t = getLivePlaybackTime();
      const idx = findActiveLyricIndex(lines, t, offset);
      setActiveIndex((prev) => (prev === idx ? prev : idx));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [showLyrics, lines, offset, isPlaying, currentTrack?.id]);

  // Scroll only when the active line changes (not every frame)
  useEffect(() => {
    if (activeIndex === lastActiveRef.current) return;
    lastActiveRef.current = activeIndex;
    if (activeIndex < 0) return;
    const el = activeLineRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIndex]);

  if (!showLyrics || !currentTrack) return null;

  return (
    <div className="fixed inset-0 bg-black/80 z-[70] md:z-50 flex flex-col">
      <div className="flex items-center justify-between p-6">
        <div>
          <h2 className="text-2xl font-bold">{currentTrack.title}</h2>
          <p className="text-spotify-text">{getArtistName(currentTrack.artist)}</p>
        </div>
        <button type="button" onClick={() => setShowLyrics(false)} className="icon-btn">
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-32">
        {lines.length > 0 ? (
          <div className="max-w-2xl mx-auto space-y-1">
            {lines.map((line, i) => (
              <div
                key={`${line.time}-${i}`}
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
