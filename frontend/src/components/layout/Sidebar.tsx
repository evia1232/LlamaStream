import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Home, Search, Library, Heart, Plus, Settings, LogOut, Music2,
} from 'lucide-react';
import { useAuthStore } from '../../store';
import api from '../../api/client';
import { getAppName } from '../../lib/appName';
import { Playlist } from '../../types';
import PlaylistCover from '../playlists/PlaylistCover';
import clsx from 'clsx';

export default function Sidebar() {
  const { t } = useTranslation();
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);

  useEffect(() => {
    api.get('/playlists')
      .then(({ data }) => setPlaylists(data.playlists))
      .catch(() => { /* ignore */ });
  }, []);

  const navItems = [
    { to: '/', icon: Home, label: t('home') },
    { to: '/search', icon: Search, label: t('search') },
    { to: '/library', icon: Library, label: t('library') },
  ];

  const libraryItems = [
    { to: '/liked', icon: Heart, label: t('likedSongs') },
  ];

  return (
    <aside className="hidden md:flex w-64 bg-spotify-black flex-col shrink-0 p-2 gap-2">
      {/* Logo */}
      <div className="px-4 py-5">
        <div className="flex items-center gap-2">
          <Music2 className="w-8 h-8 text-spotify-green" strokeWidth={2.5} />
          <span className="text-xl font-black tracking-tight">{getAppName()}</span>
        </div>
      </div>

      {/* Main Nav */}
      <nav className="bg-spotify-gray rounded-lg p-2">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => clsx('sidebar-link', isActive && 'active')}
          >
            <Icon className="w-6 h-6" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Library */}
      <div className="bg-spotify-gray rounded-lg p-2 flex-1 overflow-y-auto min-h-0">
        <div className="flex items-center justify-between px-3 py-2 mb-1">
          <span className="text-label">{t('library')}</span>
          <button type="button" onClick={() => navigate('/library')} className="icon-btn p-1" aria-label={t('createPlaylist')}>
            <Plus className="w-5 h-5" />
          </button>
        </div>
        {libraryItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => clsx('sidebar-link', isActive && 'active')}
          >
            <Icon className="w-6 h-6 text-spotify-green" />
            <span>{label}</span>
          </NavLink>
        ))}
        {playlists.length > 0 && (
          <ul className="mt-2 pt-2 border-t border-white/5 space-y-0.5">
            {playlists.map((pl) => (
              <li key={pl.id}>
                <NavLink
                  to={`/playlist/${pl.id}`}
                  className={({ isActive }) => clsx(
                    'flex items-center gap-3 px-3 py-2 rounded-md text-sm text-spotify-text hover:text-white hover:bg-white/10 transition-colors',
                    isActive && 'text-white bg-white/10'
                  )}
                >
                  <div className="w-8 h-8 rounded-sm overflow-hidden shrink-0 bg-spotify-lightgray shadow-sm">
                    <PlaylistCover
                      coverUrl={pl.coverUrl}
                      coverImages={pl.coverImages}
                      className="w-full h-full"
                      fallback={<span className="text-xs">♪</span>}
                    />
                  </div>
                  <span className="truncate font-medium">{pl.name}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* User */}
      <div className="bg-spotify-gray rounded-lg p-3">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 rounded-full bg-spotify-lightgray flex items-center justify-center overflow-hidden">
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-sm font-bold">{user?.username?.[0]?.toUpperCase()}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate">{user?.displayName || user?.username}</p>
            <p className="text-caption truncate">{user?.email}</p>
          </div>
        </div>
        <div className="flex gap-1">
          <NavLink to="/settings" className="icon-btn flex-1 flex justify-center">
            <Settings className="w-5 h-5" />
          </NavLink>
          <button onClick={logout} className="icon-btn flex-1 flex justify-center">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
