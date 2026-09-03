FROM node:22-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    ca-certificates \
    unzip \
    && curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh \
    && pip3 install --break-system-packages -U "yt-dlp[default]" \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/usr/local/bin:${PATH}"

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

COPY . .

RUN npm run build && npx prisma generate

RUN mkdir -p /app/storage/music /app/storage/cache /app/storage/avatars /app/storage/cookies \
    && deno --version \
    && yt-dlp --version

EXPOSE 3001

# Keep yt-dlp + EJS solvers current; Deno is used by default for YouTube signature challenges
CMD ["sh", "-c", "pip3 install --break-system-packages -U \"yt-dlp[default]\" 2>/dev/null; npx prisma migrate deploy && node dist/index.js"]
