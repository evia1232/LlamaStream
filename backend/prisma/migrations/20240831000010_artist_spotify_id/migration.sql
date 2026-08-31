-- AlterTable
ALTER TABLE "Artist" ADD COLUMN "spotifyArtistId" TEXT;

-- CreateIndex
CREATE INDEX "Artist_spotifyArtistId_idx" ON "Artist"("spotifyArtistId");
