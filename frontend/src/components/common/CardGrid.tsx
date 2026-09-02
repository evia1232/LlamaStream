import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Play } from 'lucide-react';
import PlaylistCover from '../playlists/PlaylistCover';

interface CardGridProps {
  title: string;
  items: {
    id: string;
    name?: string;
    title?: string;
    coverUrl?: string | null;
    coverImages?: string[];
    thumbnailUrl?: string | null;
    imageUrl?: string | null;
    trackCount?: number;
    artist?: string;
    spotifyArtistId?: string | null;
    type?: 'playlist' | 'artist' | 'track';
  }[];
  onPlay?: (id: string) => void;
  linkPrefix?: string;
}

export default function CardGrid({ title, items, onPlay, linkPrefix = '/playlist' }: CardGridProps) {
  if (!items.length) return null;

  return (
    <section className="mb-10">
      <h2 className="text-heading mb-5 px-4 md:px-6">{title}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-5 px-4 md:px-6">
        {items.map((item) => {
          const image = item.type === 'playlist' ? null : (item.coverUrl || item.thumbnailUrl || item.imageUrl);
          const label = item.name || item.title || '';
          const href = item.type === 'artist'
            ? (() => {
                const base = `/artist/by-name/${encodeURIComponent(label)}`;
                if (item.spotifyArtistId) return `${base}?spotifyArtistId=${encodeURIComponent(item.spotifyArtistId)}`;
                if (item.id && !item.id.startsWith('spotify-artist-')) return `/artist/${item.id}`;
                return base;
              })()
            : `${linkPrefix}/${item.id}`;

          return (
            <Link
              key={item.id}
              to={href}
              className="surface-card group relative"
            >
              <div className="relative mb-4">
                <div className={clsx(
                  'aspect-square rounded-spotify overflow-hidden bg-spotify-gray shadow-card',
                  item.type === 'artist' && 'rounded-full'
                )}>
                  {item.type === 'playlist' ? (
                    <PlaylistCover
                      coverUrl={item.coverUrl}
                      coverImages={item.coverImages}
                      className="w-full h-full"
                    />
                  ) : image ? (
                    <img src={image} alt={label} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-4xl text-spotify-text">♪</div>
                  )}
                </div>
                {onPlay && (
                  <button
                    onClick={(e) => { e.preventDefault(); onPlay(item.id); }}
                    className="absolute bottom-2 end-2 w-12 h-12 bg-spotify-green rounded-full flex items-center justify-center shadow-play-btn opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-300 hover:scale-105 hover:bg-spotify-green-hover"
                  >
                    <Play className="w-5 h-5 fill-black text-black play-icon-nudge" strokeWidth={0} />
                  </button>
                )}
              </div>
              <p className="text-title truncate mb-0.5 text-start">{label}</p>
              {item.artist && <p className="text-body truncate text-start">{item.artist}</p>}
              {item.trackCount !== undefined && (
                <p className="text-caption mt-1">{item.trackCount} tracks</p>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
