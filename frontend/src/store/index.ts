import { create } from 'zustand';
import i18n from '../i18n';
import { Track, RepeatMode, User, QueueItem, Lyrics } from '../types';
import api from '../api/client';

interface PlayerState {
  currentTrack: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  queue: QueueItem[];
  showQueue: boolean;
  showLyrics: boolean;
  lyrics: Lyrics | null;
  likedTrackIds: Set<string>;

  setCurrentTrack: (track: Track | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setVolume: (volume: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setShowQueue: (show: boolean) => void;
  setShowLyrics: (show: boolean) => void;
  setLyrics: (lyrics: Lyrics | null) => void;
  setQueue: (queue: QueueItem[]) => void;
  addToLiked: (trackId: string) => void;
  removeFromLiked: (trackId: string) => void;
  playTrack: (track: Track) => Promise<void>;
  playNext: () => void;
  playPrevious: () => void;
  fetchQueue: () => Promise<void>;
  addToQueue: (trackId: string, playNext?: boolean) => Promise<void>;
  removeFromQueue: (itemId: string) => Promise<void>;
  clearQueue: () => Promise<void>;
  toggleLike: (trackId: string) => Promise<void>;
  fetchLyrics: (trackId: string) => Promise<void>;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 0.7,
  shuffle: false,
  repeat: 'off',
  queue: [],
  showQueue: false,
  showLyrics: false,
  lyrics: null,
  likedTrackIds: new Set(),

  setCurrentTrack: (track) => set({ currentTrack: track }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  setVolume: (volume) => set({ volume }),
  toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),
  cycleRepeat: () => set((s) => ({
    repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off',
  })),
  setShowQueue: (show) => set({ showQueue: show }),
  setShowLyrics: (show) => set({ showLyrics: show }),
  setLyrics: (lyrics) => set({ lyrics }),
  setQueue: (queue) => set({ queue }),
  addToLiked: (trackId) => set((s) => {
    const ids = new Set(s.likedTrackIds);
    ids.add(trackId);
    return { likedTrackIds: ids };
  }),
  removeFromLiked: (trackId) => set((s) => {
    const ids = new Set(s.likedTrackIds);
    ids.delete(trackId);
    return { likedTrackIds: ids };
  }),

  playTrack: async (track) => {
    set({ currentTrack: track, isPlaying: true, currentTime: 0, lyrics: null });
    try {
      await api.post(`/tracks/${track.id}/play`);
      get().fetchLyrics(track.id);
    } catch { /* ignore */ }
  },

  playNext: () => {
    const { queue, currentTrack, repeat, shuffle } = get();
    if (repeat === 'one' && currentTrack) {
      set({ currentTime: 0, isPlaying: true });
      return;
    }
    if (queue.length > 0) {
      const idx = shuffle ? Math.floor(Math.random() * queue.length) : 0;
      const next = queue[idx];
      get().playTrack(next.track);
      get().removeFromQueue(next.id);
    } else if (repeat === 'all' && currentTrack) {
      set({ currentTime: 0, isPlaying: true });
    } else {
      set({ isPlaying: false });
    }
  },

  playPrevious: () => {
    const { currentTime, currentTrack } = get();
    if (currentTime > 3) {
      set({ currentTime: 0 });
    } else if (currentTrack) {
      set({ currentTime: 0, isPlaying: true });
    }
  },

  fetchQueue: async () => {
    try {
      const { data } = await api.get('/queue');
      set({ queue: data.queue });
    } catch { /* ignore */ }
  },

  addToQueue: async (trackId, playNext = false) => {
    await api.post('/queue', { trackId, playNext });
    get().fetchQueue();
  },

  removeFromQueue: async (itemId) => {
    await api.delete(`/queue/${itemId}`);
    get().fetchQueue();
  },

  clearQueue: async () => {
    await api.delete('/queue');
    set({ queue: [] });
  },

  toggleLike: async (trackId) => {
    const { data } = await api.post(`/tracks/${trackId}/like`);
    if (data.liked) get().addToLiked(trackId);
    else get().removeFromLiked(trackId);
  },

  fetchLyrics: async (trackId) => {
    try {
      const { data } = await api.get(`/tracks/${trackId}/lyrics`);
      set({ lyrics: data.lyrics });
    } catch {
      set({ lyrics: null });
    }
  },
}));

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  fetchUser: () => Promise<void>;
  updateProfile: (data: Partial<User>) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('token'),
  isLoading: true,

  login: async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', data.token);
    set({ user: data.user, token: data.token });
    if (data.user.language) {
      localStorage.setItem('language', data.user.language);
      i18n.changeLanguage(data.user.language);
      document.documentElement.lang = data.user.language;
      document.documentElement.dir = data.user.language === 'he' ? 'rtl' : 'ltr';
    }
  },

  logout: () => {
    localStorage.removeItem('token');
    set({ user: null, token: null });
  },

  fetchUser: async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      set({ isLoading: false });
      return;
    }
    try {
      const { data } = await api.get('/auth/me');
      set({ user: data.user, token, isLoading: false });
      if (data.user.language) {
        document.documentElement.lang = data.user.language;
        document.documentElement.dir = data.user.language === 'he' ? 'rtl' : 'ltr';
      }
    } catch {
      localStorage.removeItem('token');
      set({ user: null, token: null, isLoading: false });
    }
  },

  updateProfile: async (profileData) => {
    const { data } = await api.put('/auth/profile', profileData);
    set({ user: data.user });
    if (data.user.language) {
      localStorage.setItem('language', data.user.language);
      document.documentElement.lang = data.user.language;
      document.documentElement.dir = data.user.language === 'he' ? 'rtl' : 'ltr';
    }
  },
}));
