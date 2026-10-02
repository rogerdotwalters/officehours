/**
 * Water cooler.
 *   productive: hold the tap to fill a cup up to the line (not over), then drink
 *   slacker:    pop the lid off the tank, tip laxatives in, put the lid back.
 *               The next person to drink from this cooler goes home sick.
 */
export const FILL_MIN = 0.72;
export const FILL_MAX = 0.92;

export function generateCooler(rand, variant = 'productive') {
  return { variant };
}

export function checkCooler(puzzle, answer) {
  if (puzzle.variant === 'slacker') return answer?.lidOff === true && answer?.poured === true && answer?.lidOn === true;
  const level = Number(answer?.level);
  return answer?.drank === true && level >= FILL_MIN && level <= FILL_MAX;
}
