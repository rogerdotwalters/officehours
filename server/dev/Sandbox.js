/**
 * Sandbox — test rooms for trying features without a real game.
 *
 * A sandbox room is a normal room with `game.sandbox = true`. In one:
 *   - you can start with a single player, nobody needs to be ready
 *   - people can join with the invite link even while a match is running
 *   - anyone can pick their role (in the lobby, or switch live mid-match)
 *   - wins only happen when you ask for them (or switch "real win rules" on)
 *   - the DEV message unlocks the commands below (ignored in normal rooms)
 *
 * REMOVING IT: delete server/dev/, client/js/dev/ and tests/sandbox.test.mjs,
 * then delete every line tagged SANDBOX (`grep -rn SANDBOX server client shared`).
 * Or keep the code and set ENABLE_SANDBOX = "false" in wrangler.toml.
 */
import { PHASE, STATUS, ROLE, COLORS, MAX_PLAYERS, CHAT_MAX } from '../../shared/constants.js';
import { S2C } from '../../shared/protocol.js';
import { sanitizeSettings, SETTINGS_SPEC } from '../../shared/settings.js';
import { positionBlocked } from '../../shared/physics.js';
import { Player } from '../game/Player.js';
import { TASKS_BY_ID } from '../../shared/tasks.js';
import { randomId } from '../game/random.js';

const ROLES = new Set([ROLE.WORKER, ROLE.MANAGEMENT, ROLE.SNITCH]);
const WANDER_DIRS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

/** Per-room sandbox state, created lazily. */
function state(game) {
  if (!game.sandboxState) {
    game.sandboxState = { wander: true, realWins: false, prefs: new Map(), seeAll: new Set() };
  }
  return game.sandboxState;
}

/** Public sandbox info added to ROOM messages (it's a test room: no secrets to keep). */
export function sandboxRoomInfo(game) {
  const s = state(game);
  return {
    wander: s.wander,
    realWins: s.realWins,
    prefs: Object.fromEntries(s.prefs),
    seeAll: [...s.seeAll],
    dummies: [...game.players.values()].filter((p) => p.dummy).length,
  };
}

export function sandboxSeesAll(game, viewer) {
  return state(game).seeAll.has(viewer.id);
}

export function sandboxWinsEnabled(game) {
  return state(game).realWins;
}

// ===========================================================================
// Hooks called from Game
// ===========================================================================

/** After normal role assignment at match start: apply players' chosen roles. */
export function applyPreferredRoles(game) {
  for (const [id, role] of state(game).prefs) {
    const p = game.players.get(id);
    if (p) assignRole(game, p, role, null);
  }
}

/** Someone joined mid-match with the invite link: give them a desk and put them to work. */
export function seatNewcomer(game, p, now) {
  p.resetForMatch();
  const used = new Set([...game.players.values()].map((o) => o.deskId).filter(Boolean));
  const desk = game.office.desks.find((d) => !used.has(d.id)) ?? game.office.desks[0];
  p.deskId = desk.id;
  p.x = desk.seat.x;
  p.y = desk.seat.y;
  game.tasks.reset(p);
  if (game.day) {
    const due = game.tasksDue(now);
    while (p.tasks.length < due && game.tasks.issueNext(p));
  }
  const role = state(game).prefs.get(p.id);
  if (role) assignRole(game, p, role, now);
  p.selfDirty = true;
  for (const o of game.players.values()) if (o.isTeam) o.selfDirty = true;
  game.roomDirty = true;
}

/** Every tick: dummies wander around if that's switched on. */
export function sandboxTick(game, now) {
  const s = state(game);
  for (const p of game.players.values()) {
    if (!p.dummy || !p.isActive) continue;
    if (!s.wander || game.phase === PHASE.MEETING) { p.input = { dx: 0, dy: 0 }; continue; }
    if (now >= (p.nextWanderAt ?? 0)) {
      const [dx, dy] = WANDER_DIRS[Math.floor(Math.random() * WANDER_DIRS.length)];
      p.input = { dx, dy };
      p.nextWanderAt = now + 700 + Math.random() * 1600;
    }
  }
}

