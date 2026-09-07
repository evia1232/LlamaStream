import { useTranslation } from 'react-i18next';
import {
  ChevronDown, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  Heart, Mic2, ListMusic, ListPlus, MoreHorizontal, RefreshCw, X,
} from 'lucide-react';
import clsx from 'clsx';
import { useRef, useState, useCallback, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { usePlayerStore } from '../../store';
import { getArtistName, getTrackImageUrl, isTrackLiked, normalizeTrack } from '../../lib/trackUtils';
import { ArtistLinks } from '../artists/ArtistLink';
import CachedImage from '../ui/CachedImage';
import { progressGradient } from '../../lib/direction';
import { DevicePickerButton } from './DevicePicker';
import PlaybackMeta from './PlaybackMeta';
import AddToPlaylistModal from '../tracks/AddToPlaylistModal';
import TrackContextMenu, { TrackMenuAction } from '../tracks/TrackContextMenu';
import { useActiveLyric } from '../../hooks/useActiveLyric';
import api from '../../api/client';
import { Track } from '../../types';

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function PlayIcon({ className }: { className?: string }) {
  return <Play className={clsx(className, 'play-icon-nudge')} />;
}

function LiveLyricsColumn({ className }: { className?: string }) {
  const { t } = useTranslation();
  const activeLineRef = useRef<HTMLDivElement>(null);
  const lastActiveRef = useRef(-2);
  const { lines, activeIndex, hasSynced, plainContent } = useActiveLyric(true);

  useEffect(() => {
    if (activeIndex === lastActiveRef.current) return;
    lastActiveRef.current = activeIndex;
    if (activeIndex < 0) return;
    activeLineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIndex]);

  if (hasSynced) {
    return (
      <div className={clsx('overflow-y-auto scrollbar-spotify px-2', className)}>
        <div className="py-[28%] space-y-1">
          {lines.map((line, i) => (
            <div
              key={`${line.time}-${i}`}
              ref={i === activeIndex ? activeLineRef : undefined}
              className={clsx('lyrics-line text-xl md:text-2xl', i === activeIndex && 'active')}
            >
              {line.text || ' '}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (plainContent) {
    return (
      <pre className={clsx('whitespace-pre-wrap text-base text-white/80 overflow-y-auto px-2 py-8', className)}>
        {plainContent}
      </pre>
    );
  }

  return (
    <p className={clsx('text-spotify-text text-sm px-2 py-8', className)}>{t('noLyrics')}</p>
  );
}

export default function NowPlayingSheet() {
  const { t } = useTranslation();

  const {
    currentTrack, showNowPlaying, setShowNowPlaying,
    isPlaying, currentTime, duration,
    shuffle, repeat, likedTrackIds, likedPendingTracks,
    setIsPlaying, toggleShuffle, cycleRepeat,
    playNext, playPrevious, toggleLike, setShowQueue, setShowLyrics, seekTo,
    addToQueue, isPreparingPlayback, isBuffering, isRemoteActive, activeDeviceName,
    queue, contextTracks, contextIndex, playTrack, fetchLyrics, setCurrentTrack,
  } = usePlayerStore();

  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [related, setRelated] = useState<Track[]>([]);
  const [artistCard, setArtistCard] = useState<{
    id?: string;
    name: string;
    imageUrl?: string | null;
    bio?: string | null;
    genres?: string[];
    followers?: number;
    spotifyArtistId?: string | null;
  } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const menuAnchorRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const location = useLocation();

  const { activeText, hasSynced } = useActiveLyric(!!showNowPlaying && !!currentTrack);

  useEffect(() => {
    if (showNowPlaying) setShowNowPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on route change
  }, [location.pathname, location.search]);

  useEffect(() => {
    const el = sheetRef.current;
    if (!el || !showNowPlaying) return;

    let startY = 0;
    let startScrollTop = 0;
    let fromHeader = false;
    let active = false;
    let currentDrag = 0;

    const canStart = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      if (target.closest('input[type="range"]')) return false;
      return true;
    };

    const onStart = (e: TouchEvent) => {
      if (!canStart(e.target)) return;
      fromHeader = !!(e.target as Element).closest('[data-np-header]');
      startScrollTop = scrollRef.current?.scrollTop ?? 0;
      startY = e.touches[0].clientY;
      active = true;
      currentDrag = 0;
    };

    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const delta = e.touches[0].clientY - startY;
      if (!fromHeader && startScrollTop > 0) return;
      if (!fromHeader && scrollRef.current && scrollRef.current.scrollTop > 0) return;
      if (delta <= 0) return;
      currentDrag = delta;
      setDragY(delta);
      e.preventDefault();
    };

    const onEnd = () => {
      if (!active) return;
      active = false;
      if (currentDrag > 100) setShowNowPlaying(false);
      currentDrag = 0;
      setDragY(0);
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [showNowPlaying, setShowNowPlaying]);

  useEffect(() => {
    if (!showNowPlaying || !currentTrack?.id) {
      setRelated([]);
      setArtistCard(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await api.get('/discover/recommendations', {
          params: {
            seedTrackId: currentTrack.id.startsWith('external-') ? undefined : currentTrack.id,
            seedTitle: currentTrack.title,
            seedArtist: getArtistName(currentTrack.artist),
            limit: 6,
          },
          timeout: 15000,
        });
        if (cancelled) return;
        const tracks = (data.recommendations || data.tracks || []) as Track[];
        setRelated(tracks.map((tr) => normalizeTrack(tr)).filter((tr) => tr.id !== currentTrack.id).slice(0, 8));
      } catch {
        if (!cancelled) setRelated([]);
      }

      try {
        const name = getArtistName(currentTrack.artist);
        const spotifyId = currentTrack.spotifyArtistId;
        const { data } = await api.get(`/home/artists/by-name/${encodeURIComponent(name)}`, {
          params: spotifyId ? { spotifyArtistId: spotifyId } : undefined,
        });
        if (cancelled) return;
        setArtistCard({
          id: data.artist?.id,
          name: data.artist?.name || name,
          imageUrl: data.artist?.imageUrl,
          bio: data.artist?.bio || null,
          genres: data.spotify?.artist?.genres || [],
          followers: data.spotify?.artist?.followers,
          spotifyArtistId: data.artist?.spotifyArtistId || data.spotify?.artist?.id,
        });
      } catch {
        if (!cancelled) {
          setArtistCard({ name: getArtistName(currentTrack.artist), imageUrl: null, bio: null });
        }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [showNowPlaying, currentTrack?.id, currentTrack?.title, currentTrack?.artist, currentTrack?.spotifyArtistId]);

  const openMenu = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = menuAnchorRef.current?.getBoundingClientRect();
    if (rect) setMenuPos({ x: rect.right - 240, y: rect.bottom + 4 });
    setMenuOpen(true);
  }, []);

  const handleRetryDownload = async (research = false) => {
    if (!currentTrack || currentTrack.id.startsWith('external-') || retrying) return;
    setRetrying(true);
    try {
      const { data } = await api.post(`/tracks/${currentTrack.id}/retry-download`, { research });
      const updated = normalizeTrack(data.track);
      setCurrentTrack(updated);
      await playTrack(updated);
    } catch (err: unknown) {
      alert((err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('error'));
    } finally {
      setRetrying(false);
    }
  };

  if (!showNowPlaying || !currentTrack) return null;

  const artistName = getArtistName(currentTrack.artist);
  const imageUrl = getTrackImageUrl(currentTrack);
  const isLiked = isTrackLiked(currentTrack, likedTrackIds, likedPendingTracks);
  const showPreparing = isPreparingPlayback || isBuffering;
  const preparingHint = isBuffering && !isPreparingPlayback
    ? t('switchingTrack')
    : isPreparingPlayback && isBuffering
      ? t('preparingPlayback')
      : null;

  const upcoming = (() => {
    if (contextTracks.length > 0 && contextIndex >= 0) {
      return contextTracks.slice(contextIndex + 1, contextIndex + 6);
    }
    return queue.slice(0, 5).map((q) => q.track).filter(Boolean) as Track[];
  })();

  const transportControls = (
    <>
      <button type="button" onClick={toggleShuffle} className={clsx('icon-btn p-3', shuffle && 'text-spotify-green')}>
        <Shuffle className="w-6 h-6" />
      </button>
      <button type="button" onClick={() => playPrevious()} className="icon-btn p-3" aria-label={t('previous')}>
        <SkipBack className="w-8 h-8 fill-current" />
      </button>
      <button
        type="button"
        onClick={() => !showPreparing && setIsPlaying(!isPlaying)}
        disabled={showPreparing}
        className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-play-btn active:scale-95 transition-transform disabled:opacity-60"
        aria-label={isPlaying ? t('pause') : t('play')}
      >
        {showPreparing ? (
          <div className="w-7 h-7 border-2 border-black/30 border-t-black rounded-full animate-spin" />
        ) : isPlaying ? (
          <Pause className="w-7 h-7 text-black fill-black" />
        ) : (
          <PlayIcon className="w-7 h-7 text-black fill-black" />
        )}
      </button>
      <button type="button" onClick={() => playNext()} className="icon-btn p-3" aria-label={t('next')}>
        <SkipForward className="w-8 h-8 fill-current" />
      </button>
      <button type="button" onClick={cycleRepeat} className={clsx('icon-btn p-3', repeat !== 'off' && 'text-spotify-green')}>
        {repeat === 'one' ? <Repeat1 className="w-6 h-6" /> : <Repeat className="w-6 h-6" />}
      </button>
    </>
  );

  const progressBlock = (
    <div dir="ltr" className="player-slider-row px-1 mb-2">
      <input
        type="range"
        min={0}
        max={duration || currentTrack?.duration || 0}
        value={currentTime}
        onChange={(e) => seekTo(parseFloat(e.target.value))}
        disabled={showPreparing}
        className="player-progress w-full h-1 mb-2 disabled:opacity-50"
        style={{ background: progressGradient((currentTime / ((duration || currentTrack?.duration || 1))) * 100) }}
      />
      <div className="flex justify-between text-caption tabular-nums">
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration || currentTrack?.duration || 0)}</span>
      </div>
    </div>
  );

  const menuActions: TrackMenuAction[] = [
    {
      id: 'addToPlaylist',
      label: t('addToPlaylist'),
      icon: <ListPlus className="w-4 h-4" />,
      onClick: () => setShowPlaylistModal(true),
    },
    {
      id: 'addToQueue',
      label: t('addToQueue'),
      icon: <ListMusic className="w-4 h-4" />,
      onClick: () => { void addToQueue(currentTrack.id); },
    },
    {
      id: 'retryDownload',
      label: retrying ? t('retryingDownload') : t('retryDownload'),
      icon: <RefreshCw className={clsx('w-4 h-4', retrying && 'animate-spin')} />,
      onClick: () => { void handleRetryDownload(false); },
      disabled: retrying || currentTrack.id.startsWith('external-'),
    },
    {
      id: 'research',
      label: t('researchTrack'),
      icon: <RefreshCw className="w-4 h-4" />,
      onClick: () => { void handleRetryDownload(true); },
      disabled: retrying || currentTrack.id.startsWith('external-'),
    },
    {
      id: 'refreshLyrics',
      label: t('refreshLyrics'),
      icon: <Mic2 className="w-4 h-4" />,
      onClick: () => { void fetchLyrics(currentTrack.id, true); },
    },
  ];

  const belowFold = (
    <>
      <section className="mt-4 mb-8">
        <h3 className="text-sm font-bold mb-3">{t('relatedTracks')}</h3>
        {related.length === 0 ? (
          <p className="text-caption">{t('noRelatedYet')}</p>
        ) : (
          <div className="space-y-1">
            {related.map((tr) => (
              <button
                key={tr.id}
                type="button"
                onClick={() => void playTrack(tr)}
                className="w-full flex items-center gap-3 p-2 rounded-md hover:bg-white/5 text-start"
              >
                <div className="w-14 h-14 rounded overflow-hidden bg-spotify-lightgray shrink-0">
                  <CachedImage src={getTrackImageUrl(tr)} className="w-full h-full object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{tr.title}</p>
                  <p className="text-caption truncate">{getArtistName(tr.artist)}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {artistCard && (
        <section className="mb-8">
          <h3 className="text-sm font-bold mb-3">{t('aboutArtist')}</h3>
          <Link
            to={`/artist/by-name/${encodeURIComponent(artistCard.name)}${artistCard.spotifyArtistId ? `?spotifyArtistId=${encodeURIComponent(artistCard.spotifyArtistId)}` : ''}`}
            onClick={() => setShowNowPlaying(false)}
            className="flex gap-4 p-4 rounded-lg bg-white/[0.06] hover:bg-white/10 transition-colors"
          >
            <div className="w-24 h-24 rounded-full overflow-hidden bg-spotify-lightgray shrink-0">
              {artistCard.imageUrl ? (
                <CachedImage src={artistCard.imageUrl} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-spotify-text">
                  {artistCard.name.slice(0, 1)}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 text-start">
              <p className="text-xs uppercase tracking-wider text-spotify-text mb-1">{t('artist')}</p>
              <p className="text-xl font-bold truncate">{artistCard.name}</p>
              {!!artistCard.followers && (
                <p className="text-caption mt-1">{artistCard.followers.toLocaleString()} {t('followersLabel')}</p>
              )}
              {!!artistCard.genres?.length && (
                <p className="text-caption mt-1 truncate">{artistCard.genres.slice(0, 3).join(' · ')}</p>
              )}
              {artistCard.bio && (
                <p className="text-sm text-spotify-text mt-2 line-clamp-3">{artistCard.bio}</p>
              )}
            </div>
          </Link>
        </section>
      )}

      <section className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold">{t('upNext')}</h3>
          <button type="button" onClick={() => setShowQueue(true)} className="text-caption text-spotify-green">
            {t('showQueue')}
          </button>
        </div>
        {upcoming.length === 0 ? (
          <p className="text-caption">{t('queueEmpty')}</p>
        ) : (
          <div className="space-y-1">
            {upcoming.map((tr) => (
              <button
                key={tr.id}
                type="button"
                onClick={() => void playTrack(tr)}
                className="w-full flex items-center gap-3 p-2 rounded-md hover:bg-white/5 text-start"
              >
                <div className="w-14 h-14 rounded overflow-hidden bg-spotify-lightgray shrink-0">
                  <CachedImage src={getTrackImageUrl(tr)} className="w-full h-full object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{tr.title}</p>
                  <p className="text-caption truncate">{getArtistName(tr.artist)}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );

  const titleBlock = (
    <div className="text-start mb-6 px-1">
      {hasSynced && (
        <p
          className={clsx(
            'min-h-[1.5rem] mb-3 text-[15px] md:text-base font-bold text-white tracking-wide leading-snug truncate transition-opacity duration-500',
            activeText ? 'opacity-100' : 'opacity-0',
          )}
          dir="auto"
        >
          {activeText || '\u00a0'}
        </p>
      )}
      <h2 className="text-xl font-bold truncate mb-1 leading-snug">{currentTrack.title}</h2>
      <ArtistLinks
        artist={currentTrack.artist}
        track={currentTrack}
        className="text-body text-sm truncate block"
        linkClassName="text-body"
        onClick={() => setShowNowPlaying(false)}
      />
      {preparingHint && <p className="text-sm text-spotify-green truncate mt-1">{preparingHint}</p>}
      {isRemoteActive && activeDeviceName && (
        <p className="text-sm text-spotify-green truncate mt-1">{t('playingOnDevice', { device: activeDeviceName })}</p>
      )}
      <PlaybackMeta track={currentTrack} className="mt-1" />
    </div>
  );

  return (
    <div
      ref={sheetRef}
      className={clsx(
        'fixed inset-0 z-[60] flex flex-col bg-gradient-to-b from-[#333] via-spotify-dark to-spotify-black',
        dragY === 0 && 'animate-slide-up',
      )}
      style={{
        transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
        transition: dragY > 0 ? 'none' : 'transform 0.25s ease-out',
        opacity: dragY > 0 ? Math.max(0.5, 1 - dragY / 500) : 1,
      }}
    >
      <div data-np-header className="flex flex-col shrink-0">
        <div className="flex justify-center pt-2 pb-1 md:hidden">
          <div className="w-10 h-1 rounded-full bg-white/30" aria-hidden />
        </div>
        <div className="flex items-center justify-between px-4 pt-1 pb-2 md:pt-4">
          <button onClick={() => setShowNowPlaying(false)} className="icon-btn p-2" aria-label={t('close')}>
            <span className="md:hidden"><ChevronDown className="w-7 h-7" /></span>
            <span className="hidden md:inline"><X className="w-6 h-6" /></span>
          </button>
          <p className="text-caption uppercase tracking-widest">{t('nowPlaying')}</p>
          <div className="flex items-center gap-1">
            <DevicePickerButton />
            <button
              ref={menuAnchorRef}
              type="button"
              onClick={openMenu}
              className={clsx('icon-btn p-2', menuOpen && 'text-white bg-white/10')}
              aria-label={t('more')}
            >
              <MoreHorizontal className="w-6 h-6" />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile: original clean player + scroll for more */}
      <div ref={scrollRef} className="md:hidden flex-1 min-h-0 overflow-y-auto px-6 pb-4">
        <div className="min-h-[calc(100dvh-5.5rem)] flex flex-col justify-center">
          <div className="w-full max-w-sm mx-auto aspect-square rounded-lg shadow-card overflow-hidden bg-spotify-lightgray mb-8">
            <CachedImage src={imageUrl} className="w-full h-full object-cover" />
          </div>

          {titleBlock}
          {progressBlock}
          <div dir="ltr" className="flex items-center justify-center gap-2 mb-8">{transportControls}</div>

          <div className="flex items-center justify-around px-4 mb-6 pb-[env(safe-area-inset-bottom)]">
            <button
              onClick={() => toggleLike(currentTrack.id, currentTrack)}
              className={clsx('icon-btn p-3', isLiked && 'text-spotify-green')}
            >
              <Heart className="w-6 h-6" fill={isLiked ? 'currentColor' : 'none'} />
            </button>
            <button onClick={() => setShowPlaylistModal(true)} className="icon-btn p-3" aria-label={t('addToPlaylist')}>
              <ListPlus className="w-6 h-6" />
            </button>
            <button onClick={() => setShowLyrics(true)} className="icon-btn p-3">
              <Mic2 className="w-6 h-6" />
            </button>
            <button onClick={() => setShowQueue(true)} className="icon-btn p-3">
              <ListMusic className="w-6 h-6" />
            </button>
          </div>
        </div>

        {belowFold}
      </div>

      {/* Desktop: lyrics + large art, then same below-fold sections */}
      <div className="hidden md:flex flex-1 min-h-0 overflow-y-auto">
        <div className="w-full max-w-6xl mx-auto px-10 py-6">
          <div dir="ltr" className="flex gap-12 items-stretch min-h-[min(62vh,520px)] mb-4">
            <div className="flex-1 min-w-0">
              <LiveLyricsColumn className="h-full max-h-[520px]" />
            </div>
            <div className="w-[min(40%,400px)] shrink-0 flex flex-col justify-center">
              <div className="w-full aspect-square rounded-lg shadow-card overflow-hidden bg-spotify-lightgray mb-8">
                <CachedImage src={imageUrl} className="w-full h-full object-cover" />
              </div>
              <div dir="auto">{titleBlock}</div>
              {progressBlock}
              <div dir="ltr" className="flex items-center justify-center gap-2 mb-6">{transportControls}</div>
              <div className="flex items-center justify-center gap-5">
                <button onClick={() => toggleLike(currentTrack.id, currentTrack)} className={clsx('icon-btn p-2', isLiked && 'text-spotify-green')}>
                  <Heart className="w-5 h-5" fill={isLiked ? 'currentColor' : 'none'} />
                </button>
                <button onClick={() => setShowPlaylistModal(true)} className="icon-btn p-2">
                  <ListPlus className="w-5 h-5" />
                </button>
                <button onClick={() => setShowQueue(true)} className="icon-btn p-2">
                  <ListMusic className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
          {belowFold}
        </div>
      </div>

      <TrackContextMenu open={menuOpen} position={menuPos} actions={menuActions} onClose={() => setMenuOpen(false)} />
      <AddToPlaylistModal track={currentTrack} open={showPlaylistModal} onClose={() => setShowPlaylistModal(false)} />
    </div>
  );
}
