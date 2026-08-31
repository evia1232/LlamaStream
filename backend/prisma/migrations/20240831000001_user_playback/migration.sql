-- CreateTable
CREATE TABLE "UserPlayback" (
    "userId" TEXT NOT NULL,
    "trackId" TEXT,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isPlaying" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPlayback_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "UserPlayback" ADD CONSTRAINT "UserPlayback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPlayback" ADD CONSTRAINT "UserPlayback_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;
