/**
 * Game — the authoritative state machine for one room.
 *
 * Pure logic: it knows nothing about WebSockets or Durable Objects. The transport
 * layer (GameRoom) passes in `send(playerId, type, data)` and `broadcast(type, data)`
 * callbacks and calls the handle*() methods with already-parsed intents.
 *
 * Phases:  LOBBY -> PLAYING <-> MEETING -> ENDED -> LOBBY
 *
 * The lobby is a small walkable waiting room (shared/lobbyMap.js); the match
 * happens in the office (shared/officeMap.js).
 *
 * Roles: most players are PRODUCTIVE employees; a secret few are SLACKERS.
 * Everyone gets the same tasks, but each role does its own version of them
 * (shared/tasks.js). Productive tasks fill the Productivity meter; slacker
 * tasks fill the Chaos meter and can leave evidence around the office
 * (shared/evidence.js) that productive employees can clean up.
 *
 * The week: `match.days` workdays. Each is `match.workdayMinutes` long, split
 * into `match.tasks` equal sections; at the start of each section every
 * productive employee in the office is handed one more task. Slackers get no
 * list: they can cause any shenanigan, any time (with a cooldown).
 *
 * At 5 PM: the end-of-day report. Today's score is productivity minus chaos.
 * Anyone whose computer was pranked is fired by IT. If the score missed the
 * target, management makes the team fire someone by vote. Then the next day.
 */
import {
  PHASE, STATUS, ROLE, MAX_PLAYERS, MIN_PLAYERS, NAME_MAX, CHAT_MAX, CHAT_HISTORY,
  START_FREEZE_MS, MEETING_COOLDOWN_MS, EMERGENCY_CALLS_PER_PLAYER,
  RECONNECT_GRACE_MS, TICK_MS, INTERACT_RANGE, COLORS,
} from '../../shared/constants.js';
import { S2C, PFLAG } from '../../shared/protocol.js';
import { buildOfficeMap, distPointRect } from '../../shared/mapBuilder.js';
import { LOBBY_ROOM } from '../../shared/lobbyMap.js';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../shared/settings.js';
import { breakWindows, breakAt, nextBreak } from '../../shared/breaks.js';
import { canSee, canReach, lineOfSight } from '../../shared/sight.js';
import { inkToStrokes } from '../../shared/minigames/whiteboard.js';
import { stepMovement } from '../../shared/physics.js';
import { Player } from './Player.js';
import { TaskSystem } from './TaskSystem.js';
import { RoleSystem } from './RoleSystem.js';
import { MeetingSystem, SKIP } from './MeetingSystem.js';
import { randomId, randomInt } from './random.js';

const rand = () => randomInt(2 ** 30) / 2 ** 30;
import { EMOTES_BY_ID } from '../../shared/emotes.js';
import { EVIDENCE, CHAOS } from '../../shared/evidence.js';
import { TASKS_BY_ID, SHENANIGAN_BY_TARGET, taskVersion } from '../../shared/tasks.js';
import { MINIGAMES } from '../../shared/minigames/index.js';
import { runMs } from '../../shared/minigames/microwave.js';
import { PRANK_CONTENT } from '../../shared/minigames/prank.js';
import * as Sandbox from '../dev/Sandbox.js'; // SANDBOX

const LOBBY_GRACE_MS = 10_000;
const POST_MEETING_FREEZE_MS = 1500;

/** Whiteboard ink from a client: tidy numbers, at most a few thousand points. */
function cleanInk(ink) {
  let budget = 2500;
  return inkToStrokes(ink).map((s) => {
    const out = [];
    for (const [x, y] of s) {
      if (budget-- <= 0) break;
      out.push(Math.round(Math.max(0, Math.min(160, x)) * 2) / 2, Math.round(Math.max(0, Math.min(100, y)) * 2) / 2);
    }
    return out;
  }).filter((s) => s.length);
}

