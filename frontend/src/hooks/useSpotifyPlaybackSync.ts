import { useEffect } from 'react';
import { usePlayerStore } from '../store';
import { useSpotifyPlayerStore } from '../store/spotifyPlayerStore';
import type { SpotifyPlaybackState } from '../lib/spotifySdk';

/** Sync Spotify Web Playback SDK state into the player store */
export function useSpotifyPlaybackSync() {
  const playbackEngine = usePlayerStore((s) => s.playbackEngine);
  const volume = usePlayerStore((s) => s.volume);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const engine = useSpotifyPlayerStore((s) => s.engine);
  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime);
  const setDuration = usePlayerStore((s) => s.setDuration);
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);

  useEffect(() => {
    if (playbackEngine !== 'spotify' || !engine) return;

    const onState = (state: unknown) => {
      const s = state as SpotifyPlaybackState | null;
      if (!s) {
        setIsPlaying(false);
        return;
      }
      setCurrentTime(s.position / 1000);
      setDuration(s.duration / 1000);
      setIsPlaying(!s.paused);
    };

    engine.player.addListener('player_state_changed', onState);
    return () => {
      engine.player.removeListener('player_state_changed', onState);
    };
  }, [playbackEngine, engine, setCurrentTime, setDuration, setIsPlaying]);

  useEffect(() => {
    if (playbackEngine !== 'spotify' || !engine || !isPlaying) return;

    const poll = async () => {
      try {
        const s = await engine.player.getCurrentState();
        if (s) {
          setCurrentTime(s.position / 1000);
          if (s.duration > 0) setDuration(s.duration / 1000);
          setIsPlaying(!s.paused);
        }
      } catch { /* ignore */ }
    };

    void poll();
    const pollId = setInterval(poll, 400);
    return () => clearInterval(pollId);
  }, [playbackEngine, engine, isPlaying, setCurrentTime, setDuration, setIsPlaying]);

  useEffect(() => {
    if (playbackEngine !== 'spotify') return;
    void useSpotifyPlayerStore.getState().setVolume(volume);
  }, [playbackEngine, volume]);
}
