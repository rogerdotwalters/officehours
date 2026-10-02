/**
 * Line of sight. Walls block vision; doorways and the outdoors don't.
 *
 * Used by the server to decide who each player is sent (you only receive
 * players you can actually see), and by the browser to draw what you can see:
 * the dark fog stops at walls and spills out through open doors.
 *
 * Only walls block sight. Desks, sofas and other furniture are low enough to
 * see over.
 */
import { PLAYER_RADIUS } from './constants.js';
import { distPointRect } from './mapBuilder.js';

const SHRINK = 0.5; // ignore rays that only graze a wall's surface

/** Does the segment A->B pass through the rectangle r? (Liang-Barsky clipping) */
export function segmentHitsRect(ax, ay, bx, by, r) {
  const x0 = r.x + SHRINK, y0 = r.y + SHRINK, x1 = r.x + r.w - SHRINK, y1 = r.y + r.h - SHRINK;
  const dx = bx - ax, dy = by - ay;
  let t0 = 0, t1 = 1;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dy, ay - y0) && clip(dy, y1 - ay) && t0 <= t1;
}

/** Is the straight line between two points free of walls? */
export function lineOfSight(map, ax, ay, bx, by) {
  const minX = Math.min(ax, bx), maxX = Math.max(ax, bx), minY = Math.min(ay, by), maxY = Math.max(ay, by);
  for (const w of map.walls) {
    if (w.x > maxX || w.x + w.w < minX || w.y > maxY || w.y + w.h < minY) continue; // nowhere near
    if (segmentHitsRect(ax, ay, bx, by, w)) return false;
  }
  return true;
}

/**
 * Can someone at (x, y) use object `o`? Close enough, and no wall between them
 * and the nearest point of it (no using the toilet from the lawn).
 */
export function canReach(map, x, y, o, range) {
  if (distPointRect(x, y, o) > range) return false;
  const nx = Math.max(o.x, Math.min(o.x + o.w, x));
  const ny = Math.max(o.y, Math.min(o.y + o.h, y));
  return lineOfSight(map, x, y, nx, ny);
}

/**
 * Can someone at `a` see someone at `b`? Within `range`, and a clear line to
 * the middle of their body or either side of it (so you can spot someone
 * half-way through a doorway).
 */
export function canSee(map, a, b, range) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d > range) return false;
  if (d < 1) return true;
  if (lineOfSight(map, a.x, a.y, b.x, b.y)) return true;
  const px = (-dy / d) * PLAYER_RADIUS, py = (dx / d) * PLAYER_RADIUS;
  return lineOfSight(map, a.x, a.y, b.x + px, b.y + py) || lineOfSight(map, a.x, a.y, b.x - px, b.y - py);
}

/**
 * The area visible from (x, y) out to `radius`, as a polygon [[x, y], ...]
 * sorted by angle. Classic ray casting: shoot rays at every wall corner (and
 * just either side of it), keep the nearest hit for each.
 */
export function visibilityPolygon(map, x, y, radius) {
  const segs = [];
  const add = (x1, y1, x2, y2) => segs.push([x1, y1, x2, y2]);
  // Walls near enough to matter, as their four edges.
  for (const w of map.walls) {
    if (w.x > x + radius || w.x + w.w < x - radius || w.y > y + radius || w.y + w.h < y - radius) continue;
    const x0 = w.x, y0 = w.y, x1 = w.x + w.w, y1 = w.y + w.h;
    add(x0, y0, x1, y0); add(x1, y0, x1, y1); add(x1, y1, x0, y1); add(x0, y1, x0, y0);
  }
  // A box at the sight radius so every ray stops somewhere.
  const r = radius;
  add(x - r, y - r, x + r, y - r); add(x + r, y - r, x + r, y + r); add(x + r, y + r, x - r, y + r); add(x - r, y + r, x - r, y - r);

  const angles = [];
  for (const [x1, y1, x2, y2] of segs) {
    for (const [px, py] of [[x1, y1], [x2, y2]]) {
      const a = Math.atan2(py - y, px - x);
      angles.push(a - 0.0005, a, a + 0.0005);
    }
  }
  // A few evenly spaced rays too, so open areas come out round-ish.
  for (let i = 0; i < 24; i++) angles.push(-Math.PI + (i / 24) * Math.PI * 2);

  const pts = [];
  for (const a of angles) {
    const dx = Math.cos(a), dy = Math.sin(a);
    let best = Infinity;
    for (const [x1, y1, x2, y2] of segs) {
      // Ray (x,y)+t(dx,dy) vs segment (x1,y1)+u(x2-x1,y2-y1)
      const sx = x2 - x1, sy = y2 - y1;
      const den = dx * sy - dy * sx;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((x1 - x) * sy - (y1 - y) * sx) / den;
      const u = ((x1 - x) * dy - (y1 - y) * dx) / den;
      if (t > 0 && u >= 0 && u <= 1 && t < best) best = t;
    }
    if (best < Infinity) pts.push([a, x + dx * best, y + dy * best]);
  }
  pts.sort((p, q) => p[0] - q[0]);
  return pts.map(([, px, py]) => [px, py]);
}
