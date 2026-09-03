#!/bin/sh
set -e

BIN_DIR="${BIN_DIR:-/app/storage/bin}"
mkdir -p "$BIN_DIR"

need_ytdlp=0
need_ffmpeg=0

if [ ! -x "$BIN_DIR/yt-dlp" ]; then
  need_ytdlp=1
elif ! "$BIN_DIR/yt-dlp" --version >/dev/null 2>&1; then
  need_ytdlp=1
fi

if [ ! -x "$BIN_DIR/ffmpeg" ] || [ ! -x "$BIN_DIR/ffprobe" ]; then
  need_ffmpeg=1
fi

if [ "$need_ytdlp" = "1" ]; then
  echo "[bootstrap] Downloading yt-dlp_linux (standalone, once)..."
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -o "$BIN_DIR/yt-dlp" \
    https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux
  chmod a+rx "$BIN_DIR/yt-dlp"
  "$BIN_DIR/yt-dlp" --version
fi

if [ "$need_ffmpeg" = "1" ]; then
  echo "[bootstrap] Downloading static ffmpeg (once)..."
  tmp="$(mktemp -d)"
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -o "$tmp/ffmpeg.tar.xz" \
    https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz
  tar -xJf "$tmp/ffmpeg.tar.xz" -C "$tmp"
  cp "$tmp"/ffmpeg-*/bin/ffmpeg "$BIN_DIR/ffmpeg"
  cp "$tmp"/ffmpeg-*/bin/ffprobe "$BIN_DIR/ffprobe"
  chmod a+rx "$BIN_DIR/ffmpeg" "$BIN_DIR/ffprobe"
  rm -rf "$tmp"
  "$BIN_DIR/ffmpeg" -version | head -n 1
fi

# Prefer storage bin over anything else
export PATH="$BIN_DIR:$PATH"

exec "$@"
