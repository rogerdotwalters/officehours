/**
 * Task mini-games, by name. A task with `minigame: '<name>'` (shared/tasks.js)
 * opens a task window instead of a hold-to-complete bar.
 *
 * Each mini-game provides:
 *   generate(rand)        -> puzzle (server only; may include the answer)
 *   publicView(puzzle)    -> what the client is allowed to see
 *   check(puzzle, answer) -> true if the client's answer solves it
 *   minMs(puzzle)         -> answers faster than this are refused (no instant bots)
 * and a matching client UI in client/js/minigames/<name>.js.
 */
import { generateFridge, publicFridge, checkFridge } from './fridge.js';
import { generateMicrowave, checkMicrowave } from './microwave.js';
import { generateCatfood, checkCatfood } from './catfood.js';
import { generateEmail, checkEmail } from './email.js';
import { generateRecycling, checkRecycling } from './recycling.js';
import { generateCopier, checkCopier } from './copier.js';
import { generateWhiteboard, checkWhiteboard } from './whiteboard.js';
import { generateToilet, checkToilet } from './toilet.js';
import { generateCoffee, checkCoffee } from './coffee.js';

const asIs = (p) => p;

export const MINIGAMES = {
  fridge:    { generate: generateFridge,    publicView: publicFridge, check: checkFridge,    minMs: () => 3000 },
  microwave: { generate: generateMicrowave, publicView: asIs,         check: checkMicrowave, minMs: () => 2000 },
  catfood:   { generate: generateCatfood,   publicView: asIs,         check: checkCatfood,   minMs: (p) => p.scoops * 700 },
  email:     { generate: generateEmail,     publicView: asIs,         check: checkEmail,     minMs: (p) => p.emails.length * 900 },
  recycling: { generate: generateRecycling, publicView: asIs,         check: checkRecycling, minMs: (p) => p.items.length * 400 },
  copier:    { generate: generateCopier,    publicView: asIs,         check: checkCopier,    minMs: (p) => p.docs.length * 900 },
  whiteboard:{ generate: generateWhiteboard, publicView: asIs,        check: checkWhiteboard, minMs: () => 3000 },
  toilet:    { generate: generateToilet,    publicView: asIs,         check: checkToilet,    minMs: (p) => p.items.length * 450 + 800 },
  coffee:    { generate: generateCoffee,    publicView: asIs,         check: checkCoffee,    minMs: (p) => p.scoops * 600 + 800 },
};
