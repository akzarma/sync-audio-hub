import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import os from 'os';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.resolve('./public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');

// Ensure directories exist
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Static files
app.use(express.static(PUBLIC_DIR));

// Multer storage for uploaded audio (rooms)
const storage = multer.diskStorage({
  destination: function (req, _file, cb) {
    const roomId = req.params.roomId || 'default';
    const roomDir = path.join(UPLOAD_DIR, roomId);
    fs.mkdirSync(roomDir, { recursive: true });
    cb(null, roomDir);
  },
  filename: function (_req, file, cb) {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, `${Date.now()}_${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 1024 * 1024 * 200 // 200MB
  },
  fileFilter: (_req, file, cb) => {
    if ((file.mimetype || '').startsWith('audio/')) cb(null, true);
    else cb(new Error('Only audio files are allowed'));
  }
});

// Upload endpoint (per room)
app.post('/upload/:roomId', upload.single('audio'), (req, res) => {
  const roomId = req.params.roomId;
  const relativePath = `/uploads/${roomId}/${path.basename(req.file.path)}`;
  res.json({ ok: true, url: relativePath, roomId });
});

// Clock sync variables
let serverClockOffsetMs = 0; // base for drift, not currently needed but kept for future

// Playback session state per room
const rooms = new Map();
function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      currentTrackUrl: null,
      sessionStartAtServerMs: null,
      sessionPaused: true,
      sessionPauseAtPositionMs: 0,
    });
  }
  return rooms.get(roomId);
}

// Helper to get LAN addresses
function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

io.on('connection', (socket) => {
  const roomId = (socket.handshake.query?.room || '').toString() || 'default';
  socket.join(roomId);
  const state = getRoom(roomId);
  // Send initial state and time
  socket.emit('welcome', {
    serverTimeMs: Date.now(),
    roomId,
    state: {
      currentTrackUrl: state.currentTrackUrl,
      sessionStartAtServerMs: state.sessionStartAtServerMs,
      sessionPaused: state.sessionPaused,
      sessionPauseAtPositionMs: state.sessionPauseAtPositionMs
    }
  });

  // Basic NTP-like clock sync: client sends t0, server replies with t1
  socket.on('clock:ping', (clientPing) => {
    socket.emit('clock:pong', {
      tServer: Date.now(),
      echo: clientPing
    });
  });

  // Owner (any client) sets a new track URL
  socket.on('track:set', ({ url }) => {
    const s = getRoom(roomId);
    s.currentTrackUrl = url;
    s.sessionStartAtServerMs = null;
    s.sessionPaused = true;
    s.sessionPauseAtPositionMs = 0;
    io.to(roomId).emit('track:updated', {
      currentTrackUrl: s.currentTrackUrl,
      sessionStartAtServerMs: s.sessionStartAtServerMs,
      sessionPaused: s.sessionPaused,
      sessionPauseAtPositionMs: s.sessionPauseAtPositionMs
    });
  });

  // Play from a given server-time start
  socket.on('play', ({ startAtServerMs, startPositionMs = 0 }) => {
    const s = getRoom(roomId);
    if (!s.currentTrackUrl) return;
    s.sessionPaused = false;
    s.sessionPauseAtPositionMs = startPositionMs;
    s.sessionStartAtServerMs = startAtServerMs || Date.now() + 500; // default: half-second future
    io.to(roomId).emit('play', {
      startAtServerMs: s.sessionStartAtServerMs,
      startPositionMs: s.sessionPauseAtPositionMs
    });
  });

  // Pause at a given position
  socket.on('pause', ({ positionMs }) => {
    const s = getRoom(roomId);
    s.sessionPaused = true;
    s.sessionPauseAtPositionMs = positionMs;
    io.to(roomId).emit('pause', { positionMs: sessionPauseAtServerMs(positionMs) });
  });

  // Seek to a new position
  socket.on('seek', ({ positionMs, startAtServerMs }) => {
    const s = getRoom(roomId);
    s.sessionPauseAtPositionMs = positionMs;
    s.sessionStartAtServerMs = startAtServerMs || Date.now() + 500;
    io.to(roomId).emit('seek', {
      positionMs: s.sessionPauseAtPositionMs,
      startAtServerMs: s.sessionStartAtServerMs
    });
  });
});

// Helper to normalize position to server time boundary
function sessionPauseAtServerMs(positionMs) {
  return positionMs;
}

app.get('/lan', (_req, res) => {
  res.json({
    port: PORT,
    addresses: getLanAddresses()
  });
});

// Generate unique room id and redirect
function generateRoomId() {
  return Math.random().toString(36).slice(2, 8);
}

app.get('/', (req, res) => {
  const id = generateRoomId();
  res.redirect(`/r/${id}`);
});

// Serve index for any room path
app.get('/r/:roomId', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

server.listen(PORT, () => {
  const addrs = getLanAddresses();
  const urls = addrs.map(a => `http://${a}:${PORT}`);
  const local = `http://localhost:${PORT}`;
  console.log('Sync Audio Network running at:');
  console.log(`  Local:   ${local}`);
  urls.forEach((u) => console.log(`  LAN:     ${u}`));
});



