import { useEffect, useMemo, useState } from 'react';
import { usePlayerStore } from '../store';
import {
  estimateLyricsOffset,
  findActiveLyricIndex,
  getLivePlaybackTime,
} from '../lib/lyricsSync';

function normalizeLines(raw: unknown): { time: number; text: string }[] {
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

/** Live active lyric index + lines for karaoke UI (full player / panel). */
export function useActiveLyric(enabled = true) {
  const lyrics = usePlayerStore((s) => s.lyrics);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const duration = usePlayerStore((s) => s.duration);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const fetchLyrics = usePlayerStore((s) => s.fetchLyrics);

  const lines = useMemo(() => normalizeLines(lyrics?.lines), [lyrics?.lines]);
  const offset = useMemo(() => {
    const trackDur = duration || currentTrack?.duration || 0;
    return estimateLyricsOffset(lines, trackDur);
  }, [lines, duration, currentTrack?.duration]);

  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (!enabled || !currentTrack?.id) return;
    void fetchLyrics(currentTrack.id);
  }, [enabled, currentTrack?.id, fetchLyrics]);

  useEffect(() => {
    if (!enabled || lines.length === 0) {
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
  }, [enabled, lines, offset, isPlaying, currentTrack?.id]);

  const activeText = activeIndex >= 0 ? lines[activeIndex]?.text || '' : '';

  return { lines, activeIndex, activeText, hasSynced: lines.length > 0, plainContent: lyrics?.content || '' };
}
