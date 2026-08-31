import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { getArtistName, splitArtistNames } from '../../lib/trackUtils';

interface ArtistLinkProps {
  name: string;
  id?: string | null;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}

function artistHref(name: string): string {
  return `/artist/by-name/${encodeURIComponent(name.trim())}`;
}

export default function ArtistLink({ name, id: _id, className, onClick }: ArtistLinkProps) {
  const trimmed = name.trim();
  if (!trimmed) return null;

  return (
    <Link
      to={artistHref(trimmed)}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      className={clsx('hover:underline hover:text-white transition-colors', className)}
    >
      {trimmed}
    </Link>
  );
}

/** Render one or more clickable artist names (handles comma-separated Spotify artists). */
export function ArtistLinks({
  artist,
  className,
  linkClassName,
}: {
  artist: { id?: string; name?: string } | string | null | undefined;
  className?: string;
  linkClassName?: string;
}) {
  const fullName = getArtistName(artist);
  if (!fullName) return null;

  const id = typeof artist === 'object' && artist?.id ? artist.id : undefined;
  const parts = splitArtistNames(fullName);

  if (parts.length <= 1) {
    return (
      <span className={className}>
        <ArtistLink name={fullName} id={id} className={linkClassName} />
      </span>
    );
  }

  return (
    <span className={className}>
      {parts.map((part, i) => (
        <Fragment key={`${part}-${i}`}>
          {i > 0 && <span className="text-inherit">, </span>}
          <ArtistLink name={part} className={linkClassName} />
        </Fragment>
      ))}
    </span>
  );
}
