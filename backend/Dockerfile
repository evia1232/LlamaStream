FROM node:22

WORKDIR /app

ENV NPM_CONFIG_LOGLEVEL=info \
    NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_PROGRESS=true \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false

COPY package.json package-lock.json ./
COPY prisma ./prisma/

# ci is deterministic; --prefer-offline helps when layers are warm
RUN npm ci --no-audit --no-fund

COPY . .

RUN npm run build \
    && npx prisma generate \
    && chmod +x /app/docker-entrypoint.sh \
    && mkdir -p /app/storage/music /app/storage/cache /app/storage/avatars /app/storage/cookies /app/storage/bin \
    && npm prune --omit=dev

ENV PATH="/app/storage/bin:/usr/local/bin:${PATH}" \
    YTDLP_BIN=/app/storage/bin/yt-dlp \
    FFMPEG_BIN=/app/storage/bin/ffmpeg

EXPOSE 3001

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
