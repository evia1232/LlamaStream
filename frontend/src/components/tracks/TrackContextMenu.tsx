import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';

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
  position: { x: number; y: number } | null;
  actions: TrackMenuAction[];
  onClose: () => void;
}

export default function TrackContextMenu({ open, position, actions, onClose }: TrackContextMenuProps) {
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
    const onScroll = () => onClose();
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open, onClose]);

  if (!open || !position) return null;

  const menuWidth = 240;
  const menuHeight = actions.length * 44 + 12;
  const left = Math.min(position.x, window.innerWidth - menuWidth - 8);
  const top = Math.min(position.y, window.innerHeight - menuHeight - 8);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-[70] min-w-[240px] py-1.5 bg-[#282828] border border-white/10 rounded-lg shadow-xl animate-fade-in"
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
