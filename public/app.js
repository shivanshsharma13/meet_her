import * as room from './room.js';
import { iceServers } from './config.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  me: null,
  partner: null,
  partnerOnline: false,
  call: null,
  incoming: null,
};

// ---------- helpers ----------

function show(id) {
  for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== id;
}

let toastTimer;
function toast(text, ms = 3000) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// Vibration works on Android; iOS browsers ignore it.
const buzz = (pattern) => navigator.vibrate?.(pattern);

const send = room.send;

// ---------- sounds (generated, no audio files needed) ----------

let audioCtx;
document.addEventListener('pointerdown', () => {
  audioCtx ??= new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}, { capture: true });

function beep(freq, start, duration, volume = 0.15) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const t = audioCtx.currentTime + start;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.03);
  gain.gain.linearRampToValueAtTime(0, t + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

let toneTimer;
function startRingtone() {
  stopTone();
  const ring = () => {
    beep(659, 0, 0.25);
    beep(880, 0.3, 0.25);
    beep(659, 0.6, 0.25);
    beep(880, 0.9, 0.35);
    buzz([400, 200, 400]);
  };
  ring();
  toneTimer = setInterval(ring, 2500);
}
function startRingback() {
  stopTone();
  const ring = () => beep(440, 0, 1, 0.06);
  ring();
  toneTimer = setInterval(ring, 3000);
}
function stopTone() {
  clearInterval(toneTimer);
  navigator.vibrate?.(0);
}

// ---------- login & home ----------

function boot() {
  if (!room.isConfigured) {
    show('login');
    $('#signin-btn').disabled = true;
    $('#login-error').textContent = 'Almost there: add your Firebase settings to config.js (see README).';
    return;
  }
  room.onUser((user) => (user ? enterRoom(user) : show('login')));
}

$('#signin-btn').addEventListener('click', async () => {
  $('#login-error').textContent = '';
  try {
    await room.signIn();
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') $('#login-error').textContent = err.message;
  }
});

$('#logout-btn').addEventListener('click', () => {
  if (state.call) return;
  state.me = null;
  room.leaveRoom();
});

async function enterRoom(user) {
  try {
    await room.joinRoom(user, {
      me: (me) => {
        state.me = me;
        $('#hello').textContent = `Hi ${me.name} 💗`;
      },
      partner: (partner) => {
        state.partner = partner;
        renderPartner();
      },
      presence: (online) => {
        state.partnerOnline = online;
        renderPartner();
      },
      message: (msg) => handlers[msg.type]?.(msg),
      memory: addMemory,
    });
    show('home');
  } catch (err) {
    // The database rules only let your two Google accounts in.
    await room.leaveRoom().catch(() => {});
    show('login');
    $('#login-error').textContent = /permission/i.test(err.message)
      ? `This room is private 🔒 (${user.email} isn't on the list)`
      : err.message;
  }
}

function renderPartner() {
  const name = state.partner?.name;
  $('#partner-name').textContent = name || 'Waiting for your person…';
  $('#partner-initial').textContent = name ? name[0].toUpperCase() : '💌';
  $('#incoming-initial').textContent = name?.[0].toUpperCase() ?? '';
  $('#incoming-name').textContent = name ?? '';
  $('#call-name').textContent = name ?? '';
  $('#presence-dot').classList.toggle('on', state.partnerOnline);
  $('#presence-text').textContent = !name ? 'They haven’t signed in yet' : state.partnerOnline ? 'Online now' : 'Away';
  $('#call-btn').disabled = !state.partnerOnline;
}

$('#call-btn').addEventListener('click', startCall);

$('#nudge-btn').addEventListener('click', () => {
  if (!state.partnerOnline) return toast(`${state.partner?.name ?? 'They'} ${state.partner ? 'is away' : 'haven’t joined yet'}`);
  send({ type: 'nudge' });
  floatEmojis('💭', 6);
  toast('Sent 💗');
});

// ---------- memories ----------

// Memories arrive one at a time (all existing ones on sign-in, then new ones live); newest first.
function addMemory(memory) {
  const btn = document.createElement('button');
  const img = document.createElement('img');
  img.src = memory.thumb;
  img.alt = memory.caption;
  btn.append(img);
  btn.addEventListener('click', () => openViewer(memory));
  $('#gallery').prepend(btn);
  $('#gallery-empty').hidden = true;
  if (state.call && Date.now() - memory.at < 60_000) toast('Saved to our memories 📸');
}

async function openViewer(memory) {
  $('#viewer-img').src = memory.thumb;
  $('#viewer-caption').textContent = `${memory.caption} · ${new Date(memory.at).toLocaleString()}`;
  $('#viewer-download').removeAttribute('href');
  $('#viewer').hidden = false;
  const full = await room.loadMemoryImage(memory.id);
  if (!full) return;
  $('#viewer-img').src = full;
  $('#viewer-download').href = full;
  $('#viewer-download').download = `us-${new Date(memory.at).toISOString().slice(0, 10)}.jpg`;
}
$('#viewer-close').addEventListener('click', () => ($('#viewer').hidden = true));

const handlers = {
  nudge: () => {
    toast(`${state.partner.name} is thinking of you 💭💗`, 5000);
    buzz([80, 60, 80, 60, 200]);
    floatEmojis('💗', 14);
  },
  ring: onRing,
  'ring-cancel': (m) => {
    if (state.incoming?.from === m.from) {
      stopIncoming();
      toast(`Missed call from ${state.partner.name}`);
    }
  },
  'ring-stop': () => stopIncoming(),
  busy: () => state.call?.role === 'caller' && endCall(`${state.partner.name} is on another call`),
  decline: () => {
    if (state.call?.role === 'caller' && !state.call.peerConn) endCall(`${state.partner.name} can't talk right now 🥺`);
  },
  accept: onAccept,
  signal: onSignal,
  hangup: (m) => state.call?.peerConn === m.from && endCall(`${state.partner.name} hung up`),
  'conn-gone': (m) => {
    if (state.call?.peerConn === m.conn) endCall('Call dropped');
    if (state.incoming?.from === m.conn) stopIncoming();
  },
  touch: (m) => {
    if (!isInCallWith(m.from)) return;
    showTouch(m.x, m.y, true);
    buzz([40, 40, 40]);
  },
  react: (m) => {
    if (!isInCallWith(m.from)) return;
    floatEmojis(m.emoji);
    buzz(30);
  },
  booth: (m) => isInCallWith(m.from) && runBooth(false),
};

const isInCallWith = (conn) => state.call && state.call.peerConn === conn;

// ---------- calling ----------

async function openMedia(facing = 'user') {
  const audio = { echoCancellation: true, noiseSuppression: true };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio,
    });
  } catch (err) {
    // Camera busy (e.g. another browser has it) or missing: still join with the mic.
    if (err.name !== 'NotReadableError' && err.name !== 'NotFoundError' && err.name !== 'OverconstrainedError') throw err;
    stream = await navigator.mediaDevices.getUserMedia({ audio });
    toast('Camera is busy or missing, joining with mic only 🎙️', 5000);
  }
  const hasVideo = stream.getVideoTracks().length > 0;
  state.call.stream = stream;
  state.call.facing = facing;
  $('#local-video').srcObject = stream;
  $('#local-video').hidden = !hasVideo;
  $('#local-video').classList.toggle('mirror', facing === 'user');
  $('#cam-btn').hidden = !hasVideo;
  const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  $('#flip-btn').hidden = !hasVideo || cams.length < 2;
}

