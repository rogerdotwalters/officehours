/** Recycling: drag everything from the box into the recycling bin. */
import { itemsFor } from './items.js';

export function generateRecycling(rand) {
  const kinds = itemsFor('recycle');
  const count = 4 + Math.floor(rand() * 3);
  const items = [];
  for (let k = 0; k < count; k++) {
    items.push({
      key: `r${k}`,
      item: kinds[Math.floor(rand() * kinds.length)].id,
      // where it sits in the box, in percent, plus a little tilt
      x: 8 + Math.round(rand() * 62),
      y: 6 + Math.round(rand() * 46),
      tilt: Math.round((rand() - 0.5) * 50),
    });
  }
  return { items };
}

export function checkRecycling(puzzle, answer) {
  const keys = puzzle.items.map((i) => i.key).sort().join(',');
  const binned = Array.isArray(answer?.binned) ? [...new Set(answer.binned)].sort().join(',') : '';
  return binned === keys;
}
