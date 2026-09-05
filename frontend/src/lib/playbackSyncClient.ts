type SyncSender = (payload: object) => boolean;

let sender: SyncSender | null = null;
const pending: object[] = [];
const MAX_PENDING = 40;

function flushPending() {
  if (!sender) return;
  while (pending.length > 0) {
    const payload = pending[0];
    try {
      if (!sender(payload)) return;
      pending.shift();
    } catch {
      return;
    }
  }
}

export function setPlaybackSyncSender(fn: SyncSender | null) {
  sender = fn;
  if (fn) flushPending();
}

/** Send a sync/command packet. Queues briefly if the socket is not ready yet. */
export function sendPlaybackSync(payload: object) {
  if (sender) {
    try {
      if (sender(payload)) return;
    } catch {
      /* fall through to queue */
    }
  }
  if (pending.length >= MAX_PENDING) pending.shift();
  pending.push(payload);
}

/** True when a live sender is registered. */
export function hasPlaybackSyncSender(): boolean {
  return sender != null;
}
