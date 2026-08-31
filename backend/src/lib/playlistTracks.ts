import prisma from '../lib/prisma';

/** Add a track to a playlist, skipping if already present (unique playlistId+trackId). */
export async function addTrackToPlaylist(
  playlistId: string,
  trackId: string,
  position: number
): Promise<{ added: boolean }> {
  const existing = await prisma.playlistTrack.findUnique({
    where: { playlistId_trackId: { playlistId, trackId } },
  });

  if (existing) return { added: false };

  try {
    await prisma.playlistTrack.create({
      data: { playlistId, trackId, position },
    });
    return { added: true };
  } catch (err: unknown) {
    // Race condition safety net for unique constraint
    if ((err as { code?: string }).code === 'P2002') return { added: false };
    throw err;
  }
}

export async function nextPlaylistPosition(playlistId: string): Promise<number> {
  const last = await prisma.playlistTrack.findFirst({
    where: { playlistId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  return (last?.position ?? -1) + 1;
}
