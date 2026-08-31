import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { applyDocumentDirection } from '../lib/direction';
import { useAuthStore, usePlayerStore } from '../store';
import api from '../api/client';
import { User } from '../types';
import { Trash2, UserPlus, HardDrive, Infinity, Music2 } from 'lucide-react';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const { user, updateProfile } = useAuthStore();
  const { autoplay, toggleAutoplay } = usePlayerStore();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [language, setLanguage] = useState(user?.language || 'he');
  const [audioQuality, setAudioQuality] = useState(user?.audioQuality || 'HIGH');
  const [searchSpotifyEnabled, setSearchSpotifyEnabled] = useState(user?.searchSpotifyEnabled ?? true);
  const [searchYoutubeEnabled, setSearchYoutubeEnabled] = useState(user?.searchYoutubeEnabled ?? true);
  const [saved, setSaved] = useState(false);

  // Admin user management
  const [users, setUsers] = useState<User[]>([]);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', username: '', password: '', role: 'USER' });

  const [libraryStats, setLibraryStats] = useState<{ downloadedCount: number; totalCount: number; totalBytes: number } | null>(null);
  const [cleanupDays, setCleanupDays] = useState(7);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupMsg, setCleanupMsg] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const [spotifyMsg, setSpotifyMsg] = useState('');
  const [spotifyLoading, setSpotifyLoading] = useState(false);
  const [spotifyRedirectUri, setSpotifyRedirectUri] = useState('');

  useEffect(() => {
    const status = searchParams.get('spotify');
    if (!status) return;
    if (status === 'connected') {
      setSpotifyMsg(t('spotifyConnected'));
      void useAuthStore.getState().fetchUser();
    } else if (status === 'no_premium') {
      setSpotifyMsg(t('spotifyNoPremium'));
      void useAuthStore.getState().fetchUser();
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
    if (user?.role === 'ADMIN') {
      api.get('/auth/users').then(({ data }) => setUsers(data.users)).catch(console.error);
    }
  }, [user]);

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
    <div className="p-4 md:p-8 max-w-2xl">
      <h1 className="text-heading mb-8 md:mb-10">{t('settings')}</h1>

      {/* Profile */}
      <section className="mb-10">
        <h2 className="text-heading-sm mb-5">{t('profile')}</h2>
        <div className="flex items-center gap-4 mb-4">
          <div className="w-20 h-20 rounded-full bg-spotify-lightgray overflow-hidden">
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

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-spotify-text mb-1">{t('displayName')}</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full bg-spotify-lightgray rounded-md px-4 py-3 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm text-spotify-text mb-1">{t('language')}</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full bg-spotify-lightgray rounded-md px-4 py-3 focus:outline-none"
            >
              <option value="he">{t('hebrew')}</option>
              <option value="en">{t('english')}</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-spotify-text mb-1">{t('audioQuality')}</label>
            <select
              value={audioQuality}
              onChange={(e) => setAudioQuality(e.target.value as 'LOW' | 'NORMAL' | 'HIGH')}
              className="w-full bg-spotify-lightgray rounded-md px-4 py-3 focus:outline-none"
            >
              <option value="LOW">{t('qualityLow')}</option>
              <option value="NORMAL">{t('qualityNormal')}</option>
              <option value="HIGH">{t('qualityHigh')}</option>
            </select>
          </div>

          <button onClick={handleSave} className="green-btn">
            {saved ? t('success') : t('save')}
          </button>
        </div>
      </section>

      {/* Search preferences */}
      <section className="mb-10">
        <h2 className="text-heading-sm mb-5">{t('searchPreferences')}</h2>
        <div className="space-y-3">
          <label className="flex items-center justify-between bg-spotify-lightgray rounded-lg p-4 cursor-pointer">
            <div>
              <p className="font-medium">{t('searchSpotifyEnabled')}</p>
              <p className="text-sm text-spotify-text mt-1">{t('searchSpotifyHint')}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={searchSpotifyEnabled}
              onClick={() => setSearchSpotifyEnabled((v) => !v)}
              className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${searchSpotifyEnabled ? 'bg-spotify-green' : 'bg-spotify-gray'}`}
            >
              <span
                className={`absolute top-0.5 start-0.5 w-5 h-5 bg-white rounded-full transition-transform ${searchSpotifyEnabled ? 'translate-x-5' : ''}`}
              />
            </button>
          </label>
          <label className="flex items-center justify-between bg-spotify-lightgray rounded-lg p-4 cursor-pointer">
            <div>
              <p className="font-medium">{t('searchYoutubeEnabled')}</p>
              <p className="text-sm text-spotify-text mt-1">{t('searchYoutubeHint')}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={searchYoutubeEnabled}
              onClick={() => setSearchYoutubeEnabled((v) => !v)}
              className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${searchYoutubeEnabled ? 'bg-spotify-green' : 'bg-spotify-gray'}`}
            >
              <span
                className={`absolute top-0.5 start-0.5 w-5 h-5 bg-white rounded-full transition-transform ${searchYoutubeEnabled ? 'translate-x-5' : ''}`}
              />
            </button>
          </label>
        </div>
      </section>

      {/* Spotify Premium streaming */}
      <section className="mb-10">
        <h2 className="text-heading-sm mb-5 flex items-center gap-2">
          <Music2 className="w-5 h-5 text-spotify-green" />
          {t('spotifyAccount')}
        </h2>
        <div className="bg-spotify-lightgray rounded-lg p-4 space-y-3">
          <p className="text-sm text-spotify-text">{t('spotifyAccountHint')}</p>
          {spotifyRedirectUri && (
            <div className="text-xs bg-spotify-gray rounded-md p-3 space-y-1">
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
                className="bg-spotify-gray hover:bg-white/10 rounded-full py-2 px-5 text-sm disabled:opacity-50"
              >
                {t('spotifyDisconnect')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void connectSpotify()}
              disabled={spotifyLoading}
              className="green-btn disabled:opacity-50"
            >
              {spotifyLoading ? t('loading') : t('spotifyConnect')}
            </button>
          )}
          {spotifyMsg && <p className="text-sm text-spotify-green">{spotifyMsg}</p>}
        </div>
      </section>

      {/* Playback */}
      <section className="mb-10">
        <h2 className="text-heading-sm mb-5 flex items-center gap-2">
          <Infinity className="w-5 h-5 text-spotify-green" />
          {t('autoplay')}
        </h2>
        <label className="flex items-center justify-between bg-spotify-lightgray rounded-lg p-4 cursor-pointer">
          <div>
            <p className="font-medium">{t('autoplay')}</p>
            <p className="text-sm text-spotify-text mt-1">{t('autoplayHint')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoplay}
            onClick={toggleAutoplay}
            className={`relative w-11 h-6 rounded-full transition-colors ${autoplay ? 'bg-spotify-green' : 'bg-spotify-gray'}`}
          >
            <span
              className={`absolute top-0.5 start-0.5 w-5 h-5 bg-white rounded-full transition-transform ${autoplay ? 'translate-x-5' : ''}`}
            />
          </button>
        </label>
      </section>

      {/* Library management */}
      <section className="mb-10">
        <h2 className="text-heading-sm mb-5 flex items-center gap-2">
          <HardDrive className="w-5 h-5 text-spotify-green" />
          {t('libraryManagement')}
        </h2>

        {libraryStats && (
          <div className="bg-spotify-lightgray rounded-lg p-4 mb-4 space-y-1 text-sm">
            <p>{t('downloadedTracks')}: <span className="text-white font-medium">{libraryStats.downloadedCount}</span></p>
            <p>{t('storageUsed')}: <span className="text-white font-medium">{formatBytes(libraryStats.totalBytes)}</span></p>
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={() => handleCleanup('all')}
            disabled={cleaning}
            className="w-full flex items-center justify-center gap-2 bg-red-900/40 hover:bg-red-900/60 border border-red-500/40 text-red-300 rounded-lg py-3 px-4 text-sm font-medium transition-colors disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
            {t('deleteAllTracks')}
          </button>

          <div className="bg-spotify-lightgray rounded-lg p-4 space-y-3">
            <p className="text-sm text-spotify-text">{t('deleteRecentTracks')}</p>
            <div className="flex flex-wrap gap-2">
              {[1, 7, 30].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setCleanupDays(d)}
                  className={`px-3 py-1.5 rounded-full text-sm ${cleanupDays === d ? 'bg-white text-black font-bold' : 'bg-spotify-gray text-spotify-text'}`}
                >
                  {d === 1 ? t('deleteLastDay') : t('deleteLastDays', { count: d })}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={365}
                value={cleanupDays}
                onChange={(e) => setCleanupDays(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-20 bg-spotify-gray rounded-md px-3 py-2 text-sm focus:outline-none"
              />
              <span className="text-sm text-spotify-text">{t('days')}</span>
              <button
                onClick={() => handleCleanup('recent')}
                disabled={cleaning}
                className="ms-auto green-btn py-2 px-4 text-sm disabled:opacity-50"
              >
                {t('delete')}
              </button>
            </div>
          </div>

          {cleanupMsg && (
            <p className="text-sm text-spotify-green">{cleanupMsg}</p>
          )}
        </div>
      </section>

      {/* Admin Panel */}
      {user?.role === 'ADMIN' && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">{t('adminPanel')}</h2>
            <button onClick={() => setShowCreateUser(true)} className="green-btn py-2 px-4 text-sm flex items-center gap-2">
              <UserPlus className="w-4 h-4" />
              {t('createUser')}
            </button>
          </div>

          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.id} className="flex items-center gap-4 bg-spotify-lightgray rounded-md p-4">
                <div className="w-10 h-10 rounded-full bg-spotify-gray flex items-center justify-center font-bold">
                  {u.username[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{u.displayName || u.username}</p>
                  <p className="text-sm text-spotify-text truncate">{u.email}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${u.role === 'ADMIN' ? 'bg-spotify-green text-black' : 'bg-spotify-gray text-spotify-text'}`}>
                  {u.role === 'ADMIN' ? t('admin') : t('user')}
                </span>
                {u.id !== user.id && (
                  <button onClick={() => deleteUser(u.id)} className="icon-btn text-red-400">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {showCreateUser && (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
              <div className="bg-spotify-gray rounded-lg p-6 w-full max-w-md">
                <h3 className="text-xl font-bold mb-4">{t('createUser')}</h3>
                <div className="space-y-3">
                  <input
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    placeholder={t('email')}
                    className="w-full bg-spotify-lightgray rounded-md px-4 py-3 focus:outline-none"
                    dir="ltr"
                  />
                  <input
                    value={newUser.username}
                    onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                    placeholder={t('username')}
                    className="w-full bg-spotify-lightgray rounded-md px-4 py-3 focus:outline-none"
                  />
                  <input
                    type="password"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    placeholder={t('password')}
                    className="w-full bg-spotify-lightgray rounded-md px-4 py-3 focus:outline-none"
                  />
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                    className="w-full bg-spotify-lightgray rounded-md px-4 py-3 focus:outline-none"
                  >
                    <option value="USER">{t('user')}</option>
                    <option value="ADMIN">{t('admin')}</option>
                  </select>
                </div>
                <div className="flex gap-2 justify-end mt-4">
                  <button onClick={() => setShowCreateUser(false)} className="px-4 py-2 text-spotify-text">{t('cancel')}</button>
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
