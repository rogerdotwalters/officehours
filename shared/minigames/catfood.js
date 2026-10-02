/**
 * Cat food: scoop food from the can into the bowl.
 *   productive: a sensible 3 to 5 scoops
 *   slacker:    8 to 10 scoops. Mittens is going to need a bigger bowl.
 */
export function generateCatfood(rand, variant = 'productive') {
  const slacker = variant === 'slacker';
  return { variant, scoops: slacker ? 8 + Math.floor(rand() * 3) : 3 + Math.floor(rand() * 3) };
}

export function checkCatfood(puzzle, answer) {
  return Number(answer?.scoops) === puzzle.scoops;
}
