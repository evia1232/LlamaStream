FROM node:22

# Full node image already has ca-certificates + curl — no apt-get (BuildKit hangs on Debian mirrors here).

# Official yt-dlp binary — bundles EJS solvers; Node 22 is the JS runtime
RUN curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
      -o /usr/local/bin/yt-dlp \
      https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && yt-dlp --version

# Static ffmpeg/ffprobe
RUN curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
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

CMD ["sh", "-c", "curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp && chmod a+rx /usr/local/bin/yt-dlp; npx prisma migrate deploy && node dist/index.js"]
