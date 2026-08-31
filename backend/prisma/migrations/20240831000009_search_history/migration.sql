CREATE TABLE "SearchHistoryQuery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "searchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchHistoryQuery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SearchHistoryTrack" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trackKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "duration" INTEGER NOT NULL DEFAULT 0,
    "thumbnailUrl" TEXT,
    "youtubeUrl" TEXT,
    "spotifyUrl" TEXT,
    "album" TEXT,
    "searchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchHistoryTrack_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SearchHistoryQuery_userId_searchedAt_idx" ON "SearchHistoryQuery"("userId", "searchedAt");
CREATE INDEX "SearchHistoryTrack_userId_searchedAt_idx" ON "SearchHistoryTrack"("userId", "searchedAt");
CREATE UNIQUE INDEX "SearchHistoryTrack_userId_trackKey_key" ON "SearchHistoryTrack"("userId", "trackKey");

ALTER TABLE "SearchHistoryQuery" ADD CONSTRAINT "SearchHistoryQuery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SearchHistoryTrack" ADD CONSTRAINT "SearchHistoryTrack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
