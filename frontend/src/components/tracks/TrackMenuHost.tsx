import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Heart, ListPlus, Download, ListMusic, Trash2, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { useTrackMenuStore } from '../../store/trackMenuStore';
import { usePlayerStore } from '../../store';
import { getArtistName, normalizeTrack, isTrackLiked } from '../../lib/trackUtils';
import api from '../../api/client';
import TrackContextMenu, { TrackMenuAction } from './TrackContextMenu';
import AddToPlaylistModal from './AddToPlaylistModal';

function isLibraryTrack(trackId: string): boolean {
  return !trackId.startsWith('external-');
}

export default function TrackMenuHost() {
  const { t } = useTranslation();
  const {
    track, options, menuOpen, menuPos, playlistModalOpen,
    closeMenu, openPlaylistModal, closePlaylistModal,
  } = useTrackMenuStore();

  const {
    currentTrack, likedTrackIds, likedPendingTracks, playTrack, toggleLike, addToQueue, setCurrentTrack,
  } = usePlayerStore();

  const [downloading, setDownloading] = useState(false);
  const [researching, setResearching] = useState(false);

  if (!track) return null;

  const artistName = getArtistName(track.artist);
  const isLiked = isTrackLiked(track, likedTrackIds, likedPendingTracks);
  const hasLibraryId = isLibraryTrack(track.id);
  const canStream = track.isDownloaded;
  const canRemoveFromLibrary = canStream && hasLibraryId;

  const handleDownload = async () => {
    if (canStream) return;
    setDownloading(true);
    try {
      const payload = track.youtubeUrl
        ? {
            url: track.youtubeUrl,
            title: track.title,
            artist: artistName,
            duration: track.duration,
            album: track.album?.title,
          }
        : {
            query: `${artistName} - ${track.title}`,
            spotifyUrl: track.spotifyUrl || options.external?.spotifyUrl,
            url: options.external?.url,
            title: track.title,
            artist: artistName,
            duration: track.duration,
            album: options.external?.album || track.album?.title,
          };
      const { data } = await api.post('/tracks/download', payload);
      await playTrack(normalizeTrack(data.track));
      options.onRefresh?.();
    } catch (err: unknown) {
      alert((err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('error'));
    } finally {
      setDownloading(false);
    }
  };

  const handlePlay = async () => {
    await playTrack(track);
  };

  const handleAddToQueue = (playNext = false) => {
    addToQueue(track.id, playNext, track);
  };

  const handleRemoveFromPlaylist = async () => {
    if (!options.playlistId) return;
    if (!confirm(t('confirmDelete'))) return;
    try {
      await api.delete(`/playlists/${options.playlistId}/tracks/${track.id}`);
      options.onDeleted?.();
      options.onRefresh?.();
    } catch {
      alert(t('error'));
    }
  };

  const handleRemoveFromLibrary = async () => {
    if (!confirm(t('confirmRemoveFromLibrary'))) return;
    try {
      await api.delete(`/tracks/${track.id}`);
      if (currentTrack?.id === track.id) setCurrentTrack(null);
      options.onDeleted?.();
      options.onRefresh?.();
    } catch {
      alert(t('error'));
    }
  };

  const handleResearch = async () => {
    if (!hasLibraryId || researching) return;
    if (!confirm(t('confirmResearchTrack'))) return;
    setResearching(true);
    try {
      const { data } = await api.post(`/tracks/${track.id}/research`);
      const updated = normalizeTrack(data.track);
      if (currentTrack?.id === track.id) {
        setCurrentTrack(updated);
      }
      playTrack(updated);
      options.onRefresh?.();
    } catch (err: unknown) {
      alert((err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('error'));
    } finally {
      setResearching(false);
    }
  };

  const menuActions: TrackMenuAction[] = [
    {
      id: 'play',
      label: t('play'),
      icon: <Play className="w-4 h-4" />,
      onClick: () => { void handlePlay(); },
    },
    ...(hasLibraryId ? [{
      id: 'addToPlaylist',
      label: t('addToPlaylist'),
      icon: <ListPlus className="w-4 h-4" />,
      onClick: () => openPlaylistModal(),
    }] : []),
    ...(hasLibraryId ? [{
      id: 'addToQueue',
      label: t('addToQueue'),
      icon: <ListMusic className="w-4 h-4" />,
      onClick: () => { handleAddToQueue(false); },
    }] : []),
    ...(hasLibraryId ? [{
      id: 'playNext',
      label: t('playNext'),
      icon: <ListMusic className="w-4 h-4" />,
      onClick: () => { handleAddToQueue(true); },
    }] : []),
    ...(hasLibraryId ? [{
      id: 'like',
      label: isLiked ? t('unlike') : t('like'),
      icon: <Heart className="w-4 h-4" fill={isLiked ? 'currentColor' : 'none'} />,
      onClick: () => { toggleLike(track.id, track); },
    }] : []),
    ...(hasLibraryId ? [{
      id: 'research',
      label: researching ? t('researching') : t('researchTrack'),
      icon: <RefreshCw className={clsx('w-4 h-4', researching && 'animate-spin')} />,
      onClick: () => { void handleResearch(); },
      disabled: researching || downloading,
    }] : []),
    ...(!canStream ? [{
      id: 'download',
      label: downloading ? t('downloading') : (track.spotifyUrl || track.source === 'spotify' ? t('saveToLibrary') : t('download')),
      icon: <Download className="w-4 h-4" />,
      onClick: () => { void handleDownload(); },
      disabled: downloading,
    }] : []),
    ...(options.playlistId && hasLibraryId ? [{
      id: 'removePlaylist',
      label: t('removeFromPlaylist'),
      icon: <Trash2 className="w-4 h-4" />,
      onClick: () => { void handleRemoveFromPlaylist(); },
      danger: true,
    }] : []),
    ...(canRemoveFromLibrary ? [{
      id: 'removeLibrary',
      label: t('removeFromLibrary'),
      icon: <Trash2 className="w-4 h-4" />,
      onClick: () => { void handleRemoveFromLibrary(); },
      danger: true,
    }] : []),
  ];

  return (
    <>
      <TrackContextMenu
        open={menuOpen}
        position={menuPos}
        actions={menuActions}
        onClose={closeMenu}
      />
      {hasLibraryId && (
        <AddToPlaylistModal
          track={track}
          open={playlistModalOpen}
          onClose={closePlaylistModal}
        />
      )}
    </>
  );
}
