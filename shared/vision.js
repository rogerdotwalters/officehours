/**
 * Line of sight and fog of war, shared by the server (who may see whom) and the
 * client (what part of the floor is lit). Only walls block vision; desks and
 * furniture are low enough to look over. Door gaps let sight through.
 */
import { VISION_RADIUS } from './constants.js';

const RING_RAYS = 96;      // evenly spaced rays so the edge of the vision circle is round
const CORNER_EPS = 0.0004; // radians either side of each wall corner

/**
 * Where along the ray (ox,oy)+t*(dx,dy) it first enters rect r, for t in [0, maxT].
 * Returns Infinity if it misses. Slab method.
 */
function rayRect(ox, oy, dx, dy, r, maxT) {
  let t0 = 0;
  let t1 = maxT;
  if (dx === 0) {
    if (ox < r.x || ox > r.x + r.w) return Infinity;
  } else {
    let a = (r.x - ox) / dx;
    let b = (r.x + r.w - ox) / dx;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return Infinity;
  }
  if (dy === 0) {
    if (oy < r.y || oy > r.y + r.h) return Infinity;
  } else {
    let a = (r.y - oy) / dy;
    let b = (r.y + r.h - oy) / dy;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return Infinity;
  }
  return t0;
}

function rectNear(r, x, y, radius) {
  return r.x <= x + radius && r.x + r.w >= x - radius && r.y <= y + radius && r.y + r.h >= y - radius;
}

/** True if no wall crosses the straight line between the two points. */
export function hasLineOfSight(map, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const minX = Math.min(ax, bx), maxX = Math.max(ax, bx);
  const minY = Math.min(ay, by), maxY = Math.max(ay, by);
  for (const r of map.walls) {
    if (r.x > maxX || r.x + r.w < minX || r.y > maxY || r.y + r.h < minY) continue;
    if (rayRect(ax, ay, dx, dy, r, 1) !== Infinity) return false;
  }
  return true;
}

/** Can a player standing at `from` see a player standing at `to`? */
export function canSee(map, from, to, radius = VISION_RADIUS) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx * dx + dy * dy > radius * radius) return false;
  return hasLineOfSight(map, from.x, from.y, to.x, to.y);
}

/**
 * The lit area around (ox, oy) as a polygon [[x, y], ...], sorted by angle.
 * Rays are cast at every nearby wall corner (and just either side of it) so the
 * shadow edges are exact, plus a ring of rays for the round outer edge.
 */
export function visibilityPolygon(map, ox, oy, radius = VISION_RADIUS) {
  const rects = map.walls.filter((r) => rectNear(r, ox, oy, radius));
  const angles = [];
  for (let i = 0; i < RING_RAYS; i++) angles.push((i / RING_RAYS) * Math.PI * 2 - Math.PI);
  for (const r of rects) {
    for (const [cx, cy] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) {
      const a = Math.atan2(cy - oy, cx - ox);
      angles.push(a - CORNER_EPS, a, a + CORNER_EPS);
    }
  }
  angles.sort((a, b) => a - b);

  const points = [];
  for (const a of angles) {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let t = radius;
    for (const r of rects) {
      const hit = rayRect(ox, oy, dx, dy, r, t);
      if (hit < t) t = hit;
    }
    points.push([ox + dx * t, oy + dy * t]);
  }
  return points;
}
