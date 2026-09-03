#!/bin/sh
set -e

BIN_DIR="${BIN_DIR:-/app/storage/bin}"
mkdir -p "$BIN_DIR"
export PATH="$BIN_DIR:$PATH"
export YTDLP_BIN="${YTDLP_BIN:-$BIN_DIR/yt-dlp}"
export FFMPEG_BIN="${FFMPEG_BIN:-$BIN_DIR/ffmpeg}"

# Never block API startup on GitHub downloads (that caused 502 while curling yt-dlp).
bootstrap_bins() {
  set +e
  if [ ! -x "$BIN_DIR/yt-dlp" ] || ! "$BIN_DIR/yt-dlp" --version >/dev/null 2>&1; then
    echo "[bootstrap] Downloading yt-dlp_linux in background..."
    if curl -fsSL --connect-timeout 15 --max-time 180 --retry 3 --retry-delay 2 \
      -o "$BIN_DIR/yt-dlp.tmp" \
      https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux; then
      mv -f "$BIN_DIR/yt-dlp.tmp" "$BIN_DIR/yt-dlp"
      chmod a+rx "$BIN_DIR/yt-dlp"
      "$BIN_DIR/yt-dlp" --version && echo "[bootstrap] yt-dlp ready"
    else
      rm -f "$BIN_DIR/yt-dlp.tmp"
      echo "[bootstrap] yt-dlp download failed/timed out — YouTube may not work until retry"
    fi
  fi

  if [ ! -x "$BIN_DIR/ffmpeg" ] || [ ! -x "$BIN_DIR/ffprobe" ]; then
    echo "[bootstrap] Downloading static ffmpeg in background..."
    tmp="$(mktemp -d)"
    if curl -fsSL --connect-timeout 15 --max-time 300 --retry 3 --retry-delay 2 \
      -o "$tmp/ffmpeg.tar.xz" \
      https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz; then
      tar -xJf "$tmp/ffmpeg.tar.xz" -C "$tmp" \
        && cp "$tmp"/ffmpeg-*/bin/ffmpeg "$BIN_DIR/ffmpeg" \
        && cp "$tmp"/ffmpeg-*/bin/ffprobe "$BIN_DIR/ffprobe" \
        && chmod a+rx "$BIN_DIR/ffmpeg" "$BIN_DIR/ffprobe" \
        && echo "[bootstrap] ffmpeg ready"
    else
      echo "[bootstrap] ffmpeg download failed/timed out"
    fi
    rm -rf "$tmp"
  fi
  set -e
}

bootstrap_bins &

echo "[bootstrap] Starting API (binary install continues in background if needed)"
exec "$@"
