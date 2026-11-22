import { h } from './games.js';

// Watch or listen to YouTube in sync. Both devices keep the same queue; play, pause, seek
// and skip are mirrored to the other side.
let apiPromise;
function loadYouTube() {
  apiPromise ??= new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.append(script);
  });
  return apiPromise;
}

export function parseYouTubeId(text) {
  const s = text.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = /(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/.exec(s);
  return m?.[1] ?? null;
}

async function fetchTitle(id) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${id}`);
    return (await res.json()).title;
  } catch {
    return null;
  }
}

// ctx: { sendPeer, stage, toast, setMode(mode | null) }
export function createTogether(ctx) {
  const queue = []; // { id, title }
  let index = -1;
  let player = null;
  let ready = null;
  let body = null;
  let mode = null;
  let ignoreUntil = 0; // ignore our own player's events right after applying a remote command
  let nudgeTimer;

  function act(msg) {
    const full = { type: 'yt', ...msg };
    apply(full);
    ctx.sendPeer(full);
  }

  async function ensurePlayer() {
    if (ready) return ready;
    ready = loadYouTube().then((YT) => new Promise((resolve) => {
      const el = h('div');
      ctx.stage.replaceChildren(el);
      player = new YT.Player(el, {
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => resolve(player),
          onStateChange: onLocalState,
        },
      });
    }));
    return ready;
  }

  function onLocalState(e) {
    const S = window.YT.PlayerState;
    if (e.data === S.ENDED) {
      // Both devices reach the end on their own, so each just moves to the next song.
      if (index + 1 < queue.length) playIndex(index + 1);
      return;
    }
    if (Date.now() < ignoreUntil) return;
    if (e.data === S.PLAYING) ctx.sendPeer({ type: 'yt', action: 'play', index, t: player.getCurrentTime() });
    else if (e.data === S.PAUSED) ctx.sendPeer({ type: 'yt', action: 'pause', index, t: player.getCurrentTime() });
  }

  async function playIndex(i, startSeconds = 0) {
    index = i;
    render();
    const p = await ensurePlayer();
    ignoreUntil = Date.now() + 1500;
    p.loadVideoById({ videoId: queue[i].id, startSeconds });
  }

  async function apply(m) {
    if (m.action === 'add') {
      queue.push({ id: m.id, title: m.title });
      if (index === -1 || (player && player.getPlayerState?.() === window.YT.PlayerState.ENDED)) playIndex(queue.length - 1);
      else render();
    } else if (m.action === 'skip') {
      if (m.index < queue.length) playIndex(m.index);
    } else if (m.action === 'play' || m.action === 'pause') {
      const p = await ensurePlayer();
      ignoreUntil = Date.now() + 1200;
      if (m.index !== index && queue[m.index]) return playIndex(m.index, m.t);
      if (Math.abs(p.getCurrentTime() - m.t) > 1.5) p.seekTo(m.t, true);
      if (m.action === 'pause') return p.pauseVideo();
      p.playVideo();
      // Some phones block playback that wasn't started by a tap; offer a button if so.
      clearTimeout(nudgeTimer);
      nudgeTimer = setTimeout(() => {
        if (p.getPlayerState() !== window.YT.PlayerState.PLAYING) {
          body?.querySelector('.tap-to-play')?.removeAttribute('hidden');
        }
      }, 2000);
    }
  }

  async function add(text) {
    const id = parseYouTubeId(text);
    if (!id) return ctx.toast('That doesn’t look like a YouTube link');
    act({ action: 'add', id, title: (await fetchTitle(id)) || `Video ${queue.length + 1}` });
  }

  function render() {
    if (!body) return;
    const input = h('input', { placeholder: 'Paste a YouTube link' });
    const submit = () => {
      if (input.value.trim()) add(input.value);
      input.value = '';
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
    body.replaceChildren(...[
      h('div', { class: 'input-row' }, input, h('button', { class: 'btn primary small', onclick: submit }, 'Add')),
      h('button', {
        class: 'btn soft tap-to-play',
        hidden: true,
        onclick: (e) => {
          player?.playVideo();
          e.currentTarget.hidden = true;
        },
      }, '▶ Tap to join playback'),
      queue.length
        ? h('ol', { class: 'queue' }, queue.map((item, i) => h('li', { class: i === index ? 'now' : '' },
          i === index ? '▶ ' : '', item.title)))
        : h('p', { class: 'game-hint' }, mode === 'music'
          ? 'Add songs from YouTube. You both hear the same thing, and either of you can skip.'
          : 'Paste a YouTube link and it plays for both of you at the same time.'),
      index + 1 < queue.length && h('button', { class: 'btn soft', onclick: () => act({ action: 'skip', index: index + 1 }) }, '⏭ Skip'),
    ].filter(Boolean));
  }

  return {
    open(newMode, el) {
      mode = newMode;
      body = el;
      ctx.setMode(mode);
      render();
      if (index >= 0) playIndex(index); // reopening: pick up where the queue left off
    },
    close() {
      clearTimeout(nudgeTimer);
      player?.destroy();
      player = null;
      ready = null;
      body = null;
      mode = null;
      ctx.stage.replaceChildren();
      ctx.setMode(null);
    },
    onMessage(m) {
      if (body) apply(m);
    },
  };
}
