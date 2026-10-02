/**
 * Fridge UI: coworkers' food (pictures) sits on the shelves; drag things
 * around to make room, then put your lunchbox and smoothie in.
 *
 * Collision uses each picture's solid pixels (shared/minigames/pixelMask.js),
 * the same shapes the server checks the answer with. While you drag, the item's
 * traced outline shows green where it fits and red where it doesn't. Dropped
 * items settle downward until they rest on a shelf or on other food.
 */
import { Fridge, SHELVES, FRIDGE_W, FRIDGE_H, CELL } from '../../shared/minigames/fridge.js';
import { ITEMS_BY_ID, itemUrl } from '../../shared/minigames/items.js';
import { edgesToPath } from '../../shared/minigames/pixelMask.js';
import { el, svg, draggable, over } from './kit.js';

export function mountFridge(root, puzzle, { submit, isTouch }) {
  const pieces = puzzle.pieces.map((p, i) => ({ ...p, index: i, def: ITEMS_BY_ID.get(p.item), cx: p.x == null ? null : p.x / CELL, cy: p.y == null ? null : p.y / CELL }));
  const fridge = new Fridge();
  for (const p of pieces) if (p.cx != null) fridge.put(p.def, p.cx, p.cy, p.index);
  let scale = 1;
  let sent = false;

  // ---- DOM ----
  const inside = el('div', { class: 'fz__inside' });
  for (let i = 0; i < SHELVES.length - 1; i++) {
    const s = SHELVES[i];
    inside.append(el('div', { class: 'fz__shelf', 'data-y': s.y + s.h, 'data-h': SHELVES[i + 1].y - (s.y + s.h) }));
  }
  const box = el('div', { class: 'fz' }, el('div', { class: 'fz__light', 'aria-hidden': 'true' }), inside);
  const tray = el('div', { class: 'fz__tray' });
  const doneBtn = el('button', { type: 'button', class: 'btn btn--primary', onclick: () => send() }, 'Close the door');
  const hint = el('p', { class: 'fridge__hint' });
  root.append(el('div', { class: 'fzwrap' },
    box,
    el('div', { class: 'fridge__side' },
      el('p', { class: 'fridge__label' }, 'Your things'),
      tray,
      el('div', { class: 'fridge__controls' }, doneBtn),
      hint)));

  // One element per piece: the picture plus its traced collision outline.
  for (const p of pieces) {
    const d = p.def;
    const label = p.yours ? d.name : `${p.owner}'s ${d.name}`;
    p.node = el('div', { class: `fitem ${p.yours ? 'is-yours' : ''}`, title: label, 'aria-label': label, 'data-key': p.key },
      el('img', { src: itemUrl(d), alt: '', draggable: 'false' }),
      svg('svg', { class: 'fitem__outline', viewBox: `0 0 ${d.cols} ${d.rows}`, preserveAspectRatio: 'none' },
        svg('path', { d: edgesToPath(d.edges) })));
    attachDrag(p);
  }

  // ---- Layout ----
  function measure() {
    const narrow = window.innerWidth < 560;
    const chrome = 34;                                   // the fridge's own border and padding
    const width = root.clientWidth || window.innerWidth - 40; // before the window is shown, guess
    const availW = Math.min(width - chrome - (narrow ? 0 : 240), 400);
    const availH = window.innerHeight - (narrow ? 330 : 170);
    scale = Math.max(0.6, Math.min(availW / FRIDGE_W, availH / FRIDGE_H, 1.25));
    inside.style.width = `${FRIDGE_W * scale}px`;
    inside.style.height = `${FRIDGE_H * scale}px`;
    for (const shelf of inside.querySelectorAll('.fz__shelf')) {
      shelf.style.top = `${shelf.dataset.y * scale}px`;
      shelf.style.height = `${shelf.dataset.h * scale}px`;
    }
    layout();
  }

  function sizeNode(p) {
    p.node.style.width = `${p.def.cols * CELL * scale}px`;
    p.node.style.height = `${p.def.rows * CELL * scale}px`;
    p.node.querySelector('img').style.width = `${p.def.w * scale}px`;
    p.node.querySelector('img').style.height = `${p.def.h * scale}px`;
  }

  function layout() {
    for (const p of pieces) {
      sizeNode(p);
      if (p.cx != null) {
        if (p.node.parentNode !== inside) inside.append(p.node);
        p.node.style.left = `${p.cx * CELL * scale}px`;
        p.node.style.top = `${p.cy * CELL * scale}px`;
      } else {
        if (p.node.parentNode !== tray) tray.append(p.node);
        p.node.style.left = '';
        p.node.style.top = '';
      }
    }
    const left = pieces.filter((p) => p.yours && p.cx == null).length;
    doneBtn.disabled = left > 0 || sent;
    doneBtn.textContent = sent ? 'Closing\u2026' : 'Close the door';
    tray.classList.toggle('is-empty', left === 0);
    hint.textContent = left === 0
      ? 'All in. Close the door.'
      : `Drag ${isTouch ? 'with your finger' : 'with the mouse'}. Coworkers\u2019 food can be moved too: slide things together, tuck them into each other\u2019s gaps or stack them.`;
  }

  // ---- Dragging ----
  function attachDrag(p) {
    let grab = null;      // where on the item you grabbed it, in px
    let target = null;    // { cx, cy, ok } while over the fridge
    draggable(p.node, {
      onStart(e) {
        if (sent) return false;
        const r = p.node.getBoundingClientRect();
        grab = { x: e.clientX - r.left, y: e.clientY - r.top };
        if (p.cx != null) fridge.take(p.def, p.cx, p.cy, p.index);
        // Float above everything while dragging.
        document.body.append(p.node);
        p.node.classList.add('is-floating');
        place(e);
        return true;
      },
      onMove(e) { place(e); return true; },
      onEnd(e) {
        p.node.classList.remove('is-floating', 'is-ok', 'is-bad');
        p.node.style.position = '';
        if (target?.ok) {
          p.cx = target.cx;
          p.cy = fridge.settle(p.def, target.cx, target.cy, p.index);
        } else if (!p.yours || target) {
          // Coworkers' food can't leave the fridge; a bad spot snaps back.
        } else {
          p.cx = null; p.cy = null; // your food, dropped outside: back to the tray
        }
        if (p.cx != null) fridge.put(p.def, p.cx, p.cy, p.index);
        target = null;
        layout();
      },
    });

    function place(e) {
      const rect = inside.getBoundingClientRect();
      const px = e.clientX - grab.x, py = e.clientY - grab.y;
      p.node.style.position = 'fixed';
      if (over(inside, e.clientX, e.clientY, 20)) {
        const cx = Math.round((px - rect.left) / (CELL * scale));
        const cy = Math.round((py - rect.top) / (CELL * scale));
        target = { cx, cy, ok: fridge.fits(p.def, cx, cy, p.index) };
        p.node.style.left = `${rect.left + cx * CELL * scale}px`;
        p.node.style.top = `${rect.top + cy * CELL * scale}px`;
      } else {
        target = null;
        p.node.style.left = `${px}px`;
        p.node.style.top = `${py}px`;
      }
      p.node.classList.toggle('is-ok', !!target?.ok);
      p.node.classList.toggle('is-bad', !!target && !target.ok);
    }
  }

  function send() {
    if (sent || pieces.some((p) => p.cx == null)) return;
    sent = true;
    submit({ positions: Object.fromEntries(pieces.map((p) => [p.key, { x: p.cx * CELL, y: p.cy * CELL }])) });
    layout();
    setTimeout(() => { sent = false; layout(); }, 1500);
  }

  const ro = new ResizeObserver(() => measure());
  ro.observe(root);
  measure();
  return {
    destroy() {
      ro.disconnect();
      for (const p of pieces) p.node.remove();
      root.replaceChildren();
    },
    onKey(e) { if (e.code === 'Enter') { e.preventDefault(); send(); } },
  };
}
