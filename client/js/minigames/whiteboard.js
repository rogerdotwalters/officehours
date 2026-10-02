/**
 * Whiteboard: trace the dotted drawing with the marker. The progress bar uses
 * the same scoring the server checks with (shared/minigames/whiteboard.js).
 */
import { DRAWINGS_BY_ID, BOARD_W, BOARD_H, samplePoints, scoreDrawing } from '../../shared/minigames/whiteboard.js';
import { el } from './kit.js';

const MAX_POINTS = 2500;
const MIN_STEP = 1.2;   // board units between recorded points

export function mountWhiteboard(root, puzzle, { submit }) {
  const drawing = DRAWINGS_BY_ID.get(puzzle.drawing);
  const samples = samplePoints(drawing);
  const ink = [];          // strokes of [x, y] in board units
  let current = null;
  let points = 0;
  let score = { coverage: 0, accuracy: 1, ok: false, covered: [] };
  let sent = false;

  const canvas = el('canvas', { class: 'wb-canvas', 'aria-label': `Whiteboard: trace ${drawing.title}` });
  const bar = el('span', { class: 'wb-bar__fill' });
  const pct = el('span', { class: 'wb-bar__text' });
  const wipe = el('button', { type: 'button', class: 'btn btn--small', onclick: () => { ink.length = 0; points = 0; rescore(); draw(); } }, 'Wipe');
  const done = el('button', { type: 'button', class: 'btn btn--small btn--primary', onclick: () => send() }, 'Done');
  const status = el('p', { class: 'fridge__hint' });
  root.append(el('div', { class: 'wbwrap' },
    el('p', { class: 'wb-title' }, el('b', {}, drawing.title), el('span', {}, drawing.caption)),
    el('div', { class: 'wb-frame' }, canvas, el('span', { class: 'wb-tray', 'aria-hidden': 'true' }, el('i'), el('i'), el('i'))),
    el('div', { class: 'wb-controls' }, el('div', { class: 'wb-bar' }, bar, pct), wipe, done),
    status));
  const ctx = canvas.getContext('2d');
  let scale = 1;

  function size() {
    const avail = Math.min(root.clientWidth || window.innerWidth - 40, 620);
    const availH = window.innerHeight - (window.innerWidth < 560 ? 320 : 260);
    const w = Math.max(240, Math.min(avail - 8, (availH * BOARD_W) / BOARD_H));
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${(w * BOARD_H) / BOARD_W}px`;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(((w * BOARD_H) / BOARD_W) * dpr);
    scale = (w * dpr) / BOARD_W;
    draw();
  }

  function toBoard(e) {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * BOARD_W, ((e.clientY - r.top) / r.height) * BOARD_H];
  }

  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => {
    if (sent || points >= MAX_POINTS) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    current = [toBoard(e)];
    ink.push(current);
    points++;
    draw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!current) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events) {
      const p = toBoard(ev);
      const last = current[current.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < MIN_STEP || points >= MAX_POINTS) continue;
      current.push(p);
      points++;
    }
    draw();
  });
  const end = () => {
    if (!current) return;
    current = null;
    rescore();
    draw();
    if (score.ok) send();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  function rescore() {
    score = ink.length ? scoreDrawing(drawing, ink, samples) : { coverage: 0, accuracy: 1, ok: false, covered: [] };
    const p = Math.round(score.coverage * 100);
    bar.style.width = `${p}%`;
    bar.classList.toggle('is-ok', score.ok);
    pct.textContent = `${p}% traced`;
    done.disabled = !score.ok || sent;
    if (score.ok) status.textContent = 'Masterpiece.';
    else if (ink.length && score.accuracy < 0.6) status.textContent = 'Too much scribbling. Wipe it and trace the dotted lines.';
    else if (score.coverage >= 0.82) status.textContent = 'Almost. Some bits still need tracing.';
    else status.textContent = 'Trace the dotted lines with the marker.';
  }

  function send() {
    if (sent || !score.ok) return;
    sent = true;
    done.disabled = true;
    const round = (v) => Math.round(v * 2) / 2;
    submit({ ink: ink.map((s) => s.flatMap(([x, y]) => [round(x), round(y)])) });
    setTimeout(() => { sent = false; rescore(); }, 1500);
  }

  function draw() {
    const s = scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fbfcfd';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    // Dotted guide, greener where you've already traced it.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < samples.length; i++) {
      const [x, y] = samples[i];
      ctx.beginPath();
      ctx.arc(x, y, 0.7, 0, Math.PI * 2);
      ctx.fillStyle = score.covered[i] ? 'rgba(45, 138, 84, 0.45)' : 'rgba(110, 118, 135, 0.55)';
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(110, 118, 135, 0.8)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const l of drawing.labels) {
      ctx.font = `600 ${l.size}px Fredoka, sans-serif`;
      ctx.fillText(l.text, l.x, l.y);
    }
    // Marker ink
    ctx.strokeStyle = '#2f5bd3';
    ctx.lineWidth = 2.2;
    for (const st of ink) {
      ctx.beginPath();
      ctx.moveTo(st[0][0], st[0][1]);
      if (st.length === 1) ctx.lineTo(st[0][0] + 0.01, st[0][1]);
      for (let i = 1; i < st.length; i++) ctx.lineTo(st[i][0], st[i][1]);
      ctx.stroke();
    }
  }

  const ro = new ResizeObserver(() => size());
  ro.observe(root);
  rescore();
  size();
  return { destroy() { ro.disconnect(); root.replaceChildren(); } };
}