// Strip control characters and angle brackets, collapse whitespace.
function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export class Game {
  constructor({ code, send, broadcast, sandbox = false }) {
    this.code = code;
    this.sandbox = !!sandbox; // test room (server/dev/Sandbox.js); always false without it
    this.send = send;
    this.broadcast = broadcast;

    this.office = buildOfficeMap();
    this.lobby = buildOfficeMap(LOBBY_ROOM);
    this.tasks = new TaskSystem(this.office);
    this.roles = new RoleSystem(this.office);
    this.meetings = new MeetingSystem();

    this.players = new Map();   // id -> Player (insertion order = join order)
    this.phase = PHASE.LOBBY;
    this.hostId = null;
    this.settings = { ...DEFAULT_SETTINGS }; // edited in the lobby
    this.match = null;                       // frozen copy of settings for the current match
    this.chat = [];                          // public chat
    this.teamChat = [];                      // slackers' group chat
    this.crewChat = [];                      // water cooler: everyone, during the day
    this.day = null;                         // workday clock, see dayClock()
    this.evidence = new Map();               // objectId -> { kind, objectId, at, until, data }
    this.announcements = [];                 // { at, event } evidence news, sent after a delay
    this.whiteboard = null;                  // { drawing } the last productive drawing, if any
    this.board = null;                       // { ink, drawing } what's on the whiteboard now
    this.liveBoard = null;                   // { playerId, ink } someone drawing right now
    this.dayNumber = 0;                      // 1..match.days
    this.chaosToday = 0;                     // chaos % from today's shenanigans
    this.microwaves = new Map();             // id -> { state: 'running'|'done', ownerId, endsAt, fish, food }
    this.spiked = new Set();                 // water coolers with laxatives in the tank (secret)
    this.pranked = new Map();                // deskId -> { victimId, content, by }  (IT finds these at 5 PM)
    this.breaks = [];                        // break windows for this match (shared/breaks.js)
    this.breakId = null;                     // the break happening right now, if any
    this.freezeUntil = 0;
    this.meetingAvailableAt = 0;
    this.result = null;
    this.roomDirty = false;
    this.now = 0;                            // last time we were told about
  }

  /** The map players are currently walking around. */
  get map() {
    return this.phase === PHASE.LOBBY ? this.lobby : this.office;
  }

  /** Settings in force right now: lobby draft, or the frozen match copy. */
  get rules() {
    return this.match ?? this.settings;
  }

  // ===========================================================================
  // Joining, leaving, reconnecting
  // ===========================================================================

  /** Returns { player, resumed } or { error: { code, message } }. */
  join(rawName, token, now) {
    this.now = now;
    if (typeof token === 'string' && token) {
      const existing = [...this.players.values()].find((p) => p.token === token);
      if (existing) {
        existing.connected = true;
        existing.disconnectedAt = 0;
        existing.selfDirty = true;
        this.roomDirty = true;
        return { player: existing, resumed: true };
      }
    }

    // (Test rooms allow joining mid-game; `sandbox` is always false without server/dev/.)
    if (this.phase !== PHASE.LOBBY && !this.sandbox) return { error: { code: 'in_progress', message: 'That game has already started.' } };
    if (this.players.size >= MAX_PLAYERS) return { error: { code: 'full', message: `Room is full (${MAX_PLAYERS} players).` } };

    let name = cleanText(rawName, NAME_MAX) || `Worker ${this.players.size + 1}`;
    const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${cleanText(rawName, NAME_MAX - 3) || 'Worker'} ${n}`;

    const usedColors = new Set([...this.players.values()].map((p) => p.colorId));
    const colorId = COLORS.findIndex((_, i) => !usedColors.has(i));

    const player = new Player({ id: randomId(6), token: randomId(16), name, colorId });
    this.placeInLobby(player);
    this.players.set(player.id, player);
    if (!this.hostId) this.hostId = player.id;
    if (this.sandbox && this.phase !== PHASE.LOBBY) Sandbox.seatNewcomer(this, player, now); // SANDBOX
    this.roomDirty = true;
    return { player, resumed: false };
  }

  /** Put a player on the free-est spawn point in the waiting room. */
  placeInLobby(player) {
    const others = [...this.players.values()].filter((o) => o !== player);
    let best = this.lobby.spawnPoints[0];
    let bestGap = -1;
    for (const s of this.lobby.spawnPoints) {
      const gap = Math.min(Infinity, ...others.map((o) => Math.hypot(o.x - s.x, o.y - s.y)));
      if (gap > bestGap) { best = s; bestGap = gap; }
    }
    player.x = best.x;
    player.y = best.y;
    player.input = { dx: 0, dy: 0 };
  }

  onDisconnect(playerId, now) {
    const p = this.players.get(playerId);
    if (!p) return;
    p.connected = false;
    p.disconnectedAt = now;
    p.input = { dx: 0, dy: 0 };
    this.tasks.cancel(p);
    this.roomDirty = true;
  }

  /** Called when a disconnected player's grace period runs out. */
  expire(p, now) {
    if (this.phase === PHASE.LOBBY || this.phase === PHASE.ENDED) {
      this.players.delete(p.id);
    } else {
      p.token = null; // can no longer resume
      if (p.isActive) {
        p.status = STATUS.LEFT;
        this.meetings.removeVoter(p.id);
        this.broadcast(S2C.EVENT, { kind: 'left', playerId: p.id, name: p.name });
      }
    }
    if (this.hostId === p.id) this.migrateHost();
    this.roomDirty = true;
    this.checkWin(now);
  }

  migrateHost() {
    const next = [...this.players.values()].find((p) => p.connected && p.token);
    this.hostId = next ? next.id : null;
  }

  isEmpty() {
    return ![...this.players.values()].some((p) => p.connected && !p.dummy);
  }

  /** Everything a (re)connecting client needs to render the current moment. */
  sendFullState(p, now) {
    this.now = now;
    this.send(p.id, S2C.ROOM, this.roomState());
    this.send(p.id, S2C.CHAT, { channel: 'all', backlog: this.chat });
    if (this.phase !== PHASE.LOBBY) {
      if (p.isSlacker) this.send(p.id, S2C.CHAT, { channel: 'team', backlog: this.teamChat });
      this.send(p.id, S2C.CHAT, { channel: 'crew', backlog: this.crewChat });
    }
    if (this.phase !== PHASE.LOBBY) this.send(p.id, S2C.SELF, this.selfState(p, now));
    this.send(p.id, S2C.SNAPSHOT, this.snapshotFor(p, this.positions()));
    if (this.meetings.active) this.send(p.id, S2C.MEETING, this.meetings.serialize(now));
    if (this.phase !== PHASE.LOBBY) this.send(p.id, S2C.BOARD, { final: this.board });
    if (this.phase === PHASE.ENDED && this.result) this.send(p.id, S2C.GAME_OVER, this.result);
  }

  // ===========================================================================
  // Lobby
  // ===========================================================================

  handleReady(p, ready) {
    if (this.phase !== PHASE.LOBBY) return;
    p.ready = !!ready;
    this.roomDirty = true;
  }

  handleSettings(p, patch) {
    if (this.phase !== PHASE.LOBBY) return;
    if (p.id !== this.hostId) return this.toast(p, 'Only the host can change the settings.');
    this.settings = sanitizeSettings(patch, this.settings);
    this.roomDirty = true;
  }

  handleStart(p, now) {
    this.now = now;
    if (this.phase !== PHASE.LOBBY) return;
    if (p.id !== this.hostId) return this.toast(p, 'Only the host can start the game.');

    // Drop anyone who is mid-reconnect in the lobby; they can rejoin next round.
    for (const other of [...this.players.values()]) if (!other.connected) this.players.delete(other.id);

    const everyone = [...this.players.values()];
    const minPlayers = this.sandbox ? 1 : MIN_PLAYERS; // test rooms can start solo
    if (everyone.length < minPlayers) return this.toast(p, `Need at least ${minPlayers} players.`);
    const notReady = this.sandbox ? [] : everyone.filter((o) => o.id !== this.hostId && !o.ready);
    if (notReady.length) return this.toast(p, `Waiting on: ${notReady.map((o) => o.name).join(', ')}`);

    this.match = { ...this.settings };
    this.phase = PHASE.PLAYING;
    this.whiteboard = null;
    this.board = null;
    this.result = null;
    this.chat = [];
    this.teamChat = [];
    this.crewChat = [];

    for (const player of everyone) player.resetForMatch();
    this.roles.assign(everyone, this.match);
    if (this.sandbox) Sandbox.applyPreferredRoles(this); // SANDBOX: chosen roles
    this.dayNumber = 0;
    this.beginDay(now, START_FREEZE_MS);

    this.broadcast(S2C.GAME_START, { freezeMs: START_FREEZE_MS });
    this.broadcast(S2C.CHAT, { channel: 'all', backlog: [] });
    this.broadcastRoom();
    for (const player of everyone) this.sendSelf(player, now);
    this.sendSnapshots();
  }

  handleReturnToLobby(p) {
    if (this.phase !== PHASE.ENDED) return;
    if (p.id !== this.hostId) return this.toast(p, 'Only the host can reset the room.');
    this.resetToLobby();
  }

  resetToLobby() {
    for (const other of [...this.players.values()]) {
      if (other.dummy) { other.resetForMatch(); continue; } // SANDBOX: test dummies stay
      if (!other.connected || !other.token) { this.players.delete(other.id); continue; }
      other.resetForMatch();
      other.ready = false;
    }
    if (!this.players.has(this.hostId)) this.migrateHost();
    this.phase = PHASE.LOBBY;
    this.match = null;
    this.day = null;
    this.evidence = new Map();
    this.announcements = [];
    this.whiteboard = null;
    this.board = null;
    this.liveBoard = null;
    this.result = null;
    this.chat = [];
    this.teamChat = [];
    this.crewChat = [];
    for (const other of this.players.values()) { other.x = -999; other.y = -999; }
    for (const other of this.players.values()) this.placeInLobby(other);
    this.broadcastRoom();
    this.broadcast(S2C.CHAT, { channel: 'all', backlog: [] });
    this.sendSnapshots();
  }

  // ===========================================================================
  // Days
  // ===========================================================================

  /**
   * Start the next workday: a fresh clock and fresh tasks, messes cleaned up
   * overnight, sick people back, everyone at their desk.
   */
  beginDay(now, freezeMs) {
    this.dayNumber++;
    this.freezeUntil = now + freezeMs;
    this.day = {
      startAt: this.freezeUntil,
      lengthMs: this.match.workdayMinutes * 60_000,
      sections: this.match.tasks,
      pausedTotal: 0,
      pausedAt: null,
    };
    this.breaks = breakWindows(this.match.breaks, this.day.lengthMs);
    this.breakId = null;
    this.meetingAvailableAt = this.freezeUntil + MEETING_COOLDOWN_MS;
    this.evidence = new Map();
    this.announcements = [];
    this.liveBoard = null;
    this.chaosToday = 0;
    this.microwaves = new Map();
    this.spiked = new Set();
    this.pranked = new Map();
    for (const p of this.players.values()) {
      if (p.status === STATUS.SICK) p.status = STATUS.ACTIVE;   // feeling better
      this.tasks.reset(p);
      if (p.isActive && !p.isSlacker) this.tasks.issueNext(p); // first task of the day
      p.shenaniganReadyAt = this.freezeUntil;
      p.prankedToday = false;
      p.emergencyCallsLeft = EMERGENCY_CALLS_PER_PLAYER;
      p.input = { dx: 0, dy: 0 };
      const seat = this.roles.seatOf(p);
      if (seat) { p.x = seat.x; p.y = seat.y; }
      p.selfDirty = true;
    }
    this.roomDirty = true;
  }

  /** 5 PM: the end-of-day report (a meeting of its own). */
  startEndOfDay(now) {
    this.now = now;
    this.phase = PHASE.MEETING;
    this.chat = [];
    this.pauseDay(now);
    this.liveBoard = null;
    for (const p of this.players.values()) this.tasks.cancel(p);

    const meters = this.meters();
    const messes = [...this.evidence.values()].filter((e) => e.kind !== 'screen').length;
    const chaos = Math.min(100, this.chaosToday + messes * CHAOS.PER_MESS_LEFT);
    const productivity = Math.round(meters.productivity * 100);
    const score = Math.max(0, productivity - Math.round(chaos));

    // IT sweeps the computers: anything on a screen gets its owner fired.
    const itFired = [];
    for (const { victimId, content } of this.pranked.values()) {
      const v = this.players.get(victimId);
      if (!v || v.status === STATUS.SENT_HOME || v.status === STATUS.LEFT) continue;
      this.sendHome(v);
      itFired.push({ id: v.id, name: v.name, content, role: v.role });
    }

    const active = [...this.players.values()].filter((o) => o.isActive);
    active.forEach((o, i) => {
      o.input = { dx: 0, dy: 0 };
      const seat = this.office.meetingSeats[i % this.office.meetingSeats.length];
      o.x = seat.x;
      o.y = seat.y;
    });
    const report = {
      day: this.dayNumber, days: this.match.days, productivity, chaos: Math.round(chaos),
      messes, score, target: this.match.target, itFired,
    };
    const voteNeeded = score < this.match.target && active.length > 1;
    this.meetings.start({
      kind: 'eod', calledBy: null, now, report, voteNeeded,
      voterIds: active.filter((o) => o.connected && !o.dummy).map((o) => o.id),
    });
    this.broadcast(S2C.EVENT, { kind: 'end_of_day', day: this.dayNumber });
    this.broadcast(S2C.CHAT, { channel: 'all', backlog: [] });
    this.broadcastRoom();
    this.sendSnapshots();
    this.broadcast(S2C.MEETING, this.meetings.serialize(now));
  }

  // ===========================================================================
  // The workday clock
  // ===========================================================================

  /** Milliseconds of workday elapsed (negative during the opening freeze). */
  dayClock(now) {
    const d = this.day;
    if (!d) return 0;
    const pausedNow = d.pausedAt != null ? now - d.pausedAt : 0;
    return now - d.startAt - d.pausedTotal - pausedNow;
  }

  sectionMs() {
    return this.day.lengthMs / this.day.sections;
  }

  /** How many tasks each player should have been handed by now. */
  tasksDue(now) {
    const elapsed = Math.max(0, this.dayClock(now));
    return Math.min(this.day.sections, Math.floor(elapsed / this.sectionMs()) + 1);
  }

  pauseDay(now) {
    if (this.day && this.day.pausedAt == null) this.day.pausedAt = now;
  }

  resumeDay(now) {
    if (this.day && this.day.pausedAt != null) {
      // Time spent in the opening freeze isn't "paused" time; only count real day time.
      this.day.pausedTotal += now - Math.max(this.day.pausedAt, Math.min(now, this.day.startAt));
      this.day.pausedAt = null;
    }
  }

  /** The break happening right now, or null. */
  currentBreak(now) {
    return this.day ? breakAt(this.breaks, Math.max(0, this.dayClock(now))) : null;
  }

  /** Why a break-only task can't be done right now, or null if it can. */
  breakTaskBlocker(now) {
    if (this.currentBreak(now)) return null;
    const next = nextBreak(this.breaks, this.dayClock(now));
    return next ? `Save that for a break. ${next.label} is next.` : null; // no breaks left: do it any time
  }

  /** Announce breaks starting and ending. */
  updateBreak(now) {
    const b = this.currentBreak(now);
    const id = b?.id ?? null;
    if (id === this.breakId) return;
    const ended = this.breaks.find((w) => w.id === this.breakId);
    this.breakId = id;
    if (b) this.broadcast(S2C.EVENT, { kind: 'break_start', breakId: b.id, label: b.label });
    else if (ended) this.broadcast(S2C.EVENT, { kind: 'break_end', breakId: ended.id, label: ended.label });
    this.roomDirty = true;
  }

  /** Hand out any tasks that became due. */
  issueDueTasks(now) {
    const due = this.tasksDue(now);
    for (const p of this.players.values()) {
      if (!p.isActive || p.isSlacker) continue;   // slackers don't get a list
      while (p.tasks.length < due) {
        const def = this.tasks.issueNext(p);
        if (!def) break;
        const last = p.tasks.length === this.match.tasks;
        this.send(p.id, S2C.EVENT, { kind: 'new_task', taskId: def.id, last, private: true });
      }
    }
  }

  // ===========================================================================
  // Playing
  // ===========================================================================

  canAct(p, now) {
    return this.phase === PHASE.PLAYING && p.isActive && now >= this.freezeUntil;
  }

  handleInput(p, dx, dy) {
    if ((this.phase !== PHASE.PLAYING && this.phase !== PHASE.LOBBY) || !p.isActive) return;
    // Only the direction is accepted; speed is decided by the server.
    p.input = { dx: Math.sign(Number(dx)) || 0, dy: Math.sign(Number(dy)) || 0 };
  }

  handleInteract(p, objectId, now) {
    this.now = now;
    if (!this.canAct(p, now)) return;
    const object = typeof objectId === 'string' ? this.office.getInteractable(objectId) : null;
    if (!object) return;
    if (!canReach(this.office, p.x, p.y, object, INTERACT_RANGE)) return this.toast(p, 'You can\u2019t reach that from here.');
    if (p.activeTask?.objectId === object.id) return; // already working here

    switch (object.type) {
      case 'meeting_bell': return this.callMeeting(p, now);
      case 'hr_box':       return this.handleInteractHrBox(p);
      case 'microwave':    return this.useMicrowave(p, object, now);
      default: {
        if (p.isSlacker) return this.startShenanigan(p, object, now);
        this.tasks.cancel(p);
        const res = this.tasks.start(p, object, now, () => this.breakTaskBlocker(now));
        if (!res.ok) this.toast(p, res.reason);
      }
    }
  }

  handleCancel(p) {
    this.tasks.cancel(p);
  }

  /** The player solved (or tried to solve) their task window. */
  handleMinigame(p, answer, now) {
    if (!this.canAct(p, now) || !p.activeTask?.minigame) return;
    const a = p.activeTask;
    const objectId = a.objectId;
    const check = this.tasks.checkMinigame(p, answer, now);
    if (!check.ok) return check.reason && this.toast(p, check.reason);

    if (a.shenanigan) return this.finishShenanigan(p, a, answer, now);

    // Microwave: starting it isn't the end. Wait for the ding, then open it.
    if (a.minigame === 'microwave') {
      const m = this.office.getInteractable(objectId);
      this.microwaves.set(objectId, { state: 'running', ownerId: p.id, endsAt: now + runMs(a.puzzle), fish: false, food: a.puzzle.food });
      const entry = p.tasks.find((t) => t.id === a.taskId && !t.done);
      if (entry) entry.heating = objectId;
      p.activeTask = null;
      p.selfDirty = true;
      this.roomDirty = true;
      return this.toast(p, `Heating. Come back to the ${m?.label?.toLowerCase() ?? 'microwave'} when it dings.`);
    }

    const drawing = a.minigame === 'whiteboard' ? a.puzzle.drawing : null;
    const done = this.tasks.completeActive(p);
    if (drawing) {
      p.lastDrawing = drawing;
      // A productive drawing replaces whatever was up there.
      this.whiteboard = { drawing };
      // Whatever they actually drew stays on the board, for everyone to see.
      this.board = { ink: cleanInk(answer?.ink), drawing };
      this.liveBoard = null;
      this.broadcast(S2C.BOARD, { final: this.board, live: null });
    }
    this.onTaskFinished(p, done, objectId, now);
    // A drink from a spiked cooler: you won't make it to 5 PM.
    if (a.minigame === 'cooler' && this.spiked.has(objectId)) {
      this.spiked.delete(objectId);
      this.makeSick(p);
    }
  }

  makeSick(p) {
    this.tasks.cancel(p);
    p.status = STATUS.SICK;
    p.input = { dx: 0, dy: 0 };
    p.selfDirty = true;
    this.roomDirty = true;
    this.broadcast(S2C.EVENT, { kind: 'sick', playerId: p.id, name: p.name });
    this.checkWin(this.now);
  }

  // ===========================================================================
  // Microwaves. They really run; everyone sees the timer.
  // ===========================================================================

  useMicrowave(p, object, now) {
    const m = this.microwaves.get(object.id);
    if (m?.state === 'running') {
      if (m.ownerId === p.id && !m.fish) return this.toast(p, `Still heating: ${Math.ceil((m.endsAt - now) / 1000)}s to go.`);
      return this.toast(p, m.fish ? 'Something fishy is in there. Running.' : 'Someone\u2019s using this one. Try the other microwave.');
    }
    if (m?.state === 'done') {
      if (m.fish) {
        if (p.isSlacker) return this.toast(p, 'Leave it. Let it stink.');
        // Productive: get the fish out. Fumes gone.
        this.microwaves.delete(object.id);
        this.evidence.delete(object.id);
        this.roomDirty = true;
        this.broadcast(S2C.EVENT, { kind: 'cleaned', where: this.office.roomName(object.x, object.y), objectId: object.id });
        return this.toast(p, 'You took the fish out. The whole floor thanks you.');
      }
      if (m.ownerId !== p.id) return this.toast(p, 'Someone else\u2019s lunch is in there.');
      // Your lunch: open it to finish the task.
      this.microwaves.delete(object.id);
      this.roomDirty = true;
      const entry = p.tasks.find((t) => t.heating === object.id && !t.done);
      if (!entry) return this.toast(p, 'Lunch is served.');
      entry.done = true;
      p.selfDirty = true;
      return this.onTaskFinished(p, taskVersion(TASKS_BY_ID.get(entry.id), p.role), object.id, now);
    }
    // Free microwave.
    if (p.isSlacker) return this.startShenanigan(p, object, now);
    const waiting = p.tasks.find((t) => t.heating && !t.done);
    if (waiting) return this.toast(p, 'Your lunch is already in the other microwave.');
    this.tasks.cancel(p);
    const res = this.tasks.start(p, object, now, () => this.breakTaskBlocker(now));
    if (!res.ok) this.toast(p, res.reason);
  }

  updateMicrowaves(now) {
    for (const [id, m] of this.microwaves) {
      if (m.state !== 'running' || now < m.endsAt) continue;
      m.state = 'done';
      this.roomDirty = true;
      const object = this.office.getInteractable(id);
      if (m.fish) {
        const slacker = this.players.get(m.ownerId);
        if (slacker && object) this.leaveEvidence('fish', slacker, object, now);
      } else {
        this.send(m.ownerId, S2C.TOAST, { text: 'Ding! Your lunch is ready. Go open the microwave.' });
      }
    }
  }

  // ===========================================================================
  // Shenanigans: slackers don't get tasks; they cause chaos whenever they like.
  // ===========================================================================

  /** Which shenanigan this object offers this player, or null. */
  shenaniganFor(p, object) {
    if (object.type === 'desk') {
      if (object.id === p.deskId) return SHENANIGAN_BY_TARGET.get('own_desk') ?? null;
      const owner = [...this.players.values()].find((o) => o.deskId === object.id && o.status !== STATUS.SENT_HOME && o.status !== STATUS.LEFT);
      return owner ? SHENANIGAN_BY_TARGET.get('other_desk') ?? null : null;
    }
    return SHENANIGAN_BY_TARGET.get(object.type) ?? null;
  }

  startShenanigan(p, object, now) {
    const s = this.shenaniganFor(p, object);
    if (!s) return this.toast(p, 'Nothing fun to do here.');
    if (now < (p.shenaniganReadyAt ?? 0)) {
      return this.toast(p, `Lie low for ${Math.ceil((p.shenaniganReadyAt - now) / 1000)}s before the next one.`);
    }
    if (s.oncePerDay && p.prankedToday) return this.toast(p, 'One computer per day. Don\u2019t push your luck.');
    if (s.effect === 'sick' && this.spiked.has(object.id)) return this.toast(p, 'This one\u2019s already been taken care of.');
    if (s.effect === 'prank' && this.pranked.has(object.id)) return this.toast(p, 'Someone already got to this computer.');
    if (this.evidence.has(object.id) && s.evidence !== 'chain_email') return this.toast(p, 'There\u2019s already a mess here.');
    this.tasks.cancel(p);
    p.activeTask = { taskId: s.id, objectId: object.id, startedAt: now, duration: s.duration, shenanigan: true };
    if (s.minigame) {
      p.activeTask.minigame = s.minigame;
      p.activeTask.puzzle = MINIGAMES[s.minigame].generate(rand, 'slacker');
      if (s.effect === 'prank') {
        const owner = [...this.players.values()].find((o) => o.deskId === object.id);
        p.activeTask.puzzle.owner = owner?.name ?? 'Someone';
      }
    }
    p.selfDirty = true;
  }

  /** A shenanigan is done: chaos, a mess, maybe worse. */
  finishShenanigan(p, a, answer, now) {
    const s = taskVersion(TASKS_BY_ID.get(a.taskId), 'slacker');
    const object = this.office.getInteractable(a.objectId);
    p.activeTask = null;
    p.selfDirty = true;
    p.shenaniganReadyAt = now + this.match.shenaniganCooldown * 1000;
    this.chaosToday = Math.min(100, this.chaosToday + CHAOS.PER_SHENANIGAN);
    this.roomDirty = true;

    if (a.minigame === 'microwave') {
      // The fish runs a while; the stink starts when it dings (updateMicrowaves).
      this.microwaves.set(a.objectId, { state: 'running', ownerId: p.id, endsAt: now + runMs(a.puzzle), fish: true, food: 'fish' });
      return this.toast(p, 'Fish is in. Walk away. Casually.');
    }
    if (s.effect === 'sick') {
      this.spiked.add(a.objectId);
      return this.toast(p, 'Done. The next person to drink from this cooler is going home early.');
    }
    if (s.effect === 'prank') {
      const owner = [...this.players.values()].find((o) => o.deskId === a.objectId);
      const content = PRANK_CONTENT.find((c) => c.id === answer?.content)?.id ?? 'memes';
      if (owner) this.pranked.set(a.objectId, { victimId: owner.id, content, by: p.id });
      p.prankedToday = true;
      this.evidence.set(a.objectId, { kind: 'screen', objectId: a.objectId, at: now, until: null, data: { content } });
      return this.toast(p, `IT is going to have questions for ${owner?.name ?? 'them'} at 5 PM.`);
    }
    if (a.minigame === 'whiteboard') {
      p.lastDrawing = a.puzzle.drawing;
      this.board = { ink: cleanInk(answer?.ink), drawing: a.puzzle.drawing };
      this.liveBoard = null;
      this.broadcast(S2C.BOARD, { final: this.board, live: null });
    }
    if (s.evidence) this.leaveEvidence(s.evidence, p, object, now);
    this.toast(p, `Done: ${s.label}.`);
  }

  /**
   * A task got done. Productive versions clean up any mess at that object;
   * slacker versions may leave evidence there.
   */
  onTaskFinished(p, finished, objectId, now = this.now) {
    const object = objectId ? this.office.getInteractable(objectId) : null;
    if (!p.isSlacker && object && this.evidence.has(object.id) && this.evidence.get(object.id).kind !== 'screen') {
      this.evidence.delete(object.id);
      this.broadcast(S2C.EVENT, { kind: 'cleaned', where: this.office.roomName(object.x, object.y), objectId: object.id });
    }
    this.roomDirty = true;

    const left = p.tasks.filter((t) => !t.done).length;
    let msg = `Done: ${finished.label}.`;
    if (p.tasks.length >= this.match.tasks && !left) {
      msg = 'All your work for today is done. Keep an eye out for slackers.';
    } else if (!left) {
      msg += ' Next task arrives soon.';
    }
    this.toast(p, msg);
    this.checkWin(now);
  }

  /** A slacker made a mess: mark it now, tell the office about it in a few seconds. */
  leaveEvidence(kind, p, object, now) {
    const def = EVIDENCE[kind];
    if (!def) return;
    // Desk tasks (chain emails) happen at your own desk.
    const desk = this.office.desksById.get(p.deskId);
    const at = object ?? desk ?? null;
    const where = at ? this.office.roomName(at.x + at.w / 2, at.y + at.h / 2) : 'office';
    if (object && kind !== 'chain_email') {
      this.evidence.set(object.id, {
        kind, objectId: object.id, at: now, until: def.ttl ? now + def.ttl : null,
        data: kind === 'doodle' ? { drawing: p.lastDrawing ?? null } : null,
      });
    }
    if (def.announce) this.announcements.push({ at: now + def.delay, event: { kind: 'evidence', evidence: kind, text: def.announce.replace('{room}', where) } });
    this.announcements.sort((x, y) => x.at - y.at);
  }

  sendHome(target) {
    this.tasks.cancel(target);
    target.status = STATUS.SENT_HOME;
    target.input = { dx: 0, dy: 0 };
    target.selfDirty = true;
    this.roomDirty = true;
  }

  // ===========================================================================
  // The whiteboard, live: while someone does the whiteboard task, everyone who
  // can see the board watches it being drawn.
  // ===========================================================================

  handleWhiteboardInk(p, ink, now) {
    if (!this.canAct(p, now) || p.activeTask?.minigame !== 'whiteboard') return;
    this.liveBoard = { playerId: p.id, ink: cleanInk(ink) };
    this.sendLiveBoard();
  }

  /** Can this player see the whiteboard right now (in range, in front of it, nothing in the way)? */
  canSeeBoard(viewer) {
    if (!viewer.isActive || this.phase !== PHASE.PLAYING) return true; // fired players watch everything
    const b = this.office.getInteractable('whiteboard');
    if (!b) return false;
    const x = Math.max(b.x, Math.min(b.x + b.w, viewer.x));
    const y = b.y + b.h;
    if (viewer.y < b.y) return false;                                    // behind it
    if (Math.hypot(viewer.x - x, viewer.y - y) > this.rules.sightRange) return false;
    return lineOfSight(this.office, viewer.x, viewer.y, x, y);
  }

  sendLiveBoard() {
    for (const v of this.players.values()) {
      if (v.connected && this.canSeeBoard(v)) this.send(v.id, S2C.BOARD, { live: this.liveBoard });
    }
  }

  // ===========================================================================
  // HR complaints: at the HR box in the Lobby, anyone can report someone they
  // think is a slacker. Once per game. If they're right, the slacker is fired.
  // If they're wrong, HR fires the person who complained.
  // ===========================================================================

  handleHrReport(p, targetId, now) {
    this.now = now;
    if (!this.canAct(p, now)) return;
    if (p.hrReportUsed) return this.toast(p, "You've already filed your one HR complaint.");
    const box = this.office.interactables.find((o) => o.type === 'hr_box');
    if (!box || !canReach(this.office, p.x, p.y, box, INTERACT_RANGE)) return this.toast(p, 'Complaints go in the HR box in the Lobby.');
    const target = typeof targetId === 'string' ? this.players.get(targetId) : null;
    if (!target || target === p || !target.isActive) return this.toast(p, 'Pick someone who is still in the office.');

    p.hrReportUsed = true;
    p.selfDirty = true;
    this.tasks.cancel(p);
    if (target.isSlacker) {
      this.sendHome(target);
      this.broadcast(S2C.EVENT, { kind: 'hr', outcome: 'slacker', playerId: target.id, name: target.name });
    } else {
      this.sendHome(p);
      this.broadcast(S2C.EVENT, { kind: 'hr', outcome: 'false', playerId: p.id, name: p.name, accusedId: target.id, accused: target.name });
    }
    this.checkWin(now);
  }

  handleInteractHrBox(p) {
    if (p.hrReportUsed) return this.toast(p, "You've already filed your one HR complaint.");
    this.toast(p, 'Pick who to report in the complaint form.');
  }

  // ===========================================================================
  // Emotes: shown to everyone who can currently see you.
  // ===========================================================================

  handleEmote(p, emoteId) {
    if (!EMOTES_BY_ID.has(emoteId)) return;
    const inRoom = this.phase === PHASE.LOBBY || (this.phase === PHASE.PLAYING && p.isActive);
    if (!inRoom) return;
    const positions = this.positions();
    for (const viewer of this.players.values()) {
      if (!viewer.connected) continue;
      const sees = this.snapshotFor(viewer, positions).p.some((e) => e[0] === p.id);
      if (sees) this.send(viewer.id, S2C.EMOTE, { playerId: p.id, emote: emoteId });
    }
  }

  // ===========================================================================
  // Meetings
  // ===========================================================================

  callMeeting(p, now) {
    if (p.emergencyCallsLeft <= 0) return this.toast(p, "You've used your all-hands call.");
    if (now < this.meetingAvailableAt) {
      return this.toast(p, `The bell is on cooldown (${Math.ceil((this.meetingAvailableAt - now) / 1000)}s).`);
    }
    p.emergencyCallsLeft--;
    p.selfDirty = true;
    this.startMeeting(p, now);
  }

  startMeeting(caller, now) {
    this.now = now;
    this.phase = PHASE.MEETING;
    this.chat = [];
    this.pauseDay(now);

    const active = [...this.players.values()].filter((o) => o.isActive);
    active.forEach((o, i) => {
      this.tasks.cancel(o);
      o.input = { dx: 0, dy: 0 };
      const seat = this.office.meetingSeats[i % this.office.meetingSeats.length];
      o.x = seat.x;
      o.y = seat.y;
    });

    this.meetings.start({ calledBy: caller.id, voterIds: active.filter((o) => o.connected && !o.dummy).map((o) => o.id), now });
    this.broadcast(S2C.EVENT, { kind: 'meeting', playerId: caller.id, name: caller.name });
    this.broadcast(S2C.CHAT, { channel: 'all', backlog: [] });
    this.broadcastRoom();
    this.sendSnapshots();
    this.broadcast(S2C.MEETING, this.meetings.serialize(now));
  }

  handleVote(p, targetId, now) {
    if (this.phase !== PHASE.MEETING) return;
    const target = targetId === SKIP ? SKIP : (typeof targetId === 'string' ? targetId : null);
    if (!target) return;
    const res = this.meetings.vote(p.id, target, (id) => !!this.players.get(id)?.isActive);
    if (!res.ok) return this.toast(p, res.reason);
    this.broadcast(S2C.MEETING, this.meetings.serialize(now));
  }

  resolveVote(now) {
    const candidates = [...this.players.values()].filter((o) => o.isActive).map((o) => o.id);
    const result = this.meetings.close(now, candidates);
    if (result.ejectedId) {
      const ejected = this.players.get(result.ejectedId);
      ejected.status = STATUS.SENT_HOME;
      ejected.selfDirty = true;
      result.ejectedRole = ejected.role; // revealed to everyone
      this.broadcast(S2C.EVENT, { kind: 'ejected', playerId: ejected.id, name: ejected.name, role: ejected.role });
      this.roomDirty = true;
    }
    this.broadcast(S2C.MEETING, this.meetings.serialize(now));
  }

  endMeeting(now) {
    this.now = now;
    const wasEod = this.meetings.current?.kind === 'eod';
    this.meetings.end();
    this.phase = PHASE.PLAYING;
    this.resumeDay(now);
    if (this.checkWin(now)) return;
    if (wasEod) {
      // That was the last day: the slackers made it through the week.
      if (this.dayNumber >= this.match.days) {
        return this.endGame('slackers', `The week is over and the slackers are still on the payroll.`, now);
      }
      this.beginDay(now, START_FREEZE_MS);
      this.broadcast(S2C.EVENT, { kind: 'new_day', day: this.dayNumber, days: this.match.days });
      this.broadcast(S2C.MEETING, { stage: 'closed' });
      this.broadcastRoom();
      for (const p of this.players.values()) this.sendSelf(p, now);
      this.sendSnapshots();
      return;
    }

    // Everyone goes back to their desk, then a short freeze.
    for (const o of this.players.values()) {
      if (!o.isActive) continue;
      const seat = this.roles.seatOf(o);
      o.x = seat.x;
      o.y = seat.y;
      o.selfDirty = true;
    }
    this.freezeUntil = now + POST_MEETING_FREEZE_MS;
    this.meetingAvailableAt = now + MEETING_COOLDOWN_MS;
    this.broadcast(S2C.MEETING, { stage: 'closed' });
    this.broadcastRoom();
    this.sendSnapshots();
  }

  // ===========================================================================
  // Chat channels
  //   all  : everyone. Lobby, all-hands meetings, and after the game.
  //   crew : the water cooler. Everyone, any time during the day.
  //   team : the slackers' group chat. Slackers only, any time during the day.
  // During the match only people still in the office can post; anyone who's
  // been fired can keep reading.
  // ===========================================================================

  /** Who may read a private channel. */
  canRead(p, channel) {
    if (channel === 'team') return p.isSlacker; // slackers' group chat
    return true;                                // crew = water cooler, all = everyone
  }

  handleChat(p, rawText, channel, now) {
    const text = cleanText(rawText, CHAT_MAX);
    if (!text) return;

    if (channel === 'team' || channel === 'crew') {
      const inMatch = this.phase === PHASE.PLAYING || this.phase === PHASE.MEETING;
      if (!inMatch || !this.canRead(p, channel)) return;
      if (!p.isActive) return this.toast(p, "You're out of the office. You can read along, but not post.");
      const log = channel === 'team' ? this.teamChat : this.crewChat;
      const line = { from: p.id, text, at: now, channel };
      log.push(line);
      if (log.length > CHAT_HISTORY) log.shift();
      for (const o of this.players.values()) if (this.canRead(o, channel)) this.send(o.id, S2C.CHAT, { channel, line });
      return;
    }

    const inMeeting = this.phase === PHASE.MEETING && this.meetings.current?.stage === 'discussing';
    const open = this.phase === PHASE.LOBBY || this.phase === PHASE.ENDED || inMeeting;
    if (!open) return this.toast(p, 'Everyone chat opens during meetings.');
    if (inMeeting && !p.isActive) return this.toast(p, "You're home. Only people in the office can talk.");

    const line = { from: p.id, text, at: now, channel: 'all' };
    this.chat.push(line);
    if (this.chat.length > CHAT_HISTORY) this.chat.shift();
    this.broadcast(S2C.CHAT, { channel: 'all', line });
  }

  // ===========================================================================
  // Win conditions (all evaluated here, never on the client)
  // ===========================================================================

  /**
   * Today's meters. Productivity: productive employees' tasks done today (people
   * fired or sick keep what they did; their unfinished tasks drop out). Chaos:
   * today's shenanigans (messes still around at 5 PM count extra in the report).
   */
  meters() {
    if (!this.match) return { productivity: 0, chaos: 0, target: 0 };
    let done = 0, total = 0;
    for (const p of this.players.values()) {
      if (p.isSlacker) continue;
      const d = p.tasks.filter((x) => x.done).length;
      done += d;
      total += p.isActive ? this.match.tasks : d;
    }
    return { productivity: total ? Math.min(1, done / total) : 0, chaos: Math.min(1, this.chaosToday / 100), target: this.match.target / 100 };
  }

  /** Returns true if the game ended. */
  checkWin(now) {
    if (this.phase !== PHASE.PLAYING && this.phase !== PHASE.MEETING) return false;
    if (this.sandbox && !Sandbox.sandboxWinsEnabled(this)) return false; // SANDBOX: wins on request only

    // Sick people still count: they'll be back tomorrow.
    const employed = [...this.players.values()].filter((p) => p.isActive || p.status === STATUS.SICK);
    const slackers = employed.filter((p) => p.isSlacker).length;
    const productive = employed.length - slackers;
    if (!slackers) return this.endGame('productive', 'Every slacker has been fired. The office is finally productive.', now);
    // During a meeting, let the result screen play out; endMeeting() checks again.
    if (this.phase === PHASE.MEETING) return false;
    if (slackers >= productive) return this.endGame('slackers', 'There are as many slackers as productive employees left. Nothing will ever get done again.', now);
    // 5 PM: the end-of-day report.
    if (this.day && this.dayClock(now) >= this.day.lengthMs) { this.startEndOfDay(now); return false; }
    return false;
  }

  endGame(winner, reason, now) {
    this.meetings.end();
    this.phase = PHASE.ENDED;
    for (const p of this.players.values()) {
      p.input = { dx: 0, dy: 0 };
      this.tasks.cancel(p);
    }
    const slackers = [...this.players.values()].filter((p) => p.isSlacker);
    this.result = {
      winner,          // 'productive' | 'slackers'
      reason,
      slackers: slackers.map((s) => ({ id: s.id, name: s.name })),
      meters: this.meters(),
      day: this.dayNumber,
    };
    this.broadcast(S2C.GAME_OVER, this.result);
    this.broadcastRoom();
    return true;
  }

  // ===========================================================================
  // Tick
  // ===========================================================================

  tick(now) {
    this.now = now;

    // Disconnect grace periods
    for (const p of [...this.players.values()]) {
      if (p.connected || !p.token) continue;
      const grace = this.phase === PHASE.LOBBY ? LOBBY_GRACE_MS : RECONNECT_GRACE_MS;
      if (now - p.disconnectedAt > grace) this.expire(p, now);
    }

    const dt = TICK_MS / 1000;
    const speed = this.rules.playerSpeed;
    if (this.sandbox) Sandbox.sandboxTick(this, now); // SANDBOX: wandering dummies

    if (this.phase === PHASE.LOBBY) {
      for (const p of this.players.values()) {
        if (p.input.dx || p.input.dy) Object.assign(p, stepMovement(this.lobby, p, p.input, dt, undefined, speed));
      }
      this.sendSnapshots();
    }

    if (this.phase === PHASE.PLAYING) {
      const frozen = now < this.freezeUntil;
      for (const p of this.players.values()) {
        if (!p.isActive) continue;
        if (!frozen && (p.input.dx || p.input.dy)) {
          const next = stepMovement(this.office, p, p.input, dt, undefined, speed);
          p.x = next.x;
          p.y = next.y;
        }
        const active = p.activeTask;
        const finished = this.tasks.update(p, now);
        if (finished && active?.shenanigan) this.finishShenanigan(p, active, null, now);
        else if (finished) this.onTaskFinished(p, finished, active?.objectId, now);
      }
      if (!frozen) {
        this.issueDueTasks(now);
        this.updateBreak(now);
      }
      this.updateEvidence(now);
      this.updateMicrowaves(now);
      // The drawer stopped (walked away, closed the window): wipe the live view.
      if (this.liveBoard && this.players.get(this.liveBoard.playerId)?.activeTask?.minigame !== 'whiteboard') {
        this.liveBoard = null;
        this.broadcast(S2C.BOARD, { live: null });
      }
      if (this.phase === PHASE.PLAYING) {
        this.checkWin(now);
        this.sendSnapshots();
      }
    }

    if (this.phase === PHASE.MEETING && this.meetings.current) {
      const m = this.meetings.current;
      if (m.stage === 'report' && now >= m.endsAt) {
        if (m.voteNeeded) { this.meetings.openVoting(now); this.broadcast(S2C.MEETING, this.meetings.serialize(now)); }
        else this.resolveVote(now);
      } else if (m.stage === 'discussing' && (now >= m.endsAt || this.meetings.everyoneVoted())) this.resolveVote(now);
      else if (m.stage === 'results' && now >= m.endsAt) this.endMeeting(now);
    }

    // Private state: send when it changed, or every tick while a task bar is filling.
    if (this.phase !== PHASE.LOBBY) {
      for (const p of this.players.values()) {
        // (Task windows don't change while open, so they're not re-sent every tick.)
        if (p.connected && (p.selfDirty || (p.activeTask && !p.activeTask.minigame))) this.sendSelf(p, now);
      }
    }

    if (this.roomDirty) this.broadcastRoom();
  }

  /** Send evidence news that's due; let marks with a time limit fade. */
  updateEvidence(now) {
    while (this.announcements.length && this.announcements[0].at <= now) {
      this.broadcast(S2C.EVENT, this.announcements.shift().event);
    }
    for (const [id, e] of this.evidence) {
      if (e.until && now >= e.until) { this.evidence.delete(id); this.roomDirty = true; }
    }
  }

  // ===========================================================================
  // Serialisation
  // ===========================================================================

  /** Everyone currently walking around, with public flags. */
  positions() {
    const out = [];
    const inMatch = this.phase !== PHASE.LOBBY;
    for (const pl of this.players.values()) {
      if (!pl.isActive) continue;
      let flags = 0;
      if (pl.activeTask) flags |= PFLAG.BUSY;
      if (inMatch && this.roles.isAtDesk(pl)) flags |= PFLAG.AT_DESK;
      out.push({ pl, entry: [pl.id, Math.round(pl.x * 10) / 10, Math.round(pl.y * 10) / 10, flags] });
    }
    return out;
  }

  /**
   * What one player is allowed to see. While the workday is on, people still in
   * the office only receive players within the sight range AND in line of sight
   * (walls block vision), so a modified client can't reveal anyone in the dark
   * or behind a wall. Lobby, meetings, the end screen and
   * players who are out of the office see everyone.
   */
  snapshotFor(viewer, positions) {
    let limited = this.phase === PHASE.PLAYING && viewer.isActive;
    if (this.sandbox && Sandbox.sandboxSeesAll(this, viewer)) limited = false; // SANDBOX: see-everyone toggle
    const range = this.rules.sightRange;
    const p = [];
    for (const { pl, entry } of positions) {
      if (limited && pl !== viewer && !canSee(this.office, viewer, pl, range)) continue;
      p.push(entry);
    }
    return { p };
  }

  sendSnapshots() {
    const positions = this.positions();
    for (const viewer of this.players.values()) {
      if (viewer.connected) this.send(viewer.id, S2C.SNAPSHOT, this.snapshotFor(viewer, positions));
    }
  }

  dayState() {
    if (!this.day) return null;
    return {
      elapsed: Math.round(this.dayClock(this.now)),
      lengthMs: this.day.lengthMs,
      sections: this.day.sections,
      running: this.day.pausedAt == null && this.phase === PHASE.PLAYING,
    };
  }

  roomState() {
    const progress = this.phase === PHASE.LOBBY ? null : this.meters();
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      players: [...this.players.values()].map((p) => p.publicInfo()),
      minPlayers: this.sandbox ? 1 : MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      sandbox: this.sandbox ? Sandbox.sandboxRoomInfo(this) : null, // SANDBOX
      settings: this.rules,
      progress,
      day: this.dayState(),
      // Messes around the office (public: anyone who walks past can see them).
      evidence: [...this.evidence.values()].map((e) => ({ kind: e.kind, objectId: e.objectId, ageMs: this.now - e.at, data: e.data })),
      dayNumber: this.dayNumber,
      days: this.match?.days ?? this.settings.days,
      // Everyone can see a microwave's timer.
      microwaves: [...this.microwaves].map(([id, m]) => ({ id, state: m.state, msLeft: Math.max(0, m.endsAt - this.now), fish: m.fish, food: m.food, ownerId: m.ownerId })),
      whiteboard: this.whiteboard,
    };
  }

  broadcastRoom() {
    this.roomDirty = false;
    this.broadcast(S2C.ROOM, this.roomState());
  }

  /** Private to one player: their role, desk, tasks and (for the team) teammates. */
  selfState(p, now) {
    // Slackers know who the other slackers are.
    const team = p.isSlacker
      ? [...this.players.values()].filter((o) => o.isSlacker && o !== p).map((o) => ({ id: o.id, role: o.role }))
      : [];
    return {
      role: p.role,
      status: p.status,
      deskId: p.deskId,
      ...this.tasks.serialize(p, now),
      totalTasks: this.match?.tasks ?? 0,
      team,
      emergencyLeft: p.emergencyCallsLeft,
      hrReportUsed: !!p.hrReportUsed,
      // Slackers: when the next shenanigan is allowed, and whether today's prank is used.
      shenaniganReadyIn: p.isSlacker ? Math.max(0, (p.shenaniganReadyAt ?? 0) - now) : null,
      prankedToday: !!p.prankedToday,
      meetingReadyIn: Math.max(0, this.meetingAvailableAt - now),
      freezeMs: Math.max(0, this.freezeUntil - now),
    };
  }

  sendSelf(p, now) {
    p.selfDirty = false;
    this.send(p.id, S2C.SELF, this.selfState(p, now));
  }

  toast(p, text) {
    this.send(p.id, S2C.TOAST, { text });
  }
}
