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
  loadCrossfadeEnabled,
  saveCrossfadeEnabled,
  loadCrossfadeDuration,
  saveCrossfadeDuration,
} from '../lib/playbackStorage';
import { normalizeTrack } from '../lib/trackUtils';
import { ensureTrackDownloaded, prepareTrackForPlayback, prefetchTrack, prefetchDiscoverNext, registerTrackInLibrary, isLibraryId, canStreamTrackLocally } from '../lib/ensureDownload';
import { loadLikedIds, saveLikedIds } from '../lib/likedStorage';
import { canStreamFromSpotify, getSpotifyTrackUri } from '../lib/spotifyTrack';
import { useSpotifyPlayerStore } from './spotifyPlayerStore';
import { effectivePlaybackVolume } from '../lib/volume';
import { getDeviceId, getDeviceName } from '../lib/deviceId';
import { sendPlaybackSync } from '../lib/playbackSyncClient';

/** In-memory lyrics by track — survives leave/return without full reload */
const lyricsSessionCache = new Map<string, Lyrics>();

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
  likedPendingTracks: Track[];
  likedListVersion: number;
  pendingSeekTime: number;
  playbackRestored: boolean;
  _seekFn: ((time: number) => void) | null;
  _pauseFn: (() => void) | null;
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
  setOffline: (offline: boolean) => void;
  setReconnecting: (reconnecting: boolean) => void;
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
  playTrack: (track: Track, startTime?: number, opts?: { seamless?: boolean }) => Promise<void>;
  playTracks: (tracks: Track[], startIndex?: number) => Promise<void>;
  playNext: (opts?: { crossfade?: boolean }) => void;
  _pendingCrossfade: boolean;
  playPrevious: () => void;
  contextTracks: Track[];
  contextIndex: number;
  autoplay: boolean;
  _discoverLoading: boolean;
  isPreparingPlayback: boolean;
  isBuffering: boolean;
  isOffline: boolean;
  isReconnecting: boolean;
  playbackEngine: PlaybackEngine;
  fetchQueue: () => Promise<void>;
  addToQueue: (trackId: string, playNext?: boolean, trackHint?: Track) => void;
  removeFromQueue: (itemId: string) => Promise<void>;
  clearQueue: () => Promise<void>;
  toggleLike: (trackId: string, trackHint?: Track) => void;
  fetchLyrics: (trackId: string) => Promise<void>;
  clearPendingSeek: () => void;
  registerSeek: (fn: ((time: number) => void) | null) => void;
  registerPause: (fn: (() => void) | null) => void;
  registerStop: (fn: (() => void) | null) => void;
  /** Imperative audio load — needed when React is frozen in background/lock screen */
  registerLoadLocalTrack: (fn: ((track: Track, startTime: number) => void) | null) => void;
  _loadLocalTrackFn: ((track: Track, startTime: number) => void) | null;
  stopPlaybackImmediate: () => void;
  beginTrackTransition: () => void;
  seekTo: (time: number) => void;
  persistPlayback: () => Promise<void>;
  persistVolume: () => Promise<void>;
  restorePlayback: () => Promise<void>;
  toggleAutoplay: () => void;
  playDiscoverNext: () => Promise<void>;
  prepareDiscoverAutoplay: () => Promise<void>;
  prefetchUpcoming: () => void;
  resolveNextTrack: () => { track: Track; contextIndex?: number; queueItemId?: string } | null;
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
  }, opts?: { assumeOnline?: boolean }) => Promise<void>;
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
  crossfadeEnabled: boolean;
  crossfadeDuration: number;
  toggleCrossfade: () => void;
  setCrossfadeDuration: (seconds: number) => void;
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
  likedPendingTracks: [],
  likedListVersion: 0,
  pendingSeekTime: 0,
  playbackRestored: false,
  _seekFn: null,
  _pauseFn: null,
  _stopFn: null,
  _loadLocalTrackFn: null,
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
  _pendingCrossfade: false,
  crossfadeEnabled: loadCrossfadeEnabled(),
  crossfadeDuration: loadCrossfadeDuration(),
  _discoverLoading: false,
  isPreparingPlayback: false,
  isBuffering: false,
  isOffline: false,
  isReconnecting: false,
  playbackEngine: 'local' as PlaybackEngine,

  setCurrentTrack: (track) => set({ currentTrack: track }),
  setIsBuffering: (buffering) => set({ isBuffering: buffering }),
  setOffline: (offline) => set({ isOffline: offline }),
  setReconnecting: (reconnecting) => set({ isReconnecting: reconnecting }),
  setIsPlaying: (playing) => {
    const { playbackEngine, isRemoteActive, activeDeviceId, localDeviceId } = get();
    if (isRemoteActive && activeDeviceId && activeDeviceId !== localDeviceId) {
      // Control the remote device — never claim this device by toggling play/pause
      sendPlaybackSync({ type: 'command', action: playing ? 'play' : 'pause', targetDeviceId: activeDeviceId });
      set({ isPlaying: playing });
      return;
    }
    if (playbackEngine === 'spotify') {
      const spot = useSpotifyPlayerStore.getState();
      if (playing) void spot.resume(get().currentTime * 1000);
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
      void useSpotifyPlayerStore.getState().setVolume(effectivePlaybackVolume(v));
    }
    get().persistVolume();
  },
  toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),
  cycleRepeat: () => set((s) => ({
    repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off',
  })),
  setShowQueue: (show) => set({ showQueue: show }),
  setShowLyrics: (show) => {
    set({ showLyrics: show });
    if (show) {
      const trackId = get().currentTrack?.id;
      if (trackId && !get().lyrics) void get().fetchLyrics(trackId);
    }
  },
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

  playTrack: async (track, startTime = 0, opts?: { seamless?: boolean }) => {
    const seamless = opts?.seamless ?? false;
    if (!seamless) set({ _pendingCrossfade: false });
    const { localDeviceId, localDeviceName } = get();
    set({
      isRemoteActive: false,
      activeDeviceId: localDeviceId,
      activeDeviceName: localDeviceName,
    });
    if (seamless) {
      get().beginTrackTransition();
    } else {
      get().stopPlaybackImmediate();
    }
    const generation = get()._playGeneration;

    const { contextTracks, volume } = get();
    const ctxIdx = contextTracks.findIndex((t) => t.id === track.id);
    if (ctxIdx >= 0) {
      set({ contextIndex: ctxIdx });
    } else {
      set({ contextTracks: [], contextIndex: -1 });
    }

    const user = useAuthStore.getState().user;
    const spotifyStatus = user?.spotify ?? { connected: false, premium: false };
    const spotifyUri = getSpotifyTrackUri(track);
    const useSpotify = !track.isDownloaded && canStreamFromSpotify(track, spotifyStatus) && !!spotifyUri;
    const canPlayLocal = canStreamTrackLocally(track);
    const stale = () => generation !== get()._playGeneration;

    const streamableTrack = canPlayLocal
      ? { ...track, streamUrl: track.streamUrl || `/api/tracks/${track.id}/stream` }
      : track;

    set({
      currentTrack: streamableTrack,
      isPlaying: seamless ? true : !useSpotify,
      isPreparingPlayback: !useSpotify && !canPlayLocal,
      isBuffering: false,
      currentTime: startTime,
      pendingSeekTime: startTime,
      // Keep cached lyrics for this track; clear only when switching songs
      lyrics: lyricsSessionCache.get(track.id) ?? null,
      playbackEngine: useSpotify ? 'spotify' : 'local',
    });
    void get().fetchLyrics(track.id);
    // Fast path: stream from cache or pipe YouTube while downloading in background
    if (canPlayLocal && !useSpotify) {
      if (stale()) return;
      set({
        duration: track.duration || get().duration,
      });
      // Load immediately — don't wait for React re-render (frozen on lock screen)
      try {
        get()._loadLocalTrackFn?.(streamableTrack, startTime);
      } catch { /* ignore */ }
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
        void get().prepareDiscoverAutoplay();
      } catch { /* ignore */ }
      return;
    }

    if (useSpotify && spotifyUri) {
      set({ isPreparingPlayback: true });
      try {
        const spot = useSpotifyPlayerStore.getState();
        const ok = await spot.init(effectivePlaybackVolume(volume));
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
        void get().fetchLyrics(track.id);
        get().broadcastPlaybackSync();
        return;
      } catch (err) {
        if (stale()) return;
        console.warn('Spotify playback failed, falling back to download:', err);
        set({ playbackEngine: 'local', isPreparingPlayback: true });
      }
    }

    try {
      set({
        isPlaying: true,
        isPreparingPlayback: true,
        playbackEngine: 'local',
      });

      const ready = await prepareTrackForPlayback(track);
      if (stale()) return;
      set({
        currentTrack: ready,
        isPlaying: true,
        isPreparingPlayback: false,
        isBuffering: false,
        playbackEngine: 'local',
        currentTime: startTime,
        pendingSeekTime: startTime,
        duration: ready.duration || track.duration || get().duration,
      });
      try {
        get()._loadLocalTrackFn?.(ready, startTime);
      } catch { /* ignore */ }
      saveLocalPlayback({
        trackId: ready.id,
        position: startTime,
        isPlaying: true,
        volume: get().volume,
        savedAt: Date.now(),
      });
      void api.post(`/tracks/${ready.id}/play`);
      if (stale()) return;
      void get().fetchLyrics(ready.id);
      void get().persistPlayback();
      get().prefetchUpcoming();
      get().broadcastPlaybackSync();
      void get().prepareDiscoverAutoplay();
    } catch {
      if (!stale()) set({ isPreparingPlayback: false, isPlaying: false, isBuffering: false });
    }
  },

  beginTrackTransition: () => {
    set((s) => ({ _playGeneration: s._playGeneration + 1, isBuffering: true }));
    // Keep current audio playing until the next track is ready — avoids background autoplay blocks.
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
    const next = get().resolveNextTrack();
    if (next && !next.track.isDownloaded) {
      prefetchTrack(next.track);
    }

    const { currentTrack, contextTracks, contextIndex, queue, shuffle, autoplay } = get();
    if (!currentTrack) return;

    // Prefetch one more track ahead
    if (next?.contextIndex !== undefined && contextTracks.length > 0) {
      for (let i = next.contextIndex + 1; i < contextTracks.length; i++) {
        const t = contextTracks[i];
        if (t && !t.isDownloaded) {
          prefetchTrack(t);
          break;
        }
      }
    } else if (queue.length > 1) {
      const second = shuffle ? queue[1] : queue[1];
      if (second?.track && !second.track.isDownloaded) prefetchTrack(second.track);
    }

    if (autoplay) {
      prefetchDiscoverNext(currentTrack.id);
    }
  },

  resolveNextTrack: () => {
    const { queue, currentTrack, repeat, shuffle, contextTracks, contextIndex } = get();
    if (!currentTrack) return null;

    if (contextTracks.length > 0 && contextIndex >= 0) {
      if (shuffle) {
        const candidates = contextTracks
          .map((t, i) => ({ t, i }))
          .filter(({ t, i }) => i !== contextIndex && t);
        if (candidates.length > 0) {
          const pick = candidates[Math.floor(Math.random() * candidates.length)];
          return { track: pick.t, contextIndex: pick.i };
        }
      } else {
        for (let i = contextIndex + 1; i < contextTracks.length; i++) {
          if (contextTracks[i]) return { track: contextTracks[i], contextIndex: i };
        }
        if (repeat === 'all') {
          for (let i = 0; i < contextIndex; i++) {
            if (contextTracks[i]) return { track: contextTracks[i], contextIndex: i };
          }
        }
      }
    }

    if (queue.length > 0) {
      const idx = shuffle ? Math.floor(Math.random() * queue.length) : 0;
      const next = queue[idx];
      if (next?.track) return { track: next.track, queueItemId: next.id };
    }

    return null;
  },

  playNext: (opts) => {
    // Never crossfade when backgrounded — timers/React freeze and playback dies mid-fade
    const backgrounded = typeof document !== 'undefined' && document.hidden;
    const wantCrossfade = !backgrounded && !!opts?.crossfade && get().crossfadeEnabled;
    set({ _pendingCrossfade: wantCrossfade });

    const { isRemoteActive, activeDeviceId, localDeviceId } = get();
    if (isRemoteActive && activeDeviceId && activeDeviceId !== localDeviceId) {
      set({ _pendingCrossfade: false });
      get().sendRemoteCommand('next');
      return;
    }

    const { currentTrack, repeat, autoplay } = get();
    if (repeat === 'one' && currentTrack) {
      set({ _pendingCrossfade: false });
      get().seekTo(0);
      set({ isPlaying: true, isBuffering: false });
      return;
    }

    const resolved = get().resolveNextTrack();

    if (resolved) {
      if (resolved.contextIndex !== undefined) {
        set({ contextIndex: resolved.contextIndex });
      }
      if (resolved.queueItemId) {
        get().removeFromQueue(resolved.queueItemId);
      }
      set({
        isPreparingPlayback: !canStreamTrackLocally(resolved.track),
        isBuffering: false,
        isPlaying: true,
        duration: resolved.track.duration || 0,
      });
      void get().playTrack(resolved.track, 0, { seamless: true });
      return;
    }

    if (repeat === 'all' && currentTrack) {
      set({ _pendingCrossfade: false });
      get().seekTo(0);
      set({ isPlaying: true, isBuffering: false });
      return;
    }

    if (autoplay && currentTrack) {
      set({ isPreparingPlayback: true, isBuffering: false, isPlaying: true });
      void get().playDiscoverNext();
      return;
    }

    set({ isPlaying: false, isBuffering: false });
  },

  toggleAutoplay: () => {
    const next = !get().autoplay;
    saveAutoplayEnabled(next);
    set({ autoplay: next });
  },

  toggleCrossfade: () => {
    const next = !get().crossfadeEnabled;
    saveCrossfadeEnabled(next);
    set({ crossfadeEnabled: next });
  },

  setCrossfadeDuration: (seconds) => {
    const clamped = Math.max(1, Math.min(12, seconds));
    saveCrossfadeDuration(clamped);
    set({ crossfadeDuration: clamped });
  },

  prepareDiscoverAutoplay: async () => {
    const { currentTrack, autoplay, queue, contextTracks, _discoverLoading } = get();
    if (!autoplay || !currentTrack || _discoverLoading) return;
    if (queue.length > 0 || contextTracks.length > 1) return;

    const artistName = typeof currentTrack.artist === 'string'
      ? currentTrack.artist
      : currentTrack.artist?.name;

    try {
      const params: Record<string, string | number> = { limit: 8 };
      if (isLibraryId(currentTrack.id)) {
        params.seedTrackId = currentTrack.id;
      } else if (currentTrack.title && artistName) {
        params.seedTitle = currentTrack.title;
        params.seedArtist = artistName;
      } else {
        return;
      }

      const { data } = await api.get('/discover/recommendations', { params });
      const recs = (data.recommendations || []).map((t: Track) => normalizeTrack(t));
      if (recs.length === 0) return;

      const { currentTrack: nowPlaying } = get();
      if (!nowPlaying || nowPlaying.id !== currentTrack.id) return;

      set({ contextTracks: [currentTrack, ...recs], contextIndex: 0 });
      for (const t of recs.slice(0, 2)) {
        if (!t.isDownloaded) prefetchTrack(t);
      }
    } catch { /* ignore */ }
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

      await get().playTrack(track, 0, { seamless: true });
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
    set({ _pendingCrossfade: false });
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

    if (wantLiked) {
      get().addToLiked(trackId);
      if (track) {
        set((s) => ({
          likedPendingTracks: [
            normalizeTrack(track),
            ...s.likedPendingTracks.filter((t) => t.id !== track.id),
          ],
          likedListVersion: s.likedListVersion + 1,
        }));
      } else {
        set((s) => ({ likedListVersion: s.likedListVersion + 1 }));
      }
    } else {
      get().removeFromLiked(trackId);
      set((s) => ({
        likedPendingTracks: s.likedPendingTracks.filter((t) => t.id !== trackId),
        likedListVersion: s.likedListVersion + 1,
      }));
    }

    let resolvedId = trackId;
    const sync = async (attempt = 0): Promise<void> => {
      try {
        let id = trackId;
        if (!isLibraryId(trackId)) {
          if (!track) throw new Error('Track metadata required');
          const ready = await registerTrackInLibrary(track);
          id = ready.id;
          resolvedId = id;
          if (id !== trackId) {
            get().removeFromLiked(trackId);
            if (wantLiked) get().addToLiked(id);
            const readyNorm = normalizeTrack(ready);
            set((s) => ({
              likedPendingTracks: wantLiked
                ? [readyNorm, ...s.likedPendingTracks.filter((t) => t.id !== trackId && t.id !== id)]
                : s.likedPendingTracks.filter((t) => t.id !== trackId && t.id !== id),
              currentTrack: s.currentTrack?.id === trackId ? readyNorm : s.currentTrack,
              likedListVersion: s.likedListVersion + 1,
            }));
          }
        } else if (track && !track.isDownloaded) {
          prefetchTrack(track);
        }
        await api.put(`/tracks/${id}/like`, { liked: wantLiked });
        set((s) => ({ likedListVersion: s.likedListVersion + 1 }));
      } catch {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          return sync(attempt + 1);
        }
        if (wantLiked) get().removeFromLiked(resolvedId);
        else get().addToLiked(resolvedId);
        set((s) => ({
          likedPendingTracks: wantLiked
            ? s.likedPendingTracks.filter((t) => t.id !== resolvedId)
            : track
              ? [normalizeTrack(track), ...s.likedPendingTracks.filter((t) => t.id !== resolvedId)]
              : s.likedPendingTracks,
          likedListVersion: s.likedListVersion + 1,
        }));
      }
    };

    void sync();
  },

  fetchLyrics: async (trackId) => {
    if (!trackId) return;
    // Serve from session cache immediately
    const cached = lyricsSessionCache.get(trackId);
    if (cached) {
      if (get().currentTrack?.id === trackId) set({ lyrics: cached });
    }
    try {
      const { data } = await api.get(`/tracks/${trackId}/lyrics`);
      // Ignore stale responses after skipping tracks
      if (get().currentTrack?.id !== trackId) return;
      if (data.lyrics) {
        lyricsSessionCache.set(trackId, data.lyrics);
        set({ lyrics: data.lyrics });
      } else if (!cached) {
        set({ lyrics: null });
      }
    } catch {
      if (get().currentTrack?.id !== trackId) return;
      // Keep previous/cached lyrics on transient errors; only clear if we never had any
      if (!cached && !get().lyrics) set({ lyrics: null });
    }
  },

  clearPendingSeek: () => set({ pendingSeekTime: 0 }),

  registerSeek: (fn) => set({ _seekFn: fn }),

  registerPause: (fn) => set({ _pauseFn: fn }),

  registerStop: (fn) => set({ _stopFn: fn }),

  registerLoadLocalTrack: (fn) => set({ _loadLocalTrackFn: fn }),

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
    const { localDeviceId, activeDeviceId: prevActive, isRemoteActive } = get();
    const activeOnline = activeId ? devices.some((d) => d.deviceId === activeId) : false;

    // Never auto-claim this device when the remote briefly drops from the list —
    // keep showing the last known remote player until the user explicitly claims.
    let effectiveActiveId = activeId;
    let effectiveActiveName = activeName;
    if (activeId && activeId !== localDeviceId && !activeOnline) {
      effectiveActiveId = prevActive && prevActive !== localDeviceId ? prevActive : activeId;
      effectiveActiveName = activeName ?? get().activeDeviceName;
    } else if (!activeId && isRemoteActive && prevActive && prevActive !== localDeviceId) {
      // Active cleared in DB but we were following remote — don't steal playback
      effectiveActiveId = prevActive;
      effectiveActiveName = get().activeDeviceName;
    }

    const isRemote = !!effectiveActiveId && effectiveActiveId !== localDeviceId;
    set({
      connectedDevices: devices,
      activeDeviceId: effectiveActiveId,
      activeDeviceName: effectiveActiveName,
      isRemoteActive: isRemote,
    });
  },

  broadcastPlaybackSync: () => {
    if (get()._syncApplying) return;
    const { currentTrack, currentTime, isPlaying, volume, localDeviceId, activeDeviceId, isRemoteActive } = get();
    // Only the active local player may broadcast — observers never claim via sync.
    if (!currentTrack || isRemoteActive || (activeDeviceId && activeDeviceId !== localDeviceId)) return;
    sendPlaybackSync({
      type: 'playback',
      trackId: currentTrack.id,
      position: currentTime,
      isPlaying,
      volume,
    });
  },

  applyRemoteSync: async (data, _opts) => {
    const { localDeviceId, currentTime: localTime, isRemoteActive: wasRemote } = get();
    const remoteId = data.activeDeviceId ?? null;

    // Another device is the player — always treat as remote observer (never auto-claim).
    if (remoteId && remoteId !== localDeviceId) {
      set({
        activeDeviceId: remoteId,
        activeDeviceName: data.activeDeviceName ?? get().activeDeviceName,
        isRemoteActive: true,
      });

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

      const serverPos = data.position ?? 0;
      const playing = !!data.isPlaying;
      // Smart progress: only snap if seek / track change / large drift; else let RAF keep counting
      const trackChanged = !!(track && get().currentTrack?.id !== track.id);
      const drift = Math.abs(serverPos - localTime);
      const shouldSnap = trackChanged || !wasRemote || drift > 1.25 || !playing;

      const nextTime = shouldSnap ? serverPos : localTime;
      const duration = track?.duration || get().duration || 0;

      if (track) {
        set({
          currentTrack: track,
          currentTime: nextTime,
          isPlaying: playing,
          duration: duration || get().duration,
        });
      } else {
        set({
          isPlaying: playing,
          ...(shouldSnap ? { currentTime: serverPos } : {}),
        });
      }

      get()._syncApplying = false;
      return;
    }

    // Server says this device is active (after explicit claim) or no active device.
    // Never auto-start local audio just because we opened the app.
    if (remoteId === localDeviceId) {
      set({
        activeDeviceId: localDeviceId,
        activeDeviceName: get().localDeviceName,
        isRemoteActive: false,
      });
    }
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
        else get()._pauseFn?.();
        break;
      case 'play':
        set({ isPlaying: true });
        if (get().playbackEngine === 'spotify') void useSpotifyPlayerStore.getState().resume(get().currentTime * 1000);
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
    set({
      isRemoteActive: false,
      activeDeviceId: localDeviceId,
      activeDeviceName: localDeviceName,
      showDevicePicker: false,
      isPlaying: true,
    });
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
        const localId = get().localDeviceId;
        const isRemote = data.activeDeviceId !== localId;
        set({
          activeDeviceId: data.activeDeviceId,
          activeDeviceName: data.activeDeviceName ?? null,
          isRemoteActive: isRemote,
        });
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

    const normalized = normalizeTrack(track);
    const cachedLyrics = lyricsSessionCache.get(normalized.id) ?? null;
    // Resume if we were playing and the user is actively returning to a warm session.
    // For cold start we still restore the track but leave play to user gesture / media session.
    const shouldResume = isPlaying && typeof document !== 'undefined' && document.visibilityState === 'visible';

    set({
      currentTrack: normalized,
      currentTime: position,
      pendingSeekTime: position,
      isPlaying: shouldResume,
      lyrics: cachedLyrics,
      playbackEngine: 'local',
    });
    void get().fetchLyrics(normalized.id);
    if (shouldResume) {
      window.setTimeout(() => {
        try {
          get()._loadLocalTrackFn?.(normalized, position);
        } catch { /* ignore */ }
      }, 50);
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