function resetControls() {
  for (const id of ['#mute-btn', '#cam-btn']) $(id).classList.remove('off');
  $('#mute-btn').textContent = '🎙️';
  $('#cam-btn').textContent = '📷';
  $('#emoji-tray').hidden = true;
  $('#call-timer').textContent = '';
}

async function startCall() {
  if (state.call) return;
  state.call = { role: 'caller', peerConn: null, pc: null, pending: [] };
  try {
    await openMedia();
  } catch (err) {
    state.call = null;
    return toast(`Couldn't open camera/mic: ${err.message}`, 5000);
  }
  resetControls();
  show('call');
  setStatus(`Calling ${state.partner.name}…`);
  startRingback();
  send({ type: 'ring' });
  state.call.ringTimer = setTimeout(() => {
    if (state.call && !state.call.peerConn) {
      send({ type: 'ring-cancel' });
      endCall('No answer');
    }
  }, 45_000);
}

function onRing(m) {
  if (state.call || state.incoming) {
    send({ type: 'busy', to: m.from });
    return;
  }
  state.incoming = { from: m.from };
  $('#incoming').hidden = false;
  startRingtone();
}

function stopIncoming() {
  state.incoming = null;
  $('#incoming').hidden = true;
  stopTone();
}

$('#decline-btn').addEventListener('click', () => {
  if (!state.incoming) return;
  send({ type: 'decline', to: state.incoming.from });
  send({ type: 'ring-stop', scope: 'self' });
  stopIncoming();
});

