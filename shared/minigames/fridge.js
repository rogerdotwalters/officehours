/**
 * Fridge Tetris: fit your lunch into a fridge already packed with your
 * coworkers' food.
 *
 * The fridge is a grid completely tiled with food items (random polyominoes).
 * Two of them are pulled out and handed to you, rotated, as "your" items; a
 * small extra gap is opened as a decoy. Every puzzle therefore has a solution.
 *
 * The server generates the puzzle (it keeps the answer) and checks the
 * placements the client sends back. The client only draws it.
 */

export const COLS = 6;
export const ROWS = 7;

// Base shapes as [x, y] cells. Rotations are generated.
const SHAPES = {
  1: [[[0, 0]]],
  2: [[[0, 0], [1, 0]]],
  3: [[[0, 0], [1, 0], [2, 0]], [[0, 0], [1, 0], [0, 1]]],
  4: [
    [[0, 0], [1, 0], [2, 0], [3, 0]],  // I
    [[0, 0], [1, 0], [0, 1], [1, 1]],  // O
    [[0, 0], [0, 1], [0, 2], [1, 2]],  // L
    [[0, 0], [1, 0], [2, 0], [1, 1]],  // T
    [[1, 0], [2, 0], [0, 1], [1, 1]],  // S
  ],
};

const FOOD = {
  1: ['yogurt', 'hot sauce', 'soda', 'string cheese', 'pudding cup', 'lime'],
  2: ['leftover pizza', 'sandwich', 'milk', 'salad', 'sushi', 'oat milk'],
  3: ['soup', 'burrito', 'noodles', 'hummus tray', 'curry'],
  4: ['birthday cake', 'casserole', 'meal prep', 'lasagna', 'party platter'],
};
const OWNERS = ['Gary', 'Linda', 'Priya', 'Marco', 'Janet', 'Kev', 'Bea', 'Omar', 'Sue'];
const COLORS = ['#e8a87c', '#9fd3c7', '#f6d365', '#c3aed6', '#a8d8ea', '#f4a7b9', '#b5e48c', '#ffcf87', '#d4c4a8'];
const YOURS = [
  { label: 'Your lunchbox', color: '#3a6fd8' },
  { label: 'Your smoothie', color: '#2f9e5b' },
];

/** Normalise cells so the smallest x and y are 0, sorted row-major. */
function normalise(cells) {
  const minX = Math.min(...cells.map((c) => c[0]));
  const minY = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]) => [x - minX, y - minY]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/** Rotate cells 90 degrees clockwise `times` times. */
export function rotate(cells, times = 0) {
  let out = cells.map((c) => [...c]);
  for (let i = 0; i < ((times % 4) + 4) % 4; i++) out = out.map(([x, y]) => [-y, x]);
  return normalise(out);
}

/** Cells of a piece placed with its anchor (first cell, row-major) at (x, y). */
export function placedCells(piece, rot, x, y) {
  const cells = rotate(piece.cells, rot);
  const [ax, ay] = cells[0];
  return cells.map(([cx, cy]) => [cx - ax + x, cy - ay + y]);
}

/**
 * Build a puzzle. `rand()` returns a float in [0, 1).
 * Returns { cols, rows, items: [{ label, color, cells }], pieces: [{ label, color, cells }], answer }.
 */
export function generateFridge(rand) {
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(-1));
  const items = [];

  // Greedy random tiling: fill the first empty cell (row-major) with a random
  // shape that fits there; a single cell always fits, so this never fails.
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (grid[y][x] !== -1) continue;
      const sizes = [4, 4, 3, 3, 2, 2, 1].sort(() => rand() - 0.5);
      let placed = null;
      for (const size of sizes) {
        for (const base of [...SHAPES[size]].sort(() => rand() - 0.5)) {
          const rot = Math.floor(rand() * 4);
          const cells = placedCells({ cells: base }, rot, x, y);
          if (cells.every(([cx, cy]) => cx >= 0 && cy >= 0 && cx < COLS && cy < ROWS && grid[cy][cx] === -1)) {
            placed = cells;
            break;
          }
        }
        if (placed) break;
      }
      const id = items.length;
      for (const [cx, cy] of placed) grid[cy][cx] = id;
      const size = placed.length;
      const food = pick(FOOD[size]);
      items.push({ label: `${pick(OWNERS)}'s ${food}`, food, color: pick(COLORS), cells: placed });
    }
  }

  // Hand two of the bigger items to the player.
  const big = items.map((it, i) => i).filter((i) => items[i].cells.length >= 3).sort(() => rand() - 0.5);
  const takeIds = big.slice(0, 2);
  if (takeIds.length < 2) return generateFridge(rand); // vanishingly rare: try again
  // Open one small decoy gap too, so it's not just "fill every hole".
  const small = items.map((it, i) => i).filter((i) => !takeIds.includes(i) && items[i].cells.length <= 2);
  const decoyId = small.length ? pick(small) : null;

  const pieces = takeIds.map((id, k) => ({
    ...YOURS[k],
    cells: rotate(items[id].cells, 1 + Math.floor(rand() * 3)),
  }));
  const answer = takeIds.map((id) => items[id].cells);
  const removed = new Set([...takeIds, decoyId]);
  return {
    cols: COLS,
    rows: ROWS,
    items: items.filter((_, i) => !removed.has(i)),
    pieces,
    answer,
  };
}

/** What the client gets: everything except the answer. */
export function publicPuzzle(puzzle) {
  const { answer, ...rest } = puzzle;
  return rest;
}

/**
 * Check a set of placements: [{ piece, rot, x, y }], one per piece.
 * Any valid packing counts, not just the generated answer.
 */
export function checkFridge(puzzle, placements) {
  if (!Array.isArray(placements) || placements.length !== puzzle.pieces.length) return false;
  const taken = new Set();
  for (const it of puzzle.items) for (const [x, y] of it.cells) taken.add(`${x},${y}`);
  const seen = new Set();
  for (const pl of placements) {
    const i = Number(pl?.piece);
    if (!Number.isInteger(i) || i < 0 || i >= puzzle.pieces.length || seen.has(i)) return false;
    seen.add(i);
    const rot = Number(pl.rot), x = Number(pl.x), y = Number(pl.y);
    if (![rot, x, y].every(Number.isInteger)) return false;
    for (const [cx, cy] of placedCells(puzzle.pieces[i], rot, x, y)) {
      const key = `${cx},${cy}`;
      if (cx < 0 || cy < 0 || cx >= puzzle.cols || cy >= puzzle.rows || taken.has(key)) return false;
      taken.add(key);
    }
  }
  return true;
}
