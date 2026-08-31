import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, Check } from 'lucide-react';
import api from '../../api/client';
import { Playlist, Track } from '../../types';
import PlaylistCover from '../playlists/PlaylistCover';
import { registerTrackInLibrary, prefetchTrack } from '../../lib/ensureDownload';

interface AddToPlaylistModalProps {
  track: Track;
  open: boolean;
  onClose: () => void;
}

export default function AddToPlaylistModal({ track, open, onClose }: AddToPlaylistModalProps) {
  const { t } = useTranslation();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError('');
    setAddedIds(new Set());
    api.get('/playlists')
      .then(({ data }) => setPlaylists(data.playlists))
      .catch(() => setError(t('error')))
      .finally(() => setLoading(false));
  }, [open, t]);

  const handleAdd = (playlistId: string) => {
    if (addedIds.has(playlistId)) return;
    setAddedIds((prev) => new Set(prev).add(playlistId));
    setError('');

    const sync = async (attempt = 0): Promise<void> => {
      try {
        const ready = await registerTrackInLibrary(track);
        await api.post(`/playlists/${playlistId}/tracks`, { trackId: ready.id });
        prefetchTrack(ready);
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 409) return;
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          return sync(attempt + 1);
        }
        setAddedIds((prev) => {
          const next = new Set(prev);
          next.delete(playlistId);
          return next;
        });
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setError(msg || t('error'));
      }
    };

    void sync();
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setError('');
    try {
      const { data } = await api.post('/playlists', { name: newName.trim() });
      const playlist = data.playlist as Playlist;
      setPlaylists((prev) => [playlist, ...prev]);
      setNewName('');
      setShowCreate(false);
      handleAdd(playlist.id);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('error'));
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center">
      <button type="button" className="absolute inset-0 bg-black/70" onClick={onClose} aria-label={t('close')} />
      <div className="relative w-full sm:max-w-md bg-spotify-lightgray rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[80vh] flex flex-col animate-slide-up">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div className="min-w-0 pe-4">
            <h2 className="text-heading-sm">{t('addToPlaylist')}</h2>
            <p className="text-body text-sm truncate">{track.title}</p>
          </div>
          <button type="button" onClick={onClose} className="icon-btn shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-3">
          {error && (
            <p className="text-red-400 text-sm px-2 py-2 mb-2">{error}</p>
          )}

          {showCreate ? (
            <div className="flex gap-2 px-2 mb-3">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('name')}
                className="flex-1 bg-spotify-gray rounded-full px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-spotify-green"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
              <button type="button" onClick={handleCreate} className="green-btn py-2 px-4 text-sm">
                {t('save')}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className="icon-btn px-3">
                {t('cancel')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/10 text-start mb-2"
            >
              <div className="w-12 h-12 rounded bg-spotify-gray flex items-center justify-center shrink-0">
                <Plus className="w-6 h-6" />
              </div>
              <span className="font-medium">{t('createPlaylist')}</span>
            </button>
          )}

          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-2 border-spotify-green border-t-transparent rounded-full animate-spin" />
            </div>
          ) : playlists.length === 0 ? (
            <p className="text-spotify-text text-sm text-center py-6">{t('noPlaylists')}</p>
          ) : (
            <ul className="space-y-1">
              {playlists.map((pl) => {
                const added = addedIds.has(pl.id);
                return (
                  <li key={pl.id}>
                    <button
                      type="button"
                      onClick={() => !added && handleAdd(pl.id)}
                      disabled={added}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10 text-start disabled:opacity-70"
                    >
                      <div className="w-12 h-12 rounded bg-spotify-gray overflow-hidden shrink-0">
                        <PlaylistCover
                          coverUrl={pl.coverUrl}
                          coverImages={pl.coverImages}
                          className="w-full h-full"
                          fallback={<span className="text-xl">♪</span>}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{pl.name}</p>
                        <p className="text-caption">{t('trackCount', { count: pl.trackCount || 0 })}</p>
                      </div>
                      {added && (
                        <Check className="w-5 h-5 text-spotify-green shrink-0" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
