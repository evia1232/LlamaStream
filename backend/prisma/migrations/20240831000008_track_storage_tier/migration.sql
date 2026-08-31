-- CreateEnum
CREATE TYPE "StorageTier" AS ENUM ('CACHE', 'LIBRARY');

-- AlterTable
ALTER TABLE "Track" ADD COLUMN "storageTier" "StorageTier" NOT NULL DEFAULT 'CACHE';
ALTER TABLE "Track" ADD COLUMN "lastAccessedAt" TIMESTAMP(3);

-- Mark existing liked / playlist tracks as permanent library
UPDATE "Track" SET "storageTier" = 'LIBRARY'
WHERE id IN (
  SELECT "trackId" FROM "LikedTrack"
  UNION
  SELECT "trackId" FROM "PlaylistTrack"
);
