FROM node:22

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

COPY . .

RUN npm run build && npx prisma generate \
    && chmod +x /app/docker-entrypoint.sh \
    && mkdir -p /app/storage/music /app/storage/cache /app/storage/avatars /app/storage/cookies /app/storage/bin

ENV PATH="/app/storage/bin:/usr/local/bin:${PATH}" \
    YTDLP_BIN=/app/storage/bin/yt-dlp \
    FFMPEG_BIN=/app/storage/bin/ffmpeg

EXPOSE 3001

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
