export interface MediaImage {
  src: string;
  sizes?: string;
  type?: string;
}

export interface MetadataOptions {
  album?: string;
  artist?: string;
  artwork?: MediaImage[];
  title?: string;
  liked?: boolean;
}

export interface PlaybackStateOptions {
  playbackState: 'none' | 'paused' | 'playing';
}

export interface ActionHandlerOptions {
  action:
    | 'play'
    | 'pause'
    | 'previoustrack'
    | 'nexttrack'
    | 'seekbackward'
    | 'seekforward'
    | 'seekto'
    | 'stop'
    | 'like';
}

export interface ActionDetails {
  action: string;
  seekTime?: number | null;
}

export type ActionHandler = (details: ActionDetails) => void;

export interface PositionStateOptions {
  duration?: number;
  playbackRate?: number;
  position?: number;
}

export interface LikedOptions {
  liked: boolean;
}

export interface MediaSessionPlugin {
  setMetadata(options: MetadataOptions): Promise<void>;
  setPlaybackState(options: PlaybackStateOptions): Promise<void>;
  setActionHandler(options: ActionHandlerOptions, handler: ActionHandler | null): Promise<void>;
  setPositionState(options: PositionStateOptions): Promise<void>;
  setLiked(options: LikedOptions): Promise<void>;
  requestNotificationPermission(): Promise<void>;
}
