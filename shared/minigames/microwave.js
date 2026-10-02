/**
 * Microwave: drag the food in, punch in the time from its sticky note, press Start.
 * The microwave then really runs (everyone sees its timer).
 *   productive: your lunch, 15 to 45 seconds. Wait for the ding, then open it to finish.
 *   slacker:    fish, for an absurd time. Walk away; when it dings the fumes start.
 */
import { itemsFor } from './items.js';

const NORMAL = { times: ['15', '20', '25', '30', '35', '40', '45'], notes: ['Lunch :)', 'Mine. Please don\u2019t.', 'Leftovers, yay', 'Heat & eat'] };
const FISH = { times: ['1000', '1500', '2000'], notes: ['Then just... leave it.', 'Walk away. Don\u2019t look back.', 'Let the smell speak for itself.'] };

export function generateMicrowave(rand, variant = 'productive') {
  const pick = (l) => l[Math.floor(rand() * l.length)];
  const slacker = variant === 'slacker';
  const food = slacker ? itemsFor('stinky')[0] : pick(itemsFor('microwave'));
  const set = slacker ? FISH : NORMAL;
  return { variant, food: food.id, code: pick(set.times), note: pick(set.notes) };
}

/** "130" -> "1:30", "1500" -> "15:00" */
export function codeToClock(code) {
  const padded = code.padStart(3, '0');
  return `${Number(padded.slice(0, -2))}:${padded.slice(-2)}`;
}

/** How long the microwave really runs (ms): the time entered, but fish is capped. */
export function runMs(puzzle) {
  if (puzzle.variant === 'slacker') return 30_000;
  const c = puzzle.code.padStart(3, '0');
  return (Number(c.slice(0, -2)) * 60 + Number(c.slice(-2))) * 1000;
}

export function checkMicrowave(puzzle, answer) {
  return answer?.inside === true && typeof answer.code === 'string' && answer.code.replace(/^0+/, '') === puzzle.code;
}
