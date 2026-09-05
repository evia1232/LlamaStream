/**
 * Smooth remote timeline: between WebSocket position updates (~1–3s),
 * advance locally at 1x so the scrubber looks live instead of jumping.
 */

type Anchor = {
  position: number;
  atMs: number;
  playing: boolean;
};

let anchor: Anchor | null = null;

export function clearRemoteProgressAnchor(): void {
  anchor = null;
}

export function setRemoteProgressAnchor(position: number, playing: boolean): void {
  anchor = {
    position: Math.max(0, position),
    atMs: performance.now(),
    playing,
  };
}

/** Current guessed position based on last sync + wall clock. */
export function getRemoteProgressNow(duration = 0): number {
  if (!anchor) return 0;
  if (!anchor.playing) return anchor.position;
  let t = anchor.position + (performance.now() - anchor.atMs) / 1000;
  if (duration > 0) t = Math.min(t, duration);
  return Math.max(0, t);
}

/**
 * Apply a server position without a visible jump when drift is small.
 * Returns the display time to write into the store.
 */
export function applyRemoteProgressUpdate(
  serverPos: number,
  playing: boolean,
  opts?: { forceSnap?: boolean; duration?: number },
): number {
  const duration = opts?.duration ?? 0;
  const clampedServer = Math.max(0, duration > 0 ? Math.min(serverPos, duration) : serverPos);

  if (opts?.forceSnap || !anchor || !playing) {
    setRemoteProgressAnchor(clampedServer, playing);
    return clampedServer;
  }

  const predicted = getRemoteProgressNow(duration);
  const drift = clampedServer - predicted;

  // Hard seek / big desync — snap
  if (Math.abs(drift) > 2.75) {
    setRemoteProgressAnchor(clampedServer, true);
    return clampedServer;
  }

  // Soft pull toward server so we stay accurate without a visible jump
  const blended = predicted + drift * 0.28;
  setRemoteProgressAnchor(blended, true);
  return blended;
}
