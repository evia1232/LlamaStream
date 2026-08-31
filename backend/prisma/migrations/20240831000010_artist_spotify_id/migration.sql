-- AlterTable (idempotent — safe if a prior deploy partially applied this migration)
ALTER TABLE "Artist" ADD COLUMN IF NOT EXISTS "spotifyArtistId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Artist_spotifyArtistId_idx" ON "Artist"("spotifyArtistId");
