FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    ca-certificates \
    && pip3 install --break-system-packages -U yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

COPY . .

RUN npm run build && npx prisma generate

RUN mkdir -p /app/storage/music /app/storage/cache /app/storage/avatars \
    && yt-dlp --version

EXPOSE 3001

CMD ["sh", "-c", "pip3 install --break-system-packages -U yt-dlp 2>/dev/null; npx prisma migrate deploy && node dist/index.js"]
