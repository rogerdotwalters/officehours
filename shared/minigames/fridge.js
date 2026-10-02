/**
 * Fridge: fit your lunchbox and smoothie into a fridge already full of your
 * coworkers' food. Their food can be moved, slid together, tucked into each
 * other's transparent gaps or stacked, but it has to stay in the fridge.
 *
 * Items are pictures (client/assets/items/); their collision shapes come from
 * the pictures' solid pixels (pixelMask.js). Everything here works on the
 * mask grid: one cell = ITEM_CELL world units.
 *
 * Generation (server): pack your items and as many coworkers' items as fit,
 * tight, onto the shelves (that packing is the known solution); then take
 * yours out and spread the rest evenly so no gap is big enough. Moving
 * things back together always works, so every puzzle is solvable.
 */
import { ITEMS_BY_ID, itemsFor, ITEM_CELL } from './items.js';

export const CELL = ITEM_CELL;
export const FRIDGE_W = 320;                 // world units
export const SHELVES = [                     // inside space of each shelf, world units
  { x: 0, y: 0,   w: 320, h: 104 },
  { x: 0, y: 112, w: 320, h: 104 },
  { x: 0, y: 224, w: 320, h: 104 },
];
export const FRIDGE_H = 328;
const COLS = FRIDGE_W / CELL;
const ROWS = FRIDGE_H / CELL;
const SHELF_CELLS = SHELVES.map((s) => ({ x0: s.x / CELL, y0: s.y / CELL, x1: (s.x + s.w) / CELL, y1: (s.y + s.h) / CELL }));
const OWNERS = ['Gary', 'Linda', 'Priya', 'Marco', 'Janet', 'Kev', 'Bea', 'Omar', 'Sue', 'Dwayne'];

// ---------------------------------------------------------------------------
// Occupancy: a grid of the fridge's cells, each holding (piece index + 1) or 0.
// ---------------------------------------------------------------------------
export class Fridge {
  constructor() {
    this.occ = new Int16Array(COLS * ROWS);
  }

  /** Which shelf a cell is in, or -1 (shelf boards and outside don't count). */
  static shelfAt(cx, cy) {
    for (let i = 0; i < SHELF_CELLS.length; i++) {
      const s = SHELF_CELLS[i];
      if (cx >= s.x0 && cx < s.x1 && cy >= s.y0 && cy < s.y1) return i;
    }
    return -1;
  }

  /** Which shelf a row is in, or -1 (shelves span the full width). */
  static shelfOfRow(cy) {
    for (let i = 0; i < SHELF_CELLS.length; i++) if (cy >= SHELF_CELLS[i].y0 && cy < SHELF_CELLS[i].y1) return i;
    return -1;
  }

  /** Can `item` go with its top-left at cell (cx, cy)? Ignores piece `self`. */
  fits(item, cx, cy, self = -1) {
    // Bounding box first: inside the fridge, top and bottom rows on the same shelf.
    if (cx + item.left < 0 || cx + item.right >= COLS) return false;
    const top = Fridge.shelfOfRow(cy + item.top);
    if (top === -1 || top !== Fridge.shelfOfRow(cy + item.bottom)) return false;
    // Then the actual pixel shape against everything else.
    const occ = this.occ;
    const mine = self + 1;
    for (const [sx, sy] of item.cells) {
      const o = occ[(cy + sy) * COLS + cx + sx];
      if (o !== 0 && o !== mine) return false;
    }
    return true;
  }

  put(item, cx, cy, index) {
    for (const [sx, sy] of item.cells) this.occ[(cy + sy) * COLS + cx + sx] = index + 1;
  }

  take(item, cx, cy, index) {
    for (const [sx, sy] of item.cells) {
      const k = (cy + sy) * COLS + cx + sx;
      if (this.occ[k] === index + 1) this.occ[k] = 0;
    }
  }

  /** Let an item fall straight down until it rests on something. */
  settle(item, cx, cy, self = -1) {
    while (this.fits(item, cx, cy + 1, self)) cy++;
    return cy;
  }
}

/** Row that puts an item's lowest solid cell on a shelf's floor. */
function floorRow(item, shelf) {
  return SHELF_CELLS[shelf].y1 - 1 - item.bottom;
}

/** Leftmost spot on a shelf floor (sliding into transparent gaps), or null. */
function firstFitOnFloor(fridge, item, shelf, fromX = 0) {
  const cy = floorRow(item, shelf);
  const s = SHELF_CELLS[shelf];
  for (let k = 0; k < s.x1 - s.x0; k++) {
    const cx = s.x0 + ((fromX - s.x0 + k) % (s.x1 - s.x0)) - item.left;
    if (fridge.fits(item, cx, cy)) return { cx, cy };
  }
  return null;
}

/** Anywhere at all (any height, settled), for the "too easy?" check. */
function anyFit(fridge, item) {
  for (let cy = -item.top; cy + item.bottom < ROWS; cy++) {
    for (let cx = -item.left; cx + item.right < COLS; cx++) if (fridge.fits(item, cx, cy)) return { cx, cy };
  }
  return null;
}

/**
 * Build a puzzle. `rand()` returns a float in [0, 1).
 * pieces: [{ key, item, owner, yours, x, y }] in world units; yours start out of
 * the fridge (x/y null). `solution` (server only) is a packing that works.
 */
