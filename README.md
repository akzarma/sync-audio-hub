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

## Quick Start
```bash
npm install
npm start
```
Then open http://localhost:3000
- Share locally: LAN URLs appear in the header
- Share publicly: ngrok URL appears once the tunnel is up

## ngrok (optional)
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


