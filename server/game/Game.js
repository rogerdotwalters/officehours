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
 * The workday: `match.workdayMinutes` long, split into `match.tasks` equal
 * sections. At the start of each section every player still in the office is
 * handed one more task. The clock pauses during all-hands meetings. Workers can
 * clock out once their last task (handed out in the final section) is done.
 */
import {
  PHASE, STATUS, ROLE, MAX_PLAYERS, MIN_PLAYERS, NAME_MAX, CHAT_MAX, CHAT_HISTORY,
  START_FREEZE_MS, MEETING_COOLDOWN_MS, EMERGENCY_CALLS_PER_PLAYER, GO_HOME_RATIO,
  RECONNECT_GRACE_MS, TICK_MS, INTERACT_RANGE, COLORS,
  WIFI_OUTAGE_MS, BREAKER_COOLDOWN_MS, BREAKER_INITIAL_COOLDOWN_MS, SOCIAL_GOAL_PER_WORKER, SOCIAL_GOAL_MIN,
} from '../../shared/constants.js';
import { S2C, PFLAG } from '../../shared/protocol.js';
import { buildOfficeMap, distPointRect } from '../../shared/mapBuilder.js';
import { LOBBY_ROOM } from '../../shared/lobbyMap.js';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../shared/settings.js';
import { breakWindows, breakAt, nextBreak } from '../../shared/breaks.js';
import { stepMovement } from '../../shared/physics.js';
import { canSee } from '../../shared/vision.js';
import { TIMED_BY_ID } from '../../shared/tasks.js';
import { EMOTES_BY_ID, EMOTE_COOLDOWN_MS } from '../../shared/emotes.js';
import { Player } from './Player.js';
import { TaskSystem } from './TaskSystem.js';
import { RoleSystem } from './RoleSystem.js';
import { MeetingSystem, SKIP } from './MeetingSystem.js';
import { randomId } from './random.js';
import * as Sandbox from '../dev/Sandbox.js'; // SANDBOX

