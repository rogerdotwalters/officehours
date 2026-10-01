/**
 * Fridge Tetris UI. The server sent a fridge packed with coworkers' food and
 * your items; find where they fit. Placement rules come from the same shared
 * module the server uses to check the answer.
 *
 * Controls: pick one of your items, then click/tap a cell to put it there (the
 * highlighted square of the item goes where you tap). Rotate with the button,
 * R, or right-click. Tap an item already in the fridge to take it back out.
 */
import { placedCells } from '../../shared/minigames/fridge.js';

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}

export function mountFridge(root, puzzle, { submit, isTouch }) {
  const { cols, rows, items, pieces } = puzzle;
  const rot = pieces.map(() => 0);
  const placed = pieces.map(() => null);      // { rot, x, y } or null
  let selected = 0;
  let hover = null;                           // { x, y }
  let flashBad = null;                        // { x, y, until }
  let sent = false;

  // Which item owns each cell.
  const owner = new Map();
  items.forEach((it, i) => it.cells.forEach(([x, y]) => owner.set(`${x},${y}`, i)));

  // ---- DOM ----
  const cells = [];
  const grid = el('div', { class: 'fridge__grid', style: `--cols:${cols};--rows:${rows}`, role: 'grid', 'aria-label': 'Fridge shelves' });
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = el('button', { type: 'button', class: 'fcell', 'data-x': x, 'data-y': y, role: 'gridcell' });
      c.addEventListener('pointerenter', () => { hover = { x, y }; render(); });
      c.addEventListener('click', () => onCell(x, y));
      c.addEventListener('contextmenu', (e) => { e.preventDefault(); rotateSelected(); });
      grid.append(c);
      cells.push(c);
    }
  }
  grid.addEventListener('pointerleave', () => { hover = null; render(); });

  // Labels for coworkers' food, laid over the grid on the longest straight run
  // of the item's own cells so they never spill onto a neighbour.
  const labels = el('div', { class: 'fridge__labels', 'aria-hidden': 'true' },
    items.map((it) => {
      const has = new Set(it.cells.map(([x, y]) => `${x},${y}`));
      let best = { x: it.cells[0][0], y: it.cells[0][1], w: 1, h: 1 };
      for (const [x, y] of it.cells) {
        let w = 1; while (has.has(`${x + w},${y}`)) w++;
        let h = 1; while (has.has(`${x},${y + h}`)) h++;
        if (w > best.w) best = { x, y, w, h: 1 };
        if (h > Math.max(best.w, best.h)) best = { x, y, w: 1, h };
      }
      return el('span', { title: it.label, style: `grid-column:${best.x + 1} / span ${best.w};grid-row:${best.y + 1} / span ${best.h}` },
        it.food ?? it.label);
    }));

  const tray = el('div', { class: 'fridge__tray' });
  const rotateBtn = el('button', { type: 'button', class: 'btn fridge__rotate', onclick: () => rotateSelected() },
    'Rotate', isTouch ? null : el('kbd', {}, 'R'));
  const doneBtn = el('button', { type: 'button', class: 'btn btn--primary', onclick: () => send() }, 'Close the door');
  const hint = el('p', { class: 'fridge__hint' });

  root.append(el('div', { class: 'fridge' },
    el('div', { class: 'fridge__box' },
      el('div', { class: 'fridge__freezer', 'aria-hidden': 'true' }, el('span')),
      el('div', { class: 'fridge__inside' }, grid, labels)),
    el('div', { class: 'fridge__side' },
      el('p', { class: 'fridge__label' }, 'Your things'),
      tray,
      el('div', { class: 'fridge__controls' }, rotateBtn, doneBtn),
      hint)));

  // ---- Logic ----
  const cellsFor = (i, r, x, y) => placedCells(pieces[i], r, x, y);
  const occupiedByOthers = (except) => {
    const set = new Set(owner.keys());
    placed.forEach((p, i) => { if (p && i !== except) cellsFor(i, p.rot, p.x, p.y).forEach(([x, y]) => set.add(`${x},${y}`)); });
    return set;
  };
  function fits(i, r, x, y) {
    const taken = occupiedByOthers(i);
    return cellsFor(i, r, x, y).every(([cx, cy]) => cx >= 0 && cy >= 0 && cx < cols && cy < rows && !taken.has(`${cx},${cy}`));
  }
  function pieceAt(x, y) {
    return placed.findIndex((p, i) => p && cellsFor(i, p.rot, p.x, p.y).some(([cx, cy]) => cx === x && cy === y));
  }

  function onCell(x, y) {
    if (sent) return;
    const there = pieceAt(x, y);
    if (there !== -1) {               // pick it back up
      rot[there] = placed[there].rot;
      placed[there] = null;
      selected = there;
      return render();
    }
    if (selected == null) return;
    if (fits(selected, rot[selected], x, y)) {
      placed[selected] = { rot: rot[selected], x, y };
      const next = placed.findIndex((p) => !p);
      selected = next === -1 ? null : next;
    } else {
      flashBad = { x, y, until: performance.now() + 450 };
      setTimeout(render, 460);
    }
    render();
  }

  function rotateSelected() {
    if (selected == null || sent) return;
    rot[selected] = (rot[selected] + 1) % 4;
    render();
  }

  function send() {
    if (sent || placed.some((p) => !p)) return;
    sent = true;
    submit(placed.map((p, i) => ({ piece: i, rot: p.rot, x: p.x, y: p.y })));
    render();
    setTimeout(() => { sent = false; render(); }, 1500); // if the server says no, let them retry
  }

  // ---- Drawing ----
  function render() {
    const yours = new Map();
    placed.forEach((p, i) => { if (p) cellsFor(i, p.rot, p.x, p.y).forEach(([x, y]) => yours.set(`${x},${y}`, i)); });

    // Ghost preview of the selected piece
    const ghost = new Set();
    let ghostOk = false;
    const bad = flashBad && performance.now() < flashBad.until ? flashBad : null;
    const at = bad ?? (!isTouch ? hover : null);
    if (selected != null && at) {
      ghostOk = !bad && fits(selected, rot[selected], at.x, at.y);
      for (const [x, y] of cellsFor(selected, rot[selected], at.x, at.y)) ghost.add(`${x},${y}`);
    }

    for (const c of cells) {
      const x = Number(c.dataset.x), y = Number(c.dataset.y), key = `${x},${y}`;
      const it = owner.get(key);
      const mine = yours.get(key);
      const groupOf = (kx, ky) => {
        const k = `${kx},${ky}`;
        return owner.has(k) ? `o${owner.get(k)}` : yours.has(k) ? `y${yours.get(k)}` : null;
      };
      const g = groupOf(x, y);
      c.className = 'fcell';
      c.style.background = it != null ? items[it].color : mine != null ? pieces[mine].color : '';
      if (mine != null) c.classList.add('is-yours');
      if (it != null) c.classList.add('is-food');
      if (g) {
        // Thicker edges where an item ends, so items read as single shapes.
        if (groupOf(x, y - 1) !== g) c.classList.add('e-t');
        if (groupOf(x + 1, y) !== g) c.classList.add('e-r');
        if (groupOf(x, y + 1) !== g) c.classList.add('e-b');
        if (groupOf(x - 1, y) !== g) c.classList.add('e-l');
      }
      if (ghost.has(key)) c.classList.add(ghostOk ? 'ghost-ok' : 'ghost-bad');
      c.setAttribute('aria-label', it != null ? items[it].label : mine != null ? pieces[mine].label : 'Empty space');
    }

    tray.replaceChildren(...pieces.map((p, i) => {
      const shape = placedCells(p, rot[i], 0, 0);
      const minX = Math.min(...shape.map((s) => s[0]));
      const norm = shape.map(([x, y]) => [x - minX, y]);
      const w = Math.max(...norm.map((s) => s[0])) + 1, h = Math.max(...norm.map((s) => s[1])) + 1;
      const anchor = norm[0];
      return el('button', {
        type: 'button',
        class: `fpiece ${selected === i ? 'is-selected' : ''} ${placed[i] ? 'is-placed' : ''}`,
        'aria-pressed': String(selected === i),
        onclick: () => {
          if (sent) return;
          if (placed[i]) { rot[i] = placed[i].rot; placed[i] = null; }
          selected = i;
          render();
        },
      },
      el('span', { class: 'fpiece__shape', style: `--w:${w};--h:${h}` },
        norm.map(([x, y]) => el('i', {
          class: x === anchor[0] && y === anchor[1] ? 'is-anchor' : '',
          style: `grid-column:${x + 1};grid-row:${y + 1};background:${p.color}`,
        }))),
      el('span', { class: 'fpiece__label' }, p.label, el('small', {}, placed[i] ? 'In the fridge' : selected === i ? 'Selected' : 'Tap to pick')));
    }));

    const allIn = placed.every(Boolean);
    rotateBtn.disabled = selected == null || sent;
    doneBtn.disabled = !allIn || sent;
    doneBtn.textContent = sent ? 'Closing\u2026' : 'Close the door';
    hint.textContent = allIn
      ? 'Everything fits. Close the door.'
      : selected == null
        ? 'Pick one of your things.'
        : `${isTouch ? 'Tap' : 'Click'} where ${pieces[selected].label.toLowerCase()} goes. The marked square lands where you ${isTouch ? 'tap' : 'click'}.`;
  }

  render();
  return {
    destroy() { root.replaceChildren(); },
    onKey(e) {
      if (e.code === 'KeyR') { e.preventDefault(); rotateSelected(); }
      if (e.code === 'Enter') { e.preventDefault(); send(); }
    },
  };
}