export function generateFridge(rand) {
  const shuffle = (list) => list.map((v) => [rand(), v]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
  const yours = itemsFor('yours');
  const food = itemsFor('fridge');

  for (let attempt = 0; attempt < 30; attempt++) {
    const fridge = new Fridge();
    const pieces = [];
    const place = (item, extra, from) => {
      for (const shelf of shuffle([0, 1, 2])) {
        const spot = firstFitOnFloor(fridge, item, shelf, from);
        if (spot) {
          const i = pieces.length;
          fridge.put(item, spot.cx, spot.cy, i);
          pieces.push({ ...extra, item: item.id, cx: spot.cx, cy: spot.cy, shelf });
          return true;
        }
      }
      return false;
    };

    // 1. Your things first, somewhere random, so their spaces exist.
    let ok = true;
    yours.forEach((item, k) => {
      ok = ok && place(item, { key: `y${k}`, yours: true }, Math.floor(rand() * COLS));
    });
    if (!ok) continue;
    // 2. Then pack in as much coworker food as fits, tight from the left.
    let n = 0;
    for (const item of shuffle(food)) {
      if (n >= 11) break;
      if (place(item, { key: `c${n}`, yours: false, owner: OWNERS[Math.floor(rand() * OWNERS.length)] }, 0)) n++;
    }
    if (n < 7) continue;
    const solution = Object.fromEntries(pieces.map((p) => [p.key, { x: p.cx * CELL, y: p.cy * CELL }]));

    // 3. Take your things out, then spread each shelf's food evenly so the
    //    free space is broken up into gaps too small for them.
    pieces.forEach((p, i) => { if (p.yours) fridge.take(ITEMS_BY_ID.get(p.item), p.cx, p.cy, i); });
    for (let shelf = 0; shelf < SHELVES.length; shelf++) spreadShelf(fridge, pieces, shelf);

    // 4. Too easy if both of yours already fit somewhere. Try again.
    const test = new Fridge();
    test.occ.set(fridge.occ);
    let trivial = true;
    yours.forEach((item, k) => {
      const spot = anyFit(test, item);
      if (!spot) trivial = false;
      else test.put(item, spot.cx, spot.cy, 100 + k);
    });
    if (trivial && attempt < 29) continue;

    return {
      variant: 'productive',
      width: FRIDGE_W, height: FRIDGE_H, cell: CELL, shelves: SHELVES,
      pieces: pieces.map((p) => ({
        key: p.key, item: p.item, yours: p.yours, owner: p.owner ?? null,
        x: p.yours ? null : p.cx * CELL, y: p.yours ? null : p.cy * CELL,
      })),
      solution,
    };
  }
  throw new Error('Could not build a fridge puzzle; check the item table.');
}

/** Slide a shelf's items left, then share the leftover space out between them. */
function spreadShelf(fridge, pieces, shelf) {
  const onShelf = pieces.map((p, i) => ({ p, i })).filter(({ p }) => !p.yours && p.shelf === shelf).sort((a, b) => a.p.cx - b.p.cx);
  if (!onShelf.length) return;
  const items = onShelf.map(({ p }) => ITEMS_BY_ID.get(p.item));
  const s = SHELF_CELLS[shelf];
  const rightEdge = Math.max(...onShelf.map(({ p }, k) => p.cx + items[k].right + 1));
  const gap = Math.floor((s.x1 - rightEdge) / (onShelf.length + 1));
  if (gap <= 0) return;
  // Move from the right so nothing passes through anything.
  for (let k = onShelf.length - 1; k >= 0; k--) {
    const { p, i } = onShelf[k];
    const shift = gap * (k + 1);
    fridge.take(items[k], p.cx, p.cy, i);
    if (fridge.fits(items[k], p.cx + shift, p.cy, i)) p.cx += shift;
    fridge.put(items[k], p.cx, p.cy, i);
  }
}

/**
 * Slacker version: the fridge is full of coworkers' food, each item with its
 * owner's name on it. Find the one you're told to steal and drag it out to eat it.
 */
export function generateFridgeHeist(rand) {
  const base = generateFridge(rand);
  const pieces = base.pieces.filter((p) => !p.yours);
  // Give the target an owner nobody else has, so the label is unambiguous.
  const target = pieces[Math.floor(rand() * pieces.length)];
  const used = new Set(pieces.filter((p) => p !== target).map((p) => p.owner));
  const free = OWNERS.filter((o) => !used.has(o));
  if (free.length) target.owner = free[Math.floor(rand() * free.length)];
  return {
    variant: 'slacker',
    width: base.width, height: base.height, cell: base.cell, shelves: base.shelves,
    pieces,
    target: { key: target.key, owner: target.owner, item: target.item },
  };
}

export function publicFridge(puzzle) {
  const { solution, ...rest } = puzzle;
  return rest;
}

/**
 * Check an answer: { positions: { [key]: { x, y } } } for every piece, in world
 * units on the cell grid. Every piece inside one shelf, nothing overlapping.
 */
export function checkFridge(puzzle, answer) {
  if (puzzle.variant === 'slacker') return answer?.ate === puzzle.target.key;
  const pos = answer?.positions;
  if (!pos || typeof pos !== 'object') return false;
  const fridge = new Fridge();
  for (let i = 0; i < puzzle.pieces.length; i++) {
    const piece = puzzle.pieces[i];
    const p = pos[piece.key];
    const item = ITEMS_BY_ID.get(piece.item);
    if (!p || !item) return false;
    const x = Number(p.x), y = Number(p.y);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x % CELL || y % CELL) return false;
    if (!fridge.fits(item, x / CELL, y / CELL)) return false;
    fridge.put(item, x / CELL, y / CELL, i);
  }
  return true;
}
