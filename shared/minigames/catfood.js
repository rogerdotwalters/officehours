/** Cat food: scoop food out of the can with a spoon into the bowl, a few times. */
export function generateCatfood(rand) {
  return { scoops: 3 + Math.floor(rand() * 3) };
}

export function checkCatfood(puzzle, answer) {
  return Number(answer?.scoops) === puzzle.scoops;
}
