/**
 * Coffee: scoop grounds from the canister into the coffee maker's filter, as
 * many scoops as the sticky-note recipe says, then press Brew.
 */
const RECIPES = [
  { scoops: 3, note: 'Normal coffee. 3 scoops. Boring.', by: 'HR' },
  { scoops: 4, note: '4 scoops. For Mondays.', by: 'Linda' },
  { scoops: 5, note: '5 scoops or don\u2019t bother.', by: 'Kev' },
  { scoops: 6, note: '6 scoops. I need to see through time.', by: 'Gary' },
];

export function generateCoffee(rand) {
  return { ...RECIPES[Math.floor(rand() * RECIPES.length)] };
}

export function checkCoffee(puzzle, answer) {
  return Number(answer?.scoops) === puzzle.scoops && answer?.brewed === true;
}
