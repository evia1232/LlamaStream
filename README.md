# LlamaStream

Self-hosted music streaming platform with a Spotify-like UI, local audio caching, playlist management, and Hebrew/RTL support.

## Features

- **Spotify-like UI** — Dark theme, sidebar navigation, sticky bottom player, queue drawer, synced lyrics
- **Local audio caching** — Downloads tracks via yt-dlp and streams from local storage on repeat plays
- **Authentication & RBAC** — JWT auth with admin-only user registration (disabled by default)
- **Playlist management** — Create, edit, import from Spotify public playlists, export to JSON/M3U/TXT
- **Full playback engine** — Play/pause, skip, shuffle, repeat (off/all/one), seek bar, volume, queue
- **Hebrew & RTL** — Full i18n support with Hebrew as default language and RTL layout
- **Persistent storage** — All music, database, avatars, and cache stored on host via Docker volumes

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│  Frontend   │────▶│   Backend   │────▶│  PostgreSQL  │
│  (Nginx)    │     │  (Express)  │     │              │
│  Port 3000  │     │  Port 3001  │     │  Port 5432   │
└─────────────┘     └──────┬──────┘     └──────────────┘
                           │
                    ┌──────▼──────┐
                    │   yt-dlp    │
                    │  (in container)
                    └─────────────┘
```

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) & [Docker Compose](https://docs.docker.com/compose/install/) v2+
- At least 2 GB free disk space for music storage

## Quick Start

### 1. Clone and configure

```bash
git clone <your-repo-url> LlamaStream
cd LlamaStream
cp .env.example .env
```

Edit `.env` and **change these values for production**:

```env
JWT_SECRET=your-long-random-secret-string-here
POSTGRES_PASSWORD=your-secure-db-password
ADMIN_PASSWORD=your-secure-admin-password
```

### 2. Start all services

```bash
docker compose up -d --build
```

This starts three containers:
- **postgres** — Database with data persisted to `./storage/postgres`
- **backend** — API server with yt-dlp, music stored in `./storage/music`
- **frontend** — React app served via Nginx on port 3000

### 3. Access the app

Open **http://localhost:3000** in your browser.

### Install as PWA (mobile / desktop)

LlamaStream is a Progressive Web App — install it like a native app:

- **Android Chrome:** Tap the install banner, or Menu → "Add to Home screen"
- **iPhone Safari:** Share → "Add to Home Screen"
- **Desktop Chrome/Edge:** Click the install icon in the address bar

The app works offline for the UI shell; music streaming requires network access to your server.

Default admin credentials (change in `.env`):

| Field    | Value                      |
|----------|----------------------------|
| Email    | `admin@llamastream.local`  |
| Password | `admin123456`              |

### 4. Verify health

```bash
curl http://localhost:3001/api/health
# {"status":"ok","timestamp":"..."}
```

## Storage Volumes

All persistent data is stored on the host machine:

| Host Path              | Container Path           | Purpose                |
|------------------------|--------------------------|------------------------|
| `./storage/postgres/data` | `/var/lib/postgresql/data` | Database files       |
| `./storage/music`      | `/app/storage/music`     | Downloaded audio (MP3) |
| `./storage/cache`      | `/app/storage/cache`     | Playlist covers, cache |
| `./storage/avatars`    | `/app/storage/avatars`   | User avatar images     |

## Usage Guide

### Search & Download Music

1. Go to **Search** (חיפוש)
2. Type an artist or song name
3. Click **Download** on external results, or play already-cached local tracks

### Import Spotify Playlist

1. Go to **Library** (הספרייה שלי)
2. Click **Import from Spotify**
3. Paste a public Spotify playlist URL
4. Tracks are searched, downloaded, and added to a new playlist automatically

### Export Playlist

1. Open any playlist
2. Click **JSON** or **M3U** to download the tracklist

### Create Users (Admin Only)

1. Log in as admin
2. Go to **Settings** (הגדרות)
3. Scroll to **User Management**
4. Click **Create User**

Public registration is disabled by default. Set `ALLOW_PUBLIC_REGISTRATION=true` in `.env` to enable it.

### Audio Quality

Change quality in **Settings** → **Audio Quality**:
- **Low** — 96 kbps
- **Normal** — 192 kbps
- **High** — 320 kbps (default)

### Language

Switch between Hebrew (עברית) and English in **Settings** → **Language**. The UI direction (RTL/LTR) updates automatically.

## API Endpoints

### Authentication
| Method | Endpoint              | Description              |
|--------|-----------------------|--------------------------|
| POST   | `/api/auth/login`     | Login                    |
| POST   | `/api/auth/register`  | Register (admin only)    |
| GET    | `/api/auth/me`        | Current user profile     |
| PUT    | `/api/auth/profile`   | Update profile           |
| GET    | `/api/auth/users`     | List users (admin)       |
| POST   | `/api/auth/users`     | Create user (admin)      |

### Tracks
| Method | Endpoint                    | Description           |
|--------|-----------------------------|-----------------------|
| GET    | `/api/tracks/search?q=`     | Search tracks         |
| POST   | `/api/tracks/download`      | Download track        |
| GET    | `/api/tracks/:id/stream`    | Stream audio (range)  |
| POST   | `/api/tracks/:id/like`      | Toggle like           |
| GET    | `/api/tracks/:id/lyrics`    | Get synced lyrics     |
| GET    | `/api/tracks/liked`         | Liked songs           |

### Playlists
| Method | Endpoint                          | Description          |
|--------|-----------------------------------|----------------------|
| GET    | `/api/playlists`                  | User playlists       |
| POST   | `/api/playlists`                  | Create playlist      |
| POST   | `/api/playlists/import/spotify`   | Import from Spotify  |
| GET    | `/api/playlists/:id/export`       | Export playlist      |

### Queue
| Method | Endpoint              | Description          |
|--------|-----------------------|----------------------|
| GET    | `/api/queue`          | Get queue            |
| POST   | `/api/queue`          | Add to queue         |
| DELETE | `/api/queue/:id`      | Remove from queue    |
| PUT    | `/api/queue/reorder`  | Reorder queue        |

### WebSocket
Connect to `ws://localhost:3001/ws?token=<jwt>` for cross-device playback sync.

