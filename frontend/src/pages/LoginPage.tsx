import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Music2 } from 'lucide-react';
import { useAuthStore } from '../store';

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-spotify-black flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <Music2 className="w-12 h-12 text-spotify-green" />
          <h1 className="text-4xl font-bold">{t('appName')}</h1>
        </div>

        <div className="bg-spotify-gray rounded-lg p-8">
          <h2 className="text-2xl font-bold mb-2">{t('loginTitle')}</h2>
          <p className="text-spotify-text mb-6">{t('loginSubtitle')}</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">{t('email')}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-spotify-lightgray border border-transparent rounded-md px-4 py-3 text-white focus:outline-none focus:border-white"
                placeholder="admin@llamastream.local"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('password')}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-spotify-lightgray border border-transparent rounded-md px-4 py-3 text-white focus:outline-none focus:border-white"
              />
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full green-btn py-4 disabled:opacity-50"
            >
              {loading ? t('loading') : t('login')}
            </button>
          </form>

          <p className="text-spotify-text text-xs text-center mt-6">{t('publicRegDisabled')}</p>
        </div>
      </div>
    </div>
  );
}
