/**
 * Task catalogue.
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
 *   during: 'break'   can only be done on a break (or any time once the day has
 *                     no breaks left). See shared/breaks.js.
 *   minigame: '<name>' instead of holding still, a task window opens with a
 *                     little game: fridge, microwave, email, recycling, catfood.
 *                     The server makes it and checks the answer (shared/minigames/).
 *                     `duration` is ignored.
 *
 * To add a task:
 *   1. If it needs a new object, add an interactable with a new `type` in officeMap.js.
 *   2. Add an entry below: { id, label, target, duration (ms), chance }.
 *      `target` is an interactable type, or 'own_desk' for the player's own desk.
 *   3. Add a TARGET_HINT for new target types so the to-do list says where to go.
 * The server picks it up automatically.
 */
export const TASKS = [
  // Desk tasks: safe, because you're at your desk.
  { id: 'emails',      label: 'Clear out your inbox',             target: 'own_desk',       duration: 0,    chance: 10, desk: true, minigame: 'email' },
  { id: 'tps',         label: 'File your TPS report',             target: 'own_desk',       duration: 4500, chance: 8,  desk: true },
  { id: 'spreadsheet', label: 'Update the big spreadsheet',       target: 'own_desk',       duration: 6000, chance: 6,  desk: true },

  // Everyday errands away from your desk: this is where Management catches people.
  { id: 'water',       label: 'Drink from the water cooler',      target: 'water_cooler',   duration: 2500, chance: 9 },
  { id: 'coffee',      label: 'Refill your coffee',               target: 'coffee_machine', duration: 4000, chance: 9 },
  { id: 'reheat',      label: 'Reheat your leftovers',            target: 'microwave',      duration: 0,    chance: 7, minigame: 'microwave' },
  { id: 'fridge',      label: 'Put your lunch in the fridge',     target: 'fridge',         duration: 0,    chance: 9, minigame: 'fridge' },
  { id: 'bathroom',    label: 'Use the bathroom',                 target: 'toilet',         duration: 5000, chance: 7 },
  { id: 'wash',        label: 'Wash your hands',                  target: 'sink',           duration: 2000, chance: 7 },
  { id: 'plant',       label: 'Water the lobby ficus',            target: 'plant',          duration: 2500, chance: 5 },
  { id: 'print',       label: 'Print the quarterly report',       target: 'printer',        duration: 4000, chance: 7 },
  { id: 'mail',        label: 'Check your mailbox',               target: 'mailbox',        duration: 2500, chance: 7 },
  { id: 'supplies',    label: 'Restock printer paper',            target: 'supplies',       duration: 3000, chance: 5 },
  { id: 'shred',       label: 'Shred confidential documents',     target: 'shredder',       duration: 3500, chance: 5 },
  { id: 'filing',      label: 'File the expense reports',         target: 'filing_cabinet', duration: 4500, chance: 6 },
  { id: 'sketch',      label: 'Sketch ideas for the new logo',    target: 'easel',          duration: 5000, chance: 5 },
  { id: 'timesheet',   label: "Drop your timesheet in the manager's inbox", target: 'manager_inbox', duration: 2500, chance: 6 },

  // Break-time tasks: only on a break.
  { id: 'lunch',       label: 'Eat lunch in the break room',      target: 'lunch_table',    duration: 6000, chance: 7, during: 'break' },
  { id: 'picnic',      label: 'Eat lunch on the patio',           target: 'picnic_table',   duration: 6000, chance: 6, during: 'break' },

  // Outside.
  { id: 'planters',    label: 'Water the patio planters',         target: 'planter',        duration: 3500, chance: 6 },
  { id: 'car',         label: 'Grab your charger from your car',  target: 'car',            duration: 3000, chance: 6 },
  { id: 'recycling',   label: 'Take out the recycling',           target: 'dumpster',       duration: 0,    chance: 6, minigame: 'recycling' },
  { id: 'cat',         label: 'Feed the office cat',              target: 'cat_bowl',       duration: 0,    chance: 5, minigame: 'catfood' },

  // Rare ones: long, risky, and memorable.
  { id: 'gossip',      label: 'Catch up on gossip at the cooler', target: 'water_cooler',   duration: 7000, chance: 3 },
  { id: 'unjam',       label: 'Unjam the printer',                target: 'printer',        duration: 8000, chance: 3 },
  { id: 'candy',       label: "Sneak a mint from the manager's candy bowl", target: 'candy_bowl', duration: 2000, chance: 2 },
  { id: 'stapler',     label: 'Borrow a stapler (permanently)',   target: 'supplies',       duration: 2500, chance: 2 },
  { id: 'nap',         label: 'Sneak a nap in a stall',           target: 'toilet',         duration: 9000, chance: 1 },
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
  mailbox: 'Mail & Copy',
  supplies: 'Mail & Copy',
  shredder: 'Mail & Copy',
  filing_cabinet: 'Accounting',
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
