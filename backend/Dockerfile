FROM node:22-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# Split layers so a hang is obvious (apt vs pip vs yt-dlp)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      curl \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ffmpeg is large — separate so progress is visible
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp + EJS solvers (YouTube signature challenges need Node 22 via --js-runtimes node)
RUN pip3 install --break-system-packages -U "yt-dlp[default]" \
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
