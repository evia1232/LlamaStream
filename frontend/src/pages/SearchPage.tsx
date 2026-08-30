import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Search as SearchIcon, Download } from 'lucide-react';
import api from '../api/client';
import TrackRow from '../components/tracks/TrackRow';
import { Track } from '../types';
import { usePlayerStore } from '../store';

interface SearchResults {
  tracks: Track[];
  external: { id: string; title: string; artist: string; duration: number; thumbnailUrl: string; url: string }[];
  artists: { id: string; name: string; imageUrl?: string }[];
  albums: { id: string; title: string; coverUrl?: string; artist: { name: string } }[];
  playlists: { id: string; name: string; coverUrl?: string }[];
}

export default function SearchPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const playTrack = usePlayerStore((s) => s.playTrack);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults(null); return; }
    setLoading(true);
    try {
      const { data } = await api.get('/tracks/search', { params: { q } });
      setResults(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDownloadExternal = async (item: SearchResults['external'][0]) => {
    try {
      const { data } = await api.post('/tracks/download', { url: item.url });
      playTrack(data.track);
      search(query);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="p-6">
      <div className="relative mb-8">
        <SearchIcon className="absolute start-4 top-1/2 -translate-y-1/2 w-5 h-5 text-spotify-text" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            search(e.target.value);
          }}
          placeholder={t('searchPlaceholder')}
          className="w-full bg-white rounded-full py-3.5 ps-12 pe-4 text-black text-base focus:outline-none focus:ring-2 focus:ring-white"
          autoFocus
        />
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-spotify-green border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && results && (
        <>
          {results.tracks.length > 0 && (
            <section className="mb-8">
              <h2 className="text-xl font-bold mb-4">{t('tracks')}</h2>
              {results.tracks.map((track, i) => (
                <TrackRow key={track.id} track={track} index={i} />
              ))}
            </section>
          )}

          {results.external.length > 0 && (
            <section className="mb-8">
              <h2 className="text-xl font-bold mb-4">{t('download')}</h2>
              {results.external.map((item, i) => (
                <div key={item.id} className="flex items-center gap-4 p-3 rounded-md card-hover group">
                  <img src={item.thumbnailUrl} alt="" className="w-12 h-12 rounded object-cover" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{item.title}</p>
                    <p className="text-sm text-spotify-text truncate">{item.artist}</p>
                  </div>
                  <button
                    onClick={() => handleDownloadExternal(item)}
                    className="green-btn py-2 px-4 text-sm flex items-center gap-2 opacity-0 group-hover:opacity-100"
                  >
                    <Download className="w-4 h-4" />
                    {t('download')}
                  </button>
                </div>
              ))}
            </section>
          )}

          {results.artists.length > 0 && (
            <section className="mb-8">
              <h2 className="text-xl font-bold mb-4">{t('artists')}</h2>
              <div className="grid grid-cols-3 md:grid-cols-5 gap-4">
                {results.artists.map((artist) => (
                  <a key={artist.id} href={`/artist/${artist.id}`} className="text-center card-hover p-3 rounded-lg">
                    <div className="w-full aspect-square rounded-full bg-spotify-lightgray mb-2 overflow-hidden">
                      {artist.imageUrl && <img src={artist.imageUrl} alt="" className="w-full h-full object-cover" />}
                    </div>
                    <p className="font-semibold truncate">{artist.name}</p>
                  </a>
                ))}
              </div>
            </section>
          )}

          {results.tracks.length === 0 && results.external.length === 0 && (
            <p className="text-spotify-text text-center py-12">{t('noResults')}</p>
          )}
        </>
      )}
    </div>
  );
}
