import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Music2 } from 'lucide-react';
import { useAuthStore } from '../store';
import { getAppName } from '../lib/appName';

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

  const appName = getAppName();

  return (
    <div className="min-h-screen bg-spotify-black flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-10">
          <Music2 className="w-12 h-12 text-spotify-green" strokeWidth={2.5} />
          <h1 className="text-4xl font-black tracking-tight">{appName}</h1>
        </div>

        <div className="surface-elevated p-8 md:p-10">
          <h2 className="text-heading-sm mb-2">{t('loginTitle', { appName })}</h2>
          <p className="text-body mb-8">{t('loginSubtitle')}</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-bold mb-2">{t('email')}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="input-spotify"
                placeholder="admin@llamastream.local"
              />
            </div>
            <div>
              <label className="block text-sm font-bold mb-2">{t('password')}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="input-spotify"
              />
            </div>

            {error && <p className="text-red-400 text-sm font-medium">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full green-btn py-3.5 text-base disabled:opacity-50 mt-2"
            >
              {loading ? t('loading') : t('login')}
            </button>
          </form>

          <p className="text-caption text-center mt-8">{t('publicRegDisabled')}</p>
        </div>
      </div>
    </div>
  );
}
