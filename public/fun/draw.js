// Shared doodle layer over the call. Points are stored relative to the screen's centre and
// shorter side, so a heart drawn on a landscape PC is still a heart on a portrait phone.
export function createDraw({ canvas, sendPeer }) {
  const ctx = canvas.getContext('2d');
  const strokes = new Map(); // id -> { color, width, pts, mine }
  let order = [];
  let active = false;
  let color = '#ff5c8a';
  let current = null;
  let pending = [];
  let flushTimer = null;

  const unit = () => Math.min(innerWidth, innerHeight);
  const toNorm = (x, y) => [+((x - innerWidth / 2) / unit()).toFixed(4), +((y - innerHeight / 2) / unit()).toFixed(4)];
  const toScreen = ([x, y]) => [x * unit() + innerWidth / 2, y * unit() + innerHeight / 2];

  function paint(stroke, from) {
    const pts = stroke.pts;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.width * unit();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (pts.length === 1) {
      const [x, y] = toScreen(pts[0]);
      ctx.beginPath();
      ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(...toScreen(pts[from]));
    for (let i = from + 1; i < pts.length; i++) ctx.lineTo(...toScreen(pts[i]));
    ctx.stroke();
  }

  function redraw() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const id of order) paint(strokes.get(id), 0);
  }

  function resize() {
    const dpr = devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }
  addEventListener('resize', resize);
  resize();

  function addPoints(id, strokeColor, width, pts, mine = false) {
    let stroke = strokes.get(id);
    if (!stroke) {
      stroke = { color: strokeColor, width, pts: [], mine };
      strokes.set(id, stroke);
      order.push(id);
    }
    const from = Math.max(0, stroke.pts.length - 1);
    stroke.pts.push(...pts);
    paint(stroke, from);
  }

  function flush() {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (!current || !pending.length) return;
    sendPeer({ type: 'draw', op: 'pts', id: current.id, color: current.color, width: current.width, pts: pending });
    pending = [];
  }

  function addLocal(e) {
    const pt = toNorm(e.clientX, e.clientY);
    addPoints(current.id, current.color, current.width, [pt], true);
    pending.push(pt);
    flushTimer ??= setTimeout(flush, 40);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!active) return;
    canvas.setPointerCapture(e.pointerId);
    current = { id: Math.random().toString(36).slice(2, 10), color, width: 0.012 };
    addLocal(e);
  });
  canvas.addEventListener('pointermove', (e) => current && addLocal(e));
  const end = () => {
    flush();
    current = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  function clearLocal() {
    strokes.clear();
    order = [];
    redraw();
  }

  return {
    setActive(on) {
      active = on;
      canvas.classList.toggle('active', on);
    },
    setColor(c) {
      color = c;
    },
    hasInk: () => order.length > 0,
    canvas,
    clearLocal,
    clear() {
      clearLocal();
      sendPeer({ type: 'draw', op: 'clear' });
    },
    undo() {
      const id = [...order].reverse().find((k) => strokes.get(k).mine);
      if (!id) return;
      strokes.delete(id);
      order = order.filter((k) => k !== id);
      redraw();
      sendPeer({ type: 'draw', op: 'remove', id });
    },
    onMessage(m) {
      if (m.op === 'pts') addPoints(m.id, m.color, m.width, m.pts);
      else if (m.op === 'clear') clearLocal();
      else if (m.op === 'remove') {
        strokes.delete(m.id);
        order = order.filter((k) => k !== m.id);
        redraw();
      }
    },
  };
}
