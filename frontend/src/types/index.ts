export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: 'USER' | 'ADMIN';
  audioQuality: 'LOW' | 'NORMAL' | 'HIGH';
  language: string;
  searchSpotifyEnabled?: boolean;
  searchYoutubeEnabled?: boolean;
  /** Cumulative bytes of tracks this user liked or put in playlists */
  storageBytes?: number;
  spotify?: {
    connected: boolean;
    premium: boolean;
    product?: string | null;
  };
}

export type PlaybackEngine = 'local' | 'spotify';

export interface Artist {
  id: string;
  name: string;
  imageUrl?: string | null;
}

export interface Track {
  id: string;
  title: string;
  duration: number;
  thumbnailUrl?: string | null;
  streamUrl?: string | null;
  isDownloaded?: boolean;
  isDownloading?: boolean;
  artist: Artist | { name: string } | string;
  album?: { id: string; title: string; coverUrl?: string | null } | null;
  source?: 'library' | 'youtube' | 'spotify';
  youtubeUrl?: string;
  /** Playlist slot index (Spotify order) when loaded from a playlist */
  position?: number;
  spotifyUrl?: string;
  spotifyArtistId?: string;
  quality?: 'LOW' | 'NORMAL' | 'HIGH';
}

export interface Playlist {
  id: string;
  name: string;
  description?: string | null;
  coverUrl?: string | null;
  coverImages?: string[];
  visibility: 'PUBLIC' | 'PRIVATE';
  trackCount?: number;
  tracks?: Track[];
  failedItems?: FailedImportItem[];
  importJob?: ImportJobStatus | null;
}

export interface FailedImportItem {
  position: number;
  name: string;
  artist: string;
  album?: string;
  duration?: number;
  url?: string;
  error: string;
}

export interface ImportJobStatus {
  id: string;
  status: 'parsing' | 'pending' | 'running' | 'completed' | 'failed' | string;
  totalTracks: number;
  completedTracks: number;
  failedTracks: number;
  playlist: { id: string; name: string };
  errors?: Array<string | FailedImportItem>;
  failedItems?: FailedImportItem[];
  createdAt?: string;
}

export interface QueueItem {
  id: string;
  position: number;
  track: Track;
}

export interface LyricsLine {
  time: number;
  text: string;
}

export interface Lyrics {
  id: string;
  content: string;
  synced: boolean;
  lines?: LyricsLine[];
}

export type RepeatMode = 'off' | 'all' | 'one';
