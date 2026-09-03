FROM node:22-slim

# Node 22 is the JS runtime for yt-dlp YouTube EJS challenges (--js-runtimes node).
# Avoid Deno install.sh — it often hangs on slow VPS networks.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    ca-certificates \
    && pip3 install --break-system-packages -U "yt-dlp[default]" \
    && rm -rf /var/lib/apt/lists/* \
    && yt-dlp --version \
    && node --version

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

COPY . .

RUN npm run build && npx prisma generate

RUN mkdir -p /app/storage/music /app/storage/cache /app/storage/avatars /app/storage/cookies

EXPOSE 3001

CMD ["sh", "-c", "pip3 install --break-system-packages -U \"yt-dlp[default]\" 2>/dev/null; npx prisma migrate deploy && node dist/index.js"]
