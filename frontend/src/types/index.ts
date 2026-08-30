export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: 'USER' | 'ADMIN';
  audioQuality: 'LOW' | 'NORMAL' | 'HIGH';
  language: string;
}

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
  artist: Artist | { name: string };
  album?: { id: string; title: string; coverUrl?: string | null } | null;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string | null;
  coverUrl?: string | null;
  visibility: 'PUBLIC' | 'PRIVATE';
  trackCount?: number;
  tracks?: Track[];
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
