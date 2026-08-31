-- AlterTable
ALTER TABLE "User" ADD COLUMN "spotifyUserId" TEXT;
ALTER TABLE "User" ADD COLUMN "spotifyAccessToken" TEXT;
ALTER TABLE "User" ADD COLUMN "spotifyRefreshToken" TEXT;
ALTER TABLE "User" ADD COLUMN "spotifyTokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "spotifyProduct" TEXT;
ALTER TABLE "User" ADD COLUMN "spotifyConnectedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_spotifyUserId_key" ON "User"("spotifyUserId");
