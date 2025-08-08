# Sync Audio Hub

Synchronized audio playback across multiple devices on the same network (and over the internet via ngrok). Drag and drop an audio file, then play/pause/seek in sync on everyone's machine with automatic drift correction.

## Features

- Drag-and-drop audio upload (served to all clients)
- Shows host LAN URLs so others on the same network can join
- One-click Enable Audio per device to satisfy autoplay policies
- Synchronized play, pause, and seek via WebSockets
- NTP-like clock offset estimation and auto drift correction
- Optional public sharing via ngrok with live tunnel URL in the UI

## Requirements

- Node.js 18+
- ngrok CLI (optional, for public URL): brew install ngrok

## Quick Start (local)

```bash
npm install
npm start
```

Then open http://localhost:3000 → You will be redirected to a unique room URL like `/r/abcd12`. Share that URL so others join the same room.
Share locally: LAN URLs appear in the header.

## Public deploy (free)
### Fly.io
1) Install CLI: https://fly.io/docs/hands-on/install-flyctl/
2) Login: `fly auth login`
3) Launch & deploy: `fly launch --now` (accept defaults; app name must be globally unique)
4) Open: `fly open`

The server sets `PORT` to 8080 inside the container; Fly maps it to 443/80 automatically.

### Docker (optional)
```bash
docker build -t sync-audio-hub .
docker run -p 8080:8080 sync-audio-hub
```
Open http://localhost:8080

## ngrok (optional, for local public link)

- Install: brew install ngrok
- Add authtoken (recommended): ngrok config add-authtoken <YOUR_TOKEN>
- Or set env for this app: export NGROK_AUTHTOKEN=<YOUR_TOKEN>

The server spawns ngrok automatically and polls its local API to discover the public URL.

## Notes

- Uploaded files are saved to public/uploads/ (git-ignored)
- Any client can control playback; all clients follow
- If a device drifts, correction will nudge or re-align

## Scripts

- npm start -> starts Express + Socket.IO server and spawns ngrok if available
