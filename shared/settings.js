/**
 * Lobby game settings. The host edits these in the lobby; the server clamps every
 * value to the ranges below (a modified client can't set speed to 9999), then
 * freezes a copy for the match when the workday starts.
 *
 * To add a setting: add an entry here, then read it from `game.match` on the
 * server (and from `room.settings` on the client if the client needs it).
 */
export const SETTINGS_SPEC = {
  tasks: {
    label: 'Tasks per person', group: 'Workday',
    min: 3, max: 10, step: 1, default: 6,
    format: (v) => String(v),
    help: 'Handed out one at a time as the day goes on.',
  },
  days: {
    label: 'Days in the week', group: 'Workday',
    min: 1, max: 5, step: 1, default: 3,
    format: (v) => (v === 1 ? '1 day' : `${v} days`),
    help: 'Slackers win if they make it to the end of the last day.',
  },
  target: {
    label: 'Daily target', group: 'Workday',
    min: 30, max: 90, step: 5, default: 60,
    format: (v) => `${v}%`,
    help: 'At the end of each day, if productivity minus chaos is below this, management makes you fire someone.',
  },
  workdayMinutes: {
    label: 'Workday length', group: 'Workday',
    min: 3, max: 15, step: 1, default: 5,
    format: (v) => `${v} min`,
    help: 'Split into equal parts, one per task. The clock pauses during all-hands meetings.',
  },
  breaks: {
    label: 'Breaks', group: 'Workday',
    min: 0, max: 3, step: 1, default: 3,
    format: (v) => ['None', 'Lunch', 'Lunch and afternoon', 'Coffee, lunch, afternoon'][v],
    help: 'Some tasks (like lunch) can only be done on a break.',
  },
  playerSpeed: {
    label: 'Walking speed', group: 'Movement and sight',
    min: 120, max: 280, step: 10, default: 190,
    format: (v) => `${(v / 190).toFixed(1)}x`,
  },
  sightRange: {
    label: 'Sight range', group: 'Movement and sight',
    min: 200, max: 900, step: 50, default: 450,
    format: (v) => `${Math.round(v / 50)} m`,
    help: "You can't see anyone further away than this.",
  },
  slackers: {
    label: 'Slackers', group: 'Roles',
    min: 1, max: 3, step: 1, default: 1,
    format: (v) => String(v),
    help: 'Secretly non-productive employees. There are always more productive employees than slackers.',
  },
  shenaniganCooldown: {
    label: 'Shenanigan cooldown', group: 'Roles',
    min: 10, max: 90, step: 5, default: 30,
    format: (v) => `${v} s`,
    help: 'How long a slacker waits between shenanigans.',
  },
};

export const DEFAULT_SETTINGS = Object.freeze(
  Object.fromEntries(Object.entries(SETTINGS_SPEC).map(([k, s]) => [k, s.default])),
);

/** Merge an untrusted patch into `base`, clamping and snapping every value. */
export function sanitizeSettings(patch, base = DEFAULT_SETTINGS) {
  const out = { ...DEFAULT_SETTINGS, ...base };
  if (!patch || typeof patch !== 'object') return out;
  for (const [key, spec] of Object.entries(SETTINGS_SPEC)) {
    if (!(key in patch)) continue;
    const n = Number(patch[key]);
    if (!Number.isFinite(n)) continue;
    const snapped = spec.min + Math.round((n - spec.min) / spec.step) * spec.step;
    out[key] = Math.max(spec.min, Math.min(spec.max, snapped));
  }
  return out;
}

/** How many slackers a match of `playerCount` really gets (always fewer than productive employees). */
export function effectiveSlackers(settings, playerCount) {
  return Math.max(1, Math.min(settings.slackers, Math.floor((playerCount - 1) / 2)));
}
