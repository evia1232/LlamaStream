import { useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  Volume2, VolumeX, Heart, Mic2, ListMusic, Infinity,
} from 'lucide-react';
import clsx from 'clsx';
import { usePlayerStore } from '../../store';
import { streamUrl } from '../../lib/apiUrl';
import { getAppName } from '../../lib/appName';
import { getArtistName, getTrackImageUrl, isTrackLiked } from '../../lib/trackUtils';
import { ArtistLinks } from '../artists/ArtistLink';
import { progressGradient } from '../../lib/direction';
import PlaybackMeta from './PlaybackMeta';
import { DevicePickerButton } from './DevicePicker';
import { openTrackContextMenu } from '../../store/trackMenuStore';
import { useMediaSession } from '../../hooks/useMediaSession';
import { useSpotifyPlaybackSync } from '../../hooks/useSpotifyPlaybackSync';
import { canStreamTrackLocally, prepareTrackForPlayback, isLibraryId } from '../../lib/ensureDownload';
import { getCachedStreamBlobUrl, revokeBlobUrl } from '../../lib/audioStreamCache';
import { effectivePlaybackVolume, isMobileViewport } from '../../lib/volume';
import { safeAudioPlay, resumeAudioIfNeeded } from '../../lib/audioPlay';
import { useNetworkPlaybackRecovery } from '../../hooks/useNetworkPlaybackRecovery';

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function PlayIcon({ className }: { className?: string }) {
  return <Play className={clsx(className, 'play-icon-nudge')} />;
}

