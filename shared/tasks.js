/**
 * Task catalogue. Every task has TWO versions:
 *
 *   productive: what a productive employee does here (the normal, useful thing)
 *   slacker:    what a slacker does here (office shenanigans)
 *
 * Everyone sees the same task id and object, but your role decides which
 * version you get, its label, and which mini-game opens. Slacker versions can
 * leave `evidence` behind (shared/evidence.js): fish fumes in the Break Room,
 * a rude doodle on the whiteboard, a flooded restroom... A productive employee
 * doing their version at the same object cleans the mess up.
 *
 * Fields on a task:
 *   id, target    target is an interactable type, or 'own_desk' for your own desk
 *   chance        relative weight: chance 10 comes up five times as often as chance 2;
 *                 0 switches the task off
 *   during        'break': only on a break (or any time once the day has no breaks left)
 *   productive / slacker: { label, duration (ms, hold to finish)
 *                           or minigame (opens a task window), evidence? }
 *
 * Players never get the same task twice in a match while the list lasts.
 * To add a task: add an entry below (and a new interactable in officeMap.js if
 * it needs one, plus a TARGET_HINT). The server picks it up automatically.
 */
export const TASKS = [
  // ---- At your desk ----
  { id: 'emails', target: 'own_desk', chance: 10,
    productive: { label: 'Answer your work emails', minigame: 'email' },
    slacker:    { label: 'Forward chain emails to All Staff', minigame: 'email', evidence: 'chain_email' } },
  { id: 'tps', target: 'own_desk', chance: 8,
    productive: { label: 'File your TPS report', duration: 4500 },
    slacker:    { label: 'Look busy at your desk', duration: 4500 } },
  { id: 'spreadsheet', target: 'own_desk', chance: 6,
    productive: { label: 'Update the budget spreadsheet', duration: 6000 },
    slacker:    { label: 'Rank the office snacks in a spreadsheet', duration: 6000 } },

  // ---- Break Room ----
  { id: 'reheat', target: 'microwave', chance: 8,
    // Productive: start it, wait for the ding, come back and open it.
    productive: { label: 'Heat up your lunch', minigame: 'microwave' },
    slacker:    { label: 'Microwave fish for way too long', minigame: 'microwave', evidence: 'fish' } },
  { id: 'fridge', target: 'fridge', chance: 8,
    productive: { label: 'Put your lunch in the fridge', minigame: 'fridge' },
    slacker:    { label: 'Eat a coworker\u2019s lunch', minigame: 'fridge', evidence: 'stolen_lunch' } },
  { id: 'coffee', target: 'coffee_machine', chance: 8,
    productive: { label: 'Make a fresh pot of coffee', minigame: 'coffee' },
    slacker:    { label: 'Drink the last cup and leave the pot empty', minigame: 'coffee', evidence: 'empty_pot' } },
  { id: 'lunch', target: 'lunch_table', chance: 6, during: 'break',
    productive: { label: 'Eat lunch', duration: 5000 },
    slacker:    { label: 'Take an extremely long lunch', duration: 8000 } },

  // ---- Restrooms ----
  { id: 'clog', target: 'toilet', chance: 7,
    productive: { label: 'Restock the toilet paper', minigame: 'toilet' },
    slacker:    { label: 'Clog the toilet (on purpose)', minigame: 'toilet', evidence: 'flood' } },
  { id: 'bathroom', target: 'sink', chance: 5,
    productive: { label: 'Wash your hands', duration: 2500 },
    slacker:    { label: 'Fix your hair in the mirror for ages', duration: 6000 } },

  // ---- Conference Room ----
  { id: 'whiteboard', target: 'whiteboard', chance: 8,
    productive: { label: 'Draw the quarterly chart on the whiteboard', minigame: 'whiteboard' },
    slacker:    { label: 'Doodle something rude on the whiteboard', minigame: 'whiteboard', evidence: 'doodle' } },

  // ---- Mail & Copy Room ----
  { id: 'copies', target: 'copier', chance: 8,
    productive: { label: 'Copy the quarterly report', minigame: 'copier' },
    slacker:    { label: 'Photocopy something ridiculous', minigame: 'copier', evidence: 'copies' } },
  { id: 'print', target: 'printer', chance: 6,
    productive: { label: 'Print the meeting agenda', duration: 4000 },
    slacker:    { label: 'Print 400 pages of memes', duration: 6000, evidence: 'memes' } },
  { id: 'mail', target: 'mailbox', chance: 5,
    productive: { label: 'Sort the mail', duration: 3000 },
    slacker:    { label: 'Pick up the packages you sent to work', duration: 3000 } },
  { id: 'supplies', target: 'supplies', chance: 5,
    productive: { label: 'Restock the printer paper', duration: 3000 },
    slacker:    { label: 'Take every free pen', duration: 3000 } },
  { id: 'shred', target: 'shredder', chance: 5,
    productive: { label: 'Shred old confidential files', duration: 3500 },
    slacker:    { label: 'Shred the evidence', duration: 3500 } },

  // ---- Elsewhere inside ----
  { id: 'water', target: 'water_cooler', chance: 8,
    productive: { label: 'Get a cup of water', minigame: 'cooler' },
    slacker:    { label: 'Spike the water cooler with laxatives', minigame: 'cooler', effect: 'sick' } },
  // Slackers only: never handed out as a task (chance 0). Someone else's desk.
  { id: 'prank', target: 'other_desk', chance: 0, oncePerDay: true,
    productive: { label: 'Leave a coworker\u2019s computer alone' },
    slacker:    { label: 'Put something unprofessional on a coworker\u2019s screen', minigame: 'prank', effect: 'prank', evidence: 'screen' } },
  { id: 'plant', target: 'plant', chance: 4,
    productive: { label: 'Water the lobby ficus', duration: 2500 },
    slacker:    { label: 'Tell the lobby ficus your problems', duration: 5000 } },
  { id: 'filing', target: 'filing_cabinet', chance: 5,
    productive: { label: 'File the expense reports', duration: 4000 },
    slacker:    { label: 'Hide snacks in the filing cabinet', duration: 4000 } },
  { id: 'sketch', target: 'easel', chance: 5,
    productive: { label: 'Sketch the new logo', duration: 4500 },
    slacker:    { label: 'Draw a mustache on the logo mockups', duration: 4500 } },
  { id: 'timesheet', target: 'manager_inbox', chance: 5,
    productive: { label: "Hand in your timesheet", duration: 2500 },
    slacker:    { label: 'Fudge your timesheet', duration: 3000 } },
  { id: 'candy', target: 'candy_bowl', chance: 3,
    productive: { label: 'Refill the candy bowl', duration: 2500 },
    slacker:    { label: 'Empty the candy bowl into your pockets', duration: 2500 } },

  // ---- Outside ----
  { id: 'recycling', target: 'dumpster', chance: 6,
    productive: { label: 'Take out the recycling', minigame: 'recycling' },
    slacker:    { label: 'Dump the recycling in the parking lot', minigame: 'recycling', evidence: 'litter' } },
  { id: 'cat', target: 'cat_bowl', chance: 6,
    productive: { label: 'Feed the office cat', minigame: 'catfood' },
    slacker:    { label: 'Overfeed the office cat', minigame: 'catfood', evidence: 'fat_cat' } },
  { id: 'planters', target: 'planter', chance: 5,
    productive: { label: 'Water the patio planters', duration: 3500 },
    slacker:    { label: 'Water the fake plant', duration: 3500 } },
  { id: 'car', target: 'car', chance: 5,
    productive: { label: 'Grab your charger from your car', duration: 3000 },
    slacker:    { label: 'Nap in your car', duration: 7000 } },
  { id: 'picnic', target: 'picnic_table', chance: 5, during: 'break',
    productive: { label: 'Eat lunch on the patio', duration: 5000 },
    slacker:    { label: 'Fall asleep on the patio', duration: 8000 } },
];

