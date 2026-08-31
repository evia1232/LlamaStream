#!/bin/sh
# Recover backend when migrate deploy fails with P3009 on 20240831000010_artist_spotify_id.
# Run from repo root: sh backend/scripts/recover-failed-migration.sh

set -e

MIGRATION=20240831000010_artist_spotify_id

echo "Marking failed migration as rolled back..."
docker compose exec -T backend npx prisma migrate resolve --rolled-back "$MIGRATION"

echo "Ensuring Artist.spotifyArtistId column exists..."
docker compose exec -T postgres psql -U "${POSTGRES_USER:-llamastream}" -d "${POSTGRES_DB:-llamastream}" -c \
  'ALTER TABLE "Artist" ADD COLUMN IF NOT EXISTS "spotifyArtistId" TEXT; CREATE INDEX IF NOT EXISTS "Artist_spotifyArtistId_idx" ON "Artist"("spotifyArtistId");'

echo "Redeploying backend..."
docker compose up -d --build backend

echo "Done. Check logs: docker compose logs -f backend"
