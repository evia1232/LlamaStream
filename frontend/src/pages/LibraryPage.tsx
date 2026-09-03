import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Import, Camera } from 'lucide-react';
import clsx from 'clsx';
import api from '../api/client';
import { Playlist } from '../types';
import { useAuthStore } from '../store';
import PlaylistCover from '../components/playlists/PlaylistCover';
import ImportStatusPanel from '../components/playlists/ImportStatusPanel';
import SpotifyPlaylistPicker, { SpotifyConnectPrompt } from '../components/playlists/SpotifyPlaylistPicker';

type ImportTab = 'spotify' | 'url';

export default function LibraryPage() {
  const { t } = useTranslation();
  const spotifyConnected = useAuthStore((s) => s.user?.spotify?.connected ?? false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importTab, setImportTab] = useState<ImportTab>('spotify');
  const [newName, setNewName] = useState('');
  const [newCover, setNewCover] = useState<File | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const fetchPlaylists = useCallback(() => {
    api.get('/playlists').then(({ data }) => setPlaylists(data.playlists)).catch(console.error);
  }, []);

  useEffect(() => { fetchPlaylists(); }, [fetchPlaylists]);

  const openImport = (tab: ImportTab) => {
    setImportTab(tab);
    setImportMessage(null);
    setShowImport(true);
  };

  const createPlaylist = async () => {
    if (!newName.trim()) return;
    const { data } = await api.post('/playlists', { name: newName });
    const createdId = data?.playlist?.id as string | undefined;
    if (createdId && newCover) {
      const form = new FormData();
      form.append('cover', newCover);
      await api.post(`/playlists/${createdId}/cover`, form);
    }
    setNewName('');
    setNewCover(null);
    setShowCreate(false);
    fetchPlaylists();
  };

  const importPlaylist = async () => {
    if (!importUrl.trim()) return;

    const isSpotify = /open\.spotify\.com\/playlist\//i.test(importUrl.trim());
    if (isSpotify && !spotifyConnected) {
      setImportMessage(t('spotifyImportRequiresConnect'));
      return;
    }

    setImporting(true);
    setImportMessage(null);
    try {
      await api.post('/playlists/import', { url: importUrl.trim() });
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

  const handleSpotifyImported = () => {
    setShowImport(false);
    setImportMessage(t('importStarted'));
    fetchPlaylists();
  };

  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <h1 className="text-heading">{t('library')}</h1>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => openImport('spotify')}
            className="icon-btn flex items-center gap-2 px-4 border border-spotify-green/40 text-spotify-green"
          >
            <Import className="w-5 h-5" />
            <span className="text-sm font-bold">{t('importSpotify')}</span>
          </button>
          <button onClick={() => openImport('url')} className="icon-btn flex items-center gap-2 px-4 border border-white/20">
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

      <ImportStatusPanel className="mb-6" onUpdate={fetchPlaylists} />

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-5">
        <Link to="/liked" className="surface-card">
          <div className="aspect-square rounded-spotify bg-gradient-to-br from-indigo-700 to-purple-300 mb-4 flex items-center justify-center shadow-card">
            <span className="text-5xl">💜</span>
          </div>
          <p className="text-title text-start">{t('likedSongs')}</p>
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
            <p className="text-title truncate text-start">{playlist.name}</p>
            <p className="text-body mt-0.5 text-start">{t('trackCount', { count: playlist.trackCount || 0 })}</p>
          </Link>
        ))}
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="surface-elevated p-6 md:p-8 w-full max-w-md">
            <h3 className="text-heading-sm mb-5">{t('createPlaylist')}</h3>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('name')}
              className="input-spotify mb-4"
              autoFocus
            />
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              className="icon-btn w-full flex items-center justify-center gap-2 mb-5 py-2.5"
            >
              <Camera className="w-4 h-4" />
              {newCover ? newCover.name : t('coverOptional')}
            </button>
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setNewCover(e.target.files?.[0] ?? null)}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowCreate(false); setNewCover(null); }} className="px-4 py-2 text-body hover:text-white font-bold">{t('cancel')}</button>
              <button onClick={createPlaylist} className="green-btn py-2 px-6">{t('save')}</button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="surface-elevated p-6 md:p-8 w-full max-w-lg max-h-[90vh] flex flex-col">
            <h3 className="text-heading-sm mb-4">{importTab === 'spotify' ? t('importSpotify') : t('importPlaylist')}</h3>

            <div className="flex gap-1 mb-4 p-1 bg-white/5 rounded-lg">
              <button
                type="button"
                onClick={() => { setImportTab('spotify'); setImportMessage(null); }}
                className={clsx(
                  'flex-1 py-2 text-sm font-bold rounded-md transition-colors',
                  importTab === 'spotify' ? 'bg-white/10 text-white' : 'text-spotify-text hover:text-white',
                )}
              >
                {t('importFromSpotifyAccount')}
              </button>
              <button
                type="button"
                onClick={() => { setImportTab('url'); setImportMessage(null); }}
                className={clsx(
                  'flex-1 py-2 text-sm font-bold rounded-md transition-colors',
                  importTab === 'url' ? 'bg-white/10 text-white' : 'text-spotify-text hover:text-white',
                )}
              >
                {t('importFromUrl')}
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden">
              {importTab === 'spotify' ? (
                spotifyConnected ? (
                  <SpotifyPlaylistPicker
                    onImported={handleSpotifyImported}
                    onError={setImportMessage}
                  />
                ) : (
                  <SpotifyConnectPrompt />
                )
              ) : (
                <div>
                  <input
                    value={importUrl}
                    onChange={(e) => setImportUrl(e.target.value)}
                    placeholder={t('playlistImportUrl')}
                    className="input-spotify mb-4"
                    dir="ltr"
                  />
                  {importMessage && importTab === 'url' && (
                    <p className="text-sm text-red-400 mb-4">{importMessage}</p>
                  )}
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowImport(false)} className="px-4 py-2 text-body hover:text-white font-bold">{t('cancel')}</button>
                    <button onClick={importPlaylist} disabled={importing} className="green-btn py-2 px-6 disabled:opacity-50">
                      {importing ? t('importing') : t('import')}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {importTab === 'spotify' && importMessage && (
              <p className="text-sm text-red-400 mt-3">{importMessage}</p>
            )}

            {importTab === 'spotify' && (
              <div className="flex justify-end mt-4 pt-2 border-t border-white/10">
                <button onClick={() => setShowImport(false)} className="px-4 py-2 text-body hover:text-white font-bold">
                  {t('cancel')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
