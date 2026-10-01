/**
 * RoleSystem — secret role assignment, desk assignment, and report validation.
 * Roles live only on the server; each client is told its own role and nothing else.
 */
import { ROLE, DESK_RANGE, REPORT_RANGE, REPORT_COOLDOWN_MS, REPORT_INITIAL_COOLDOWN_MS } from '../../shared/constants.js';
import { randomInt, shuffle } from './random.js';

export class RoleSystem {
  constructor(map) {
    this.map = map;
  }

  /** Pick one Management player at random, give everyone a random desk. */
  assign(players, now) {
    const list = [...players];
    const managementIndex = randomInt(list.length);
    const desks = shuffle(this.map.desks);

    list.forEach((p, i) => {
      p.role = i === managementIndex ? ROLE.MANAGEMENT : ROLE.WORKER;
      p.deskId = desks[i].id;
      p.reportReadyAt = p.isManagement ? now + REPORT_INITIAL_COOLDOWN_MS : 0;
      p.selfDirty = true;
    });
    return list[managementIndex];
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
   *  - target exists, is an active worker, is NOT at their own desk
   *  - target is within REPORT_RANGE (Management must actually catch them)
   */
  validateReport(reporter, target, now) {
    if (!reporter.isManagement) return { ok: false, reason: 'Only Management can report.' };
    if (!reporter.isActive) return { ok: false, reason: "You're not in the office." };
    if (now < reporter.reportReadyAt) return { ok: false, reason: 'Report is on cooldown.' };
    if (!target || target.id === reporter.id) return { ok: false, reason: 'Invalid target.' };
    if (!target.isActive) return { ok: false, reason: "They're not in the office." };
    if (this.isAtDesk(target)) return { ok: false, reason: "They're at their desk." };
    if (Math.hypot(reporter.x - target.x, reporter.y - target.y) > REPORT_RANGE) return { ok: false, reason: 'Get closer first.' };
    return { ok: true };
  }

  consumeReport(reporter, now) {
    reporter.reportReadyAt = now + REPORT_COOLDOWN_MS;
    reporter.selfDirty = true;
  }
}
