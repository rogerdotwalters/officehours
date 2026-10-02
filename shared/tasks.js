/**
 * Task catalogue. The theme is office shenanigans: nobody here is being productive.
 *
 * During the workday each player is handed tasks one at a time. Every new task is
 * drawn at random from this list, weighted by `chance`:
 *
 *   chance is a relative weight. A task with chance 10 comes up five times as
 *   often as one with chance 2. Set chance: 0 to switch a task off.
 *
 * A player never gets the same task twice in one match (unless the list runs out).
 *
 * Optional fields:
 *   during: 'break'    can only be done on a break (or any time once the day has
 *                      no breaks left). See shared/breaks.js.
 *   minigame: '<name>' instead of holding still, a task window opens with a
 *                      little game: fridge, microwave, email, recycling, catfood,
 *                      copier, whiteboard, toilet, coffee. The server makes it and checks the
 *                      answer (shared/minigames/). `duration` is ignored.
 *
 * To add a task:
 *   1. If it needs a new object, add an interactable with a new `type` in officeMap.js.
 *   2. Add an entry below: { id, label, target, duration (ms), chance }.
 *      `target` is an interactable type, or 'own_desk' for the player's own desk.
 *   3. Add a TARGET_HINT for new target types so the to-do list says where to go.
 * The server picks it up automatically.
 */
export const TASKS = [
  // At your desk: safe, because you're at your desk.
  { id: 'emails',      label: 'Delete the chain emails',               target: 'own_desk',       duration: 0,    chance: 10, desk: true, minigame: 'email' },
  { id: 'tps',         label: 'Look busy at your desk',                target: 'own_desk',       duration: 4500, chance: 8,  desk: true },
  { id: 'spreadsheet', label: 'Rank the office snacks in a spreadsheet', target: 'own_desk',     duration: 6000, chance: 6,  desk: true },

  // Around the office: this is where Management catches people.
  { id: 'water',       label: 'Loiter at the water cooler',            target: 'water_cooler',   duration: 2500, chance: 9 },
  { id: 'coffee',      label: 'Make dangerously strong coffee',        target: 'coffee_machine', duration: 0,    chance: 9, minigame: 'coffee' },
  { id: 'reheat',      label: 'Reheat fish in the microwave',          target: 'microwave',      duration: 0,    chance: 7, minigame: 'microwave' },
  { id: 'fridge',      label: 'Squeeze your lunch into the fridge',    target: 'fridge',         duration: 0,    chance: 9, minigame: 'fridge' },
  { id: 'bathroom',    label: 'Hide in the bathroom',                  target: 'toilet',         duration: 5000, chance: 6 },
  { id: 'clog',        label: 'Clog the toilet (on purpose)',          target: 'toilet',         duration: 0,    chance: 7, minigame: 'toilet' },
  { id: 'wash',        label: 'Wash your hands (finally)',             target: 'sink',           duration: 2000, chance: 6 },
  { id: 'plant',       label: 'Tell the lobby ficus your problems',    target: 'plant',          duration: 3000, chance: 5 },
  { id: 'print',       label: 'Accidentally print 400 pages',          target: 'printer',        duration: 4000, chance: 6 },
  { id: 'copies',      label: 'Photocopy something ridiculous',        target: 'copier',         duration: 0,    chance: 8, minigame: 'copier' },
  { id: 'mail',        label: 'Pick up the packages you sent to work', target: 'mailbox',        duration: 2500, chance: 6 },
  { id: 'supplies',    label: 'Stock up on free pens',                 target: 'supplies',       duration: 3000, chance: 5 },
  { id: 'shred',       label: 'Shred the evidence',                    target: 'shredder',       duration: 3500, chance: 6 },
  { id: 'filing',      label: 'Hide snacks in the filing cabinet',     target: 'filing_cabinet', duration: 4000, chance: 6 },
  { id: 'whiteboard',  label: 'Doodle on the conference whiteboard',   target: 'whiteboard',     duration: 0,    chance: 8, minigame: 'whiteboard' },
  { id: 'sketch',      label: 'Draw a mustache on the logo mockups',   target: 'easel',          duration: 4000, chance: 5 },
  { id: 'timesheet',   label: "Fudge your timesheet in the manager's inbox", target: 'manager_inbox', duration: 2500, chance: 6 },

  // Break-time only.
  { id: 'lunch',       label: 'Take an extremely long lunch',          target: 'lunch_table',    duration: 6000, chance: 7, during: 'break' },
  { id: 'picnic',      label: 'Eat lunch on the patio',                target: 'picnic_table',   duration: 6000, chance: 6, during: 'break' },

  // Outside.
  { id: 'planters',    label: 'Water the planters (one is fake)',      target: 'planter',        duration: 3500, chance: 6 },
  { id: 'car',         label: 'Nap in your car',                       target: 'car',            duration: 4000, chance: 6 },
  { id: 'recycling',   label: 'Take out the recycling',                target: 'dumpster',       duration: 0,    chance: 6, minigame: 'recycling' },
  { id: 'cat',         label: 'Feed the office cat',                   target: 'cat_bowl',       duration: 0,    chance: 5, minigame: 'catfood' },

  // Rare ones: long, risky, and memorable.
  { id: 'gossip',      label: 'Spread a rumor at the water cooler',    target: 'water_cooler',   duration: 7000, chance: 3 },
  { id: 'unjam',       label: 'Fight the printer',                     target: 'printer',        duration: 8000, chance: 3 },
  { id: 'candy',       label: "Steal from the manager's candy bowl",   target: 'candy_bowl',     duration: 2000, chance: 2 },
  { id: 'stapler',     label: "Borrow Gary's stapler (permanently)",   target: 'supplies',       duration: 2500, chance: 2 },
  { id: 'nap',         label: 'Sneak a nap in a stall',                target: 'toilet',         duration: 9000, chance: 1 },
];

export const TASKS_BY_ID = new Map(TASKS.map((t) => [t.id, t]));

/** Human-readable hint for where a task happens (used in the task list). */
export const TARGET_HINT = {
  own_desk: 'your desk',
  water_cooler: 'hallway nooks',
  coffee_machine: 'Break Room',
  microwave: 'Break Room',
  lunch_table: 'Break Room',
  fridge: 'Break Room',
  toilet: 'Restrooms',
  sink: 'Restrooms',
  plant: 'Lobby',
  printer: 'Mail & Copy',
  copier: 'Mail & Copy',
  mailbox: 'Mail & Copy',
  supplies: 'Mail & Copy',
  shredder: 'Mail & Copy',
  filing_cabinet: 'Accounting',
  whiteboard: 'Conference Room',
  easel: 'Design Studio',
  manager_inbox: "Manager's Office",
  candy_bowl: "Manager's Office",
  planter: 'Patio, outside',
  picnic_table: 'Patio, outside',
  car: 'Parking Lot, outside',
  dumpster: 'Parking Lot, outside',
  cat_bowl: 'Lawn, outside',
};

/** Rarity word shown next to a task in the to-do list. */
export function rarityOf(task) {
  if (task.chance <= 2) return 'rare';
  if (task.chance <= 4) return 'uncommon';
  return '';
}
