type SyncSender = (payload: object) => void;

let sender: SyncSender | null = null;

export function setPlaybackSyncSender(fn: SyncSender | null) {
  sender = fn;
}

export function sendPlaybackSync(payload: object) {
  sender?.(payload);
}
