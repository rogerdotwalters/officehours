/**
 * Coffee.
 *   productive: scoop grounds into the filter (as many as the recipe says), press Brew
 *   slacker:    pour the last of the pot into your mug and put the empty pot back
 *               on the hot plate. Someone else can deal with it.
 */
const RECIPES = [
  { scoops: 3, note: 'Standard pot. 3 scoops.', by: 'Facilities' },
  { scoops: 4, note: '4 scoops. It\u2019s a Monday.', by: 'Linda' },
  { scoops: 3, note: '3 scoops, please. Not Gary\u2019s recipe.', by: 'HR' },
];

export function generateCoffee(rand, variant = 'productive') {
  if (variant === 'slacker') return { variant: 'slacker' };
  return { variant: 'productive', ...RECIPES[Math.floor(rand() * RECIPES.length)] };
}

export function checkCoffee(puzzle, answer) {
  if (puzzle.variant === 'slacker') return answer?.poured === true && answer?.returned === true;
  return Number(answer?.scoops) === puzzle.scoops && answer?.brewed === true;
}
