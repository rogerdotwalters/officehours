/**
 * Circle-vs-rect movement shared by the server (authoritative) and the client
 * (prediction). Axis-separated so players slide along walls instead of sticking.
 */
import { distPointRect } from './mapBuilder.js';
import { PLAYER_RADIUS, PLAYER_SPEED } from './constants.js';

function collides(map, x, y, radius) {
  if (x < radius || y < radius || x > map.width - radius || y > map.height - radius) return true;
  for (const r of map.colliders) {
    // Cheap reject before the exact test.
    if (x + radius < r.x || x - radius > r.x + r.w || y + radius < r.y || y - radius > r.y + r.h) continue;
    if (distPointRect(x, y, r) < radius) return true;
  }
  return false;
}

/** Normalise a raw input direction so diagonals aren't faster. */
export function normaliseInput(dx, dy) {
  const sx = Math.sign(dx) || 0;
  const sy = Math.sign(dy) || 0;
  if (sx && sy) return { dx: sx * Math.SQRT1_2, dy: sy * Math.SQRT1_2 };
  return { dx: sx, dy: sy };
}

/**
 * Move a player by input direction over dt seconds. Returns the new position.
 * Sub-steps so a large dt can never tunnel through a 12-unit wall.
 */
export function stepMovement(map, pos, input, dtSeconds, radius = PLAYER_RADIUS, speed = PLAYER_SPEED) {
  const dir = normaliseInput(input.dx, input.dy);
  let { x, y } = pos;
  const totalX = dir.dx * speed * dtSeconds;
  const totalY = dir.dy * speed * dtSeconds;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(totalX), Math.abs(totalY)) / (radius * 0.5)));
  const sx = totalX / steps;
  const sy = totalY / steps;

  for (let i = 0; i < steps; i++) {
    if (sx && !collides(map, x + sx, y, radius)) x += sx;
    if (sy && !collides(map, x, y + sy, radius)) y += sy;
  }
  return { x, y };
}

export { collides as positionBlocked };
