/**
 * RoleSystem — secret role assignment and desks.
 *
 * Roles: a few SLACKERS (house rule, always fewer than everyone else), everyone
 * else PRODUCTIVE. Roles live only on the server; each client is told its own
 * role, and slackers are told who the other slackers are.
 */
import { ROLE, DESK_RANGE } from '../../shared/constants.js';
import { effectiveSlackers } from '../../shared/settings.js';
import { shuffle } from './random.js';

export class RoleSystem {
  constructor(map) {
    this.map = map;
  }

  /** Shuffle players, make the first few slackers, and give everyone a random desk. */
  assign(players, settings) {
    const list = shuffle(players);
    const slackerCount = effectiveSlackers(settings, list.length);
    const desks = shuffle(this.map.desks);
    list.forEach((p, i) => {
      p.role = i < slackerCount ? ROLE.SLACKER : ROLE.PRODUCTIVE;
      p.deskId = desks[i].id;
      p.selfDirty = true;
    });
    return { slackers: list.slice(0, slackerCount) };
  }

  seatOf(player) {
    return this.map.desksById.get(player.deskId)?.seat ?? null;
  }

  isAtDesk(player) {
    const seat = this.seatOf(player);
    if (!seat) return false;
    return Math.hypot(player.x - seat.x, player.y - seat.y) <= DESK_RANGE;
  }
}
