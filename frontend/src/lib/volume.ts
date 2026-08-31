/** Tailwind `md` breakpoint — mobile has no in-app volume (uses device/system level). */
export function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
}

export function effectivePlaybackVolume(storedVolume: number): number {
  return isMobileViewport() ? 1 : storedVolume;
}