// ===========================================================================
// Commands
// ===========================================================================

/**
 * Handle a DEV message: { t: 'dev', cmd, ...args }. Only reachable in sandbox
 * rooms (GameRoom checks game.sandbox). Every command still goes through the
 * real game code paths where possible, so you're testing the real thing.
 */
export function handleDevCommand(game, p, msg, now) {
  game.now = now;
  const cmd = typeof msg.cmd === 'string' ? msg.cmd : '';
  const fn = COMMANDS[cmd];
  if (!fn) return;
  const reply = fn(game, p, msg, now);
  if (typeof reply === 'string') game.toast(p, reply);
  game.roomDirty = true;
}

const inMatch = (game) => game.phase === PHASE.PLAYING || game.phase === PHASE.MEETING;

const COMMANDS = {
  // ---- Roles ---------------------------------------------------------------
  role(game, p, { role }, now) {
    const s = state(game);
    const wanted = ROLES.has(role) ? role : null; // null = random
    if (wanted) s.prefs.set(p.id, wanted); else s.prefs.delete(p.id);
    if (!inMatch(game) || !wanted) {
      return wanted ? `You'll be ${label(wanted)} when the match starts.` : "You'll get a random role.";
    }
    assignRole(game, p, wanted, now);
    return `You're now ${label(wanted)}.`;
  },

  // ---- Match flow ----------------------------------------------------------
  start(game, p, _msg, now) {
    if (game.phase !== PHASE.LOBBY) return 'A match is already running.';
    const prevHost = game.hostId;
    game.hostId = p.id;               // anyone can start a test match
    game.handleStart(p, now);
    game.hostId = prevHost;
  },
  lobby(game) {
    game.meetings.end();
    game.resetToLobby();
  },
  end(game, _p, { winner }, now) {
    if (!inMatch(game)) return 'No match running.';
    game.endGame(winner === 'management' ? 'management' : 'workers', 'Ended from the test tools.', now);
  },
  realWins(game, _p, { on }, now) {
    state(game).realWins = !!on;
    if (on) game.checkWin(now);
    return on ? 'Real win rules are on.' : 'Wins only happen when you end the match.';
  },

  // ---- Workday & tasks -----------------------------------------------------
  nextTask(game, _p, _msg, now) {
    if (game.phase !== PHASE.PLAYING || !game.day) return 'Start a match first.';
    const clock = Math.max(0, game.dayClock(now));
    const section = game.sectionMs();
    if (Math.floor(clock / section) >= game.day.sections - 1) return 'Everyone already has all their tasks.';
    shiftClock(game, now, section - (clock % section) + 1);
    game.issueDueTasks(now);
  },
  allTasks(game, _p, _msg, now) {
    if (game.phase !== PHASE.PLAYING || !game.day) return 'Start a match first.';
    const target = (game.day.sections - 1) * game.sectionMs() + 1;
    const clock = game.dayClock(now);
    if (clock < target) shiftClock(game, now, target - clock);
    game.issueDueTasks(now);
  },
  almostFive(game, _p, _msg, now) {
    if (game.phase !== PHASE.PLAYING || !game.day) return 'Start a match first.';
    const target = game.day.lengthMs - 20_000;
    const clock = game.dayClock(now);
    if (clock < target) shiftClock(game, now, target - clock);
    game.issueDueTasks(now);
    return 'It\u2019s 4:50 PM. 20 seconds until closing time.';
  },
  nextBreak(game, _p, _msg, now) {
    if (game.phase !== PHASE.PLAYING || !game.day) return 'Start a match first.';
    const clock = game.dayClock(now);
    const next = game.breaks.find((w) => w.startMs > clock);
    if (!next) return game.breaks.length ? 'No breaks left today.' : 'Breaks are switched off in the house rules.';
    shiftClock(game, now, next.startMs - clock + 1);
    game.issueDueTasks(now);
    game.updateBreak(now);
  },
  giveTask(game, p, { taskId }) {
    if (!inMatch(game) || !p.isActive) return 'You need to be in the office.';
    const def = TASKS_BY_ID.get(taskId);
    if (!def) return 'Unknown task.';
    const existing = p.tasks.find((t) => t.id === def.id);
    if (existing) existing.done = false;
    else p.tasks.push({ id: def.id, done: false });
    p.selfDirty = true;
    return `Added: ${def.label}.`;
  },
  finishTasks(game, p) {
    if (!inMatch(game)) return 'Start a match first.';
    game.tasks.cancel(p);
    for (const t of p.tasks) t.done = true;
    p.selfDirty = true;
  },

  // ---- Management tools -----------------------------------------------------
  cooldowns(game, _p, _msg, now) {
    for (const o of game.players.values()) {
      if (o.isManagement) { o.reportReadyAt = now; o.deskCheckReadyAt = now; }
      o.emergencyCallsLeft = Math.max(1, o.emergencyCallsLeft);
      o.selfDirty = true;
    }
    game.meetingAvailableAt = now;
    game.freezeUntil = Math.min(game.freezeUntil, now);
    return 'Cooldowns reset.';
  },
  deskCheck(game, _p, _msg, now) {
    if (game.phase !== PHASE.PLAYING) return 'Desk checks only happen during the workday.';
    if (game.deskCheck) return 'A desk check is already underway.';
    game.deskCheck = { endsAt: now + game.match.deskCheckWarning * 1000, startedAt: now };
    const mgmt = [...game.players.values()].find((o) => o.isManagement);
    if (mgmt) { mgmt.deskCheckReadyAt = Infinity; mgmt.selfDirty = true; }
    game.broadcast(S2C.EVENT, { kind: 'desk_check', seconds: game.match.deskCheckWarning });
  },
  meeting(game, p, _msg, now) {
    if (game.phase !== PHASE.PLAYING) return 'Meetings can only be called during the workday.';
    if (game.deskCheck) game.deskCheck = null;
    game.startMeeting(p, now);
  },
  endMeeting(game, _p, _msg, now) {
    const m = game.meetings.current;
    if (!m) return 'No meeting running.';
    if (m.stage === 'discussing') game.resolveVote(now);
    game.endMeeting(now);
  },

  // ---- Moving yourself around ------------------------------------------------
  teleport(game, p, { to }) {
    if (!inMatch(game) || !p.isActive) return 'You need to be in the office.';
    const spot = findSpot(game, p, to);
    if (!spot) return 'Unknown place.';
    game.tasks.cancel(p);
    p.x = spot.x;
    p.y = spot.y;
  },
  goHome(game, p) {
    if (!inMatch(game) || !p.isActive) return 'You need to be in the office.';
    game.sendHome(p);
    game.broadcast(S2C.EVENT, { kind: 'reported', playerId: p.id, name: p.name, where: game.office.roomName(p.x, p.y) });
  },
  backToWork(game, p, _msg, now) {
    if (!inMatch(game)) return 'Start a match first.';
    if (p.isActive) return "You're already in the office.";
    p.status = STATUS.ACTIVE;
    const seat = game.roles.seatOf(p);
    if (seat) { p.x = seat.x; p.y = seat.y; }
    if (game.day) { const due = game.tasksDue(now); while (p.tasks.length < due && game.tasks.issueNext(p)); }
    p.selfDirty = true;
  },
  seeAll(game, p, { on }) {
    const s = state(game).seeAll;
    if (on) s.add(p.id); else s.delete(p.id);
  },

  // ---- Dummies ---------------------------------------------------------------
  addDummy(game, _p, _msg, now) {
    if (game.players.size >= MAX_PLAYERS) return `Room is full (${MAX_PLAYERS}).`;
    const n = [...game.players.values()].filter((o) => o.dummy).length + 1;
    const used = new Set([...game.players.values()].map((o) => o.colorId));
    const colorId = COLORS.findIndex((_, i) => !used.has(i));
    const d = new Player({ id: randomId(6), token: null, name: `Dummy ${n}`, colorId });
    d.dummy = true;
    d.ready = true;
    game.placeInLobby(d);
    game.players.set(d.id, d);
    if (game.phase !== PHASE.LOBBY) seatNewcomer(game, d, now);
    game.roomDirty = true;
  },
  clearDummies(game) {
    for (const o of [...game.players.values()]) {
      if (!o.dummy) continue;
      game.meetings.removeVoter(o.id);
      game.players.delete(o.id);
    }
    game.roomDirty = true;
  },
  wander(game, _p, { on }) {
    state(game).wander = !!on;
  },

  // ---- Settings (anyone, any time) ----------------------------------------------
  setting(game, _p, { key, value }) {
    if (!(key in SETTINGS_SPEC)) return;
    game.settings = sanitizeSettings({ [key]: value }, game.settings);
    if (game.match) {
      game.match = sanitizeSettings({ [key]: value }, game.match);
      if (game.day && (key === 'workdayMinutes' || key === 'tasks')) {
        game.day.lengthMs = game.match.workdayMinutes * 60_000;
        game.day.sections = game.match.tasks;
        for (const o of game.players.values()) o.selfDirty = true;
      }
    }
  },

  // ---- Say something as a dummy (to test chats without a second device) ---------
  dummySay(game, _p, { channel, text }, now) {
    const d = [...game.players.values()].find((o) => o.dummy && o.isActive);
    if (!d) return 'Add a dummy first.';
    const clean = typeof text === 'string' ? text.slice(0, CHAT_MAX) : '';
    game.handleChat(d, clean || 'Has anyone seen my stapler?', ['all', 'team', 'crew'].includes(channel) ? channel : 'crew', now);
  },
};

