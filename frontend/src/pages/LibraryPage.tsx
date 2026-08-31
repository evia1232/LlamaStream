import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Import } from 'lucide-react';
import api from '../api/client';
import { Playlist } from '../types';
import PlaylistCover from '../components/playlists/PlaylistCover';

export default function LibraryPage() {
  const { t } = useTranslation();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [newName, setNewName] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const fetchPlaylists = () => {
    api.get('/playlists').then(({ data }) => setPlaylists(data.playlists)).catch(console.error);
  };

  useEffect(() => { fetchPlaylists(); }, []);

  const createPlaylist = async () => {
    if (!newName.trim()) return;
    await api.post('/playlists', { name: newName });
    setNewName('');
    setShowCreate(false);
    fetchPlaylists();
  };

  const importPlaylist = async () => {
    if (!importUrl.trim()) return;
    setImporting(true);
    setImportMessage(null);
    try {
      const { data } = await api.post('/playlists/import', { url: importUrl.trim() });
      setImportUrl('');
      setShowImport(false);
      setImportMessage(t('importStarted'));
      fetchPlaylists();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('error');
      setImportMessage(msg);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <h1 className="text-heading">{t('library')}</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowImport(true)} className="icon-btn flex items-center gap-2 px-4 border border-white/20">
            <Import className="w-5 h-5" />
            <span className="text-sm font-bold">{t('importPlaylist')}</span>
          </button>
          <button onClick={() => setShowCreate(true)} className="green-btn flex items-center gap-2 py-2.5">
            <Plus className="w-5 h-5" />
            <span>{t('createPlaylist')}</span>
          </button>
        </div>
      </div>

      {importMessage && (
        <p className="mb-4 text-sm text-spotify-text">{importMessage}</p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-5">
        <Link to="/liked" className="surface-card">
          <div className="aspect-square rounded-spotify bg-gradient-to-br from-indigo-700 to-purple-300 mb-4 flex items-center justify-center shadow-card">
            <span className="text-5xl">💜</span>
          </div>
          <p className="text-title">{t('likedSongs')}</p>
        </Link>

        {playlists.map((playlist) => (
          <Link key={playlist.id} to={`/playlist/${playlist.id}`} className="surface-card">
            <div className="aspect-square rounded-spotify bg-spotify-gray mb-4 overflow-hidden shadow-card">
              <PlaylistCover
                coverUrl={playlist.coverUrl}
                coverImages={playlist.coverImages}
                className="w-full h-full"
              />
            </div>
            <p className="text-title truncate">{playlist.name}</p>
            <p className="text-body mt-0.5">{t('trackCount', { count: playlist.trackCount || 0 })}</p>
          </Link>
        ))}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="surface-elevated p-6 md:p-8 w-full max-w-md">
            <h3 className="text-heading-sm mb-5">{t('createPlaylist')}</h3>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('name')}
              className="input-spotify mb-5"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-body hover:text-white font-bold">{t('cancel')}</button>
              <button onClick={createPlaylist} className="green-btn py-2 px-6">{t('save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="surface-elevated p-6 md:p-8 w-full max-w-md">
            <h3 className="text-heading-sm mb-5">{t('importPlaylist')}</h3>
            <input
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder={t('playlistImportUrl')}
              className="input-spotify mb-5"
              dir="ltr"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowImport(false)} className="px-4 py-2 text-body hover:text-white font-bold">{t('cancel')}</button>
              <button onClick={importPlaylist} disabled={importing} className="green-btn py-2 px-6 disabled:opacity-50">
                {importing ? t('importing') : t('import')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
