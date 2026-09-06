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
import { getRemoteProgressNow } from '../../lib/remoteProgress';
import CachedImage from '../ui/CachedImage';
import { isNativeShell } from '../../lib/nativeMediaSession';

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
    clearPendingSeek, persistPlayback, registerSeek, registerPause, registerStop, registerLoadLocalTrack, seekTo, setShowNowPlaying,
    autoplay, toggleAutoplay, _discoverLoading, isPreparingPlayback, isBuffering, playbackEngine,
    setIsBuffering, isRemoteActive, activeDeviceName, prefetchUpcoming, resolveNextTrack,
    isOffline, isReconnecting,
  } = usePlayerStore();

  const lastPersistRef = useRef(0);
  const loadTokenRef = useRef(0);
  const activeBlobRef = useRef<string | null>(null);
  const endedHandledRef = useRef(false);
  const crossfadeTriggeredRef = useRef(false);
  const fadeCountRef = useRef(0);
  const fadeCancelRef = useRef<Array<() => void>>([]);
  const outgoingRef = useRef<HTMLAudioElement | null>(null);
  const outgoingBlobRef = useRef<string | null>(null);
  const lastImperativeTrackIdRef = useRef<string | null>(null);

  const isFading = () => fadeCountRef.current > 0;

  const cancelAllFades = useCallback(() => {
    const cancels = fadeCancelRef.current.splice(0);
    for (const c of cancels) {
      try { c(); } catch { /* ignore */ }
    }
    fadeCountRef.current = 0;
  }, []);

  const stopOutgoing = useCallback(() => {
    const el = outgoingRef.current;
    outgoingRef.current = null;
    if (el) {
      try {
        el.pause();
        el.removeAttribute('src');
        el.src = '';
        // Never call el.load() after clearing src — crashes some WebViews (Capacitor/Android)
      } catch { /* ignore */ }
    }
    const blob = outgoingBlobRef.current;
    outgoingBlobRef.current = null;
    // Only revoke if main player is not using the same blob
    if (blob && blob !== activeBlobRef.current && audioRef.current?.src !== blob) {
      revokeBlobUrl(blob);
    }
  }, []);

  const fadeAudioVolume = useCallback((el: HTMLAudioElement, from: number, to: number, ms: number, onDone?: () => void) => {
    let cancelled = false;
    fadeCountRef.current += 1;
    const cancel = () => { cancelled = true; };
    fadeCancelRef.current.push(cancel);

    const start = performance.now();
    const tick = (now: number) => {
      if (cancelled) {
        fadeCountRef.current = Math.max(0, fadeCountRef.current - 1);
        return;
      }
      try {
        const p = Math.min((now - start) / Math.max(ms, 50), 1);
        el.volume = Math.max(0, Math.min(1, from + (to - from) * p));
        if (p < 1) {
          requestAnimationFrame(tick);
          return;
        }
      } catch {
        fadeCountRef.current = Math.max(0, fadeCountRef.current - 1);
        return;
      }
      fadeCountRef.current = Math.max(0, fadeCountRef.current - 1);
      try { onDone?.(); } catch { /* ignore */ }
    };
    requestAnimationFrame(tick);
  }, []);

  const startOutgoingCrossfade = useCallback((fromAudio: HTMLAudioElement, seconds: number) => {
    stopOutgoing();
    const src = fromAudio.currentSrc || fromAudio.src;
    if (!src || src === window.location.href) return;

    let outgoing: HTMLAudioElement;
    try {
      outgoing = new Audio();
      outgoing.crossOrigin = 'anonymous';
      outgoing.preload = 'auto';
      const t = fromAudio.currentTime;
      const vol = Math.max(0, Math.min(1, fromAudio.volume || 0));
      outgoing.src = src;
      outgoing.volume = vol;
      outgoingRef.current = outgoing;
      outgoingBlobRef.current = src.startsWith('blob:') ? src : null;

      const beginFade = () => {
        if (outgoingRef.current !== outgoing) return;
        try {
          if (Number.isFinite(t) && t > 0) outgoing.currentTime = t;
        } catch { /* ignore */ }
        void outgoing.play().catch(() => { /* ignore */ });
        fadeAudioVolume(outgoing, vol, 0, seconds * 1000, () => {
          if (outgoingRef.current === outgoing) stopOutgoing();
        });
      };

      if (outgoing.readyState >= HTMLMediaElement.HAVE_METADATA) beginFade();
      else outgoing.addEventListener('loadedmetadata', beginFade, { once: true });
      outgoing.addEventListener('error', () => {
        if (outgoingRef.current === outgoing) stopOutgoing();
      }, { once: true });
    } catch {
      stopOutgoing();
    }
  }, [fadeAudioVolume, stopOutgoing]);

  useNetworkPlaybackRecovery(audioRef, activeBlobRef);

  const canPlayLocal = canStreamTrackLocally(currentTrack);
  const isLiked = currentTrack ? isTrackLiked(currentTrack, likedTrackIds, likedPendingTracks) : false;
  const isSpotifyMode = playbackEngine === 'spotify';

  useMediaSession();
  useSpotifyPlaybackSync();

  // Imperative loader for lock-screen / background advance (React may not re-render).
  // Also owns crossfade: playTrack() calls this before React effects, so CF must live here.
  useEffect(() => {
    registerLoadLocalTrack((track, startTime) => {
      const s = usePlayerStore.getState();
      if (s.isRemoteActive && s.activeDeviceId && s.activeDeviceId !== s.localDeviceId) {
        return;
      }

      const audio = audioRef.current;
      if (!audio || !isLibraryId(track.id) || !canStreamTrackLocally(track)) return;

      const wantCf = !!s._pendingCrossfade
        && s.crossfadeEnabled
        && !document.hidden
        && !isNativeShell(); // Dual Audio + load() races crash Capacitor WebView
      usePlayerStore.setState({ _pendingCrossfade: false });

      const canOverlap = wantCf
        && !!audio.src
        && !audio.paused
        && audio.currentTime > 0.4
        && s.playbackEngine !== 'spotify';

      lastImperativeTrackIdRef.current = track.id;
      loadTokenRef.current += 1;
      endedHandledRef.current = false;
      crossfadeTriggeredRef.current = false;

      if (canOverlap) {
        // Keep old media playing on a side element while main swaps to the next track
        startOutgoingCrossfade(audio, s.crossfadeDuration);
        // Old blob stays alive via outgoingBlobRef until fade completes
        activeBlobRef.current = null;
      } else {
        cancelAllFades();
        stopOutgoing();
        revokeBlobUrl(activeBlobRef.current);
        activeBlobRef.current = null;
      }

      const token = localStorage.getItem('token');
      // Always use network URL (HTTP/SW cache warmed by preload). Never steal preload.src —
      // clearing the preload element aborts the shared media resource and freezes the next track.
      const networkSrc = streamUrl(track.id, token);
      audio.src = networkSrc;
      audio.load();

      const targetVol = effectivePlaybackVolume(usePlayerStore.getState().volume);
      if (canOverlap) {
        audio.volume = 0;
      } else {
        audio.volume = targetVol;
      }

      if (startTime > 0) {
        const onMeta = () => {
          if (Number.isFinite(audio.duration)) {
            audio.currentTime = Math.min(startTime, audio.duration || startTime);
          }
        };
        audio.addEventListener('loadedmetadata', onMeta, { once: true });
      }

      safeAudioPlay(audio, undefined, { persistent: true });
      if (canOverlap) {
        fadeAudioVolume(audio, 0, targetVol, s.crossfadeDuration * 1000);
      }
    });
    return () => registerLoadLocalTrack(null);
  }, [registerLoadLocalTrack, stopOutgoing, startOutgoingCrossfade, fadeAudioVolume, cancelAllFades]);

  // Load audio — play immediately; buffer in browser + Cache API in background
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || isSpotifyMode || !currentTrack || !isLibraryId(currentTrack.id) || isRemoteActive) return;
    if (!canPlayLocal) return;

    const srcHasTrack = (src: string) => src.includes(`/tracks/${currentTrack.id}/stream`);

    // Already started by imperative loader — don't interrupt (esp. mid-crossfade)
    if (lastImperativeTrackIdRef.current === currentTrack.id) {
      lastImperativeTrackIdRef.current = null;
      if (audio.src && !audio.ended) {
        endedHandledRef.current = false;
        crossfadeTriggeredRef.current = false;
        if (audio.paused && usePlayerStore.getState().isPlaying) {
          safeAudioPlay(audio, undefined, { persistent: true });
        }
        return;
      }
    }

    // Same track already loaded/playing (e.g. streamUrl metadata refresh) — skip reload
    if (audio.src && srcHasTrack(audio.src) && !audio.ended && audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }

    const loadToken = ++loadTokenRef.current;
    let cancelled = false;

    const { crossfadeEnabled, crossfadeDuration, _pendingCrossfade } = usePlayerStore.getState();
    usePlayerStore.setState({ _pendingCrossfade: false });
    const canOverlap = _pendingCrossfade
      && crossfadeEnabled
      && !document.hidden
      && !isNativeShell()
      && !!audio.src
      && !audio.paused
      && audio.currentTime > 0.4
      && !isSpotifyMode
      && !isRemoteActive;

    if (canOverlap) {
      startOutgoingCrossfade(audio, crossfadeDuration);
    } else {
      cancelAllFades();
      stopOutgoing();
      revokeBlobUrl(activeBlobRef.current);
    }

    activeBlobRef.current = null;
    endedHandledRef.current = false;
    crossfadeTriggeredRef.current = false;

    const applyPendingSeek = () => {
      const { pendingSeekTime: seek } = usePlayerStore.getState();
      if (seek > 0 && Number.isFinite(audio.duration)) {
        const t = Math.min(seek, audio.duration || seek);
        audio.currentTime = t;
        setCurrentTime(t);
        clearPendingSeek();
      }
    };

    let fadedIn = false;
    const tryStartPlayback = () => {
      if (loadToken !== loadTokenRef.current || cancelled) return;
      setIsBuffering(false);
      applyPendingSeek();
      if (!usePlayerStore.getState().isPlaying) return;
      const targetVol = effectivePlaybackVolume(usePlayerStore.getState().volume);
      if (canOverlap && !fadedIn) {
        fadedIn = true;
        audio.volume = 0;
        safeAudioPlay(audio, undefined, { persistent: true });
        fadeAudioVolume(audio, 0, targetVol, crossfadeDuration * 1000);
      } else if (!canOverlap) {
        audio.volume = targetVol;
        safeAudioPlay(audio, undefined, { persistent: true });
      } else {
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

      // Prefer Cache API blob when available; otherwise network (warmed by preload / SW)
      if (cachedBlob) {
        activeBlobRef.current = cachedBlob;
        audio.src = cachedBlob;
      } else {
        audio.src = networkSrc;
      }
      audio.load();

      if (usePlayerStore.getState().isPlaying) {
        if (canOverlap) {
          audio.volume = 0;
        }
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
  }, [currentTrack?.id, currentTrack?.streamUrl, currentTrack?.isDownloaded, canPlayLocal, isSpotifyMode, isRemoteActive, setIsPlaying, setCurrentTime, clearPendingSeek, setIsBuffering, fadeAudioVolume, startOutgoingCrossfade, stopOutgoing, cancelAllFades]);
  useEffect(() => {
    if (isSpotifyMode) return;
    registerSeek((time) => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = time;
      // Unstick silent/paused next-track after a failed crossfade handoff
      if (!isFading() && usePlayerStore.getState().isPlaying) {
        const target = effectivePlaybackVolume(usePlayerStore.getState().volume);
        if (audio.volume < target * 0.05) audio.volume = target;
        if (audio.paused) safeAudioPlay(audio, undefined, { persistent: true });
      }
    });
    return () => registerSeek(null);
  }, [registerSeek, isSpotifyMode]);

  useEffect(() => {
    registerPause(() => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.pause();
      outgoingRef.current?.pause();
    });
    return () => registerPause(null);
  }, [registerPause]);

  useEffect(() => {
    registerStop(() => {
      const audio = audioRef.current;
      if (!audio) return;
      try {
        audio.pause();
        audio.removeAttribute('src');
        audio.src = '';
      } catch { /* ignore */ }
      cancelAllFades();
      stopOutgoing();
      revokeBlobUrl(activeBlobRef.current);
      activeBlobRef.current = null;
      loadTokenRef.current += 1;
    });
    return () => registerStop(null);
  }, [registerStop, stopOutgoing, cancelAllFades]);

  useEffect(() => {
    const onUnload = () => { persistPlayback(); };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [persistPlayback]);

  // Play/pause — keep audio src intact on pause so resume continues from same position
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || isSpotifyMode || !currentTrack || !canPlayLocal) return;

    // Observing another device — never drive local <audio>
    if (isRemoteActive) {
      try {
        audio.pause();
        outgoingRef.current?.pause();
        if (audio.src) {
          audio.removeAttribute('src');
          audio.src = '';
        }
      } catch { /* ignore */ }
      return;
    }

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
      outgoingRef.current?.pause();
    }
  }, [isPlaying, isSpotifyMode, isRemoteActive, canPlayLocal, currentTrack?.id, currentTrack?.streamUrl, currentTrack?.isDownloaded, setIsPlaying]);

  useEffect(() => {
    if (isSpotifyMode || isFading()) return;
    if (audioRef.current) {
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

  // Warm HTTP/SW cache for the next track (do not hand off element.src — that aborts media)
  useEffect(() => {
    if (isSpotifyMode || isRemoteActive) return;
    const next = resolveNextTrack();
    if (!next?.track || !canStreamTrackLocally(next.track)) {
      preloadTrackIdRef.current = null;
      return;
    }

    const token = localStorage.getItem('token');
    const src = streamUrl(next.track.id, token);
    void import('../../lib/offlineStore').then(({ prefetchTrackStream }) => {
      void prefetchTrackStream(next.track.id, src);
    });
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
      // Keep buffered data in browser cache; only detach when switching targets
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
      if (document.visibilityState === 'hidden' || isRemoteActive) return;
      void import('../../lib/appResume').then(({ forceResumeLocalPlayback }) => {
        void forceResumeLocalPlayback();
      });
      const audio = audioRef.current;
      if (!audio) return;
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

  // Smooth progress while remote device plays — wall-clock guess between WS updates
  useEffect(() => {
    if (!isRemoteActive || !isPlaying) return;
    let raf = 0;

    const tick = () => {
      const s = usePlayerStore.getState();
      if (!s.isRemoteActive || !s.isPlaying) return;
      const dur = s.duration || s.currentTrack?.duration || 0;
      const next = getRemoteProgressNow(dur);
      // Update every frame so the scrubber/time don't stutter in ~3s steps
      if (Math.abs(next - s.currentTime) >= 0.016) {
        setCurrentTime(next);
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isRemoteActive, isPlaying, currentTrack?.id, setCurrentTime]);

  const handleEnded = () => {
    if (isRemoteActive) return;
    setIsPlaying(true);
    // Background: hard cut only — crossfade freezes JS and kills continuity
    playNext({ crossfade: !document.hidden });
  };

  const handleTimeUpdate = () => {
    if (isRemoteActive) return;
    const audio = audioRef.current;
    if (!audio) return;
    const time = audio.currentTime;
    setCurrentTime(time);

    const d = audio.duration;
    const { crossfadeEnabled, crossfadeDuration } = usePlayerStore.getState();
    const allowCrossfade = crossfadeEnabled && !document.hidden && !isNativeShell();

    if (allowCrossfade && Number.isFinite(d) && d > 0) {
      const fadeStart = Math.max(0, d - crossfadeDuration);
      if (time >= fadeStart && d > crossfadeDuration + 0.5 && !crossfadeTriggeredRef.current && !endedHandledRef.current) {
        crossfadeTriggeredRef.current = true;
        endedHandledRef.current = true;
        setIsPlaying(true);
        playNext({ crossfade: true });
      } else if (time < fadeStart - 1) {
        crossfadeTriggeredRef.current = false;
      }
    }

    // Near-end / end detection (also works without crossfade; critical when timers throttle)
    if (Number.isFinite(d) && d > 0 && time >= d - 0.35) {
      if (!endedHandledRef.current) {
        endedHandledRef.current = true;
        handleEnded();
      }
    } else if (!Number.isFinite(d) || time < d - 1) {
      if (!crossfadeTriggeredRef.current) endedHandledRef.current = false;
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
      <button type="button" onClick={() => playPrevious()} className="icon-btn" aria-label={t('previous')}>
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
      <button type="button" onClick={() => playNext()} className="icon-btn" aria-label={t('next')}>
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
            <CachedImage src={imageUrl} className="w-full h-full object-cover" />
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
            <CachedImage src={imageUrl} className="w-full h-full object-cover" />
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
