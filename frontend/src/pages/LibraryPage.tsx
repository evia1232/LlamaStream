import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Import } from 'lucide-react';
import api from '../api/client';
import { Playlist } from '../types';

export default function LibraryPage() {
  const { t } = useTranslation();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [newName, setNewName] = useState('');
  const [spotifyUrl, setSpotifyUrl] = useState('');
  const [importing, setImporting] = useState(false);

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

  const importSpotify = async () => {
    if (!spotifyUrl.trim()) return;
    setImporting(true);
    try {
      await api.post('/playlists/import/spotify', { url: spotifyUrl });
      setSpotifyUrl('');
      setShowImport(false);
      fetchPlaylists();
    } catch (err) {
      console.error(err);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('library')}</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowImport(true)} className="icon-btn flex items-center gap-2 px-4">
            <Import className="w-5 h-5" />
            <span className="text-sm">{t('importSpotify')}</span>
          </button>
          <button onClick={() => setShowCreate(true)} className="icon-btn flex items-center gap-2 px-4">
            <Plus className="w-5 h-5" />
            <span className="text-sm">{t('createPlaylist')}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        <Link to="/liked" className="bg-spotify-lightgray p-4 rounded-lg card-hover">
          <div className="aspect-square rounded-md bg-gradient-to-br from-indigo-700 to-purple-300 mb-4 flex items-center justify-center">
            <span className="text-5xl">💜</span>
          </div>
          <p className="font-semibold">{t('likedSongs')}</p>
        </Link>

        {playlists.map((playlist) => (
          <Link key={playlist.id} to={`/playlist/${playlist.id}`} className="bg-spotify-lightgray p-4 rounded-lg card-hover">
            <div className="aspect-square rounded-md bg-spotify-gray mb-4 overflow-hidden">
              {playlist.coverUrl ? (
                <img src={playlist.coverUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-4xl text-spotify-text">♪</div>
              )}
            </div>
            <p className="font-semibold truncate">{playlist.name}</p>
            <p className="text-sm text-spotify-text">{t('trackCount', { count: playlist.trackCount || 0 })}</p>
          </Link>
        ))}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-spotify-gray rounded-lg p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">{t('createPlaylist')}</h3>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('name')}
              className="w-full bg-spotify-lightgray rounded-md px-4 py-3 mb-4 focus:outline-none"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-spotify-text hover:text-white">{t('cancel')}</button>
              <button onClick={createPlaylist} className="green-btn py-2 px-6">{t('save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-spotify-gray rounded-lg p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">{t('importSpotify')}</h3>
            <input
              value={spotifyUrl}
              onChange={(e) => setSpotifyUrl(e.target.value)}
              placeholder={t('spotifyUrl')}
              className="w-full bg-spotify-lightgray rounded-md px-4 py-3 mb-4 focus:outline-none"
              dir="ltr"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowImport(false)} className="px-4 py-2 text-spotify-text hover:text-white">{t('cancel')}</button>
              <button onClick={importSpotify} disabled={importing} className="green-btn py-2 px-6 disabled:opacity-50">
                {importing ? t('importing') : t('import')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