// ===========================================================================
// Helpers
// ===========================================================================

function label(role) {
  return role === ROLE.MANAGEMENT ? 'Management' : role === ROLE.SNITCH ? 'a snitch' : 'a worker';
}

/**
 * Give a player a role. There's only ever one Management: whoever had it
 * becomes a worker. `now` null = at match start (use the normal cooldowns),
 * otherwise mid-match (tools are ready immediately).
 */
function assignRole(game, p, role, now) {
  if (role === ROLE.MANAGEMENT) {
    for (const o of game.players.values()) if (o !== p && o.isManagement) o.role = ROLE.WORKER;
  }
  p.role = role;
  if (now != null) {
    p.reportReadyAt = now;
    p.deskCheckReadyAt = now;
  } else if (role === ROLE.MANAGEMENT && !p.reportReadyAt) {
    p.reportReadyAt = game.day?.startAt ?? 0;
    p.deskCheckReadyAt = game.day?.startAt ?? 0;
  }
  for (const o of game.players.values()) o.selfDirty = true; // team lists changed
  // Hand over the chat history the new role can now read.
  if (now != null) {
    if (p.isTeam) game.send(p.id, S2C.CHAT, { channel: 'team', backlog: game.teamChat });
    if (!p.isManagement) game.send(p.id, S2C.CHAT, { channel: 'crew', backlog: game.crewChat });
  }
  game.roomDirty = true;
}

/** Move the workday clock forward by `ms`. */
function shiftClock(game, now, ms) {
  game.day.startAt -= ms;
  game.roomDirty = true;
}

/** A free spot in a room, next to an object, or at your desk. */
function findSpot(game, p, to) {
  const map = game.office;
  let target = null;
  if (to === 'desk') target = game.roles.seatOf(p);
  else {
    const obj = map.getInteractable(to);
    if (obj) target = { x: obj.x + obj.w / 2, y: obj.y + obj.h + 22 };
    const room = map.rooms.find((r) => r.id === to);
    if (room) target = { x: room.x + room.w / 2, y: room.y + room.h / 2 };
  }
  if (!target) return null;
  // Spiral out until we find somewhere you can actually stand.
  for (let r = 0; r < 300; r += 10) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const x = target.x + Math.cos(a) * r;
      const y = target.y + Math.sin(a) * r;
      if (!positionBlocked(map, x, y, 14)) return { x, y };
      if (r === 0) break;
    }
  }
  return null;
}
