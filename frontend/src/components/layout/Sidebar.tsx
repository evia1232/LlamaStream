import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Home, Search, Library, Heart, Plus, Settings, LogOut, Music2,
} from 'lucide-react';
import { useAuthStore } from '../../store';
import clsx from 'clsx';

export default function Sidebar() {
  const { t } = useTranslation();
  const { user, logout } = useAuthStore();

  const navItems = [
    { to: '/', icon: Home, label: t('home') },
    { to: '/search', icon: Search, label: t('search') },
    { to: '/library', icon: Library, label: t('library') },
  ];

  const libraryItems = [
    { to: '/liked', icon: Heart, label: t('likedSongs') },
  ];

  return (
    <aside className="w-64 bg-spotify-black flex flex-col shrink-0 p-2 gap-2">
      {/* Logo */}
      <div className="px-3 py-4">
        <div className="flex items-center gap-2">
          <Music2 className="w-8 h-8 text-spotify-green" />
          <span className="text-xl font-bold text-white">{t('appName')}</span>
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
      <div className="bg-spotify-gray rounded-lg p-2 flex-1 overflow-y-auto">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-sm font-semibold text-spotify-text">{t('library')}</span>
          <button className="icon-btn p-1">
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
            <p className="text-sm font-semibold truncate">{user?.displayName || user?.username}</p>
            <p className="text-xs text-spotify-text truncate">{user?.email}</p>
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
