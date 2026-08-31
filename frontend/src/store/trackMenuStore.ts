import { create } from 'zustand';
import { Track } from '../types';

export interface TrackMenuOptions {
  playlistId?: string;
  onDeleted?: () => void;
  onRefresh?: () => void;
  external?: {
    url?: string;
    album?: string;
  };
}

interface TrackMenuState {
  track: Track | null;
  options: TrackMenuOptions;
  menuOpen: boolean;
  menuPos: { x: number; y: number } | null;
  playlistModalOpen: boolean;
  openMenu: (track: Track, x: number, y: number, options?: TrackMenuOptions) => void;
  openMenuFromElement: (track: Track, el: HTMLElement, options?: TrackMenuOptions) => void;
  closeMenu: () => void;
  openPlaylistModal: () => void;
  closePlaylistModal: () => void;
  openPlaylistForTrack: (track: Track, options?: TrackMenuOptions) => void;
}

export const useTrackMenuStore = create<TrackMenuState>((set) => ({
  track: null,
  options: {},
  menuOpen: false,
  menuPos: null,
  playlistModalOpen: false,

  openMenu: (track, x, y, options = {}) => {
    set({ track, options, menuOpen: true, menuPos: { x, y } });
  },

  openMenuFromElement: (track, el, options = {}) => {
    const rect = el.getBoundingClientRect();
    set({
      track,
      options,
      menuOpen: true,
      menuPos: { x: Math.min(rect.right - 240, window.innerWidth - 248), y: rect.bottom + 4 },
    });
  },

  closeMenu: () => set({ menuOpen: false }),

  openPlaylistModal: () => set({ playlistModalOpen: true, menuOpen: false }),

  closePlaylistModal: () => set({ playlistModalOpen: false }),

  openPlaylistForTrack: (track, options = {}) => {
    set({ track, options, playlistModalOpen: true, menuOpen: false });
  },
}));

/** Open track context menu at cursor — use on any song surface */
export function openTrackContextMenu(
  e: React.MouseEvent,
  track: Track,
  options?: TrackMenuOptions
) {
  e.preventDefault();
  e.stopPropagation();
  useTrackMenuStore.getState().openMenu(track, e.clientX, e.clientY, options);
}