export const TASKS_BY_ID = new Map(TASKS.map((t) => [t.id, t]));

/**
 * Shenanigans: what slackers can do. Slackers don't get a to-do list; any
 * slacker version that makes a mess or has an effect is available any time,
 * at its object (with a cooldown between them; the prank once per day).
 */
export const SHENANIGANS = TASKS
  .filter((t) => t.slacker.evidence || t.slacker.effect)
  .map((t) => ({ ...taskVersion(t, 'slacker'), oncePerDay: !!t.oncePerDay }));
export const SHENANIGAN_BY_TARGET = new Map(SHENANIGANS.map((s) => [s.target, s]));

/**
 * The version of a task for a role: { id, target, chance, during, label,
 * duration, minigame, evidence, variant }.
 */
export function taskVersion(task, role) {
  const variant = role === 'slacker' ? 'slacker' : 'productive';
  const v = task[variant];
  return {
    id: task.id, target: task.target, chance: task.chance, during: task.during,
    desk: task.target === 'own_desk',
    label: v.label, duration: v.duration ?? 0, minigame: v.minigame ?? null, evidence: v.evidence ?? null,
    effect: v.effect ?? null,
    variant,
  };
}

/** Human-readable hint for where a task happens (used in the task list). */
export const TARGET_HINT = {
  own_desk: 'your desk',
  other_desk: 'a coworker\u2019s desk',
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
