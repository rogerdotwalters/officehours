/**
 * Task catalogue. A task is completed by standing next to an interactable of the
 * matching `target` type and holding the interaction for `duration` ms.
 *
 * To add a task: add an interactable with a new `type` in officeMap.js, then add
 * an entry here. `target: 'own_desk'` means "your personal desk" specifically.
 */
import { BREAKER_HOLD_MS } from './constants.js';

export const TASKS = [
  // Desk tasks — safe, because you're at your desk.
  { id: 'emails',    label: 'Answer your emails',           target: 'own_desk',       duration: 5000, desk: true },
  { id: 'tps',       label: 'File your TPS report',         target: 'own_desk',       duration: 4500, desk: true },

  // Away-from-desk tasks — this is where Management can catch you.
  { id: 'water',     label: 'Drink from the water cooler',  target: 'water_cooler',   duration: 2500 },
  { id: 'coffee',    label: 'Refill your coffee',           target: 'coffee_machine', duration: 4000 },
  { id: 'reheat',    label: 'Reheat your leftovers',        target: 'microwave',      duration: 3500 },
  { id: 'lunch',     label: 'Eat lunch in the break room',  target: 'lunch_table',    duration: 6000 },
  { id: 'fridge',    label: 'Label your yogurt in the fridge', target: 'fridge',      duration: 2500 },
  { id: 'bathroom',  label: 'Use the bathroom',             target: 'toilet',         duration: 5000 },
  { id: 'wash',      label: 'Wash your hands',              target: 'sink',           duration: 2000 },
  { id: 'plant',     label: 'Water the lobby ficus',        target: 'plant',          duration: 2500 },
  { id: 'print',     label: 'Print the quarterly report',   target: 'printer',        duration: 4000 },
  { id: 'mail',      label: 'Check your mailbox',           target: 'mailbox',        duration: 2500 },
  { id: 'supplies',  label: 'Restock printer paper',        target: 'supplies',       duration: 3000 },
  { id: 'shred',     label: 'Shred confidential documents', target: 'shredder',       duration: 3500 },
];

export const TASKS_BY_ID = new Map(TASKS.map((t) => [t.id, t]));

/** Timed holds that aren't to-do items (they share the task progress bar). */
export const ACTIONS = [
  { id: 'breaker_off', label: 'Cutting the power',   target: 'breaker', duration: BREAKER_HOLD_MS, action: true },
  { id: 'breaker_on',  label: 'Restoring the power', target: 'breaker', duration: BREAKER_HOLD_MS, action: true },
];

/** Tasks and actions together, for anything that shows a progress bar. */
export const TIMED_BY_ID = new Map([...TASKS, ...ACTIONS].map((t) => [t.id, t]));

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
};
