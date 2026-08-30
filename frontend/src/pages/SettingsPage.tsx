import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { useAuthStore } from '../store';
import api from '../api/client';
import { User } from '../types';
import { Trash2, UserPlus } from 'lucide-react';

export default function SettingsPage() {
  const { t } = useTranslation();
  const { user, updateProfile } = useAuthStore();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [language, setLanguage] = useState(user?.language || 'he');
  const [audioQuality, setAudioQuality] = useState(user?.audioQuality || 'HIGH');
  const [saved, setSaved] = useState(false);

  // Admin user management
  const [users, setUsers] = useState<User[]>([]);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', username: '', password: '', role: 'USER' });

  useEffect(() => {
    if (user?.role === 'ADMIN') {
      api.get('/auth/users').then(({ data }) => setUsers(data.users)).catch(console.error);
    }
  }, [user]);

  const handleSave = async () => {
    await updateProfile({ displayName, language, audioQuality: audioQuality as 'LOW' | 'NORMAL' | 'HIGH' });
    i18n.changeLanguage(language);
    localStorage.setItem('language', language);
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'he' ? 'rtl' : 'ltr';
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

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-3xl font-bold mb-8">{t('settings')}</h1>

      {/* Profile */}
      <section className="mb-8">
        <h2 className="text-xl font-bold mb-4">{t('profile')}</h2>
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
