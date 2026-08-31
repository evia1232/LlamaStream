import clsx from 'clsx';
import type { ReactNode } from 'react';

interface PlaylistCoverProps {
  coverUrl?: string | null;
  coverImages?: string[];
  className?: string;
  imageClassName?: string;
  fallback?: ReactNode;
}

function CoverImage({ src, className }: { src: string; className?: string }) {
  return <img src={src} alt="" className={clsx('w-full h-full object-cover', className)} loading="lazy" />;
}

export default function PlaylistCover({
  coverUrl,
  coverImages = [],
  className,
  imageClassName,
  fallback = <span className="text-4xl text-spotify-text">♪</span>,
}: PlaylistCoverProps) {
  if (coverUrl) {
    return (
      <div className={clsx('w-full h-full', className)}>
        <CoverImage src={coverUrl} className={imageClassName} />
      </div>
    );
  }

  const images = coverImages.filter(Boolean).slice(0, 4);
  if (images.length === 0) {
    return (
      <div className={clsx('w-full h-full flex items-center justify-center bg-spotify-gray', className)}>
        {fallback}
      </div>
    );
  }

  if (images.length === 1) {
    return (
      <div className={clsx('w-full h-full', className)}>
        <CoverImage src={images[0]} className={imageClassName} />
      </div>
    );
  }

  if (images.length === 2) {
    return (
      <div className={clsx('w-full h-full grid grid-cols-2', className)}>
        {images.map((src) => (
          <CoverImage key={src} src={src} className={imageClassName} />
        ))}
      </div>
    );
  }

  if (images.length === 3) {
    return (
      <div className={clsx('w-full h-full grid grid-cols-2 grid-rows-2', className)}>
        <div className="row-span-2 min-h-0">
          <CoverImage src={images[0]} className={imageClassName} />
        </div>
        <div className="min-h-0">
          <CoverImage src={images[1]} className={imageClassName} />
        </div>
        <div className="min-h-0">
          <CoverImage src={images[2]} className={imageClassName} />
        </div>
      </div>
    );
  }

  return (
    <div className={clsx('w-full h-full grid grid-cols-2 grid-rows-2', className)}>
      {images.map((src) => (
        <CoverImage key={src} src={src} className={imageClassName} />
      ))}
    </div>
  );
}
