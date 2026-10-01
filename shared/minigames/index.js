/**
 * Task mini-games, by name. A task with `minigame: '<name>'` (shared/tasks.js)
 * opens a task window instead of a hold-to-complete bar.
 *
 * Each mini-game provides:
 *   generate(rand)            -> puzzle (server only; may include the answer)
 *   publicView(puzzle)        -> what the client is allowed to see
 *   check(puzzle, answer)     -> true if the client's answer solves it
 * and a matching client UI in client/js/minigames/<name>.js.
 */
import { generateFridge, publicPuzzle, checkFridge } from './fridge.js';

export const MINIGAMES = {
  fridge: { generate: generateFridge, publicView: publicPuzzle, check: checkFridge },
};