$('#accept-btn').addEventListener('click', async () => {
  if (!state.incoming) return;
  const from = state.incoming.from;
  stopIncoming();
  send({ type: 'ring-stop', scope: 'self' }); // stop ringing on my other devices
  state.call = { role: 'callee', peerConn: from, pc: null, pending: [] };
  try {
    await openMedia();
  } catch (err) {
    state.call = null;
    send({ type: 'decline', to: from });
    return toast(`Couldn't open camera/mic: ${err.message}`, 5000);
  }
  resetControls();
  show('call');
  setStatus('Connecting…');
  createPeer();
  send({ type: 'accept', to: from });
});

async function onAccept(m) {
  const call = state.call;
  if (!call || call.role !== 'caller') return;
  if (call.peerConn) {
    // Her other device answered too late; tell it to stand down.
    if (call.peerConn !== m.from) send({ type: 'hangup', to: m.from });
    return;
  }
  call.peerConn = m.from;
  clearTimeout(call.ringTimer);
  stopTone();
  setStatus('Connecting…');
  const pc = createPeer();
  await pc.setLocalDescription(await pc.createOffer());
  send({ type: 'signal', to: call.peerConn, sdp: pc.localDescription.toJSON() });
}

function createPeer() {
  const call = state.call;
  const pc = new RTCPeerConnection({ iceServers });
  call.pc = pc;
  for (const track of call.stream.getTracks()) pc.addTrack(track, call.stream);
  // Without a camera we still want to see the other person's video.
  if (!call.stream.getVideoTracks().length) pc.addTransceiver('video', { direction: 'recvonly' });

  pc.onicecandidate = (e) => e.candidate && send({ type: 'signal', to: call.peerConn, candidate: e.candidate.toJSON() });
  pc.ontrack = (e) => ($('#remote-video').srcObject = e.streams[0]);
  pc.onconnectionstatechange = () => {
    if (state.call !== call) return;
    if (pc.connectionState === 'connected') {
      setStatus('');
      call.connected = true;
      startTimer();
      keepScreenOn();
    } else if (pc.connectionState === 'disconnected') {
      setStatus('Reconnecting…');
    } else if (pc.connectionState === 'failed') {
      endCall("Couldn't connect. The network may need a TURN server (see README).");
    }
  };
  return pc;
}

async function onSignal(m) {
  const call = state.call;
  if (!call?.pc || call.peerConn !== m.from) return;
  const { pc } = call;
  if (m.sdp) {
    await pc.setRemoteDescription(m.sdp);
    for (const c of call.pending.splice(0)) await pc.addIceCandidate(c);
    if (m.sdp.type === 'offer') {
      await pc.setLocalDescription(await pc.createAnswer());
      send({ type: 'signal', to: call.peerConn, sdp: pc.localDescription.toJSON() });
    }
  } else if (m.candidate) {
    if (pc.remoteDescription) await pc.addIceCandidate(m.candidate);
    else call.pending.push(m.candidate);
  }
}

