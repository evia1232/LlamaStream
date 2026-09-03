#!/bin/sh
set -e

# Install into container FS (/usr/local/bin) — volume mounts are often noexec → EACCES
BIN_DIR="/usr/local/bin"
CACHE_DIR="${BIN_CACHE_DIR:-/app/storage/bin}"
mkdir -p "$CACHE_DIR"

export PATH="$BIN_DIR:$PATH"
export YTDLP_BIN="${YTDLP_BIN:-$BIN_DIR/yt-dlp}"
export FFMPEG_BIN="${FFMPEG_BIN:-$BIN_DIR/ffmpeg}"

install_ytdlp() {
  set +e
  if [ -x "$BIN_DIR/yt-dlp" ] && "$BIN_DIR/yt-dlp" --version >/dev/null 2>&1; then
    set -e
    return 0
  fi

  # Reuse cached copy from volume if present and runnable when copied to /usr/local/bin
  if [ -f "$CACHE_DIR/yt-dlp" ]; then
    cp -f "$CACHE_DIR/yt-dlp" "$BIN_DIR/yt-dlp"
    chmod 755 "$BIN_DIR/yt-dlp"
    if "$BIN_DIR/yt-dlp" --version >/dev/null 2>&1; then
      echo "[bootstrap] yt-dlp restored from cache"
      set -e
      return 0
    fi
  fi

  echo "[bootstrap] Downloading yt-dlp_linux in background..."
  if curl -fsSL --connect-timeout 15 --max-time 180 --retry 3 --retry-delay 2 \
    -o "$BIN_DIR/yt-dlp.tmp" \
    https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux; then
    mv -f "$BIN_DIR/yt-dlp.tmp" "$BIN_DIR/yt-dlp"
    chmod 755 "$BIN_DIR/yt-dlp"
    if "$BIN_DIR/yt-dlp" --version; then
      cp -f "$BIN_DIR/yt-dlp" "$CACHE_DIR/yt-dlp" 2>/dev/null || true
      chmod 755 "$CACHE_DIR/yt-dlp" 2>/dev/null || true
      echo "[bootstrap] yt-dlp ready"
    else
      echo "[bootstrap] yt-dlp binary invalid"
      rm -f "$BIN_DIR/yt-dlp"
    fi
  else
    rm -f "$BIN_DIR/yt-dlp.tmp"
    echo "[bootstrap] yt-dlp download failed/timed out"
  fi
  set -e
}

install_ffmpeg() {
  set +e
  if [ -x "$BIN_DIR/ffmpeg" ] && [ -x "$BIN_DIR/ffprobe" ]; then
    set -e
    return 0
  fi

  if [ -f "$CACHE_DIR/ffmpeg" ] && [ -f "$CACHE_DIR/ffprobe" ]; then
    cp -f "$CACHE_DIR/ffmpeg" "$BIN_DIR/ffmpeg"
    cp -f "$CACHE_DIR/ffprobe" "$BIN_DIR/ffprobe"
    chmod 755 "$BIN_DIR/ffmpeg" "$BIN_DIR/ffprobe"
    if "$BIN_DIR/ffmpeg" -version >/dev/null 2>&1; then
      echo "[bootstrap] ffmpeg restored from cache"
      set -e
      return 0
    fi
  fi

  echo "[bootstrap] Downloading static ffmpeg in background..."
  tmp="$(mktemp -d)"
  if curl -fsSL --connect-timeout 15 --max-time 300 --retry 3 --retry-delay 2 \
    -o "$tmp/ffmpeg.tar.xz" \
    https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz; then
    if tar -xJf "$tmp/ffmpeg.tar.xz" -C "$tmp" \
      && cp "$tmp"/ffmpeg-*/bin/ffmpeg "$BIN_DIR/ffmpeg" \
      && cp "$tmp"/ffmpeg-*/bin/ffprobe "$BIN_DIR/ffprobe"; then
      chmod 755 "$BIN_DIR/ffmpeg" "$BIN_DIR/ffprobe"
      cp -f "$BIN_DIR/ffmpeg" "$CACHE_DIR/ffmpeg" 2>/dev/null || true
      cp -f "$BIN_DIR/ffprobe" "$CACHE_DIR/ffprobe" 2>/dev/null || true
      echo "[bootstrap] ffmpeg ready"
    else
      echo "[bootstrap] ffmpeg extract failed"
    fi
  else
    echo "[bootstrap] ffmpeg download failed/timed out"
  fi
  rm -rf "$tmp"
  set -e
}

(install_ytdlp; install_ffmpeg) &

echo "[bootstrap] Starting API"
exec "$@"
