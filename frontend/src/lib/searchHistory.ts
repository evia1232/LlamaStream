import { Track } from '../types';
import { getArtistName } from './trackUtils';

const QUERIES_KEY = 'llamastream_recent_searches';
const TRACKS_KEY = 'llamastream_recent_search_tracks';
const MAX_QUERIES = 12;
const MAX_TRACKS = 20;

export interface RecentSearchTrack {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnailUrl?: string | null;
  youtubeUrl?: string;
  spotifyUrl?: string;
  album?: string;
  searchedAt: number;
}

export function loadRecentQueries(): string[] {
  try {
    const raw = localStorage.getItem(QUERIES_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as string[];
    return list.filter((q) => typeof q === 'string' && q.trim());
  } catch {
    return [];
  }
}

export function addRecentQuery(query: string): void {
  const q = query.trim();
  if (!q) return;
  const prev = loadRecentQueries().filter((item) => item.toLowerCase() !== q.toLowerCase());
  localStorage.setItem(QUERIES_KEY, JSON.stringify([q, ...prev].slice(0, MAX_QUERIES)));
}

export function loadRecentSearchTracks(): RecentSearchTrack[] {
  try {
    const raw = localStorage.getItem(TRACKS_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as RecentSearchTrack[]).filter((t) => t?.id && t?.title);
  } catch {
    return [];
  }
}

export function addRecentSearchTrack(track: Track): void {
  const entry: RecentSearchTrack = {
    id: track.id,
    title: track.title,
    artist: getArtistName(track.artist),
    duration: track.duration,
    thumbnailUrl: track.thumbnailUrl,
    youtubeUrl: track.youtubeUrl,
    spotifyUrl: track.spotifyUrl,
    album: track.album?.title,
    searchedAt: Date.now(),
  };
  const prev = loadRecentSearchTracks().filter((t) => t.id !== entry.id);
  localStorage.setItem(TRACKS_KEY, JSON.stringify([entry, ...prev].slice(0, MAX_TRACKS)));
}

export function recentTrackToTrack(item: RecentSearchTrack): Track {
  const isExternal = item.id.startsWith('external-');
  return {
    id: item.id,
    title: item.title,
    duration: item.duration,
    thumbnailUrl: item.thumbnailUrl,
    artist: { name: item.artist },
    album: item.album ? { id: '', title: item.album } : null,
    youtubeUrl: item.youtubeUrl,
    spotifyUrl: item.spotifyUrl,
    source: item.spotifyUrl ? 'spotify' : item.youtubeUrl ? 'youtube' : 'library',
    isDownloaded: !isExternal,
  };
}