function endCall(reason) {
  const call = state.call;
  if (!call) return;
  state.call = null;
  clearTimeout(call.ringTimer);
  clearInterval(call.timer);
  stopTone();
  call.pc?.close();
  call.stream?.getTracks().forEach((t) => t.stop());
  call.wakeLock?.release().catch(() => {});
  $('#remote-video').srcObject = null;
  $('#local-video').srcObject = null;
  $('#countdown').hidden = true;
  show('home');
  if (reason) toast(reason, 4000);
}

$('#hangup-btn').addEventListener('click', () => {
  const call = state.call;
  if (!call) return;
  send(call.peerConn ? { type: 'hangup', to: call.peerConn } : { type: 'ring-cancel' });
  endCall();
});

function setStatus(text) {
  $('#call-status').textContent = text;
}

function startTimer() {
  const call = state.call;
  const started = Date.now();
  call.timer = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    const h = Math.floor(s / 3600);
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    $('#call-timer').textContent = h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }, 1000);
}

async function keepScreenOn() {
  try {
    state.call.wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    /* not supported; the screen may dim */
  }
}

// ---------- call controls ----------

$('#mute-btn').addEventListener('click', (e) => {
  const track = state.call?.stream.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  e.currentTarget.classList.toggle('off', !track.enabled);
  e.currentTarget.textContent = track.enabled ? '🎙️' : '🔇';
});

$('#cam-btn').addEventListener('click', (e) => {
  const track = state.call?.stream.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  e.currentTarget.classList.toggle('off', !track.enabled);
  e.currentTarget.textContent = track.enabled ? '📷' : '🙈';
});

$('#flip-btn').addEventListener('click', async () => {
  const call = state.call;
  if (!call) return;
  const facing = call.facing === 'user' ? 'environment' : 'user';
  try {
    const fresh = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } });
    const newTrack = fresh.getVideoTracks()[0];
    const oldTrack = call.stream.getVideoTracks()[0];
    await call.pc?.getSenders().find((s) => s.track?.kind === 'video')?.replaceTrack(newTrack);
    call.stream.removeTrack(oldTrack);
    oldTrack.stop();
    call.stream.addTrack(newTrack);
    call.facing = facing;
    $('#local-video').classList.toggle('mirror', facing === 'user');
  } catch (err) {
    toast(`Couldn't switch camera: ${err.message}`);
  }
});

$('#react-btn').addEventListener('click', () => ($('#emoji-tray').hidden = !$('#emoji-tray').hidden));

$('#emoji-tray').addEventListener('click', (e) => {
  const emoji = e.target.closest('button')?.dataset.emoji;
  if (!emoji || !state.call?.connected) return;
  floatEmojis(emoji);
  send({ type: 'react', to: state.call.peerConn, emoji });
});

// Tap anywhere on her video to send a "touch" that ripples and vibrates on her screen.
let lastTouch = 0;
$('#remote-video').addEventListener('pointerdown', (e) => {
  const call = state.call;
  if (!call?.connected || Date.now() - lastTouch < 150) return;
  lastTouch = Date.now();
  $('#emoji-tray').hidden = true;
  const x = e.clientX / innerWidth;
  const y = e.clientY / innerHeight;
  showTouch(x, y, false);
  send({ type: 'touch', to: call.peerConn, x, y });
});

// ---------- effects ----------

function floatEmojis(emoji, count = 16) {
  const fx = $('#fx');
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'float';
    el.textContent = emoji;
    el.style.left = `${5 + Math.random() * 85}%`;
    el.style.fontSize = `${1.6 + Math.random() * 2.2}rem`;
    el.style.animationDelay = `${Math.random() * 0.7}s`;
    el.style.setProperty('--drift', `${(Math.random() - 0.5) * 160}px`);
    el.style.setProperty('--spin', `${(Math.random() - 0.5) * 60}deg`);
    el.addEventListener('animationend', () => el.remove());
    fx.append(el);
  }
}

