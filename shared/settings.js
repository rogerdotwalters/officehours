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
  workdayMinutes: {
    label: 'Workday length', group: 'Workday',
    min: 3, max: 15, step: 1, default: 6,
    format: (v) => `${v} min`,
    help: 'Split into equal parts, one per task. The clock pauses during all-hands meetings.',
  },
  breaks: {
    label: 'Breaks', group: 'Workday',
    min: 0, max: 3, step: 1, default: 3,
    format: (v) => ['None', 'Lunch', 'Lunch and afternoon', 'Coffee, lunch, afternoon'][v],
    help: 'On a break you can\u2019t be reported in the Break Room or outside, and desk checks are off.',
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
  snitches: {
    label: 'Snitches', group: 'Management',
    min: 0, max: 3, step: 1, default: 1,
    format: (v) => String(v),
    help: 'Secret helpers who share the back-office terminal channel with Management. At least two real workers are always kept.',
  },
  reportRange: {
    label: 'Report range', group: 'Management',
    min: 100, max: 400, step: 20, default: 220,
    format: (v) => `${Math.round(v / 50)} m`,
  },
  reportCooldown: {
    label: 'Report cooldown', group: 'Management',
    min: 10, max: 60, step: 5, default: 25,
    format: (v) => `${v} s`,
  },
  deskCheckWarning: {
    label: 'Desk check warning', group: 'Management',
    min: 8, max: 40, step: 1, default: 15,
    format: (v) => `${v} s`,
    help: 'Time everyone gets to reach their desk once Management calls a desk check.',
  },
  deskCheckCooldown: {
    label: 'Desk check cooldown', group: 'Management',
    min: 30, max: 240, step: 15, default: 90,
    format: (v) => `${v} s`,
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

/** How many snitches a match of `playerCount` really gets (keeps 2+ real workers). */
export function effectiveSnitches(settings, playerCount) {
  return Math.max(0, Math.min(settings.snitches, playerCount - 3));
}
