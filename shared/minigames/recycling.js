/**
 * Recycling: drag everything out of the box.
 *   productive: into the blue recycling bin
 *   slacker:    straight onto the parking lot
 */
import { itemsFor } from './items.js';

export function generateRecycling(rand, variant = 'productive') {
  const kinds = itemsFor('recycle');
  const count = 4 + Math.floor(rand() * 3);
  const items = [];
  for (let k = 0; k < count; k++) {
    items.push({
      key: `r${k}`,
      item: kinds[Math.floor(rand() * kinds.length)].id,
      x: 8 + Math.round(rand() * 62),
      y: 6 + Math.round(rand() * 46),
      tilt: Math.round((rand() - 0.5) * 50),
    });
  }
  return { variant, items };
}

export function checkRecycling(puzzle, answer) {
  const keys = puzzle.items.map((i) => i.key).sort().join(',');
  const binned = Array.isArray(answer?.binned) ? [...new Set(answer.binned)].sort().join(',') : '';
  return binned === keys;
}