function showTouch(x, y, theirs) {
  const fx = $('#fx');
  const el = document.createElement('div');
  el.className = theirs ? 'touch theirs' : 'touch';
  if (theirs) el.textContent = '💗';
  el.style.left = `${x * 100}%`;
  el.style.top = `${y * 100}%`;
  el.addEventListener('animationend', () => el.remove());
  fx.append(el);
  if (theirs) {
    const glow = document.createElement('div');
    glow.className = 'glow';
    glow.addEventListener('animationend', () => glow.remove());
    fx.append(glow);
  }
}

// ---------- photo booth ----------

$('#booth-btn').addEventListener('click', () => {
  const call = state.call;
  if (!call?.connected || call.boothRunning) return;
  send({ type: 'booth', to: call.peerConn });
  runBooth(true);
});

async function runBooth(isCapturer) {
  const call = state.call;
  if (!call || call.boothRunning) return;
  call.boothRunning = true;
  const box = $('#countdown');
  box.hidden = false;
  for (const n of ['3', '2', '1']) {
    box.innerHTML = `<span>${n}</span>`;
    beep(n === '1' ? 880 : 660, 0, 0.15, 0.1);
    await new Promise((r) => setTimeout(r, 800));
  }
  box.hidden = true;
  const flash = $('#flash');
  flash.classList.remove('go');
  void flash.offsetWidth; // restart the animation
  flash.classList.add('go');

  // One side saves the picture so it isn't duplicated; both get it via the "memory" event.
  if (isCapturer && state.call === call) {
    const caption = `${state.partner.name} ♥ ${state.me.name}`;
    try {
      const canvas = capturePolaroid(caption);
      await room.saveMemory({ caption, image: canvas.toDataURL('image/jpeg', 0.85), thumb: thumbnail(canvas) });
    } catch (err) {
      toast(`Couldn't save photo: ${err.message}`);
    }
  }
  call.boothRunning = false;
}

function capturePolaroid(caption) {
  const pad = 40;
  const frame = 540;
  const canvas = document.createElement('canvas');
  canvas.width = pad * 3 + frame * 2;
  canvas.height = pad + frame + 150;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fffaf3';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawCover(ctx, $('#remote-video'), pad, pad, frame, frame, false);
  drawCover(ctx, $('#local-video'), pad * 2 + frame, pad, frame, frame, state.call.facing === 'user');

  ctx.fillStyle = '#3a1f3d';
  ctx.textAlign = 'center';
  ctx.font = '600 48px Fredoka, system-ui, sans-serif';
  ctx.fillText(caption, canvas.width / 2, pad + frame + 70);
  ctx.fillStyle = '#a07a8f';
  ctx.font = '400 28px Fredoka, system-ui, sans-serif';
  const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  ctx.fillText(date, canvas.width / 2, pad + frame + 115);
  return canvas;
}

// Small copy for the gallery grid, so opening the app doesn't download every full photo.
function thumbnail(source) {
  const canvas = document.createElement('canvas');
  canvas.width = 360;
  canvas.height = Math.round((source.height / source.width) * 360);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.7);
}

// Draw a video frame cropped to fill the box (like object-fit: cover), with rounded corners.
function drawCover(ctx, video, x, y, w, h, mirror) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 18);
  ctx.clip();
  ctx.fillStyle = '#2a1630';
  ctx.fillRect(x, y, w, h);
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw && vh) {
    const scale = Math.max(w / vw, h / vh);
    const sw = w / scale;
    const sh = h / scale;
    const sx = (vw - sw) / 2;
    const sy = (vh - sh) / 2;
    if (mirror) {
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
    } else {
      ctx.drawImage(video, sx, sy, sw, sh, x, y, w, h);
    }
  }
  ctx.restore();
}

// ---------- start ----------

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
if (new URLSearchParams(location.search).has('emulator')) window.room = room; // lets tests sign in

boot();
