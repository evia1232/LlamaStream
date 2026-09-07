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

function CompactLyrics({ className }: { className?: string }) {
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
      <div className={clsx('overflow-y-auto scrollbar-spotify', className)}>
        <div className="space-y-0.5 py-4">
          {lines.map((line, i) => (
            <div
              key={`${line.time}-${i}`}
              ref={i === activeIndex ? activeLineRef : undefined}
              className={clsx(
                'py-1.5 text-[15px] font-semibold leading-snug transition-colors duration-300',
                i === activeIndex ? 'text-white' : 'text-white/35',
              )}
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
      <pre className={clsx('whitespace-pre-wrap text-sm text-white/70 overflow-y-auto py-4', className)}>
        {plainContent}
      </pre>
    );
  }

  return <p className={clsx('text-spotify-text text-sm py-4', className)}>{t('noLyrics')}</p>;
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
        setRelated(tracks.map((tr) => normalizeTrack(tr)).filter((tr) => tr.id !== currentTrack.id).slice(0, 6));
      } catch {
        if (!cancelled) setRelated([]);
      }

      try {
        const name = getArtistName(currentTrack.artist);
        const spotifyId = currentTrack.spotifyArtistId;
        const { data } = await api.get(`/home/artists/by-name/${encodeURIComponent(name)}`, {
          params: spotifyId ? { spotifyArtistId: spotifyId } : undefined,
          timeout: 12000,
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
      return contextTracks.slice(contextIndex + 1, contextIndex + 5);
    }
    return queue.slice(0, 4).map((q) => q.track).filter(Boolean) as Track[];
  })();

  const transportControls = (compact = false) => (
    <>
      <button type="button" onClick={toggleShuffle} className={clsx('icon-btn', compact ? 'p-2' : 'p-3', shuffle && 'text-spotify-green')}>
        <Shuffle className={compact ? 'w-4 h-4' : 'w-6 h-6'} />
      </button>
      <button type="button" onClick={() => playPrevious()} className={clsx('icon-btn', compact ? 'p-2' : 'p-3')} aria-label={t('previous')}>
        <SkipBack className={clsx(compact ? 'w-5 h-5' : 'w-8 h-8', 'fill-current')} />
      </button>
      <button
        type="button"
        onClick={() => !showPreparing && setIsPlaying(!isPlaying)}
        disabled={showPreparing}
        className={clsx(
          'bg-white rounded-full flex items-center justify-center shadow-play-btn active:scale-95 transition-transform disabled:opacity-60',
          compact ? 'w-11 h-11' : 'w-16 h-16',
        )}
        aria-label={isPlaying ? t('pause') : t('play')}
      >
        {showPreparing ? (
          <div className={clsx('border-2 border-black/30 border-t-black rounded-full animate-spin', compact ? 'w-4 h-4' : 'w-7 h-7')} />
        ) : isPlaying ? (
          <Pause className={clsx(compact ? 'w-5 h-5' : 'w-7 h-7', 'text-black fill-black')} />
        ) : (
          <PlayIcon className={clsx(compact ? 'w-5 h-5' : 'w-7 h-7', 'text-black fill-black')} />
        )}
      </button>
      <button type="button" onClick={() => playNext()} className={clsx('icon-btn', compact ? 'p-2' : 'p-3')} aria-label={t('next')}>
        <SkipForward className={clsx(compact ? 'w-5 h-5' : 'w-8 h-8', 'fill-current')} />
      </button>
      <button type="button" onClick={cycleRepeat} className={clsx('icon-btn', compact ? 'p-2' : 'p-3', repeat !== 'off' && 'text-spotify-green')}>
        {repeat === 'one'
          ? <Repeat1 className={compact ? 'w-4 h-4' : 'w-6 h-6'} />
          : <Repeat className={compact ? 'w-4 h-4' : 'w-6 h-6'} />}
      </button>
    </>
  );

  const progressBlock = (compact = false) => (
    <div dir="ltr" className={clsx('player-slider-row', compact ? 'mb-1' : 'px-1 mb-2')}>
      <input
        type="range"
        min={0}
        max={duration || currentTrack?.duration || 0}
        value={currentTime}
        onChange={(e) => seekTo(parseFloat(e.target.value))}
        disabled={showPreparing}
        className="player-progress w-full h-1 mb-1.5 disabled:opacity-50"
        style={{ background: progressGradient((currentTime / ((duration || currentTrack?.duration || 1))) * 100) }}
      />
      <div className="flex justify-between text-caption tabular-nums text-[11px]">
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
      <section className="mb-6">
        <h3 className="text-xs font-bold uppercase tracking-wider text-spotify-text mb-2">{t('relatedTracks')}</h3>
        {related.length === 0 ? (
          <p className="text-caption">{t('noRelatedYet')}</p>
        ) : (
          <div className="space-y-0.5">
            {related.map((tr) => (
              <button
                key={tr.id}
                type="button"
                onClick={() => void playTrack(tr)}
                className="w-full flex items-center gap-2.5 p-1.5 rounded-md hover:bg-white/5 text-start"
              >
                <div className="w-10 h-10 rounded overflow-hidden bg-spotify-lightgray shrink-0">
                  <CachedImage src={getTrackImageUrl(tr)} className="w-full h-full object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{tr.title}</p>
                  <p className="text-caption truncate">{getArtistName(tr.artist)}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {artistCard && (
        <section className="mb-6">
          <h3 className="text-xs font-bold uppercase tracking-wider text-spotify-text mb-2">{t('aboutArtist')}</h3>
          <Link
            to={`/artist/by-name/${encodeURIComponent(artistCard.name)}${artistCard.spotifyArtistId ? `?spotifyArtistId=${encodeURIComponent(artistCard.spotifyArtistId)}` : ''}`}
            onClick={() => setShowNowPlaying(false)}
            className="flex gap-3 p-3 rounded-lg bg-white/[0.06] hover:bg-white/10 transition-colors"
          >
            <div className="w-14 h-14 rounded-full overflow-hidden bg-spotify-lightgray shrink-0">
              {artistCard.imageUrl ? (
                <CachedImage src={artistCard.imageUrl} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-lg font-bold text-spotify-text">
                  {artistCard.name.slice(0, 1)}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 text-start">
              <p className="text-sm font-bold truncate">{artistCard.name}</p>
              {!!artistCard.followers && (
                <p className="text-caption mt-0.5">{artistCard.followers.toLocaleString()} {t('followersLabel')}</p>
              )}
              {artistCard.bio && (
                <p className="text-xs text-spotify-text mt-1 line-clamp-2">{artistCard.bio}</p>
              )}
            </div>
          </Link>
        </section>
      )}

      <section className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-spotify-text">{t('upNext')}</h3>
          <button type="button" onClick={() => setShowQueue(true)} className="text-caption text-spotify-green">
            {t('showQueue')}
          </button>
        </div>
        {upcoming.length === 0 ? (
          <p className="text-caption">{t('queueEmpty')}</p>
        ) : (
          <div className="space-y-0.5">
            {upcoming.map((tr) => (
              <button
                key={tr.id}
                type="button"
                onClick={() => void playTrack(tr)}
                className="w-full flex items-center gap-2.5 p-1.5 rounded-md hover:bg-white/5 text-start"
              >
                <div className="w-10 h-10 rounded overflow-hidden bg-spotify-lightgray shrink-0">
                  <CachedImage src={getTrackImageUrl(tr)} className="w-full h-full object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{tr.title}</p>
                  <p className="text-caption truncate">{getArtistName(tr.artist)}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );

  const titleBlock = (compact = false) => (
    <div className={clsx('text-start', compact ? 'mb-3' : 'mb-6 px-1')}>
      {hasSynced && (
        <p
          className={clsx(
            'font-bold text-white tracking-wide leading-snug truncate transition-opacity duration-500',
            compact ? 'min-h-[1.25rem] mb-2 text-sm' : 'min-h-[1.5rem] mb-3 text-[15px]',
            activeText ? 'opacity-100' : 'opacity-0',
          )}
          dir="auto"
        >
          {activeText || '\u00a0'}
        </p>
      )}
      <h2 className={clsx('font-bold truncate leading-snug', compact ? 'text-base mb-0.5' : 'text-xl mb-1')}>
        {currentTrack.title}
      </h2>
      <ArtistLinks
        artist={currentTrack.artist}
        track={currentTrack}
        className={clsx('text-body truncate block', compact ? 'text-xs' : 'text-sm')}
        linkClassName="text-body"
        onClick={() => setShowNowPlaying(false)}
      />
      {preparingHint && <p className="text-xs text-spotify-green truncate mt-1">{preparingHint}</p>}
      {isRemoteActive && activeDeviceName && (
        <p className="text-xs text-spotify-green truncate mt-1">{t('playingOnDevice', { device: activeDeviceName })}</p>
      )}
      <PlaybackMeta track={currentTrack} className="mt-1" />
    </div>
  );

  return (
    <>
      {/* Desktop backdrop */}
      <div
        className="hidden md:block fixed inset-0 z-[55] bg-black/40"
        onClick={() => setShowNowPlaying(false)}
        aria-hidden
      />

      {/* Mobile fullscreen */}
      <div
        ref={sheetRef}
        className={clsx(
          'md:hidden fixed inset-0 z-[60] flex flex-col bg-gradient-to-b from-[#333] via-spotify-dark to-spotify-black',
          dragY === 0 && 'animate-slide-up',
        )}
        style={{
          transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
          transition: dragY > 0 ? 'none' : 'transform 0.25s ease-out',
          opacity: dragY > 0 ? Math.max(0.5, 1 - dragY / 500) : 1,
        }}
      >
        <div data-np-header className="flex flex-col shrink-0">
          <div className="flex justify-center pt-2 pb-1">
            <div className="w-10 h-1 rounded-full bg-white/30" aria-hidden />
          </div>
          <div className="flex items-center justify-between px-4 pt-1 pb-2">
            <button onClick={() => setShowNowPlaying(false)} className="icon-btn p-2" aria-label={t('close')}>
              <ChevronDown className="w-7 h-7" />
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

        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-6 pb-4">
          <div className="min-h-[calc(100dvh-5.5rem)] flex flex-col justify-center">
            <div className="w-full max-w-sm mx-auto aspect-square rounded-lg shadow-card overflow-hidden bg-spotify-lightgray mb-8">
              <CachedImage src={imageUrl} className="w-full h-full object-cover" />
            </div>
            {titleBlock(false)}
            {progressBlock(false)}
            <div dir="ltr" className="flex items-center justify-center gap-2 mb-8">{transportControls(false)}</div>
            <div className="flex items-center justify-around px-4 mb-6 pb-[env(safe-area-inset-bottom)]">
              <button onClick={() => toggleLike(currentTrack.id, currentTrack)} className={clsx('icon-btn p-3', isLiked && 'text-spotify-green')}>
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
      </div>

      {/* Desktop: side panel (~1/4 screen) */}
      <aside
        className="hidden md:flex fixed top-0 end-0 z-[56] h-[calc(100vh-var(--player-h))] w-[min(32vw,400px)] min-w-[320px] flex-col bg-[#121212] border-s border-white/10 shadow-2xl animate-np-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/8 shrink-0">
          <p className="text-xs uppercase tracking-widest text-spotify-text">{t('nowPlaying')}</p>
          <div className="flex items-center gap-0.5">
            <DevicePickerButton />
            <button
              ref={menuAnchorRef}
              type="button"
              onClick={openMenu}
              className={clsx('icon-btn p-1.5', menuOpen && 'text-white bg-white/10')}
              aria-label={t('more')}
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
            <button onClick={() => setShowNowPlaying(false)} className="icon-btn p-1.5" aria-label={t('close')}>
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-spotify px-5 py-5">
          <div className="w-full max-w-[240px] mx-auto aspect-square rounded-md overflow-hidden bg-spotify-lightgray shadow-lg mb-5">
            <CachedImage src={imageUrl} className="w-full h-full object-cover" />
          </div>

          {titleBlock(true)}
          {progressBlock(true)}
          <div dir="ltr" className="flex items-center justify-center gap-1 mb-4">{transportControls(true)}</div>

          <div className="flex items-center justify-center gap-3 mb-6">
            <button onClick={() => toggleLike(currentTrack.id, currentTrack)} className={clsx('icon-btn p-2', isLiked && 'text-spotify-green')}>
              <Heart className="w-4 h-4" fill={isLiked ? 'currentColor' : 'none'} />
            </button>
            <button onClick={() => setShowPlaylistModal(true)} className="icon-btn p-2">
              <ListPlus className="w-4 h-4" />
            </button>
            <button onClick={() => setShowLyrics(true)} className="icon-btn p-2">
              <Mic2 className="w-4 h-4" />
            </button>
            <button onClick={() => setShowQueue(true)} className="icon-btn p-2">
              <ListMusic className="w-4 h-4" />
            </button>
          </div>

          <div className="border-t border-white/8 pt-4 mb-6">
            <h3 className="text-xs font-bold uppercase tracking-wider text-spotify-text mb-1">{t('lyrics')}</h3>
            <CompactLyrics className="max-h-48" />
          </div>

          {belowFold}
        </div>
      </aside>

      <TrackContextMenu open={menuOpen} position={menuPos} actions={menuActions} onClose={() => setMenuOpen(false)} />
      <AddToPlaylistModal track={currentTrack} open={showPlaylistModal} onClose={() => setShowPlaylistModal(false)} />
    </>
  );
}