## Development (without Docker)

### Backend

```bash
cd backend
npm install
cp ../.env.example .env
# Edit DATABASE_URL to point to local PostgreSQL
npx prisma migrate deploy
npm run dev
```

Requires yt-dlp and ffmpeg installed locally.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend dev server runs on http://localhost:3000 with API proxy to port 3001.

## Environment Variables

| Variable                    | Default                        | Description                        |
|-----------------------------|--------------------------------|------------------------------------|
| `JWT_SECRET`                | (required)                     | Secret for JWT signing             |
| `POSTGRES_PASSWORD`         | `llamastream_secret`           | Database password                  |
| `ADMIN_EMAIL`               | `admin@llamastream.local`      | Initial admin email                |
| `ADMIN_PASSWORD`            | `admin123456`                  | Initial admin password             |
| `ALLOW_PUBLIC_REGISTRATION` | `false`                        | Enable public sign-up              |
| `DEFAULT_AUDIO_QUALITY`     | `high`                         | Default download quality           |
| `CORS_ORIGIN`               | `http://localhost:3000`        | Allowed frontend origin            |
| `BACKEND_PORT`              | `3001`                         | Backend host port                  |
| `FRONTEND_PORT`             | `3000`                         | Frontend host port                 |

## Troubleshooting

**Container won't start:**
```bash
docker compose logs backend
docker compose logs postgres
```

**Database migration failed:**
```bash
docker compose exec backend npx prisma migrate deploy
```

**yt-dlp download errors:**
```bash
docker compose exec backend yt-dlp --version
docker compose exec backend yt-dlp -x --audio-format mp3 "https://youtube.com/watch?v=..."
```

**Reset everything:**
```bash
docker compose down -v
rm -rf storage/postgres/* storage/music/* storage/cache/* storage/avatars/*
docker compose up -d --build
```

## License

MIT
