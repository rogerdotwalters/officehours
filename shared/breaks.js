/**
 * Scheduled breaks. The workday runs 9:00 AM to 5:00 PM on the punch clock;
 * breaks are set in office time and converted to match time here.
 *
 * During a break:
 *   - people in a break area (rooms with breakArea: true, e.g. the Break Room and
 *     everywhere outside) can't be reported
 *   - Management can't call desk checks
 *   - tasks marked `during: 'break'` can be done (once no breaks are left in the
 *     day, they can be done any time, so nobody gets stuck)
 *
 * The `breaks` house rule picks how many of these the day has (in this order).
 */
import { OFFICE_OPEN_HOUR, OFFICE_CLOSE_HOUR } from './constants.js';

export const BREAKS = [
  { id: 'lunch',     label: 'Lunch',           start: 12,     end: 13 },
  { id: 'afternoon', label: 'Afternoon break', start: 15,     end: 15 + 20 / 60 },
  { id: 'coffee',    label: 'Coffee break',    start: 10.5,   end: 10.5 + 20 / 60 },
];

/** Break windows for a match, in workday-clock milliseconds, sorted by time. */
export function breakWindows(count, lengthMs) {
  const span = OFFICE_CLOSE_HOUR - OFFICE_OPEN_HOUR;
  const toMs = (hour) => ((hour - OFFICE_OPEN_HOUR) / span) * lengthMs;
  return BREAKS.slice(0, Math.max(0, count))
    .map((b) => ({ id: b.id, label: b.label, startMs: toMs(b.start), endMs: toMs(b.end) }))
    .sort((a, b) => a.startMs - b.startMs);
}

/** The break happening at `clock`, or null. */
export function breakAt(windows, clock) {
  return windows.find((w) => clock >= w.startMs && clock < w.endMs) ?? null;
}

/** The next break that hasn't started yet, or null. */
export function nextBreak(windows, clock) {
  return windows.find((w) => w.startMs > clock) ?? null;
}