export default function PlayerBar() {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement>(null);
  const preloadRef = useRef<HTMLAudioElement | null>(null);
  const preloadTrackIdRef = useRef<string | null>(null);
  const footerRef = useRef<HTMLElement>(null);

  const {
    currentTrack, isPlaying, currentTime, duration, volume,
    shuffle, repeat, likedTrackIds, pendingSeekTime,
    setIsPlaying, setCurrentTime, setDuration, setVolume,
    toggleShuffle, cycleRepeat, playNext, playPrevious,
    toggleLike, setShowQueue, setShowLyrics, showLyrics,
    likedPendingTracks,
    clearPendingSeek, persistPlayback, registerSeek, registerPause, registerStop, seekTo, setShowNowPlaying,
    autoplay, toggleAutoplay, _discoverLoading, isPreparingPlayback, isBuffering, playbackEngine,
    setIsBuffering, isRemoteActive, activeDeviceName, sendRemoteCommand, prefetchUpcoming, resolveNextTrack,
    isOffline, isReconnecting,
  } = usePlayerStore();

  const lastPersistRef = useRef(0);
  const loadTokenRef = useRef(0);
  const activeBlobRef = useRef<string | null>(null);
  const endedHandledRef = useRef(false);

  useNetworkPlaybackRecovery(audioRef, activeBlobRef);

  const canPlayLocal = canStreamTrackLocally(currentTrack);
  const isLiked = currentTrack ? isTrackLiked(currentTrack, likedTrackIds, likedPendingTracks) : false;
  const isSpotifyMode = playbackEngine === 'spotify';

  useMediaSession();
  useSpotifyPlaybackSync();

  // Load audio — play immediately; buffer in browser + Cache API in background
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || isSpotifyMode || !currentTrack || !isLibraryId(currentTrack.id) || isRemoteActive) return;
    if (!canPlayLocal) return;

    const loadToken = ++loadTokenRef.current;
    let cancelled = false;

    revokeBlobUrl(activeBlobRef.current);
    activeBlobRef.current = null;
    endedHandledRef.current = false;

    const applyPendingSeek = () => {
      const { pendingSeekTime: seek } = usePlayerStore.getState();
      if (seek > 0 && Number.isFinite(audio.duration)) {
        const t = Math.min(seek, audio.duration || seek);
        audio.currentTime = t;
        setCurrentTime(t);
        clearPendingSeek();
      }
    };

    const tryStartPlayback = () => {
      if (loadToken !== loadTokenRef.current || cancelled) return;
      setIsBuffering(false);
      applyPendingSeek();
      if (usePlayerStore.getState().isPlaying) {
        safeAudioPlay(audio, undefined, { persistent: true });
      }
    };

    const onLoadedData = () => tryStartPlayback();
    const onCanPlay = () => tryStartPlayback();
    const onWaiting = () => {
      if (loadToken === loadTokenRef.current) setIsBuffering(true);
    };
    const onPlaying = () => {
      if (loadToken === loadTokenRef.current) setIsBuffering(false);
    };

    const onError = async () => {
      if (loadToken !== loadTokenRef.current || cancelled) return;
      const track = usePlayerStore.getState().currentTrack;
      if (track && isLibraryId(track.id)) {
        try {
          const ready = await prepareTrackForPlayback(track);
          usePlayerStore.setState({ currentTrack: ready });
          if (canStreamTrackLocally(ready)) return;
        } catch { /* fall through */ }
      }
      setIsBuffering(false);
    };

    audio.addEventListener('loadeddata', onLoadedData);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('error', onError);

    void (async () => {
      const token = localStorage.getItem('token');
      const networkSrc = streamUrl(currentTrack.id, token);
      const cachedBlob = await getCachedStreamBlobUrl(currentTrack.id);
      if (cancelled || loadToken !== loadTokenRef.current) {
        revokeBlobUrl(cachedBlob);
        return;
      }

      const preload = preloadRef.current;
      const preloaded = preloadTrackIdRef.current === currentTrack.id
        && preload?.src
        && preload.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;

      if (preloaded && preload?.src) {
        if (preload.src.startsWith('blob:')) {
          activeBlobRef.current = preload.src;
        }
        audio.src = preload.src;
        audio.load();
        preload.removeAttribute('src');
        preload.load();
        preloadTrackIdRef.current = null;
      } else if (cachedBlob) {
        activeBlobRef.current = cachedBlob;
        audio.src = cachedBlob;
        audio.load();
      } else {
        audio.src = networkSrc;
        audio.load();
      }

      if (usePlayerStore.getState().isPlaying) {
        safeAudioPlay(audio, undefined, { persistent: true });
      }
    })();

    return () => {
      cancelled = true;
      audio.removeEventListener('loadeddata', onLoadedData);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('error', onError);
    };
  }, [currentTrack?.id, currentTrack?.streamUrl, currentTrack?.isDownloaded, canPlayLocal, isSpotifyMode, isRemoteActive, setIsPlaying, setCurrentTime, clearPendingSeek, setIsBuffering]);

  useEffect(() => {
    if (isSpotifyMode) return;
    registerSeek((time) => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = time;
    });
    return () => registerSeek(null);
  }, [registerSeek, isSpotifyMode]);

  useEffect(() => {
    registerPause(() => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.pause();
    });
    return () => registerPause(null);
  }, [registerPause]);

  useEffect(() => {
    registerStop(() => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      revokeBlobUrl(activeBlobRef.current);
      activeBlobRef.current = null;
      loadTokenRef.current += 1;
    });
    return () => registerStop(null);
  }, [registerStop]);

  useEffect(() => {
    const onUnload = () => { persistPlayback(); };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [persistPlayback]);

  // Play/pause — keep audio src intact on pause so resume continues from same position
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || isSpotifyMode || !currentTrack || !canPlayLocal || isRemoteActive) return;

    if (isPlaying) {
      const startPlayback = () => {
        safeAudioPlay(audio, undefined, { persistent: true });
      };

      if (!audio.src) {
        const token = localStorage.getItem('token');
        audio.src = streamUrl(currentTrack.id, token);
        audio.load();
        audio.addEventListener('canplay', startPlayback, { once: true });
        return;
      }

      if (audio.paused) startPlayback();
    } else {
      audio.pause();
    }
  }, [isPlaying, isSpotifyMode, isRemoteActive, canPlayLocal, currentTrack?.id, currentTrack?.streamUrl, currentTrack?.isDownloaded, setIsPlaying]);

  useEffect(() => {
    if (!isSpotifyMode && audioRef.current) {
      audioRef.current.volume = effectivePlaybackVolume(volume);
    }
  }, [volume, isSpotifyMode]);

  const adjustVolumeByWheel = useCallback((deltaY: number) => {
    if (isMobileViewport() || !currentTrack) return;
    const step = deltaY < 0 ? 0.05 : -0.05;
    const next = Math.min(1, Math.max(0, usePlayerStore.getState().volume + step));
    setVolume(next);
  }, [currentTrack, setVolume]);

  useEffect(() => {
    const el = footerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (isMobileViewport() || !currentTrack) return;
      e.preventDefault();
      adjustVolumeByWheel(e.deltaY);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [currentTrack, adjustVolumeByWheel]);

  // Preload next local track stream for instant skip
  useEffect(() => {
    if (isSpotifyMode || isRemoteActive) return;
    const next = resolveNextTrack();
    if (!next?.track || !canStreamTrackLocally(next.track)) {
      preloadTrackIdRef.current = null;
      return;
    }

    const token = localStorage.getItem('token');
    const src = streamUrl(next.track.id, token);
    const el = preloadRef.current ?? new Audio();
    preloadRef.current = el;
    el.preload = 'auto';
    preloadTrackIdRef.current = next.track.id;
    if (el.src !== src) {
      el.src = src;
      el.load();
    }

    return () => {
      if (preloadTrackIdRef.current === next.track.id) {
        preloadTrackIdRef.current = null;
      }
      el.removeAttribute('src');
      el.load();
    };
  }, [currentTrack?.id, isSpotifyMode, isRemoteActive, resolveNextTrack]);

  // Keep next track download ready while playing
  useEffect(() => {
    if (!isPlaying || isRemoteActive) return;
    prefetchUpcoming();
    const timer = window.setInterval(prefetchUpcoming, 15000);
    return () => window.clearInterval(timer);
  }, [isPlaying, currentTrack?.id, isRemoteActive, prefetchUpcoming]);

  useEffect(() => {
    const onVisibility = () => {
      const audio = audioRef.current;
      if (!audio || isRemoteActive) return;
      const { isPlaying: wantPlay, isPreparingPlayback: preparing } = usePlayerStore.getState();
      resumeAudioIfNeeded(audio, wantPlay, preparing);
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onVisibility);
    window.addEventListener('focus', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onVisibility);
      window.removeEventListener('focus', onVisibility);
    };
  }, [isRemoteActive]);

  // Smooth progress updates while local audio plays (timeupdate alone is too coarse)
  useEffect(() => {
    if (isSpotifyMode || isRemoteActive || !isPlaying || !canPlayLocal) return;
    let raf = 0;
    let last = -1;

    const tick = () => {
      const audio = audioRef.current;
      if (audio && !audio.paused && Number.isFinite(audio.currentTime)) {
        const t = audio.currentTime;
        if (Math.abs(t - last) >= 0.025) {
          last = t;
          setCurrentTime(t);
        }
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          setDuration(audio.duration);
        }
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, isSpotifyMode, isRemoteActive, canPlayLocal, currentTrack?.id, currentTrack?.streamUrl, currentTrack?.isDownloaded, setCurrentTime, setDuration]);

  // Smooth progress while remote device plays (WS sync is every ~3s)
  useEffect(() => {
    if (!isRemoteActive || !isPlaying) return;
    let raf = 0;
    let lastTs = performance.now();

    const tick = (now: number) => {
      const dt = (now - lastTs) / 1000;
      lastTs = now;
      const s = usePlayerStore.getState();
      const dur = s.duration;
      let next = s.currentTime + dt;
      if (dur > 0) next = Math.min(next, dur);
      if (Math.abs(next - s.currentTime) >= 0.025) setCurrentTime(next);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isRemoteActive, isPlaying, setCurrentTime]);

  const handleEnded = () => {
    if (isRemoteActive) return;
    setIsPlaying(true);
    playNext();
  };

  const handleTimeUpdate = () => {
    if (isRemoteActive) return;
    const audio = audioRef.current;
    if (!audio) return;
    const time = audio.currentTime;
    setCurrentTime(time);

    const d = audio.duration;
    if (Number.isFinite(d) && d > 0 && time >= d - 0.35) {
      if (!endedHandledRef.current) {
        endedHandledRef.current = true;
        handleEnded();
      }
    } else if (!Number.isFinite(d) || time < d - 1) {
      endedHandledRef.current = false;
    }

    const now = Date.now();
    if (now - lastPersistRef.current > 4000) {
      lastPersistRef.current = now;
      persistPlayback();
      prefetchUpcoming();
    }
  };

  const handleLoadedMetadata = () => {
    if (!audioRef.current || !currentTrack) return;

    let d = audioRef.current.duration;
    if (!Number.isFinite(d)) {
      d = currentTrack.duration || 0;
    }
    setDuration(d);

    if (pendingSeekTime > 0) {
      const t = Math.min(pendingSeekTime, audioRef.current.duration || pendingSeekTime);
      audioRef.current.currentTime = t;
      setCurrentTime(t);
      clearPendingSeek();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    seekTo(parseFloat(e.target.value));
  };

  if (!currentTrack) {
    return (
      <footer className="player-bar player-bar-empty shrink-0" dir="ltr">
        <p className="text-spotify-text text-sm hidden md:block">{getAppName()}</p>
      </footer>
    );
  }

  const trackDuration = duration || currentTrack.duration || 0;
  const progressPct = (currentTime / (trackDuration || 1)) * 100;
  const volumePct = volume * 100;
  const showPreparing = isPreparingPlayback || (isBuffering && !isOffline && !isReconnecting);
  const networkBanner = isOffline
    ? t('offlinePlayback')
    : isReconnecting
      ? t('reconnectingPlayback')
      : isBuffering
        ? t('bufferingPlayback')
        : null;
  const preparingLabel = isBuffering && !isPreparingPlayback
    ? t('switchingTrack')
    : isPreparingPlayback && !isSpotifyMode && !canPlayLocal
      ? t('preparingPlayback')
      : t('preparingPlayback');

  const transportControls = (
    <>
      <button type="button" onClick={toggleShuffle} className={clsx('icon-btn', shuffle && 'active text-spotify-green')}>
        <Shuffle className="w-4 h-4" />
      </button>
      <button type="button" onClick={() => (isRemoteActive ? sendRemoteCommand('prev') : playPrevious())} className="icon-btn" aria-label={t('previous')}>
        <SkipBack className="w-5 h-5 fill-current" />
      </button>
      <button
        type="button"
        onClick={() => !showPreparing && setIsPlaying(!isPlaying)}
        disabled={showPreparing}
        className="w-8 h-8 bg-white rounded-full flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-60"
        aria-label={isPlaying ? t('pause') : t('play')}
      >
        {showPreparing ? (
          <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
        ) : isPlaying ? (
          <Pause className="w-4 h-4 text-black fill-black" />
        ) : (
          <PlayIcon className="w-4 h-4 text-black fill-black" />
        )}
      </button>
      <button type="button" onClick={() => (isRemoteActive ? sendRemoteCommand('next') : playNext())} className="icon-btn" aria-label={t('next')}>
        <SkipForward className="w-5 h-5 fill-current" />
      </button>
      <button type="button" onClick={cycleRepeat} className={clsx('icon-btn', repeat !== 'off' && 'active text-spotify-green')}>
        {repeat === 'one' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
      </button>
      <button
        type="button"
        onClick={toggleAutoplay}
        className={clsx('icon-btn', autoplay && 'active text-spotify-green')}
        aria-label={t('autoplay')}
        title={t('autoplayHint')}
      >
        <Infinity className="w-4 h-4" />
      </button>
    </>
  );

  const artistName = getArtistName(currentTrack.artist);
  const imageUrl = getTrackImageUrl(currentTrack);

  return (
    <footer ref={footerRef} className="player-bar shrink-0 relative" dir="ltr">
      {networkBanner && !isSpotifyMode && (
        <div className="absolute bottom-full inset-x-0 flex justify-center pointer-events-none px-4 pb-1 z-10">
          <p className="text-xs font-medium text-white/90 bg-[#5038a0] px-3 py-1 rounded-full shadow-lg">
            {networkBanner}
          </p>
        </div>
      )}
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        crossOrigin="anonymous"
        playsInline
        preload="auto"
        {...({ 'x-webkit-airplay': 'allow' } as React.AudioHTMLAttributes<HTMLAudioElement>)}
      />

      <div className="md:hidden absolute top-0 inset-x-0 h-0.5 bg-spotify-hover">
        <div className="h-full bg-white transition-all" style={{ width: `${progressPct}%` }} />
      </div>

      <div className="md:hidden flex items-center gap-3 px-3 h-full min-w-0">
        <button
          type="button"
          onClick={() => setShowNowPlaying(true)}
          onContextMenu={(e) => openTrackContextMenu(e, currentTrack)}
          className="flex items-center gap-3 flex-1 min-w-0 text-start active:opacity-80"
        >
          <div className="w-11 h-11 rounded bg-spotify-gray shrink-0 overflow-hidden shadow-sm">
            {imageUrl ? (
              <img src={imageUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-spotify-text text-sm">♪</div>
            )}
          </div>
          <div className="flex-1 min-w-0 text-start" dir="auto">
            <p className="text-sm font-normal truncate">{currentTrack.title}</p>
            <p className="text-caption truncate">{artistName}</p>
            {showPreparing && (
              <p className="text-2xs text-spotify-green truncate">{preparingLabel}</p>
            )}
            {isRemoteActive && activeDeviceName && (
              <p className="text-2xs text-spotify-green truncate">{t('playingOnDevice', { device: activeDeviceName })}</p>
            )}
          </div>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <DevicePickerButton />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleLike(currentTrack.id, currentTrack); }}
            className={clsx('icon-btn p-1', isLiked && 'text-spotify-green')}
          >
            <Heart className="w-5 h-5" fill={isLiked ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); !showPreparing && setIsPlaying(!isPlaying); }}
            disabled={showPreparing}
            className="w-9 h-9 bg-white rounded-full flex items-center justify-center disabled:opacity-60"
            aria-label={isPlaying ? t('pause') : t('play')}
          >
            {showPreparing ? (
              <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-4 h-4 text-black fill-black" />
            ) : (
              <PlayIcon className="w-4 h-4 text-black fill-black" />
            )}
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); playNext(); }}
            className="icon-btn p-1"
            aria-label={t('next')}
          >
            <SkipForward className="w-5 h-5 fill-current" />
          </button>
        </div>
      </div>

      <div className="player-bar-desktop hidden md:block relative h-full w-full overflow-visible">
        <div
          className="absolute inset-y-0 start-0 flex items-center gap-3 min-w-0 max-w-[30%] ps-4 pe-2 z-10 cursor-default"
          onContextMenu={(e) => openTrackContextMenu(e, currentTrack)}
        >
          <div className="w-14 h-14 rounded bg-spotify-gray shrink-0 overflow-hidden">
            {currentTrack.thumbnailUrl ? (
              <img src={currentTrack.thumbnailUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-spotify-text">♪</div>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-normal truncate">{currentTrack.title}</p>
            <ArtistLinks artist={currentTrack.artist} track={currentTrack} className="text-caption truncate block" linkClassName="text-caption" />
            {isRemoteActive && activeDeviceName && (
              <p className="text-2xs text-spotify-green truncate">{t('playingOnDevice', { device: activeDeviceName })}</p>
            )}
            {currentTrack && <PlaybackMeta track={currentTrack} className="mt-0.5" />}
            {_discoverLoading && <p className="text-2xs text-spotify-green truncate">{t('findingNext')}</p>}
          </div>
          <button
            type="button"
            onClick={() => toggleLike(currentTrack.id, currentTrack)}
            className={clsx('icon-btn shrink-0', isLiked && 'text-spotify-green')}
          >
            <Heart className="w-4 h-4" fill={isLiked ? 'currentColor' : 'none'} />
          </button>
        </div>

        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 flex flex-col items-center justify-center gap-2 w-full max-w-[40rem] px-4 pointer-events-none z-20">
          <div className="pointer-events-auto flex items-center gap-4">
            {transportControls}
          </div>
          <div className="player-slider-row pointer-events-auto flex items-center gap-2 w-full">
            <span className="text-caption w-10 text-end tabular-nums shrink-0">{formatTime(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={trackDuration}
              value={currentTime}
              onChange={handleSeek}
              disabled={showPreparing}
              className="player-progress flex-1 min-w-0 disabled:opacity-50"
              style={{ background: progressGradient(progressPct) }}
            />
            <span className="text-caption w-10 tabular-nums shrink-0">{formatTime(trackDuration)}</span>
          </div>
        </div>

        <div className="absolute inset-y-0 end-0 flex items-center justify-end gap-2 pe-4 ps-2 z-10">
          <DevicePickerButton />
          <button
            type="button"
            onClick={() => setShowLyrics(!showLyrics)}
            className={clsx('icon-btn shrink-0', showLyrics && 'text-spotify-green')}
            aria-label={t('lyrics')}
          >
            <Mic2 className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => setShowQueue(true)} className="icon-btn shrink-0" aria-label={t('queue')}>
            <ListMusic className="w-4 h-4" />
          </button>
          <div className="player-slider-row flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setVolume(volume === 0 ? 0.7 : 0)}
              className="icon-btn shrink-0"
              aria-label={t('volume')}
            >
              {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="player-progress w-[6.5rem] shrink-0"
              style={{ background: progressGradient(volumePct) }}
            />
          </div>
        </div>
      </div>
    </footer>
  );
}
