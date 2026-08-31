-- AlterTable
ALTER TABLE "Track" ADD COLUMN "downloadedAt" TIMESTAMP(3);

-- Backfill from updatedAt for already-downloaded tracks
UPDATE "Track" SET "downloadedAt" = "updatedAt" WHERE "isDownloaded" = true AND "downloadedAt" IS NULL;