const LOBBY_GRACE_MS = 10_000;
const POST_MEETING_FREEZE_MS = 1500;

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
    this.chat = [];                          // public chat: lobby, meetings, after the game
    // Desk terminal channels (the only way to talk during the workday):
    this.generalChat = [];                   // #general: everyone
    this.teamChat = [];                      // back office: Management + snitches
    this.crewChat = [];                      // water cooler: workers + snitches
    this.wifi = { down: false, until: 0, readyAt: 0 };
    this.social = 0;                         // worker tasks finished during wifi outages
    this.day = null;                         // workday clock, see dayClock()
    this.deskCheck = null;                   // { endsAt } while a desk check counts down
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
    // A (re)connecting client starts with its desk terminal closed.
    p.terminalOpen = false;
    this.send(p.id, S2C.TERMINAL, { open: false });
    if (this.phase !== PHASE.LOBBY) this.send(p.id, S2C.SELF, this.selfState(p, now));
    this.send(p.id, S2C.SNAPSHOT, this.snapshotFor(p, this.positions()));
    if (this.meetings.active) this.send(p.id, S2C.MEETING, this.meetings.serialize(now));
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
    this.freezeUntil = now + START_FREEZE_MS;
    this.day = {
      startAt: this.freezeUntil,
      lengthMs: this.match.workdayMinutes * 60_000,
      sections: this.match.tasks,
      pausedTotal: 0,
      pausedAt: null,
    };
    this.meetingAvailableAt = this.freezeUntil + MEETING_COOLDOWN_MS;
    this.deskCheck = null;
    this.breaks = breakWindows(this.match.breaks, this.day.lengthMs);
    this.breakId = null;
    this.result = null;
    this.chat = [];
    this.generalChat = [];
    this.teamChat = [];
    this.crewChat = [];
    this.wifi = { down: false, until: 0, readyAt: this.freezeUntil + BREAKER_INITIAL_COOLDOWN_MS };
    this.social = 0;

    for (const player of everyone) player.resetForMatch();
    this.roles.assign(everyone, this.match, this.day.startAt);
    if (this.sandbox) Sandbox.applyPreferredRoles(this); // SANDBOX: chosen roles
    for (const player of everyone) {
      this.tasks.reset(player);
      this.tasks.issueNext(player); // first task of the day, shown during the role reveal
      const seat = this.roles.seatOf(player);
      player.x = seat.x;
      player.y = seat.y;
      player.emergencyCallsLeft = EMERGENCY_CALLS_PER_PLAYER;
    }

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
    this.deskCheck = null;
    this.result = null;
    this.chat = [];
    this.generalChat = [];
    this.teamChat = [];
    this.crewChat = [];
    this.wifi = { down: false, until: 0, readyAt: 0 };
    this.social = 0;
    for (const other of this.players.values()) { other.x = -999; other.y = -999; }
    for (const other of this.players.values()) this.placeInLobby(other);
    this.broadcastRoom();
    this.broadcast(S2C.CHAT, { channel: 'all', backlog: [] });
    this.sendSnapshots();
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
      if (!p.isActive) continue;
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
    if (distPointRect(p.x, p.y, object) > INTERACT_RANGE) return this.toast(p, 'Too far away.');
    if (p.activeTask?.objectId === object.id) return; // already working here

    switch (object.type) {
      case 'meeting_bell': return this.callMeeting(p, now);
      case 'time_clock':   return this.clockOut(p, now);
      case 'breaker':      return this.useBreaker(p, object, now);
      default: {
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
    const res = this.tasks.submitMinigame(p, answer);
    if (!res.ok) return res.reason && this.toast(p, res.reason);
    this.onTaskFinished(p, res.task);
  }

  onTaskFinished(p, finished) {
    const total = this.match.tasks;
    const allIn = p.tasks.length >= total;
    const left = p.tasks.filter((t) => !t.done).length;
    let msg = `Done: ${finished.label}.`;
    if (allIn && !left) {
      msg = p.isTeam ? 'All tasks done. Keep blending in.' : 'All tasks done! Clock out at the time clock in the Lobby.';
    } else if (!left) {
      msg += ' Next task arrives soon.';
    }
    this.toast(p, msg);

    // Away-from-desk tasks done by real workers during a wifi outage fill the
    // shared social meter. Snitch and Management tasks never count.
    if (this.wifi.down && !finished.desk && p.role === ROLE.WORKER) {
      this.social++;
      this.roomDirty = true;
      this.checkWin(this.now);
    }
  }

  clockOut(p, now) {
    if (p.isManagement) return this.toast(p, "Management doesn't clock out. Keep an eye on the floor.");
    if (p.isSnitch) return this.toast(p, 'Snitches stay late. Management needs you on the floor.');
    const total = this.match.tasks;
    if (p.tasks.length < total) {
      return this.toast(p, `More work is on the way (${p.tasks.length} of ${total} tasks handed out so far).`);
    }
    if (!this.tasks.allDone(p, total)) {
      return this.toast(p, `Finish your tasks first (${p.tasks.filter((t) => t.done).length}/${total}).`);
    }

    p.status = STATUS.HOME;
    p.input = { dx: 0, dy: 0 };
    p.selfDirty = true;
    this.broadcast(S2C.EVENT, { kind: 'went_home', playerId: p.id, name: p.name });
    this.roomDirty = true;
    this.checkWin(now);
  }

  handleReport(p, targetId, now) {
    this.now = now;
    if (!this.canAct(p, now)) return;
    const target = typeof targetId === 'string' ? this.players.get(targetId) : null;
    const check = this.roles.validateReport(p, target, now, this.match.reportRange, { wifiDown: this.wifi.down });
    if (!check.ok) return this.toast(p, check.reason);
    if (this.currentBreak(now) && this.office.inBreakArea(target.x, target.y)) {
      return this.toast(p, `${target.name} is on break. Leave them be.`);
    }

    this.roles.consumeReport(p, now, this.match.reportCooldown);
    this.sendHome(target);

    // Everyone learns who was caught and where, but not who reported them.
    this.broadcast(S2C.EVENT, {
      kind: 'reported', playerId: target.id, name: target.name, where: this.office.roomName(target.x, target.y),
    });
    this.toast(p, `${target.name} was sent home.`);
    this.checkWin(now);
  }

  sendHome(target) {
    this.tasks.cancel(target);
    target.status = STATUS.SENT_HOME;
    target.input = { dx: 0, dy: 0 };
    target.selfDirty = true;
    this.roomDirty = true;
  }

  // ===========================================================================
  // Desk checks: Management announces one, and after the warning countdown
  // anyone (other than Management) who isn't at their own desk is sent home.
  // ===========================================================================

  handleDeskCheck(p, now) {
    this.now = now;
    if (!this.canAct(p, now)) return;
    if (!p.isManagement) return this.toast(p, 'Only Management can call a desk check.');
    if (this.deskCheck) return this.toast(p, 'A desk check is already underway.');
    if (this.wifi.down) return this.toast(p, "The wifi is down. You can't run a desk check without it.");
    if (now < p.deskCheckReadyAt) {
      return this.toast(p, `Desk check is on cooldown (${Math.ceil((p.deskCheckReadyAt - now) / 1000)}s).`);
    }
    const warningMs = this.match.deskCheckWarning * 1000;
    const brk = this.currentBreak(now);
    if (brk) return this.toast(p, `No desk checks during ${brk.label.toLowerCase()}.`);
    const upcoming = nextBreak(this.breaks, this.dayClock(now));
    if (upcoming && upcoming.startMs < this.dayClock(now) + warningMs) {
      return this.toast(p, `${upcoming.label} starts before a desk check would finish.`);
    }
    this.deskCheck = { endsAt: now + warningMs, startedAt: now };
    p.deskCheckReadyAt = Infinity; // set properly when it resolves
    p.selfDirty = true;
    this.broadcast(S2C.EVENT, { kind: 'desk_check', seconds: this.match.deskCheckWarning });
    this.roomDirty = true;
  }

  resolveDeskCheck(now) {
    this.deskCheck = null;
    const caught = [];
    for (const o of this.players.values()) {
      if (!o.isActive || o.isManagement) continue;
      if (this.roles.isAtDesk(o)) continue;
      this.sendHome(o);
      caught.push({ id: o.id, name: o.name });
    }
    const mgmt = [...this.players.values()].find((o) => o.isManagement);
    if (mgmt) {
      mgmt.deskCheckReadyAt = now + this.match.deskCheckCooldown * 1000;
      mgmt.selfDirty = true;
    }
    this.broadcast(S2C.EVENT, { kind: 'desk_check_done', caught });
    this.roomDirty = true;
    this.checkWin(now);
  }

  // ===========================================================================
  // Meetings
  // ===========================================================================

  callMeeting(p, now) {
    if (this.deskCheck) return this.toast(p, 'Desk check underway. Get to your desk!');
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
    for (const o of this.players.values()) this.closeTerminal(o, 'meeting');
    // Facilities resets the breaker while everyone is in the conference room.
    if (this.wifi.down) this.restoreWifi(now, null);

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
    const result = this.meetings.close(now);
    if (result.ejectedId) {
      const ejected = this.players.get(result.ejectedId);
      ejected.status = STATUS.SENT_HOME;
      ejected.selfDirty = true;
      result.ejectedRole = ejected.role; // revealed to everyone
      result.wasManagement = ejected.isManagement;
      this.broadcast(S2C.EVENT, { kind: 'ejected', playerId: ejected.id, name: ejected.name, role: ejected.role });
      this.roomDirty = true;
    }
    this.broadcast(S2C.MEETING, this.meetings.serialize(now));
  }

  endMeeting(now) {
    this.now = now;
    this.meetings.end();
    this.phase = PHASE.PLAYING;
    this.resumeDay(now);
    if (this.checkWin(now)) return;

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
  // Breaker box & wifi
  // ===========================================================================

  /** Anyone can cut the power (if the breaker isn't stuck) or restore it. */
  useBreaker(p, object, now) {
    this.tasks.cancel(p);
    if (this.wifi.down) return this.tasks.startTimed(p, object, TIMED_BY_ID.get('breaker_on'), now);
    if (now < this.wifi.readyAt) {
      return this.toast(p, `The breaker won't budge yet (${Math.ceil((this.wifi.readyAt - now) / 1000)}s).`);
    }
    this.tasks.startTimed(p, object, TIMED_BY_ID.get('breaker_off'), now);
  }

  /** A timed action (not a to-do item) finished. */
  finishAction(p, action, now) {
    if (action.id === 'breaker_off') {
      if (this.wifi.down || now < this.wifi.readyAt) return;
      this.wifi.down = true;
      this.wifi.until = now + WIFI_OUTAGE_MS;
      // Anonymous: only people who saw it happen know who flipped it.
      this.broadcast(S2C.EVENT, { kind: 'wifi_down', ms: WIFI_OUTAGE_MS });
      for (const o of this.players.values()) this.closeTerminal(o, 'wifi');
      // No wifi, no desk check: nobody can be sent home for leaving their desk.
      if (this.deskCheck) {
        this.deskCheck = null;
        const mgmt = [...this.players.values()].find((o) => o.isManagement);
        if (mgmt) {
          mgmt.deskCheckReadyAt = now + this.match.deskCheckCooldown * 1000;
          mgmt.selfDirty = true;
        }
        this.broadcast(S2C.EVENT, { kind: 'desk_check_cancelled' });
      }
      this.roomDirty = true;
    } else if (action.id === 'breaker_on') {
      if (this.wifi.down) this.restoreWifi(now, 'breaker');
    }
  }

  restoreWifi(now, why) {
    this.wifi.down = false;
    this.wifi.until = 0;
    this.wifi.readyAt = now + BREAKER_COOLDOWN_MS;
    // Anyone mid-way through flipping the breaker back has nothing left to flip.
    for (const o of this.players.values()) {
      if (o.activeTask?.taskId === 'breaker_on') this.tasks.cancel(o);
    }
    if (why) this.broadcast(S2C.EVENT, { kind: 'wifi_up', why });
    this.roomDirty = true;
  }

  // ===========================================================================
  // Talking
  //   all     : everyone, face to face. Lobby, all-hands meetings, after the game.
  //   During the workday the ONLY way to talk is the terminal on your own desk
  //   (needs wifi). It has three channels:
  //   general : everyone
  //   crew    : the water cooler. Workers + snitches. Management never sees it,
  //             which is exactly why snitches are useful.
  //   team    : the back office. Management + snitches.
  //   Lines are delivered live only to open terminals; you get the backlog when
  //   you sit down and open yours. Out on the floor you can only emote.
  // ===========================================================================

  /** Who may read a terminal channel. */
  canRead(p, channel) {
    if (channel === 'team') return p.isTeam;
    if (channel === 'crew') return !p.isManagement;
    return true;
  }

  channelLog(channel) {
    return channel === 'team' ? this.teamChat : channel === 'crew' ? this.crewChat : this.generalChat;
  }

  /** Why this player can't use their terminal right now, or null if they can. */
  terminalBlocked(p) {
    if (this.phase !== PHASE.PLAYING || !p.isActive) return 'Your terminal is off.';
    if (!this.roles.isAtDesk(p)) return 'Sit at your own desk to use your terminal.';
    if (this.wifi.down) return 'No wifi. Your terminal is offline.';
    return null;
  }

  handleTerminal(p, open) {
    if (!open) return this.closeTerminal(p);
    const blocked = this.terminalBlocked(p);
    if (blocked) return this.toast(p, blocked);
    p.terminalOpen = true;
    this.send(p.id, S2C.TERMINAL, { open: true });
    for (const channel of ['general', 'crew', 'team']) {
      if (this.canRead(p, channel)) this.send(p.id, S2C.CHAT, { channel, backlog: this.channelLog(channel) });
    }
  }

  closeTerminal(p, reason) {
    if (!p.terminalOpen) return;
    p.terminalOpen = false;
    this.send(p.id, S2C.TERMINAL, { open: false, reason });
  }

  /** Post to a terminal channel (callers have checked the sender may). */
  postToTerminal(p, channel, text, now) {
    const log = this.channelLog(channel);
    const line = { from: p.id, text, at: now, channel };
    log.push(line);
    if (log.length > CHAT_HISTORY) log.shift();
    for (const o of this.players.values()) {
      if (o.terminalOpen && this.canRead(o, channel)) this.send(o.id, S2C.CHAT, { channel, line });
    }
  }

  handleChat(p, rawText, channel, now) {
    const text = cleanText(rawText, CHAT_MAX);
    if (!text) return;

    if (channel !== 'all') {
      if (!this.canRead(p, channel)) return;
      const blocked = this.terminalBlocked(p);
      if (blocked || !p.terminalOpen) return this.toast(p, blocked ?? 'Open your terminal at your desk to chat.');
      return this.postToTerminal(p, channel, text, now);
    }

    if (this.phase === PHASE.PLAYING) return this.toast(p, 'Out on the floor you can only emote. Talk at your desk terminal.');
    const inMeeting = this.phase === PHASE.MEETING && this.meetings.current?.stage === 'discussing';
    const open = this.phase === PHASE.LOBBY || this.phase === PHASE.ENDED || inMeeting;
    if (!open) return this.toast(p, 'Everyone chat opens during meetings.');
    if (inMeeting && !p.isActive) return this.toast(p, "You're home. Only people in the office can talk.");

    const line = { from: p.id, text, at: now, channel: 'all' };
    this.chat.push(line);
    if (this.chat.length > CHAT_HISTORY) this.chat.shift();
    this.broadcast(S2C.CHAT, { channel: 'all', line });
  }

  /** In-person reaction. Only people who can see you get it. */
  handleEmote(p, id, now) {
    const emote = typeof id === 'string' ? EMOTES_BY_ID.get(id) : null;
    if (!emote) return;
    const walking = this.phase === PHASE.LOBBY || (this.phase === PHASE.PLAYING && p.isActive);
    if (!walking || now < (p.emoteReadyAt ?? 0)) return;
    p.emoteReadyAt = now + EMOTE_COOLDOWN_MS;
    const msg = { playerId: p.id, id: emote.id };
    for (const o of this.players.values()) {
      if (!o.connected) continue;
      const limited = this.phase === PHASE.PLAYING && o.isActive && o !== p
        && !(this.sandbox && Sandbox.sandboxSeesAll(this, o)); // SANDBOX
      if (limited && !canSee(this.office, o, p, this.rules.sightRange)) continue;
      this.send(o.id, S2C.EMOTE, msg);
    }
  }

  // ===========================================================================
  // Win conditions (all evaluated here, never on the client)
  // ===========================================================================

  workdayProgress() {
    // Only real workers count. Snitches can't clock out and don't count.
    const workers = [...this.players.values()].filter((p) => p.role === ROLE.WORKER && p.status !== STATUS.LEFT);
    const goal = Math.max(1, Math.ceil(workers.length * GO_HOME_RATIO));
    const home = workers.filter((p) => p.status === STATUS.HOME).length;
    const inOffice = workers.filter((p) => p.status === STATUS.ACTIVE).length;
    const socialGoal = Math.max(SOCIAL_GOAL_MIN, Math.ceil(workers.length * SOCIAL_GOAL_PER_WORKER));
    return { goal, home, inOffice, social: this.social, socialGoal };
  }

  /** Returns true if the game ended. */
  checkWin(now) {
    if (this.phase !== PHASE.PLAYING && this.phase !== PHASE.MEETING) return false;
    if (this.sandbox && !Sandbox.sandboxWinsEnabled(this)) return false; // SANDBOX: wins on request only

    const mgmt = [...this.players.values()].find((p) => p.isManagement);
    if (!mgmt || mgmt.status === STATUS.LEFT) return this.endGame('workers', 'Management left the building.', now);
    // During a meeting, let the result screen play out; endMeeting() checks again.
    if (this.phase === PHASE.MEETING) return false;
    if (mgmt.status === STATUS.SENT_HOME) return this.endGame('workers', `${mgmt.name} was Management, and got voted out.`, now);

    const { goal, home, inOffice, social, socialGoal } = this.workdayProgress();
    if (home >= goal) return this.endGame('workers', 'Enough of the team clocked out. The workday is done.', now);
    if (social >= socialGoal) return this.endGame('workers', 'The social meter is full. The team bonded during the outages.', now);
    if (home + inOffice < goal) return this.endGame('management', 'Too few workers are left to finish the workday.', now);
    if (this.day && this.dayClock(now) >= this.day.lengthMs) {
      return this.endGame('management', 'Five o\u2019clock came and too few people had clocked out.', now);
    }
    return false;
  }

  endGame(winner, reason, now) {
    this.meetings.end();
    this.phase = PHASE.ENDED;
    this.deskCheck = null;
    for (const p of this.players.values()) {
      p.input = { dx: 0, dy: 0 };
      this.tasks.cancel(p);
      this.closeTerminal(p);
    }
    const mgmt = [...this.players.values()].find((p) => p.isManagement);
    const snitches = [...this.players.values()].filter((p) => p.isSnitch);
    this.result = {
      winner,
      reason,
      managementId: mgmt?.id ?? null,
      managementName: mgmt?.name ?? null,
      snitches: snitches.map((s) => ({ id: s.id, name: s.name })),
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

    if (this.phase === PHASE.PLAYING && this.wifi.down && now >= this.wifi.until) this.restoreWifi(now, 'timeout');

    if (this.phase === PHASE.PLAYING) {
      const frozen = now < this.freezeUntil;
      for (const p of this.players.values()) {
        if (!p.isActive) continue;
        if (!frozen && (p.input.dx || p.input.dy)) {
          const next = stepMovement(this.office, p, p.input, dt, undefined, speed);
          p.x = next.x;
          p.y = next.y;
        }
        if (p.terminalOpen && this.terminalBlocked(p)) this.closeTerminal(p, 'left_desk');
        const finished = this.tasks.update(p, now);
        if (finished?.action) this.finishAction(p, finished, now);
        else if (finished) this.onTaskFinished(p, finished);
        if (this.phase !== PHASE.PLAYING) break; // that task ended the game
      }
      const stillPlaying = this.phase === PHASE.PLAYING;
      if (!frozen && stillPlaying) {
        this.issueDueTasks(now);
        this.updateBreak(now);
      }
      if (stillPlaying && this.deskCheck && now >= this.deskCheck.endsAt) this.resolveDeskCheck(now);
      if (this.phase === PHASE.PLAYING) {
        this.checkWin(now);
        this.sendSnapshots();
      }
    }

    if (this.phase === PHASE.MEETING && this.meetings.current) {
      const m = this.meetings.current;
      if (m.stage === 'discussing' && (now >= m.endsAt || this.meetings.everyoneVoted())) this.resolveVote(now);
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
   * (walls block vision), so a modified client can't see around corners or into
   * the dark. Lobby, meetings, the end screen and players who are out of the
   * office see everyone.
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
    const progress = this.phase === PHASE.LOBBY ? null : this.workdayProgress();
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
      deskCheck: this.deskCheck ? { msLeft: Math.max(0, this.deskCheck.endsAt - this.now) } : null,
      wifi: this.phase === PHASE.LOBBY ? null : {
        down: this.wifi.down,
        msLeft: this.wifi.down ? Math.max(0, this.wifi.until - this.now) : 0,
        readyIn: Math.max(0, this.wifi.readyAt - this.now),
      },
    };
  }

  broadcastRoom() {
    this.roomDirty = false;
    this.broadcast(S2C.ROOM, this.roomState());
  }

  /** Private to one player: their role, desk, tasks and (for the team) teammates. */
  selfState(p, now) {
    const team = p.isTeam
      ? [...this.players.values()].filter((o) => o.isTeam && o !== p).map((o) => ({ id: o.id, role: o.role }))
      : [];
    return {
      role: p.role,
      status: p.status,
      deskId: p.deskId,
      ...this.tasks.serialize(p, now),
      totalTasks: this.match?.tasks ?? 0,
      team,
      reportReadyIn: p.isManagement ? Math.max(0, p.reportReadyAt - now) : null,
      deskCheckReadyIn: p.isManagement && Number.isFinite(p.deskCheckReadyAt) ? Math.max(0, p.deskCheckReadyAt - now) : null,
      emergencyLeft: p.emergencyCallsLeft,
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
