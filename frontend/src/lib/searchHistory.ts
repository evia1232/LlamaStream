import { Track } from '../types';
import { getArtistName } from './trackUtils';
import api from '../api/client';

const QUERIES_KEY = 'llamastream_recent_searches';
const TRACKS_KEY = 'llamastream_recent_search_tracks';
const IMPORTED_KEY = 'llamastream_search_history_imported';

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

export interface SearchHistorySnapshot {
  queries: string[];
  tracks: RecentSearchTrack[];
}

function loadLocalQueries(): string[] {
  try {
    const raw = localStorage.getItem(QUERIES_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as string[];
    return list.filter((q) => typeof q === 'string' && q.trim());
  } catch {
    return [];
  }
}

function loadLocalTracks(): RecentSearchTrack[] {
  try {
    const raw = localStorage.getItem(TRACKS_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as RecentSearchTrack[]).filter((t) => t?.id && t?.title);
  } catch {
    return [];
  }
}

function clearLocalStorage(): void {
  try {
    localStorage.removeItem(QUERIES_KEY);
    localStorage.removeItem(TRACKS_KEY);
  } catch { /* ignore */ }
}

async function migrateLocalIfNeeded(): Promise<void> {
  try {
    if (localStorage.getItem(IMPORTED_KEY)) return;
    const queries = loadLocalQueries();
    const tracks = loadLocalTracks();
    if (queries.length === 0 && tracks.length === 0) {
      localStorage.setItem(IMPORTED_KEY, '1');
      return;
    }
    await api.post('/tracks/search-history/import', { queries, tracks });
    localStorage.setItem(IMPORTED_KEY, '1');
    clearLocalStorage();
  } catch {
    // Server unavailable — keep local data for now
  }
}

export async function fetchSearchHistory(): Promise<SearchHistorySnapshot> {
  await migrateLocalIfNeeded();
  try {
    const { data } = await api.get<SearchHistorySnapshot>('/tracks/search-history');
    return {
      queries: data.queries ?? [],
      tracks: data.tracks ?? [],
    };
  } catch {
    return {
      queries: loadLocalQueries(),
      tracks: loadLocalTracks(),
    };
  }
}

export async function addRecentQuery(query: string): Promise<string[]> {
  const q = query.trim();
  if (!q) return [];

  try {
    const { data } = await api.post<{ queries: string[] }>('/tracks/search-history/query', { query: q });
    return data.queries ?? [];
  } catch {
    const prev = loadLocalQueries().filter((item) => item.toLowerCase() !== q.toLowerCase());
    const next = [q, ...prev].slice(0, 12);
    localStorage.setItem(QUERIES_KEY, JSON.stringify(next));
    return next;
  }
}

export async function addRecentSearchTrack(track: Track): Promise<RecentSearchTrack[]> {
  const entry = {
    id: track.id,
    title: track.title,
    artist: getArtistName(track.artist),
    duration: track.duration,
    thumbnailUrl: track.thumbnailUrl,
    youtubeUrl: track.youtubeUrl,
    spotifyUrl: track.spotifyUrl,
    album: track.album?.title,
  };

  try {
    const { data } = await api.post<{ tracks: RecentSearchTrack[] }>('/tracks/search-history/track', entry);
    return data.tracks ?? [];
  } catch {
    const full: RecentSearchTrack = { ...entry, searchedAt: Date.now() };
    const prev = loadLocalTracks().filter((t) => t.id !== full.id);
    const next = [full, ...prev].slice(0, 20);
    localStorage.setItem(TRACKS_KEY, JSON.stringify(next));
    return next;
  }
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

/** @deprecated Use fetchSearchHistory */
export function loadRecentQueries(): string[] {
  return loadLocalQueries();
}

/** @deprecated Use fetchSearchHistory */
export function loadRecentSearchTracks(): RecentSearchTrack[] {
  return loadLocalTracks();
}
