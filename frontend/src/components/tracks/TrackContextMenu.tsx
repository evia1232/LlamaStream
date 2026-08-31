import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  ListMusic, ListPlus, Heart, Download, Play, Trash2, MoreHorizontal,
} from 'lucide-react';
import clsx from 'clsx';
import { Track } from '../../types';

export interface TrackMenuAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface TrackContextMenuProps {
  open: boolean;
  anchorRect: DOMRect | null;
  actions: TrackMenuAction[];
  onClose: () => void;
}

export default function TrackContextMenu({ open, anchorRect, actions, onClose }: TrackContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open || !anchorRect) return null;

  const menuWidth = 220;
  const left = Math.min(anchorRect.right - menuWidth, window.innerWidth - menuWidth - 8);
  const top = Math.min(anchorRect.bottom + 4, window.innerHeight - actions.length * 44 - 16);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-[70] min-w-[220px] py-1.5 bg-[#282828] border border-white/10 rounded-lg shadow-xl animate-fade-in"
      style={{ top: Math.max(8, top), left: Math.max(8, left) }}
    >
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          role="menuitem"
          disabled={action.disabled}
          onClick={(e) => {
            e.stopPropagation();
            action.onClick();
            onClose();
          }}
          className={clsx(
            'w-full flex items-center gap-3 px-4 py-2.5 text-sm text-start hover:bg-white/10 transition-colors disabled:opacity-40',
            action.danger && 'text-red-400'
          )}
        >
          <span className="shrink-0 text-spotify-text">{action.icon}</span>
          {action.label}
        </button>
      ))}
      <span className="sr-only">{t('more')}</span>
    </div>,
    document.body
  );
}

export { ListMusic, ListPlus, Heart, Download, Play, Trash2, MoreHorizontal };
