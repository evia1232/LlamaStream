import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Play } from 'lucide-react';

interface CardGridProps {
  title: string;
  items: {
    id: string;
    name?: string;
    title?: string;
    coverUrl?: string | null;
    thumbnailUrl?: string | null;
    imageUrl?: string | null;
    trackCount?: number;
    artist?: string;
    type?: 'playlist' | 'artist' | 'track';
  }[];
  onPlay?: (id: string) => void;
  linkPrefix?: string;
}

export default function CardGrid({ title, items, onPlay, linkPrefix = '/playlist' }: CardGridProps) {
  if (!items.length) return null;

  return (
    <section className="mb-8">
      <h2 className="text-2xl font-bold mb-4 px-6">{title}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 px-6">
        {items.map((item) => {
          const image = item.coverUrl || item.thumbnailUrl || item.imageUrl;
          const label = item.name || item.title || '';
          const href = item.type === 'artist' ? `/artist/${item.id}` : `${linkPrefix}/${item.id}`;

          return (
            <Link
              key={item.id}
              to={href}
              className="bg-spotify-lightgray p-4 rounded-lg card-hover group relative"
            >
              <div className="relative mb-4">
                <div className={clsx(
                  'aspect-square rounded-md overflow-hidden bg-spotify-gray shadow-lg',
                  item.type === 'artist' && 'rounded-full'
                )}>
                  {image ? (
                    <img src={image} alt={label} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-4xl text-spotify-text">♪</div>
                  )}
                </div>
                {onPlay && (
                  <button
                    onClick={(e) => { e.preventDefault(); onPlay(item.id); }}
                    className="absolute bottom-2 end-2 w-12 h-12 bg-spotify-green rounded-full flex items-center justify-center shadow-xl opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all hover:scale-105 hover:bg-spotify-green-hover"
                  >
                    <Play className="w-5 h-5 fill-black text-black ms-0.5" />
                  </button>
                )}
              </div>
              <p className="font-semibold truncate">{label}</p>
              {item.artist && <p className="text-sm text-spotify-text truncate">{item.artist}</p>}
              {item.trackCount !== undefined && (
                <p className="text-sm text-spotify-text">{item.trackCount} tracks</p>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
