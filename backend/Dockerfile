FROM node:22-slim

ENV DEBIAN_FRONTEND=noninteractive

# Prefer IPv4 for any apt use
RUN printf 'Acquire::ForceIPv4 "true";\n' > /etc/apt/apt.conf.d/99force-ipv4

# Minimal packages only (avoid heavy apt like full ffmpeg from Debian mirrors)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Official yt-dlp binary — bundles EJS solvers (no pip / yt-dlp[default] needed)
RUN curl -fsSL --retry 5 --retry-delay 2 \
      -o /usr/local/bin/yt-dlp \
      https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && yt-dlp --version

# Static ffmpeg/ffprobe (skips slow Debian ffmpeg package)
RUN curl -fsSL --retry 5 --retry-delay 2 \
      -o /tmp/ffmpeg.tar.xz \
      https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz \
    && tar -xJf /tmp/ffmpeg.tar.xz -C /tmp \
    && cp /tmp/ffmpeg-*/bin/ffmpeg /usr/local/bin/ffmpeg \
    && cp /tmp/ffmpeg-*/bin/ffprobe /usr/local/bin/ffprobe \
    && chmod a+rx /usr/local/bin/ffmpeg /usr/local/bin/ffprobe \
    && rm -rf /tmp/ffmpeg* \
    && ffmpeg -version | head -n 1

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

COPY . .

RUN npm run build && npx prisma generate

RUN mkdir -p /app/storage/music /app/storage/cache /app/storage/avatars /app/storage/cookies

EXPOSE 3001

# Refresh yt-dlp binary on start (optional; ignores failures)
CMD ["sh", "-c", "curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp && chmod a+rx /usr/local/bin/yt-dlp; npx prisma migrate deploy && node dist/index.js"]
