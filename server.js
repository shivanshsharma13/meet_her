import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const MEMORY_DIR = path.join(DATA_DIR, 'memories');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const MEMORIES_FILE = path.join(DATA_DIR, 'memories.json');
fs.mkdirSync(MEMORY_DIR, { recursive: true });

// Exactly two people can ever log in.
const USERS = [1, 2].map((n) => ({
  id: `u${n}`,
  name: process.env[`USER${n}_NAME`],
  pass: process.env[`USER${n}_PASS`],
}));
if (USERS.some((u) => !u.name || !u.pass)) {
  console.error('Missing users. Copy .env.example to .env and fill in both names and passcodes.');
  process.exit(1);
}
if (USERS[0].pass === USERS[1].pass) {
  console.error('USER1_PASS and USER2_PASS must be different (the passcode decides who you are).');
  process.exit(1);
}

const partnerOf = (user) => USERS.find((u) => u.id !== user.id);
const publicUser = (user) => ({ id: user.id, name: user.name });

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));

const sessions = readJson(SESSIONS_FILE, {}); // token -> user id
const memories = readJson(MEMORIES_FILE, []);

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return cookies;
}

function userFromReq(req) {
  const id = sessions[parseCookies(req.headers.cookie).sid];
  return USERS.find((u) => u.id === id);
}

function requireUser(req, res, next) {
  req.user = userFromReq(req);
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  next();
}

const sha = (value) => crypto.createHash('sha256').update(String(value)).digest();

function iceServers() {
  const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URLS) {
    servers.push({
      urls: process.env.TURN_URLS.split(','),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }
  return servers;
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '15mb' }));

app.post('/api/login', async (req, res) => {
  const passcode = String(req.body?.passcode || '');
  const user = USERS.find((u) => crypto.timingSafeEqual(sha(u.pass), sha(passcode)));
  if (!user) {
    await new Promise((resolve) => setTimeout(resolve, 800)); // slow down guessing
    return res.status(401).json({ error: 'That passcode isn’t right' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = user.id;
  writeJson(SESSIONS_FILE, sessions);
  res.cookie('sid', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: 365 * 24 * 60 * 60 * 1000,
  });
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  delete sessions[parseCookies(req.headers.cookie).sid];
  writeJson(SESSIONS_FILE, sessions);
  res.clearCookie('sid');
  res.json({ ok: true });
});

app.get('/api/me', requireUser, (req, res) => {
  const partner = partnerOf(req.user);
  res.json({
    me: publicUser(req.user),
    partner: publicUser(partner),
    partnerOnline: isOnline(partner),
    iceServers: iceServers(),
  });
});

app.get('/api/memories', requireUser, (req, res) => res.json(memories));

app.post('/api/memories', requireUser, (req, res) => {
  const match = /^data:image\/(jpeg|png);base64,(.+)$/.exec(req.body?.image || '');
  if (!match) return res.status(400).json({ error: 'Expected a JPEG or PNG data URL' });
  const file = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${match[1] === 'png' ? 'png' : 'jpg'}`;
  fs.writeFileSync(path.join(MEMORY_DIR, file), Buffer.from(match[2], 'base64'));
  const memory = {
    file,
    caption: String(req.body.caption || '').slice(0, 200),
    by: req.user.id,
    at: new Date().toISOString(),
  };
  memories.unshift(memory);
  writeJson(MEMORIES_FILE, memories);
  for (const user of USERS) sendToUser(user, { type: 'memory', memory });
  res.json(memory);
});

app.use('/memories', requireUser, express.static(MEMORY_DIR, { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(ROOT, 'public')));

let server;
if (process.env.HTTPS === '1') {
  // Self-signed certificate so phones on the same Wi-Fi can use the camera (it needs HTTPS).
  const { default: selfsigned } = await import('selfsigned');
  const pems = selfsigned.generate([{ name: 'commonName', value: 'our-little-room' }], { days: 365, keySize: 2048 });
  server = https.createServer({ key: pems.private, cert: pems.cert }, app);
} else {
  server = http.createServer(app);
}

// WebSocket relay: signaling for calls plus live in-call effects (hearts, touches, booth).
// Each device gets its own connection id, so her phone and tablet can both be online.
const sockets = new Map(); // conn id -> { ws, user }
const wss = new WebSocketServer({ noServer: true });

const connsOf = (user) => [...sockets.entries()].filter(([, s]) => s.user.id === user.id);
const isOnline = (user) => connsOf(user).length > 0;

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function sendToUser(user, msg, exceptConn) {
  for (const [conn, s] of connsOf(user)) if (conn !== exceptConn) send(s.ws, msg);
}

function broadcastPresence() {
  for (const user of USERS) sendToUser(user, { type: 'presence', partnerOnline: isOnline(partnerOf(user)) });
}

server.on('upgrade', (req, socket, head) => {
  const user = userFromReq(req);
  if (!user || new URL(req.url, 'http://localhost').pathname !== '/ws') {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => onConnect(ws, user));
});

function onConnect(ws, user) {
  const conn = crypto.randomUUID();
  sockets.set(conn, { ws, user });
  send(ws, { type: 'hello', conn });
  broadcastPresence();

  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg?.type !== 'string') return;
    const { to, scope, ...rest } = msg;
    const out = { ...rest, from: conn };

    // scope "self": my other devices (e.g. stop ringing on her tablet once she answers on her phone)
    if (scope === 'self') return sendToUser(user, out, conn);

    const partner = partnerOf(user);
    if (to) {
      const target = sockets.get(to);
      if (target?.user.id === partner.id) send(target.ws, out);
      return;
    }
    sendToUser(partner, out);
  });

  ws.on('close', () => {
    sockets.delete(conn);
    sendToUser(partnerOf(user), { type: 'conn-gone', conn });
    broadcastPresence();
  });
}

setInterval(() => {
  for (const { ws } of sockets.values()) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  const proto = process.env.HTTPS === '1' ? 'https' : 'http';
  console.log(`Our Little Room is open at ${proto}://localhost:${port}`);
});
