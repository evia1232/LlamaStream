import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Music2, Search } from 'lucide-react';
import clsx from 'clsx';
import api from '../../api/client';

export interface SpotifyLibraryPlaylist {
  id: string;
  name: string;
  description: string;
  trackCount: number;
  imageUrl: string;
  ownerName: string;
  isPublic: boolean;
  spotifyUrl: string;
}

interface SpotifyPlaylistPickerProps {
  onImported: () => void;
  onError: (message: string) => void;
}

export default function SpotifyPlaylistPicker({ onImported, onError }: SpotifyPlaylistPickerProps) {
  const { t } = useTranslation();
  const [playlists, setPlaylists] = useState<SpotifyLibraryPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  const loadPlaylists = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<{ playlists: SpotifyLibraryPlaylist[] }>('/playlists/spotify/library');
      setPlaylists(data.playlists);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        || t('error');
      onError(msg);
    } finally {
      setLoading(false);
    }
  }, [onError, t]);

  useEffect(() => { void loadPlaylists(); }, [loadPlaylists]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return playlists;
    return playlists.filter(
      (p) => p.name.toLowerCase().includes(q) || p.ownerName.toLowerCase().includes(q),
    );
  }, [playlists, query]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const importSelected = async () => {
    if (selected.size === 0) return;
    setImporting(true);
    try {
      await api.post('/playlists/import/spotify/selected', {
        playlistIds: Array.from(selected),
      });
      setSelected(new Set());
      onImported();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        || t('error');
      onError(msg);
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-spotify-text gap-3">
        <Loader2 className="w-8 h-8 animate-spin" />
        <p className="text-sm">{t('spotifyPlaylistsLoading')}</p>
      </div>
    );
  }

  if (playlists.length === 0) {
    return (
      <p className="text-sm text-spotify-text py-6 text-center">{t('spotifyPlaylistsEmpty')}</p>
    );
  }

  return (
    <div className="flex flex-col gap-4 min-h-0">
      <p className="text-sm text-spotify-text">{t('spotifyPlaylistsSelect')}</p>

      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-spotify-text" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('spotifyPlaylistsSearch')}
          className="input-spotify ps-10"
        />
      </div>

      <div className="max-h-[min(50vh,360px)] overflow-y-auto space-y-1 -mx-1 px-1">
        {filtered.map((playlist) => {
          const isSelected = selected.has(playlist.id);
          return (
            <button
              key={playlist.id}
              type="button"
              onClick={() => toggle(playlist.id)}
              className={clsx(
                'w-full flex items-center gap-3 p-2 rounded-lg text-start transition-colors',
                isSelected ? 'bg-spotify-green/20 ring-1 ring-spotify-green/50' : 'hover:bg-white/5',
              )}
            >
              <div className="w-12 h-12 rounded bg-spotify-gray shrink-0 overflow-hidden flex items-center justify-center">
                {playlist.imageUrl ? (
                  <img src={playlist.imageUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Music2 className="w-5 h-5 text-spotify-text" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate">{playlist.name}</p>
                <p className="text-xs text-spotify-text truncate">
                  {t('trackCount', { count: playlist.trackCount })}
                  {!playlist.isPublic && ` · ${t('private')}`}
                </p>
              </div>
              <div className={clsx(
                'w-6 h-6 rounded-full border flex items-center justify-center shrink-0',
                isSelected ? 'bg-spotify-green border-spotify-green' : 'border-white/30',
              )}>
                {isSelected && <Check className="w-4 h-4 text-black" />}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/10">
        <span className="text-xs text-spotify-text">
          {t('spotifyPlaylistsSelected', { count: selected.size })}
        </span>
        <button
          type="button"
          onClick={() => void importSelected()}
          disabled={importing || selected.size === 0}
          className="green-btn py-2 px-5 disabled:opacity-50"
        >
          {importing ? t('importing') : t('import')}
        </button>
      </div>
    </div>
  );
}

export function SpotifyConnectPrompt() {
  const { t } = useTranslation();
  return (
    <div className="py-6 text-center space-y-4">
      <Music2 className="w-12 h-12 mx-auto text-spotify-text" />
      <p className="text-sm text-spotify-text">{t('spotifyConnectToImport')}</p>
      <Link to="/settings" className="green-btn inline-block py-2 px-6">
        {t('spotifyConnect')}
      </Link>
    </div>
  );
}
