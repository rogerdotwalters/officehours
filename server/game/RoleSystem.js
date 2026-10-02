/**
 * RoleSystem — secret role assignment, desk assignment, and report validation.
 *
 * Roles: one Management, N snitches (lobby setting, secretly on Management's
 * side), everyone else a worker. Roles live only on the server; each client is
 * told its own role, and team members (Management + snitches) are told each other.
 */
import { ROLE, DESK_RANGE, REPORT_INITIAL_COOLDOWN_MS, DESK_CHECK_INITIAL_DELAY_MS } from '../../shared/constants.js';
import { effectiveSnitches } from '../../shared/settings.js';
import { shuffle } from './random.js';
import { lineOfSight } from '../../shared/sight.js';

export class RoleSystem {
  constructor(map) {
    this.map = map;
  }

  /**
   * Shuffle players, make the first Management and the next few snitches, and
   * give everyone a random desk. `dayStartAt` is when the start freeze ends.
   */
  assign(players, settings, dayStartAt) {
    const list = shuffle(players);
    const snitchCount = effectiveSnitches(settings, list.length);
    const desks = shuffle(this.map.desks);

    list.forEach((p, i) => {
      p.role = i === 0 ? ROLE.MANAGEMENT : i <= snitchCount ? ROLE.SNITCH : ROLE.WORKER;
      p.deskId = desks[i].id;
      p.reportReadyAt = p.isManagement ? dayStartAt + REPORT_INITIAL_COOLDOWN_MS : 0;
      p.deskCheckReadyAt = p.isManagement
        ? dayStartAt + Math.min(DESK_CHECK_INITIAL_DELAY_MS, settings.deskCheckCooldown * 1000)
        : 0;
      p.selfDirty = true;
    });
    return { management: list[0], snitches: list.slice(1, 1 + snitchCount) };
  }

  seatOf(player) {
    return this.map.desksById.get(player.deskId)?.seat ?? null;
  }

  isAtDesk(player) {
    const seat = this.seatOf(player);
    if (!seat) return false;
    return Math.hypot(player.x - seat.x, player.y - seat.y) <= DESK_RANGE;
  }

  /**
   * Validate a Management report. Every rule is checked here, never on the client:
   *  - reporter really is Management, is still in the office, cooldown elapsed
   *  - target exists, is still in the office, is NOT at their own desk
   *  - target is within the match's report range (Management must actually catch them)
   */
  validateReport(reporter, target, now, range) {
    if (!reporter.isManagement) return { ok: false, reason: 'Only Management can report.' };
    if (!reporter.isActive) return { ok: false, reason: "You're not in the office." };
    if (now < reporter.reportReadyAt) return { ok: false, reason: 'Report is on cooldown.' };
    if (!target || target.id === reporter.id) return { ok: false, reason: 'Invalid target.' };
    if (!target.isActive) return { ok: false, reason: "They're not in the office." };
    if (this.isAtDesk(target)) return { ok: false, reason: "They're at their desk." };
    if (Math.hypot(reporter.x - target.x, reporter.y - target.y) > range) return { ok: false, reason: 'Get closer first.' };
    if (!lineOfSight(this.map, reporter.x, reporter.y, target.x, target.y)) return { ok: false, reason: "You can't see them from here." };
    return { ok: true };
  }

  consumeReport(reporter, now, cooldownSeconds) {
    reporter.reportReadyAt = now + cooldownSeconds * 1000;
    reporter.selfDirty = true;
  }
}
