/**
 * Toilet.
 *   productive: restock the toilet paper (drag the rolls onto the holder)
 *   slacker:    clog it: drag ridiculous things into the bowl, then flush
 */
import { itemsFor } from './items.js';

export function generateToilet(rand, variant = 'productive') {
  if (variant !== 'slacker') {
    return { variant: 'productive', items: [0, 1, 2].map((k) => ({ key: `t${k}`, item: 'tp_roll' })) };
  }
  const pool = itemsFor('toilet').map((it) => [rand(), it]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
  const count = 4 + Math.floor(rand() * 2);
  return { variant: 'slacker', items: pool.slice(0, count).map((it, k) => ({ key: `t${k}`, item: it.id })) };
}

export function checkToilet(puzzle, answer) {
  const keys = puzzle.items.map((i) => i.key).sort().join(',');
  const dropped = Array.isArray(answer?.dropped) ? [...new Set(answer.dropped)].sort().join(',') : '';
  if (dropped !== keys) return false;
  return puzzle.variant === 'slacker' ? answer?.flushed === true : true;
}
