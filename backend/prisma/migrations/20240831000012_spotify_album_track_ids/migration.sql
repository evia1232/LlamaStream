-- AlterTable
ALTER TABLE "Album" ADD COLUMN IF NOT EXISTS "spotifyAlbumId" TEXT;

-- AlterTable
ALTER TABLE "Track" ADD COLUMN IF NOT EXISTS "spotifyTrackId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Album_spotifyAlbumId_idx" ON "Album"("spotifyAlbumId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Track_spotifyTrackId_idx" ON "Track"("spotifyTrackId");
