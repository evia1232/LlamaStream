import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import i18n from '../i18n';
import { applyDocumentDirection } from '../lib/direction';
import { useAuthStore, usePlayerStore } from '../store';
import api from '../api/client';
import { User } from '../types';
import { Trash2, UserPlus, HardDrive, Infinity, Music2, Palette, LogOut, Wifi } from 'lucide-react';
import { fetchThemeSettings, updateThemePreset, type ThemePreset } from '../lib/theme';
import {
  clearAudioCache,
  getAudioCacheStats,
  isOfflineCacheEnabled,
  MAX_AUDIO_CACHE_BYTES,
  setOfflineCacheEnabled,
} from '../lib/offlineStore';

type SettingsTab = 'profile' | 'playback' | 'search' | 'storage' | 'admin';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function ToggleSwitch({
  checked,
  onToggle,
}: {
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className={clsx(
        'relative w-11 h-6 rounded-full transition-colors shrink-0',
        checked ? 'bg-spotify-green' : 'bg-spotify-gray',
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 start-0.5 w-5 h-5 bg-white rounded-full transition-transform',
          checked && 'translate-x-5 rtl:-translate-x-5',
        )}
      />
    </button>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const { user, updateProfile, logout } = useAuthStore();
  const { autoplay, toggleAutoplay, crossfadeEnabled, crossfadeDuration, toggleCrossfade, setCrossfadeDuration } = usePlayerStore();
  const isAdmin = user?.role === 'ADMIN';

  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [language, setLanguage] = useState(user?.language || 'he');
  const [audioQuality, setAudioQuality] = useState(user?.audioQuality || 'HIGH');
  const [searchSpotifyEnabled, setSearchSpotifyEnabled] = useState(user?.searchSpotifyEnabled ?? true);
  const [searchYoutubeEnabled, setSearchYoutubeEnabled] = useState(user?.searchYoutubeEnabled ?? true);
  const [saved, setSaved] = useState(false);

  const [users, setUsers] = useState<User[]>([]);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', username: '', password: '', role: 'USER' });
  const [themePreset, setThemePreset] = useState('green');
  const [themePresets, setThemePresets] = useState<ThemePreset[]>([]);
  const [themeSaving, setThemeSaving] = useState(false);
  const [themeMsg, setThemeMsg] = useState('');

  const [libraryStats, setLibraryStats] = useState<{
    downloadedCount: number;
    totalCount: number;
    totalBytes: number;
    libraryCount?: number;
    cacheCount?: number;
    libraryBytes?: number;
    cacheBytes?: number;
    cacheMaxAgeHours?: number;
  } | null>(null);
  const [cleanupDays, setCleanupDays] = useState(7);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupMsg, setCleanupMsg] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const [spotifyMsg, setSpotifyMsg] = useState('');
  const [spotifyLoading, setSpotifyLoading] = useState(false);
  const [spotifyRedirectUri, setSpotifyRedirectUri] = useState('');
  const [ytdlpStatus, setYtdlpStatus] = useState<{
    enabled: boolean;
    rotateEvery: number;
    activeProfileLabel: string;
    profileCount: number;
    profiles: { id: string; label: string; hasProxy: boolean; hasCookies: boolean }[];
  } | null>(null);
  const [ytdlpSaving, setYtdlpSaving] = useState(false);
  const [ytdlpMsg, setYtdlpMsg] = useState('');
  const [offlineCacheOn, setOfflineCacheOn] = useState(() => isOfflineCacheEnabled());
  const [localCacheStats, setLocalCacheStats] = useState<{ bytes: number; count: number }>({ bytes: 0, count: 0 });
  const [localCacheMsg, setLocalCacheMsg] = useState('');

  const tabs = useMemo(() => {
    const items: { id: SettingsTab; label: string }[] = [
      { id: 'profile', label: t('profile') },
      { id: 'playback', label: t('settingsTabPlayback') },
      { id: 'search', label: t('search') },
      { id: 'storage', label: t('settingsTabStorage') },
    ];
    if (isAdmin) items.push({ id: 'admin', label: t('admin') });
    return items;
  }, [isAdmin, t]);

  useEffect(() => {
    const status = searchParams.get('spotify');
    if (!status) return;
    if (status === 'connected') {
      setSpotifyMsg(t('spotifyConnected'));
      void useAuthStore.getState().fetchUser();
      setActiveTab('playback');
    } else if (status === 'no_premium') {
      setSpotifyMsg(t('spotifyNoPremium'));
      void useAuthStore.getState().fetchUser();
      setActiveTab('playback');
    } else if (status === 'already_linked') {
      setSpotifyMsg(t('spotifyAlreadyLinked'));
    } else if (status === 'not_allowlisted') {
      setSpotifyMsg(t('spotifyNotAllowlisted'));
    } else if (status === 'profile_failed' || status === 'token_exchange_failed') {
      setSpotifyMsg(t('spotifyConnectError'));
    } else if (status === 'error') {
      setSpotifyMsg(t('spotifyConnectError'));
    }
    searchParams.delete('spotify');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams, t]);

  const connectSpotify = async () => {
    setSpotifyLoading(true);
    try {
      const { data } = await api.get('/auth/spotify/connect');
      window.location.href = data.url;
    } catch {
      setSpotifyMsg(t('spotifyConnectError'));
      setSpotifyLoading(false);
    }
  };

  const disconnectSpotify = async () => {
    setSpotifyLoading(true);
    try {
      await api.delete('/auth/spotify/disconnect');
      await useAuthStore.getState().fetchUser();
      setSpotifyMsg(t('spotifyDisconnected'));
    } catch {
      setSpotifyMsg(t('error'));
    } finally {
      setSpotifyLoading(false);
    }
  };

  const fetchLibraryStats = () => {
    api.get('/tracks/library/stats').then(({ data }) => setLibraryStats(data)).catch(console.error);
  };

  useEffect(() => {
    fetchLibraryStats();
    api.get('/auth/spotify/status')
      .then(({ data }) => {
        if (data.redirectUri) setSpotifyRedirectUri(data.redirectUri as string);
      })
      .catch(() => { /* ignore */ });
  }, []);

  useEffect(() => {
    if (isAdmin) {
      api.get('/auth/users').then(({ data }) => setUsers(data.users)).catch(console.error);
      fetchThemeSettings()
        .then((data) => {
          setThemePreset(data.theme.preset);
          setThemePresets(data.presets);
        })
        .catch(console.error);
      api.get('/settings/ytdlp').then(({ data }) => setYtdlpStatus(data)).catch(() => setYtdlpStatus(null));
    }
  }, [isAdmin]);

  useEffect(() => {
    if (activeTab === 'storage') {
      void getAudioCacheStats().then(setLocalCacheStats);
    }
  }, [activeTab]);

  const toggleYtdlpMulti = async () => {
    if (!ytdlpStatus) return;
    setYtdlpSaving(true);
    setYtdlpMsg('');
    try {
      const { data } = await api.put('/settings/ytdlp', { multiProfile: !ytdlpStatus.enabled });
      setYtdlpStatus(data);
      setYtdlpMsg(data.enabled ? t('ytdlpMultiEnabled') : t('ytdlpMultiDisabled'));
    } catch {
      setYtdlpMsg(t('error'));
    } finally {
      setYtdlpSaving(false);
    }
  };

  const toggleOfflineCache = () => {
    const next = !offlineCacheOn;
    setOfflineCacheEnabled(next);
    setOfflineCacheOn(next);
  };

  const handleClearLocalCache = async () => {
    await clearAudioCache();
    setLocalCacheStats({ bytes: 0, count: 0 });
    setLocalCacheMsg(t('localCacheCleared'));
  };

  useEffect(() => {
    if (!user) return;
    setSearchSpotifyEnabled(user.searchSpotifyEnabled ?? true);
    setSearchYoutubeEnabled(user.searchYoutubeEnabled ?? true);
  }, [user?.searchSpotifyEnabled, user?.searchYoutubeEnabled, user]);

  const handleSave = async () => {
    await updateProfile({
      displayName,
      language,
      audioQuality: audioQuality as 'LOW' | 'NORMAL' | 'HIGH',
      searchSpotifyEnabled,
      searchYoutubeEnabled,
    });
    i18n.changeLanguage(language);
    localStorage.setItem('language', language);
    applyDocumentDirection(language);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('avatar', file);
    await api.post('/auth/avatar', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
    useAuthStore.getState().fetchUser();
  };

  const createUser = async () => {
    await api.post('/auth/users', newUser);
    setShowCreateUser(false);
    setNewUser({ email: '', username: '', password: '', role: 'USER' });
    const { data } = await api.get('/auth/users');
    setUsers(data.users);
  };

  const handleThemeChange = async (preset: string) => {
    setThemeSaving(true);
    setThemeMsg('');
    try {
      const theme = await updateThemePreset(preset);
      setThemePreset(theme.preset);
      setThemeMsg(t('themeSaved'));
    } catch {
      setThemeMsg(t('error'));
    } finally {
      setThemeSaving(false);
      setTimeout(() => setThemeMsg(''), 2500);
    }
  };

  const deleteUser = async (id: string) => {
    if (!confirm(t('confirmDelete'))) return;
    await api.delete(`/auth/users/${id}`);
    setUsers(users.filter((u) => u.id !== id));
  };

  const handleCleanup = async (mode: 'all' | 'recent') => {
    const msg = mode === 'all'
      ? t('confirmDeleteAll')
      : t('confirmDeleteRecent', { count: cleanupDays });
    if (!confirm(msg)) return;

    setCleaning(true);
    setCleanupMsg('');
    try {
      const { data } = await api.delete('/tracks/library/cleanup', {
        data: { mode, days: cleanupDays },
      });
      setCleanupMsg(t('tracksDeleted', { count: data.deleted }));
      fetchLibraryStats();
    } catch (err: unknown) {
      setCleanupMsg((err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('error'));
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      {/* Header + mobile logout shortcut */}
      <div className="flex items-start justify-between gap-3 mb-5 md:mb-6">
        <h1 className="text-heading">{t('settings')}</h1>
        <button
          type="button"
          onClick={logout}
          className="md:hidden flex items-center gap-2 shrink-0 px-3 py-2 rounded-full bg-spotify-lightgray text-spotify-text hover:text-white text-sm font-bold"
          aria-label={t('logout')}
        >
          <LogOut className="w-4 h-4" />
          {t('logout')}
        </button>
      </div>

      {/* User card — mobile */}
      <div className="md:hidden flex items-center gap-3 bg-spotify-lightgray rounded-xl p-4 mb-5">
        <div className="w-14 h-14 rounded-full bg-spotify-gray overflow-hidden shrink-0">
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xl font-bold">
              {user?.username?.[0]?.toUpperCase()}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold truncate">{user?.displayName || user?.username}</p>
          <p className="text-sm text-spotify-text truncate">{user?.email}</p>
        </div>
      </div>

      {/* Tabs — sticky on mobile */}
      <div className="sticky top-0 z-10 -mx-4 px-4 py-2 mb-5 bg-spotify-black/95 backdrop-blur-md md:static md:mx-0 md:px-0 md:py-0 md:bg-transparent md:backdrop-blur-none md:mb-8">
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'shrink-0 px-4 py-2.5 rounded-full text-sm font-bold transition-colors whitespace-nowrap',
                activeTab === tab.id
                  ? 'bg-white text-black'
                  : 'bg-spotify-lightgray text-spotify-text hover:text-white',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Profile */}
      {activeTab === 'profile' && (
        <section className="space-y-5">
          <div className="hidden md:flex items-center gap-4">
            <div className="w-20 h-20 rounded-full bg-spotify-lightgray overflow-hidden shrink-0">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-2xl font-bold">
                  {user?.username?.[0]?.toUpperCase()}
                </div>
              )}
            </div>
            <label className="green-btn py-2 px-4 text-sm cursor-pointer">
              {t('uploadAvatar')}
              <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
            </label>
          </div>

          <label className="md:hidden green-btn py-2.5 px-4 text-sm cursor-pointer inline-block">
            {t('uploadAvatar')}
            <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
          </label>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-spotify-text mb-1.5">{t('displayName')}</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="input-spotify"
              />
            </div>

            <div>
              <label className="block text-sm text-spotify-text mb-1.5">{t('language')}</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="input-spotify"
              >
                <option value="he">{t('hebrew')}</option>
                <option value="en">{t('english')}</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-spotify-text mb-1.5">{t('audioQuality')}</label>
              <select
                value={audioQuality}
                onChange={(e) => setAudioQuality(e.target.value as 'LOW' | 'NORMAL' | 'HIGH')}
                className="input-spotify"
              >
                <option value="LOW">{t('qualityLow')}</option>
                <option value="NORMAL">{t('qualityNormal')}</option>
                <option value="HIGH">{t('qualityHigh')}</option>
              </select>
            </div>

            <button onClick={handleSave} className="green-btn w-full md:w-auto">
              {saved ? t('success') : t('save')}
            </button>
          </div>

          <button
            type="button"
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 mt-4 py-3.5 rounded-xl border border-red-500/30 bg-red-900/20 text-red-300 hover:bg-red-900/40 font-bold transition-colors"
          >
            <LogOut className="w-5 h-5" />
            {t('logout')}
          </button>
        </section>
      )}

      {/* Playback */}
      {activeTab === 'playback' && (
        <section className="space-y-5">
          <div className="bg-spotify-lightgray rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Infinity className="w-5 h-5 text-spotify-green shrink-0" />
              <p className="font-bold">{t('autoplay')}</p>
            </div>
            <p className="text-sm text-spotify-text mb-4">{t('autoplayHint')}</p>
            <div className="flex items-center justify-between">
              <span className="text-sm">{t('autoplay')}</span>
              <ToggleSwitch checked={autoplay} onToggle={toggleAutoplay} />
            </div>
          </div>

          <div className="bg-spotify-lightgray rounded-xl p-4 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Music2 className="w-5 h-5 text-spotify-green shrink-0" />
              <p className="font-bold">{t('crossfade')}</p>
            </div>
            <p className="text-sm text-spotify-text">{t('crossfadeHint')}</p>
            <div className="flex items-center justify-between">
              <span className="text-sm">{t('crossfade')}</span>
              <ToggleSwitch checked={crossfadeEnabled} onToggle={toggleCrossfade} />
            </div>
            {crossfadeEnabled && (
              <div>
                <label className="block text-sm text-spotify-text mb-1.5">{t('crossfadeDuration')}</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={1}
                    max={12}
                    step={1}
                    value={crossfadeDuration}
                    onChange={(e) => setCrossfadeDuration(Number(e.target.value))}
                    className="flex-1 accent-spotify-green"
                  />
                  <span className="text-sm w-16 text-end">{t('crossfadeSeconds', { count: crossfadeDuration })}</span>
                </div>
              </div>
            )}
          </div>

          <div className="bg-spotify-lightgray rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Music2 className="w-5 h-5 text-spotify-green shrink-0" />
              <p className="font-bold">{t('spotifyAccount')}</p>
            </div>
            <p className="text-sm text-spotify-text">{t('spotifyAccountHint')}</p>
            {spotifyRedirectUri && (
              <div className="text-xs bg-spotify-gray rounded-lg p-3 space-y-1">
                <p className="text-spotify-text">{t('spotifyRedirectHint')}</p>
                <p className="font-mono text-white break-all select-all" dir="ltr">{spotifyRedirectUri}</p>
              </div>
            )}
            {user?.spotify?.connected ? (
              <div className="space-y-3">
                <p className="text-sm">
                  {user.spotify.premium ? t('spotifyPremiumActive') : t('spotifyFreeAccount')}
                </p>
                <button
                  type="button"
                  onClick={() => void disconnectSpotify()}
                  disabled={spotifyLoading}
                  className="w-full md:w-auto bg-spotify-gray hover:bg-white/10 rounded-full py-2.5 px-5 text-sm font-bold disabled:opacity-50"
                >
                  {t('spotifyDisconnect')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void connectSpotify()}
                disabled={spotifyLoading}
                className="green-btn w-full md:w-auto disabled:opacity-50"
              >
                {spotifyLoading ? t('loading') : t('spotifyConnect')}
              </button>
            )}
            {spotifyMsg && <p className="text-sm text-spotify-green">{spotifyMsg}</p>}
          </div>
        </section>
      )}

      {/* Search */}
      {activeTab === 'search' && (
        <section className="space-y-3">
          <p className="text-sm text-spotify-text mb-2">{t('searchPreferences')}</p>
          <div className="bg-spotify-lightgray rounded-xl p-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium">{t('searchSpotifyEnabled')}</p>
              <p className="text-sm text-spotify-text mt-1">{t('searchSpotifyHint')}</p>
            </div>
            <ToggleSwitch
              checked={searchSpotifyEnabled}
              onToggle={() => setSearchSpotifyEnabled((v) => !v)}
            />
          </div>
          <div className="bg-spotify-lightgray rounded-xl p-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium">{t('searchYoutubeEnabled')}</p>
              <p className="text-sm text-spotify-text mt-1">{t('searchYoutubeHint')}</p>
            </div>
            <ToggleSwitch
              checked={searchYoutubeEnabled}
              onToggle={() => setSearchYoutubeEnabled((v) => !v)}
            />
          </div>
          <button onClick={handleSave} className="green-btn w-full md:w-auto mt-2">
            {saved ? t('success') : t('save')}
          </button>
        </section>
      )}

      {/* Storage */}
      {activeTab === 'storage' && (
        <section className="space-y-4">
          <div className="bg-spotify-lightgray rounded-xl p-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium flex items-center gap-2">
                <Wifi className="w-4 h-4 text-spotify-green" />
                {t('offlineCacheTitle')}
              </p>
              <p className="text-sm text-spotify-text mt-1">{t('offlineCacheHint')}</p>
            </div>
            <ToggleSwitch checked={offlineCacheOn} onToggle={toggleOfflineCache} />
          </div>

          <div className="bg-spotify-lightgray rounded-xl p-4 space-y-2 text-sm">
            <p>{t('localAudioCache')}: <span className="text-white font-medium">{formatBytes(localCacheStats.bytes)}</span>
              <span className="text-spotify-text"> / {formatBytes(MAX_AUDIO_CACHE_BYTES)}</span>
            </p>
            <p>{t('localCachedTracks')}: <span className="text-white font-medium">{localCacheStats.count}</span></p>
            <button
              type="button"
              onClick={() => void handleClearLocalCache()}
              className="mt-2 bg-spotify-gray hover:bg-white/10 rounded-full py-2 px-4 text-sm font-bold"
            >
              {t('clearLocalCache')}
            </button>
            {localCacheMsg && <p className="text-spotify-green">{localCacheMsg}</p>}
          </div>

          {libraryStats && (
            <div className="bg-spotify-lightgray rounded-xl p-4 space-y-1 text-sm">
              <p>{t('downloadedTracks')}: <span className="text-white font-medium">{libraryStats.downloadedCount}</span></p>
              <p>{t('storageUsed')}: <span className="text-white font-medium">{formatBytes(libraryStats.totalBytes)}</span></p>
              {(libraryStats.libraryCount != null || libraryStats.cacheCount != null) && (
                <>
                  <p>{t('storagePermanent')}: <span className="text-white font-medium">{libraryStats.libraryCount ?? 0}</span>
                    {libraryStats.libraryBytes != null && (
                      <span className="text-spotify-text"> · {formatBytes(libraryStats.libraryBytes)}</span>
                    )}
                  </p>
                  <p>{t('storageTemporary')}: <span className="text-white font-medium">{libraryStats.cacheCount ?? 0}</span>
                    {libraryStats.cacheBytes != null && (
                      <span className="text-spotify-text"> · {formatBytes(libraryStats.cacheBytes)}</span>
                    )}
                  </p>
                </>
              )}
              {libraryStats.cacheMaxAgeHours != null && (
                <p className="text-spotify-text pt-1">{t('storageCacheHint', { hours: libraryStats.cacheMaxAgeHours })}</p>
              )}
            </div>
          )}

          <button
            onClick={() => handleCleanup('all')}
            disabled={cleaning}
            className="w-full flex items-center justify-center gap-2 bg-red-900/40 hover:bg-red-900/60 border border-red-500/40 text-red-300 rounded-xl py-3.5 px-4 text-sm font-bold transition-colors disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
            {t('deleteAllTracks')}
          </button>

          <div className="bg-spotify-lightgray rounded-xl p-4 space-y-3">
            <p className="text-sm text-spotify-text">{t('deleteRecentTracks')}</p>
            <div className="flex flex-wrap gap-2">
              {[1, 7, 30].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setCleanupDays(d)}
                  className={clsx(
                    'px-3 py-2 rounded-full text-sm font-bold',
                    cleanupDays === d ? 'bg-white text-black' : 'bg-spotify-gray text-spotify-text',
                  )}
                >
                  {d === 1 ? t('deleteLastDay') : t('deleteLastDays', { count: d })}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={1}
                max={365}
                value={cleanupDays}
                onChange={(e) => setCleanupDays(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-20 bg-spotify-gray rounded-lg px-3 py-2.5 text-sm focus:outline-none"
              />
              <span className="text-sm text-spotify-text">{t('days')}</span>
              <button
                onClick={() => handleCleanup('recent')}
                disabled={cleaning}
                className="ms-auto green-btn py-2.5 px-5 text-sm disabled:opacity-50"
              >
                {t('delete')}
              </button>
            </div>
          </div>

          {cleanupMsg && <p className="text-sm text-spotify-green">{cleanupMsg}</p>}
        </section>
      )}

      {/* Admin */}
      {activeTab === 'admin' && isAdmin && (
        <section className="space-y-8">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <HardDrive className="w-5 h-5 text-spotify-green" />
              <h2 className="text-lg font-bold">{t('ytdlpMultiTitle')}</h2>
            </div>
            <p className="text-body mb-4">{t('ytdlpMultiHint')}</p>
            <div className="bg-spotify-lightgray rounded-xl p-4 flex items-center justify-between gap-4 mb-3">
              <div className="min-w-0">
                <p className="font-medium">{t('ytdlpMultiToggle')}</p>
                <p className="text-sm text-spotify-text mt-1">
                  {ytdlpStatus
                    ? t('ytdlpMultiStatus', {
                        count: ytdlpStatus.profileCount,
                        every: ytdlpStatus.rotateEvery,
                        active: ytdlpStatus.activeProfileLabel,
                      })
                    : t('ytdlpMultiUnavailable')}
                </p>
              </div>
              <ToggleSwitch
                checked={!!ytdlpStatus?.enabled}
                onToggle={() => { if (!ytdlpSaving) void toggleYtdlpMulti(); }}
              />
            </div>
            {ytdlpStatus && ytdlpStatus.profiles.length > 0 && (
              <ul className="space-y-2 text-sm">
                {ytdlpStatus.profiles.map((p) => (
                  <li key={p.id} className="bg-spotify-gray rounded-lg px-3 py-2 flex justify-between gap-2">
                    <span className="font-medium truncate">{p.label}</span>
                    <span className="text-spotify-text shrink-0">
                      {p.hasProxy ? 'proxy' : '—'} · {p.hasCookies ? 'cookies' : 'no cookies'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {ytdlpMsg && <p className="text-sm text-spotify-green mt-3">{ytdlpMsg}</p>}
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3">
              <Palette className="w-5 h-5 text-spotify-green" />
              <h2 className="text-lg font-bold">{t('platformTheme')}</h2>
            </div>
            <p className="text-body mb-4">{t('platformThemeHint')}</p>
            <div className="grid grid-cols-2 gap-3">
              {themePresets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={themeSaving}
                  onClick={() => void handleThemeChange(p.id)}
                  className={clsx(
                    'flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-start',
                    themePreset === p.id
                      ? 'border-spotify-green bg-spotify-lightgray'
                      : 'border-transparent bg-spotify-gray hover:bg-spotify-lightgray',
                  )}
                >
                  <span
                    className="w-8 h-8 rounded-full shrink-0 shadow-card"
                    style={{ background: `linear-gradient(135deg, ${p.accent}, ${p.accentHover})` }}
                  />
                  <span className="text-sm font-bold truncate">{t(`theme_${p.id}`, p.label)}</span>
                </button>
              ))}
            </div>
            {themeMsg && <p className="text-sm text-spotify-green mt-3">{themeMsg}</p>}
          </div>

          <div>
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-spotify-green" />
                <h2 className="text-lg font-bold">{t('adminPanel')}</h2>
              </div>
              <button onClick={() => setShowCreateUser(true)} className="green-btn py-2 px-4 text-sm flex items-center gap-2 shrink-0">
                <UserPlus className="w-4 h-4" />
                <span className="hidden sm:inline">{t('createUser')}</span>
              </button>
            </div>

            <div className="space-y-2">
              {users.map((u) => (
                <div key={u.id} className="flex items-center gap-3 bg-spotify-lightgray rounded-xl p-3 md:p-4">
                  <div className="w-10 h-10 rounded-full bg-spotify-gray flex items-center justify-center font-bold shrink-0">
                    {u.username[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{u.displayName || u.username}</p>
                    <p className="text-sm text-spotify-text truncate">{u.email}</p>
                    <p className="text-2xs text-spotify-text mt-0.5">
                      {t('userStorageUsed')}: {formatBytes(u.storageBytes ?? 0)}
                    </p>
                  </div>
                  <span className={clsx(
                    'text-xs px-2 py-1 rounded-full shrink-0',
                    u.role === 'ADMIN' ? 'bg-spotify-green text-black' : 'bg-spotify-gray text-spotify-text',
                  )}>
                    {u.role === 'ADMIN' ? t('admin') : t('user')}
                  </span>
                  {u.id !== user?.id && (
                    <button onClick={() => deleteUser(u.id)} className="icon-btn text-red-400 shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {showCreateUser && (
            <div className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
              <div className="bg-spotify-gray rounded-t-2xl sm:rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
                <h3 className="text-xl font-bold mb-4">{t('createUser')}</h3>
                <div className="space-y-3">
                  <input
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    placeholder={t('email')}
                    className="input-spotify"
                    dir="ltr"
                  />
                  <input
                    value={newUser.username}
                    onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                    placeholder={t('username')}
                    className="input-spotify"
                  />
                  <input
                    type="password"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    placeholder={t('password')}
                    className="input-spotify"
                  />
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                    className="input-spotify"
                  >
                    <option value="USER">{t('user')}</option>
                    <option value="ADMIN">{t('admin')}</option>
                  </select>
                </div>
                <div className="flex gap-2 justify-end mt-4">
                  <button onClick={() => setShowCreateUser(false)} className="px-4 py-2 text-spotify-text font-bold">{t('cancel')}</button>
                  <button onClick={createUser} className="green-btn py-2 px-6">{t('createUser')}</button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
