import { useRef, useCallback } from 'react';

const SWIPE_THRESHOLD = 56;

/** Detect horizontal swipe right (add-to-queue gesture). */
export function useTrackSwipe(onSwipeRight?: () => void) {
  const startX = useRef(0);
  const startY = useRef(0);
  const tracking = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (!onSwipeRight) return;
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    tracking.current = true;
  }, [onSwipeRight]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!onSwipeRight || !tracking.current) return;
    tracking.current = false;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - startX.current;
    const dy = touch.clientY - startY.current;
    if (Math.abs(dx) >= SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.4 && dx > 0) {
      onSwipeRight();
    }
  }, [onSwipeRight]);

  return { onTouchStart, onTouchEnd };
}
