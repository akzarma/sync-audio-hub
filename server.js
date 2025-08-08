import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import os from 'os';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

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

// Multer storage for uploaded audio
const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, UPLOAD_DIR);
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

// Upload endpoint
app.post('/upload', upload.single('audio'), (req, res) => {
  const relativePath = `/uploads/${path.basename(req.file.path)}`;
  res.json({ ok: true, url: relativePath });
});

// Clock sync variables
let serverClockOffsetMs = 0; // base for drift, not currently needed but kept for future

// Playback session state (shared among clients)
let currentTrackUrl = null; // string or null
let sessionStartAtServerMs = null; // epoch ms when the track was requested to start
let sessionPaused = true;
let sessionPauseAtPositionMs = 0; // position where we paused

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
  // Send initial state and time
  socket.emit('welcome', {
    serverTimeMs: Date.now(),
    state: {
      currentTrackUrl,
      sessionStartAtServerMs,
      sessionPaused,
      sessionPauseAtPositionMs
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
    currentTrackUrl = url;
    sessionStartAtServerMs = null;
    sessionPaused = true;
    sessionPauseAtPositionMs = 0;
    io.emit('track:updated', {
      currentTrackUrl,
      sessionStartAtServerMs,
      sessionPaused,
      sessionPauseAtPositionMs
    });
  });

  // Play from a given server-time start
  socket.on('play', ({ startAtServerMs, startPositionMs = 0 }) => {
    if (!currentTrackUrl) return;
    sessionPaused = false;
    sessionPauseAtPositionMs = startPositionMs;
    sessionStartAtServerMs = startAtServerMs || Date.now() + 500; // default: half-second in the future
    io.emit('play', {
      startAtServerMs: sessionStartAtServerMs,
      startPositionMs: sessionPauseAtPositionMs
    });
  });

  // Pause at a given position
  socket.on('pause', ({ positionMs }) => {
    sessionPaused = true;
    sessionPauseAtPositionMs = positionMs;
    io.emit('pause', { positionMs: sessionPauseAtServerMs(positionMs) });
  });

  // Seek to a new position
  socket.on('seek', ({ positionMs, startAtServerMs }) => {
    sessionPauseAtPositionMs = positionMs;
    sessionStartAtServerMs = startAtServerMs || Date.now() + 500;
    io.emit('seek', {
      positionMs: sessionPauseAtPositionMs,
      startAtServerMs: sessionStartAtServerMs
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

server.listen(PORT, () => {
  const addrs = getLanAddresses();
  const urls = addrs.map(a => `http://${a}:${PORT}`);
  const local = `http://localhost:${PORT}`;
  console.log('Sync Audio Network running at:');
  console.log(`  Local:   ${local}`);
  urls.forEach((u) => console.log(`  LAN:     ${u}`));
});

// Ngrok tunnel management via CLI
let tunnelUrl = null;
let ngrokProcess = null;

function ensureNgrokRunning() {
  if (ngrokProcess && !ngrokProcess.killed) return;
  const ngrokCmd = process.env.NGROK_CMD || 'ngrok_custom || ngrok';
  const args = ['http', String(PORT)];
  if (process.env.NGROK_AUTHTOKEN) {
    args.unshift('--authtoken', process.env.NGROK_AUTHTOKEN);
  }
  try {
    ngrokProcess = spawn(`${ngrokCmd}`, args, { stdio: 'ignore', shell: true });
    ngrokProcess.on('exit', (code) => {
      console.warn('ngrok process exited with code', code);
      ngrokProcess = null;
    });
  } catch (err) {
    console.warn('Failed to start ngrok:', err?.message || err);
  }
}

async function pollNgrokApi() {
  try {
    const resp = await fetch('http://127.0.0.1:4040/api/tunnels');
    if (!resp.ok) return;
    const data = await resp.json();
    const pub = (data.tunnels || []).find(t => t.public_url && t.proto && (t.proto === 'https' || t.proto === 'http'));
    if (pub) {
      tunnelUrl = pub.public_url;
    }
  } catch (_e) {
    // 4040 not available yet
  }
}

// Kick off ngrok and poll for URL periodically
ensureNgrokRunning();
setInterval(() => { ensureNgrokRunning(); pollNgrokApi(); }, 3000);

app.get('/tunnel', (_req, res) => {
  res.json({ url: tunnelUrl || null, tokenProvided: Boolean(process.env.NGROK_AUTHTOKEN) });
});


