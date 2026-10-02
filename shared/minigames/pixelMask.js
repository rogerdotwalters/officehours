/**
 * Pixel masks: collision shapes taken from a picture's transparency.
 *
 * A picture is cut into a grid of square cells (CELL world units each). A cell
 * is SOLID if enough of the pixels inside it are opaque; transparent margins,
 * holes and curves stay empty, so a banana's curve or a pizza slice's slanted
 * side really can tuck into the space next to something else.
 *
 * Used at build time (scripts/build-items.mjs reads every PNG and stores its
 * mask) and at run time by the server and the browser to test overlaps. Both
 * sides use the exact same masks, so the server can check a fridge answer.
 */

export const CELL = 4;              // world units per mask cell
export const ALPHA_SOLID = 64;      // 0..255: a pixel counts as solid at or above this alpha
export const COVERAGE = 0.25;       // fraction of solid pixels for a cell to be solid

/**
 * Build a mask from raw RGBA pixels.
 * @param {Uint8Array} rgba   pixel data, 4 bytes per pixel
 * @param {number} pxW, pxH   picture size in pixels
 * @param {number} cols, rows mask size in cells
 * @returns {Uint8Array} cols*rows, 1 = solid
 */
export function buildMask(rgba, pxW, pxH, cols, rows, { alpha = ALPHA_SOLID, coverage = COVERAGE } = {}) {
  const mask = new Uint8Array(cols * rows);
  const sx = pxW / cols, sy = pxH / rows;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor(cx * sx), x1 = Math.max(x0 + 1, Math.floor((cx + 1) * sx));
      const y0 = Math.floor(cy * sy), y1 = Math.max(y0 + 1, Math.floor((cy + 1) * sy));
      let solid = 0, total = 0;
      for (let y = y0; y < Math.min(y1, pxH); y++) {
        for (let x = x0; x < Math.min(x1, pxW); x++) {
          total++;
          if (rgba[(y * pxW + x) * 4 + 3] >= alpha) solid++;
        }
      }
      if (total && solid / total >= coverage) mask[cy * cols + cx] = 1;
    }
  }
  return mask;
}

/** Compact text form: one hex string per row (4 cells per hex digit). */
export function encodeMask(mask, cols, rows) {
  const out = [];
  for (let y = 0; y < rows; y++) {
    let row = '';
    for (let x = 0; x < cols; x += 4) {
      let nib = 0;
      for (let b = 0; b < 4; b++) if (x + b < cols && mask[y * cols + x + b]) nib |= 8 >> b;
      row += nib.toString(16);
    }
    out.push(row);
  }
  return out;
}

export function decodeMask(hexRows, cols) {
  const rows = hexRows.length;
  const mask = new Uint8Array(cols * rows);
  hexRows.forEach((row, y) => {
    for (let i = 0; i < row.length; i++) {
      const nib = parseInt(row[i], 16);
      for (let b = 0; b < 4; b++) {
        const x = i * 4 + b;
        if (x < cols && nib & (8 >> b)) mask[y * cols + x] = 1;
      }
    }
  });
  return mask;
}

/** [[cx, cy], ...] for every solid cell. */
export function solidCells(mask, cols, rows) {
  const out = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (mask[y * cols + x]) out.push([x, y]);
  return out;
}

/**
 * Edge finding: every boundary between a solid cell and an empty one (or the
 * picture's border). Returns line segments [x1, y1, x2, y2] in cell units,
 * with collinear runs merged. This is the outline of the collision shape.
 */
export function maskEdges(mask, cols, rows) {
  const at = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && mask[y * cols + x] === 1;
  const segs = [];
  // Horizontal edges: between row y-1 and row y.
  for (let y = 0; y <= rows; y++) {
    let start = null;
    for (let x = 0; x <= cols; x++) {
      const edge = x < cols && at(x, y) !== at(x, y - 1);
      if (edge && start === null) start = x;
      if (!edge && start !== null) { segs.push([start, y, x, y]); start = null; }
    }
  }
  // Vertical edges: between column x-1 and column x.
  for (let x = 0; x <= cols; x++) {
    let start = null;
    for (let y = 0; y <= rows; y++) {
      const edge = y < rows && at(x, y) !== at(x - 1, y);
      if (edge && start === null) start = y;
      if (!edge && start !== null) { segs.push([x, start, x, y]); start = null; }
    }
  }
  return segs;
}

/** The outline as an SVG path (cell units), for drawing. */
export function edgesToPath(segs) {
  return segs.map(([x1, y1, x2, y2]) => `M${x1} ${y1}L${x2} ${y2}`).join('');
}
