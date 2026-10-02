/**
 * Microwave: drag your food in, punch in the time written on its sticky note,
 * press Start.
 */
import { itemsFor } from './items.js';

const TIMES = ['45', '100', '130', '200', '230', '300'];
const NOTES = ['Mine!! Do NOT eat.', 'Property of Kev.', 'Heat me up!', 'Not yours, Gary.', 'Lunch :)'];

export function generateMicrowave(rand) {
  const pick = (l) => l[Math.floor(rand() * l.length)];
  const food = pick(itemsFor('microwave'));
  const code = pick(TIMES);
  return { food: food.id, code, note: pick(NOTES) };
}

/** "130" -> "1:30" */
export function codeToClock(code) {
  const padded = code.padStart(3, '0');
  return `${Number(padded.slice(0, -2))}:${padded.slice(-2)}`;
}

export function checkMicrowave(puzzle, answer) {
  return answer?.inside === true && typeof answer.code === 'string' && answer.code.replace(/^0+/, '') === puzzle.code;
}
