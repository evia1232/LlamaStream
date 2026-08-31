import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { getArtistName, splitArtistNames, extractSpotifyTrackId } from '../../lib/trackUtils';
import { Track } from '../../types';

interface ArtistLinkProps {
  name: string;
  spotifyArtistId?: string | null;
  spotifyTrackId?: string | null;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}

function artistHref(name: string, opts?: { spotifyArtistId?: string | null; spotifyTrackId?: string | null }): string {
  const base = `/artist/by-name/${encodeURIComponent(name.trim())}`;
  const params = new URLSearchParams();
  if (opts?.spotifyArtistId) params.set('spotifyArtistId', opts.spotifyArtistId);
  if (opts?.spotifyTrackId) params.set('spotifyTrackId', opts.spotifyTrackId);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export default function ArtistLink({ name, spotifyArtistId, spotifyTrackId, className, onClick }: ArtistLinkProps) {
  const trimmed = name.trim();
  if (!trimmed) return null;

  return (
    <Link
      to={artistHref(trimmed, { spotifyArtistId, spotifyTrackId })}
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

function artistHintsFromTrack(track?: Track | null): { spotifyArtistId?: string; spotifyTrackId?: string } {
  if (!track) return {};
  return {
    spotifyArtistId: track.spotifyArtistId,
    spotifyTrackId: extractSpotifyTrackId(track.spotifyUrl) ?? undefined,
  };
}

/** Render one or more clickable artist names (handles comma-separated Spotify artists). */
export function ArtistLinks({
  artist,
  track,
  className,
  linkClassName,
}: {
  artist: { id?: string; name?: string } | string | null | undefined;
  track?: Track | null;
  className?: string;
  linkClassName?: string;
}) {
  const fullName = getArtistName(artist);
  if (!fullName) return null;

  const hints = artistHintsFromTrack(track);
  const parts = splitArtistNames(fullName);

  if (parts.length <= 1) {
    return (
      <span className={className}>
        <ArtistLink name={fullName} {...hints} className={linkClassName} />
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
