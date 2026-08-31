import { create } from 'zustand';
import i18n from '../i18n';
import { Track, RepeatMode, User, QueueItem, Lyrics, PlaybackEngine } from '../types';
import api from '../api/client';
import { applyDocumentDirection } from '../lib/direction';
import {
  loadLocalPlayback,
  saveLocalPlayback,
  clearLocalPlayback,
  loadSavedVolume,
  saveVolume,
  loadAutoplayEnabled,
  saveAutoplayEnabled,
} from '../lib/playbackStorage';
import { normalizeTrack } from '../lib/trackUtils';
import { ensureTrackDownloaded, prefetchTrack, prefetchDiscoverNext, registerTrackInLibrary, isLibraryId } from '../lib/ensureDownload';
import { loadLikedIds, saveLikedIds } from '../lib/likedStorage';
import { canStreamFromSpotify, getSpotifyTrackUri } from '../lib/spotifyTrack';
import { useSpotifyPlayerStore } from './spotifyPlayerStore';
import { sendPlaybackSync } from '../lib/playbackSyncClient';
import { getDeviceId, getDeviceName } from '../lib/deviceId';

interface SyncDevice {
  deviceId: string;
  deviceName: string;
}

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
  showNowPlaying: boolean;
  lyrics: Lyrics | null;
  likedTrackIds: Set<string>;
  pendingSeekTime: number;
  playbackRestored: boolean;
  _seekFn: ((time: number) => void) | null;
  _stopFn: (() => void) | null;
  _playGeneration: number;
  localDeviceId: string;
  localDeviceName: string;
  activeDeviceId: string | null;
  activeDeviceName: string | null;
  connectedDevices: SyncDevice[];
  isRemoteActive: boolean;
  showDevicePicker: boolean;
  _syncApplying: boolean;

  setCurrentTrack: (track: Track | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setIsBuffering: (buffering: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setVolume: (volume: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setShowQueue: (show: boolean) => void;
  setShowLyrics: (show: boolean) => void;
  setShowNowPlaying: (show: boolean) => void;
  setLyrics: (lyrics: Lyrics | null) => void;
  setQueue: (queue: QueueItem[]) => void;
  addToLiked: (trackId: string) => void;
  removeFromLiked: (trackId: string) => void;
  playTrack: (track: Track, startTime?: number) => Promise<void>;
  playTracks: (tracks: Track[], startIndex?: number) => Promise<void>;
  playNext: () => void;
  playPrevious: () => void;
  contextTracks: Track[];
  contextIndex: number;
  autoplay: boolean;
  _discoverLoading: boolean;
  isPreparingPlayback: boolean;
  isBuffering: boolean;
  playbackEngine: PlaybackEngine;
  fetchQueue: () => Promise<void>;
  addToQueue: (trackId: string, playNext?: boolean, trackHint?: Track) => void;
  removeFromQueue: (itemId: string) => Promise<void>;
  clearQueue: () => Promise<void>;
  toggleLike: (trackId: string, trackHint?: Track) => void;
  fetchLyrics: (trackId: string) => Promise<void>;
  clearPendingSeek: () => void;
  registerSeek: (fn: ((time: number) => void) | null) => void;
  registerStop: (fn: (() => void) | null) => void;
  stopPlaybackImmediate: () => void;
  seekTo: (time: number) => void;
  persistPlayback: () => Promise<void>;
  persistVolume: () => Promise<void>;
  restorePlayback: () => Promise<void>;
  toggleAutoplay: () => void;
  playDiscoverNext: () => Promise<void>;
  prefetchUpcoming: () => void;
  downloadToLibrary: () => Promise<void>;
  initLocalDevice: (id: string, name: string) => void;
  setSyncDevices: (devices: SyncDevice[], activeId: string | null, activeName: string | null) => void;
  applyRemoteSync: (data: {
    track?: Track | null;
    trackId?: string;
    position?: number;
    isPlaying?: boolean;
    activeDeviceId?: string | null;
    activeDeviceName?: string | null;
  }) => Promise<void>;
  handleSyncCommand: (msg: {
    action?: string;
    fromDeviceId?: string;
    targetDeviceId?: string;
    deviceId?: string;
    seekTime?: number;
  }) => void;
  broadcastPlaybackSync: () => void;
  claimPlaybackHere: () => Promise<void>;
  sendRemoteCommand: (action: string, extra?: Record<string, unknown>) => void;
  setShowDevicePicker: (show: boolean) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: loadSavedVolume(),
  shuffle: false,
  repeat: 'off',
  queue: [],
  showQueue: false,
  showLyrics: false,
  showNowPlaying: false,
  lyrics: null,
  likedTrackIds: loadLikedIds(),
  pendingSeekTime: 0,
  playbackRestored: false,
  _seekFn: null,
  _stopFn: null,
  _playGeneration: 0,
  localDeviceId: getDeviceId(),
  localDeviceName: getDeviceName(),
  activeDeviceId: null,
  activeDeviceName: null,
  connectedDevices: [],
  isRemoteActive: false,
  showDevicePicker: false,
  _syncApplying: false,
  contextTracks: [] as Track[],
  contextIndex: -1,
  autoplay: loadAutoplayEnabled(),
  _discoverLoading: false,
  isPreparingPlayback: false,
  isBuffering: false,
  playbackEngine: 'local' as PlaybackEngine,

  setCurrentTrack: (track) => set({ currentTrack: track }),
  setIsBuffering: (buffering) => set({ isBuffering: buffering }),
  setIsPlaying: (playing) => {
    const { playbackEngine, isRemoteActive, activeDeviceId, localDeviceId } = get();
    if (isRemoteActive && activeDeviceId && activeDeviceId !== localDeviceId) {
      sendPlaybackSync({ type: 'command', action: playing ? 'play' : 'pause', targetDeviceId: activeDeviceId });
      set({ isPlaying: playing });
      return;
    }
    if (playbackEngine === 'spotify') {
      const spot = useSpotifyPlayerStore.getState();
      if (playing) void spot.resume();
      else void spot.pause();
    }
    set({ isPlaying: playing, activeDeviceId: get().localDeviceId, activeDeviceName: get().localDeviceName, isRemoteActive: false });
    get().persistPlayback();
    get().broadcastPlaybackSync();
  },
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  setVolume: (volume) => {
    const v = Math.min(1, Math.max(0, volume));
    set({ volume: v });
    saveVolume(v);
    if (get().playbackEngine === 'spotify') {
      void useSpotifyPlayerStore.getState().setVolume(v);
    }
    get().persistVolume();
  },
  toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),
  cycleRepeat: () => set((s) => ({
    repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off',
  })),
  setShowQueue: (show) => set({ showQueue: show }),
  setShowLyrics: (show) => set({ showLyrics: show }),
  setShowNowPlaying: (show) => set({ showNowPlaying: show }),
  setLyrics: (lyrics) => set({ lyrics }),
  setQueue: (queue) => set({ queue }),
  addToLiked: (trackId) => set((s) => {
    const ids = new Set(s.likedTrackIds);
    ids.add(trackId);
    saveLikedIds(ids);
    return { likedTrackIds: ids };
  }),
  removeFromLiked: (trackId) => set((s) => {
    const ids = new Set(s.likedTrackIds);
    ids.delete(trackId);
    saveLikedIds(ids);
    return { likedTrackIds: ids };
  }),

  playTrack: async (track, startTime = 0) => {
    set({
      isRemoteActive: false,
      activeDeviceId: get().localDeviceId,
      activeDeviceName: get().localDeviceName,
    });
    get().stopPlaybackImmediate();
    const generation = get()._playGeneration;

    const { contextTracks, volume } = get();
    const ctxIdx = contextTracks.findIndex((t) => t.id === track.id);
    if (ctxIdx >= 0) {
      set({ contextIndex: ctxIdx });
    }

    const user = useAuthStore.getState().user;
    const spotifyStatus = user?.spotify ?? { connected: false, premium: false };
    const spotifyUri = getSpotifyTrackUri(track);
    const useSpotify = !track.isDownloaded && canStreamFromSpotify(track, spotifyStatus) && !!spotifyUri;
    const stale = () => generation !== get()._playGeneration;

    set({
      currentTrack: track,
      isPlaying: false,
      isPreparingPlayback: !track.isDownloaded && !useSpotify,
      currentTime: startTime,
      pendingSeekTime: startTime,
      lyrics: null,
      playbackEngine: useSpotify ? 'spotify' : 'local',
    });

    // Fast path: already downloaded locally
    if (track.isDownloaded && !useSpotify) {
      if (stale()) return;
      set({
        isPlaying: true,
        isPreparingPlayback: false,
        playbackEngine: 'local',
        currentTime: startTime,
        pendingSeekTime: startTime,
      });
      saveLocalPlayback({
        trackId: track.id,
        position: startTime,
        isPlaying: true,
        volume: get().volume,
        savedAt: Date.now(),
      });
      try {
        void api.post(`/tracks/${track.id}/play`);
        if (stale()) return;
        void get().fetchLyrics(track.id);
        void get().persistPlayback();
        get().prefetchUpcoming();
        get().broadcastPlaybackSync();
      } catch { /* ignore */ }
      return;
    }

    if (useSpotify && spotifyUri) {
      set({ isPreparingPlayback: true });
      try {
        const spot = useSpotifyPlayerStore.getState();
        const ok = await spot.init(volume);
        if (stale()) return;
        if (!ok) throw new Error(spot.initError || 'Spotify player failed');
        await spot.playUri(spotifyUri, startTime * 1000);
        if (stale()) return;
        set({
          isPlaying: true,
          isPreparingPlayback: false,
          currentTime: startTime,
          duration: track.duration || 0,
        });
        get().broadcastPlaybackSync();
        return;
      } catch (err) {
        if (stale()) return;
        console.warn('Spotify playback failed, falling back to download:', err);
        set({ playbackEngine: 'local', isPreparingPlayback: true });
      }
    }

    try {
      const ready = await ensureTrackDownloaded(track);
      if (stale()) return;
      set({
        currentTrack: ready,
        isPlaying: true,
        isPreparingPlayback: false,
        playbackEngine: 'local',
        currentTime: startTime,
        pendingSeekTime: startTime,
      });
      saveLocalPlayback({
        trackId: ready.id,
        position: startTime,
        isPlaying: true,
        volume: get().volume,
        savedAt: Date.now(),
      });
      await api.post(`/tracks/${ready.id}/play`);
      if (stale()) return;
      get().fetchLyrics(ready.id);
      await get().persistPlayback();
      get().prefetchUpcoming();
      get().broadcastPlaybackSync();
    } catch {
      if (!stale()) set({ isPreparingPlayback: false, isPlaying: false });
    }
  },

  stopPlaybackImmediate: () => {
    set((s) => ({ _playGeneration: s._playGeneration + 1, isPlaying: false, isBuffering: false }));
    get()._stopFn?.();
    void useSpotifyPlayerStore.getState().pause();
  },

  downloadToLibrary: async () => {
    const { currentTrack, currentTime, playbackEngine } = get();
    if (!currentTrack || currentTrack.isDownloaded) return;

    set({ isPreparingPlayback: true });
    try {
      if (playbackEngine === 'spotify') {
        await useSpotifyPlayerStore.getState().pause();
      }
      const ready = await ensureTrackDownloaded(currentTrack);
      set({
        currentTrack: ready,
        playbackEngine: 'local',
        isPreparingPlayback: false,
        pendingSeekTime: currentTime,
      });
      await get().playTrack(ready, currentTime);
    } catch {
      set({ isPreparingPlayback: false });
    }
  },

  playTracks: async (tracks, startIndex = 0) => {
    if (tracks.length === 0) return;
    const idx = Math.min(Math.max(0, startIndex), tracks.length - 1);
    set({ contextTracks: tracks, contextIndex: idx });
    await get().playTrack(tracks[idx]);
  },

  prefetchUpcoming: () => {
    const { currentTrack, contextTracks, contextIndex, queue, shuffle, autoplay } = get();
    if (!currentTrack) return;

    for (let i = contextIndex + 1; i < contextTracks.length; i++) {
      const t = contextTracks[i];
      if (!t.isDownloaded) {
        prefetchTrack(t);
        return;
      }
    }

    if (queue.length > 0) {
      const next = shuffle ? queue[Math.floor(Math.random() * queue.length)] : queue[0];
      if (next?.track && !next.track.isDownloaded) {
        prefetchTrack(next.track);
        return;
      }
    }

    if (autoplay) {
      prefetchDiscoverNext(currentTrack.id);
    }
  },

  playNext: () => {
    const { isRemoteActive, activeDeviceId, localDeviceId } = get();
    if (isRemoteActive && activeDeviceId && activeDeviceId !== localDeviceId) {
      get().sendRemoteCommand('next');
      return;
    }

    const { queue, currentTrack, repeat, shuffle, contextTracks, contextIndex } = get();
    if (repeat === 'one' && currentTrack) {
      get().seekTo(0);
      set({ isPlaying: true });
      return;
    }

    const findNextInContext = (): Track | null => {
      if (contextTracks.length === 0 || contextIndex < 0) return null;
      const playable = (i: number) => !!contextTracks[i];

      if (shuffle) {
        const candidates = contextTracks
          .map((t, i) => ({ t, i }))
          .filter(({ t, i }) => i !== contextIndex && t);
        if (candidates.length > 0) {
          const pick = candidates[Math.floor(Math.random() * candidates.length)];
          set({ contextIndex: pick.i });
          return pick.t;
        }
      } else {
        for (let i = contextIndex + 1; i < contextTracks.length; i++) {
          if (playable(i)) {
            set({ contextIndex: i });
            return contextTracks[i];
          }
        }
        if (repeat === 'all') {
          for (let i = 0; i < contextIndex; i++) {
            if (playable(i)) {
              set({ contextIndex: i });
              return contextTracks[i];
            }
          }
        }
      }
      return null;
    };

    const nextInContext = findNextInContext();
    if (nextInContext) {
      get().playTrack(nextInContext);
      return;
    }

    if (queue.length > 0) {
      const idx = shuffle ? Math.floor(Math.random() * queue.length) : 0;
      const next = queue[idx];
      get().playTrack(next.track);
      get().removeFromQueue(next.id);
    } else if (repeat === 'all' && currentTrack) {
      get().seekTo(0);
      set({ isPlaying: true });
    } else if (get().autoplay && currentTrack) {
      void get().playDiscoverNext();
    } else {
      set({ isPlaying: false });
    }
  },

  toggleAutoplay: () => {
    const next = !get().autoplay;
    saveAutoplayEnabled(next);
    set({ autoplay: next });
  },

  playDiscoverNext: async () => {
    const { currentTrack, autoplay, _discoverLoading } = get();
    if (!autoplay || !currentTrack || _discoverLoading) {
      if (!autoplay) set({ isPlaying: false });
      return;
    }

    set({ _discoverLoading: true });
    try {
      const { data } = await api.get('/discover/next', { params: { seedTrackId: currentTrack.id } });
      if (!data.track) {
        set({ isPlaying: false });
        return;
      }

      const track = normalizeTrack(data.track);
      const upcoming = (data.upcoming || []).map((t: Track) => normalizeTrack(t));

      if (upcoming.length > 0) {
        set({ contextTracks: [track, ...upcoming], contextIndex: 0 });
      } else {
        set({ contextTracks: [track], contextIndex: 0 });
      }

      await get().playTrack(track);
    } catch {
      set({ isPlaying: false });
    } finally {
      set({ _discoverLoading: false });
    }
  },

  playPrevious: () => {
    const { isRemoteActive, activeDeviceId, localDeviceId } = get();
    if (isRemoteActive && activeDeviceId && activeDeviceId !== localDeviceId) {
      get().sendRemoteCommand('prev');
      return;
    }

    const { currentTime, currentTrack, contextTracks, contextIndex } = get();
    if (currentTime > 3) {
      get().seekTo(0);
      return;
    }
    if (contextTracks.length > 0 && contextIndex > 0) {
      for (let i = contextIndex - 1; i >= 0; i--) {
        const t = contextTracks[i];
        if (t) {
          set({ contextIndex: i });
          get().playTrack(t);
          return;
        }
      }
    }
    if (currentTrack) {
      get().seekTo(0);
      set({ isPlaying: true });
    }
  },

  fetchQueue: async () => {
    try {
      const { data } = await api.get('/queue');
      set({ queue: data.queue });
    } catch { /* ignore */ }
  },

  addToQueue: (trackId, playNext = false, trackHint) => {
    const track = trackHint ?? (get().currentTrack?.id === trackId ? get().currentTrack : null);

    const sync = async (attempt = 0): Promise<void> => {
      try {
        let id = trackId;
        if (!isLibraryId(trackId)) {
          if (!track) throw new Error('Track metadata required');
          const ready = await registerTrackInLibrary(track);
          id = ready.id;
        }
        await api.post('/queue', { trackId: id, playNext });
        get().fetchQueue();
      } catch {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          return sync(attempt + 1);
        }
      }
    };

    void sync();
  },

  removeFromQueue: async (itemId) => {
    await api.delete(`/queue/${itemId}`);
    get().fetchQueue();
  },

  clearQueue: async () => {
    await api.delete('/queue');
    set({ queue: [] });
  },

  toggleLike: (trackId, trackHint) => {
    const track = trackHint ?? (get().currentTrack?.id === trackId ? get().currentTrack : null);
    const wantLiked = !get().likedTrackIds.has(trackId);

    if (wantLiked) get().addToLiked(trackId);
    else get().removeFromLiked(trackId);

    const sync = async (attempt = 0): Promise<void> => {
      try {
        let id = trackId;
        if (!isLibraryId(trackId)) {
          if (!track) throw new Error('Track metadata required');
          const ready = await registerTrackInLibrary(track);
          id = ready.id;
          if (id !== trackId) {
            get().removeFromLiked(trackId);
            if (wantLiked) get().addToLiked(id);
            saveLikedIds(get().likedTrackIds);
          }
        } else if (track && !track.isDownloaded) {
          prefetchTrack(track);
        }
        await api.put(`/tracks/${id}/like`, { liked: wantLiked });
      } catch {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          return sync(attempt + 1);
        }
        if (wantLiked) get().removeFromLiked(trackId);
        else get().addToLiked(trackId);
        saveLikedIds(get().likedTrackIds);
      }
    };

    void sync();
  },

  fetchLyrics: async (trackId) => {
    try {
      const { data } = await api.get(`/tracks/${trackId}/lyrics`);
      set({ lyrics: data.lyrics });
    } catch {
      set({ lyrics: null });
    }
  },

  clearPendingSeek: () => set({ pendingSeekTime: 0 }),

  registerSeek: (fn) => set({ _seekFn: fn }),

  registerStop: (fn) => set({ _stopFn: fn }),

  seekTo: (time) => {
    const t = Math.max(0, time);
    const { isRemoteActive, activeDeviceId, localDeviceId } = get();
    if (isRemoteActive && activeDeviceId && activeDeviceId !== localDeviceId) {
      sendPlaybackSync({ type: 'command', action: 'seek', seekTime: t, targetDeviceId: activeDeviceId });
      set({ currentTime: t });
      return;
    }
    set({ currentTime: t, pendingSeekTime: 0 });
    if (get().playbackEngine === 'spotify') {
      void useSpotifyPlayerStore.getState().seek(t * 1000);
    } else {
      get()._seekFn?.(t);
    }
    get().persistPlayback();
    get().broadcastPlaybackSync();
  },

  initLocalDevice: (id, name) => set({ localDeviceId: id, localDeviceName: name }),

  setShowDevicePicker: (show) => set({ showDevicePicker: show }),

  setSyncDevices: (devices, activeId, activeName) => {
    const { localDeviceId } = get();
    const isRemote = !!activeId && activeId !== localDeviceId;
    set({
      connectedDevices: devices,
      activeDeviceId: activeId,
      activeDeviceName: activeName,
      isRemoteActive: isRemote,
    });
  },

  broadcastPlaybackSync: () => {
    if (get()._syncApplying) return;
    const { currentTrack, currentTime, isPlaying, volume, localDeviceId, activeDeviceId } = get();
    if (!currentTrack || (activeDeviceId && activeDeviceId !== localDeviceId)) return;
    sendPlaybackSync({
      type: 'playback',
      trackId: currentTrack.id,
      position: currentTime,
      isPlaying,
      volume,
    });
  },

  applyRemoteSync: async (data) => {
    const { localDeviceId } = get();
    const remoteId = data.activeDeviceId ?? null;
    const isRemote = !!remoteId && remoteId !== localDeviceId;

    set({
      activeDeviceId: remoteId,
      activeDeviceName: data.activeDeviceName ?? null,
      isRemoteActive: isRemote,
    });

    if (!isRemote) return;

    get()._syncApplying = true;
    get().stopPlaybackImmediate();

    let track = data.track ? normalizeTrack(data.track) : null;
    if (!track && data.trackId) {
      try {
        const { data: res } = await api.get(`/tracks/${data.trackId}`);
        track = normalizeTrack(res.track);
      } catch {
        get()._syncApplying = false;
        return;
      }
    }

    if (track) {
      set({
        currentTrack: track,
        currentTime: data.position ?? 0,
        isPlaying: !!data.isPlaying,
      });
    } else {
      set({ isPlaying: !!data.isPlaying, currentTime: data.position ?? get().currentTime });
    }

    get()._syncApplying = false;
  },

  handleSyncCommand: (msg) => {
    const { localDeviceId, activeDeviceId } = get();
    const isActive = !activeDeviceId || activeDeviceId === localDeviceId;

    if (msg.action === 'transfer') {
      if (msg.fromDeviceId && msg.fromDeviceId !== localDeviceId) {
        get().stopPlaybackImmediate();
        set({ isPlaying: false, isRemoteActive: true, activeDeviceId: msg.fromDeviceId });
      }
      return;
    }

    if (msg.targetDeviceId && msg.targetDeviceId !== localDeviceId) return;
    if (!isActive) return;

    switch (msg.action) {
      case 'pause':
        set({ isPlaying: false });
        if (get().playbackEngine === 'spotify') void useSpotifyPlayerStore.getState().pause();
        else get()._stopFn?.();
        break;
      case 'play':
        set({ isPlaying: true });
        if (get().playbackEngine === 'spotify') void useSpotifyPlayerStore.getState().resume();
        break;
      case 'seek': {
        if (msg.seekTime == null) break;
        const t = Math.max(0, msg.seekTime);
        set({ currentTime: t });
        if (get().playbackEngine === 'spotify') void useSpotifyPlayerStore.getState().seek(t * 1000);
        else get()._seekFn?.(t);
        break;
      }
      case 'next':
        get().playNext();
        break;
      case 'prev':
        get().playPrevious();
        break;
      default:
        break;
    }
  },

  sendRemoteCommand: (action, extra) => {
    sendPlaybackSync({ type: 'command', action, targetDeviceId: get().activeDeviceId, ...extra });
  },

  claimPlaybackHere: async () => {
    const { currentTrack, currentTime, localDeviceId, localDeviceName } = get();
    if (!currentTrack) return;
    set({ isRemoteActive: false, activeDeviceId: localDeviceId, activeDeviceName: localDeviceName, showDevicePicker: false });
    sendPlaybackSync({
      type: 'command',
      action: 'transfer',
      fromDeviceId: localDeviceId,
      trackId: currentTrack.id,
      position: currentTime,
      isPlaying: true,
    });
    await get().playTrack(currentTrack, currentTime);
  },

  persistVolume: async () => {
    try {
      await api.put('/tracks/playback-state', { volume: get().volume });
    } catch { /* ignore */ }
  },

  persistPlayback: async () => {
    const { currentTrack, currentTime, isPlaying, volume, localDeviceId, localDeviceName, activeDeviceId } = get();
    if (!currentTrack) return;

    saveLocalPlayback({
      trackId: currentTrack.id,
      position: currentTime,
      isPlaying,
      volume,
      savedAt: Date.now(),
    });

    try {
      await api.put('/tracks/playback-state', {
        trackId: currentTrack.id,
        position: currentTime,
        isPlaying,
        volume,
        activeDeviceId: activeDeviceId ?? localDeviceId,
        activeDeviceName: activeDeviceId === localDeviceId ? localDeviceName : get().activeDeviceName,
      });
    } catch { /* ignore */ }
  },

  restorePlayback: async () => {
    if (get().playbackRestored) return;
    set({ playbackRestored: true });

    let track: Track | null = null;
    let position = 0;
    let isPlaying = false;
    let volume = loadSavedVolume();

    try {
      const { data } = await api.get('/tracks/playback-state');
      if (typeof data.volume === 'number') {
        volume = Math.min(1, Math.max(0, data.volume));
        saveVolume(volume);
      }
      if (data.track) {
        track = data.track;
        position = data.position ?? 0;
        isPlaying = !!data.isPlaying;
      }
      if (data.activeDeviceId) {
        const isRemote = data.activeDeviceId !== get().localDeviceId;
        set({
          activeDeviceId: data.activeDeviceId,
          activeDeviceName: data.activeDeviceName ?? null,
          isRemoteActive: isRemote,
        });
        if (isRemote) isPlaying = false;
      }
    } catch { /* fall back to local */ }

    set({ volume });

    if (!track) {
      const local = loadLocalPlayback();
      if (!local) return;
      if (typeof local.volume === 'number') {
        set({ volume: Math.min(1, Math.max(0, local.volume)) });
      }
      try {
        const { data } = await api.get(`/tracks/${local.trackId}`);
        track = data.track;
        position = local.position;
        isPlaying = local.isPlaying;
      } catch {
        clearLocalPlayback();
        return;
      }
    }

    if (!track) return;

    set({
      currentTrack: normalizeTrack(track),
      currentTime: position,
      pendingSeekTime: position,
      isPlaying: false,
    });
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
      applyDocumentDirection(data.user.language);
    }
  },

  logout: () => {
    localStorage.removeItem('token');
    useSpotifyPlayerStore.getState().destroy();
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
        applyDocumentDirection(data.user.language);
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
      applyDocumentDirection(data.user.language);
    }
  },
}));
