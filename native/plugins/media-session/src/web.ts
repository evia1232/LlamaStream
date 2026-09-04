import { WebPlugin } from '@capacitor/core';
import type {
  ActionHandler,
  ActionHandlerOptions,
  LikedOptions,
  MediaSessionPlugin,
  MetadataOptions,
  PlaybackStateOptions,
  PositionStateOptions,
} from './definitions';

function setHandler(action: string, handler: MediaSessionActionHandler | null) {
  try {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler(action as MediaSessionAction, handler);
  } catch {
    /* unsupported */
  }
}

export class MediaSessionWeb extends WebPlugin implements MediaSessionPlugin {
  async setMetadata(options: MetadataOptions): Promise<void> {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: options.title,
      artist: options.artist,
      album: options.album,
      artwork: options.artwork,
    });
  }

  async setPlaybackState(options: PlaybackStateOptions): Promise<void> {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = options.playbackState;
  }

  async setActionHandler(options: ActionHandlerOptions, handler: ActionHandler | null): Promise<void> {
    if (options.action === 'like') return;
    setHandler(options.action, handler as MediaSessionActionHandler | null);
  }

  async setPositionState(options: PositionStateOptions): Promise<void> {
    if (!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: options.duration,
        playbackRate: options.playbackRate ?? 1,
        position: options.position,
      });
    } catch {
      /* ignore */
    }
  }

  async setLiked(_options: LikedOptions): Promise<void> {
    /* web: no-op */
  }

  async requestNotificationPermission(): Promise<void> {
    /* web: no-op */
  }
}
