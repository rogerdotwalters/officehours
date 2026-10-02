/**
 * Clog the toilet: drag the ridiculous things into the bowl, then flush and
 * enjoy the consequences. The objects come from the item table (use: toilet).
 */
import { itemsFor } from './items.js';

export function generateToilet(rand) {
  const pool = itemsFor('toilet').map((it) => [rand(), it]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
  const count = 4 + Math.floor(rand() * 2);
  return { items: pool.slice(0, count).map((it, k) => ({ key: `t${k}`, item: it.id })) };
}

export function checkToilet(puzzle, answer) {
  const keys = puzzle.items.map((i) => i.key).sort().join(',');
  const dropped = Array.isArray(answer?.dropped) ? [...new Set(answer.dropped)].sort().join(',') : '';
  return dropped === keys && answer?.flushed === true;
}
