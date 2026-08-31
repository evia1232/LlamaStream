import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Home, Search, Library, Settings } from 'lucide-react';
import clsx from 'clsx';

export default function MobileNav() {
  const { t } = useTranslation();

  const items = [
    { to: '/', icon: Home, label: t('home') },
    { to: '/search', icon: Search, label: t('search') },
    { to: '/library', icon: Library, label: t('library') },
    { to: '/settings', icon: Settings, label: t('settings') },
  ];

  return (
    <nav className="md:hidden shrink-0 bg-spotify-black border-t border-white/10 pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-stretch h-14">
        {items.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              clsx(
                'flex-1 flex flex-col items-center justify-center gap-1 text-2xs font-bold transition-colors',
                isActive ? 'text-white' : 'text-spotify-text'
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={clsx('w-6 h-6', isActive && 'fill-current')} strokeWidth={isActive ? 2.5 : 2} />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
