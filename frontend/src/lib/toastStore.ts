import { create } from 'zustand';

type ToastState = {
  message: string | null;
  show: (message: string) => void;
  clear: () => void;
};

let hideTimer: number | undefined;

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  show: (message) => {
    if (hideTimer) window.clearTimeout(hideTimer);
    set({ message });
    hideTimer = window.setTimeout(() => set({ message: null }), 2400);
  },
  clear: () => {
    if (hideTimer) window.clearTimeout(hideTimer);
    set({ message: null });
  },
}));
