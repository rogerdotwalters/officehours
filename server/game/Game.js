/**
 * Game — the authoritative state machine for one room.
 *
 * Pure logic: it knows nothing about WebSockets or Durable Objects. The transport
 * layer (GameRoom) passes in `send(playerId, type, data)` and `broadcast(type, data)`
 * callbacks and calls the handle*() methods with already-parsed intents.
 *
 * Phases:  LOBBY -> PLAYING <-> MEETING -> ENDED -> LOBBY
 */
import {
  PHASE, STATUS, ROLE, MAX_PLAYERS, MIN_PLAYERS, NAME_MAX, CHAT_MAX, CHAT_HISTORY,
  START_FREEZE_MS, MEETING_COOLDOWN_MS, EMERGENCY_CALLS_PER_PLAYER, GO_HOME_RATIO,
  RECONNECT_GRACE_MS, TICK_MS, INTERACT_RANGE, COLORS,
} from '../../shared/constants.js';
import { S2C, PFLAG } from '../../shared/protocol.js';
import { buildOfficeMap, distPointRect } from '../../shared/mapBuilder.js';
import { stepMovement } from '../../shared/physics.js';
import { Player } from './Player.js';
import { TaskSystem } from './TaskSystem.js';
import { RoleSystem } from './RoleSystem.js';
import { MeetingSystem, SKIP } from './MeetingSystem.js';
import { randomId } from './random.js';

const LOBBY_GRACE_MS = 10_000;

// Strip control characters and angle brackets, collapse whitespace.
function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export class Game {
  constructor({ code, send, broadcast }) {
    this.code = code;
    this.send = send;
    this.broadcast = broadcast;

    this.map = buildOfficeMap();
    this.tasks = new TaskSystem(this.map);
    this.roles = new RoleSystem(this.map);
    this.meetings = new MeetingSystem();

    this.players = new Map();   // id -> Player (insertion order = join order)
    this.phase = PHASE.LOBBY;
    this.hostId = null;
    this.chat = [];
    this.freezeUntil = 0;
    this.meetingAvailableAt = 0;
    this.result = null;
    this.roomDirty = false;
  }

  // ===========================================================================
  // Joining, leaving, reconnecting
  // ===========================================================================

  /** Returns { player, resumed } or { error: { code, message } }. */
  join(rawName, token, now) {
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

    if (this.phase !== PHASE.LOBBY) return { error: { code: 'in_progress', message: 'That game has already started.' } };
    if (this.players.size >= MAX_PLAYERS) return { error: { code: 'full', message: `Room is full (${MAX_PLAYERS} players).` } };

    let name = cleanText(rawName, NAME_MAX) || `Worker ${this.players.size + 1}`;
    const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${cleanText(rawName, NAME_MAX - 3) || 'Worker'} ${n}`;

    const usedColors = new Set([...this.players.values()].map((p) => p.colorId));
    const colorId = COLORS.findIndex((_, i) => !usedColors.has(i));

    const player = new Player({ id: randomId(6), token: randomId(16), name, colorId });
    this.players.set(player.id, player);
    if (!this.hostId) this.hostId = player.id;
    this.roomDirty = true;
    return { player, resumed: false };
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
    return ![...this.players.values()].some((p) => p.connected);
  }

  /** Everything a (re)connecting client needs to render the current moment. */
  sendFullState(p, now) {
    this.send(p.id, S2C.ROOM, this.roomState());
    this.send(p.id, S2C.CHAT, { backlog: this.chat });
    if (this.phase !== PHASE.LOBBY) {
      this.send(p.id, S2C.SELF, this.selfState(p, now));
      this.send(p.id, S2C.SNAPSHOT, this.snapshot());
    }
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

  handleStart(p, now) {
    if (this.phase !== PHASE.LOBBY) return;
    if (p.id !== this.hostId) return this.toast(p, 'Only the host can start the game.');

    // Drop anyone who is mid-reconnect in the lobby; they can rejoin next round.
    for (const other of [...this.players.values()]) if (!other.connected) this.players.delete(other.id);

    const everyone = [...this.players.values()];
    if (everyone.length < MIN_PLAYERS) return this.toast(p, `Need at least ${MIN_PLAYERS} players.`);
    const notReady = everyone.filter((o) => o.id !== this.hostId && !o.ready);
    if (notReady.length) return this.toast(p, `Waiting on: ${notReady.map((o) => o.name).join(', ')}`);

    for (const player of everyone) player.resetForMatch();
    this.roles.assign(everyone, now);
    for (const player of everyone) {
      this.tasks.assign(player);
      const seat = this.roles.seatOf(player);
      player.x = seat.x;
      player.y = seat.y;
      player.emergencyCallsLeft = EMERGENCY_CALLS_PER_PLAYER;
    }

    this.phase = PHASE.PLAYING;
    this.freezeUntil = now + START_FREEZE_MS;
    this.meetingAvailableAt = now + MEETING_COOLDOWN_MS;
    this.result = null;
    this.chat = [];

    this.broadcast(S2C.GAME_START, { freezeMs: START_FREEZE_MS });
    this.broadcastRoom();
    for (const player of everyone) this.sendSelf(player, now);
    this.broadcast(S2C.SNAPSHOT, this.snapshot());
  }

  handleReturnToLobby(p) {
    if (this.phase !== PHASE.ENDED) return;
    if (p.id !== this.hostId) return this.toast(p, 'Only the host can reset the room.');
    for (const other of [...this.players.values()]) {
      if (!other.connected || !other.token) { this.players.delete(other.id); continue; }
      other.resetForMatch();
      other.ready = false;
    }
    if (!this.players.has(this.hostId)) this.migrateHost();
    this.phase = PHASE.LOBBY;
    this.result = null;
    this.chat = [];
    this.broadcastRoom();
    this.broadcast(S2C.CHAT, { backlog: [] });
  }

  // ===========================================================================
  // Playing
  // ===========================================================================

  canAct(p, now) {
    return this.phase === PHASE.PLAYING && p.isActive && now >= this.freezeUntil;
  }

  handleInput(p, dx, dy) {
    if (this.phase !== PHASE.PLAYING || !p.isActive) return;
    // Only the direction is accepted; speed is decided by the server.
    p.input = { dx: Math.sign(Number(dx)) || 0, dy: Math.sign(Number(dy)) || 0 };
  }

  handleInteract(p, objectId, now) {
    if (!this.canAct(p, now)) return;
    const object = typeof objectId === 'string' ? this.map.getInteractable(objectId) : null;
    if (!object) return;
    if (distPointRect(p.x, p.y, object) > INTERACT_RANGE) return this.toast(p, 'Too far away.');
    if (p.activeTask?.objectId === object.id) return; // already working here

    switch (object.type) {
      case 'meeting_bell': return this.callMeeting(p, now);
      case 'time_clock':   return this.clockOut(p, now);
      default: {
        this.tasks.cancel(p);
        const res = this.tasks.start(p, object, now);
        if (!res.ok) this.toast(p, res.reason);
      }
    }
  }

  handleCancel(p) {
    this.tasks.cancel(p);
  }

  clockOut(p, now) {
    if (p.isManagement) return this.toast(p, "Management doesn't clock out. Keep an eye on the floor.");
    const done = p.tasks.filter((t) => t.done).length;
    if (!this.tasks.allDone(p)) return this.toast(p, `Finish your tasks first (${done}/${p.tasks.length}).`);

    p.status = STATUS.HOME;
    p.input = { dx: 0, dy: 0 };
    p.selfDirty = true;
    this.broadcast(S2C.EVENT, { kind: 'went_home', playerId: p.id, name: p.name });
    this.roomDirty = true;
    this.checkWin(now);
  }

  handleReport(p, targetId, now) {
    if (!this.canAct(p, now)) return;
    const target = typeof targetId === 'string' ? this.players.get(targetId) : null;
    const check = this.roles.validateReport(p, target, now);
    if (!check.ok) return this.toast(p, check.reason);

    this.roles.consumeReport(p, now);
    this.tasks.cancel(target);
    target.status = STATUS.SENT_HOME;
    target.input = { dx: 0, dy: 0 };
    target.selfDirty = true;

    // Everyone learns who was caught and where, but not who reported them.
    this.broadcast(S2C.EVENT, {
      kind: 'reported', playerId: target.id, name: target.name, where: this.map.roomName(target.x, target.y),
    });
    this.toast(p, `${target.name} was sent home.`);
    this.roomDirty = true;
    this.checkWin(now);
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
    this.phase = PHASE.MEETING;
    this.chat = [];

    const active = [...this.players.values()].filter((o) => o.isActive);
    active.forEach((o, i) => {
      this.tasks.cancel(o);
      o.input = { dx: 0, dy: 0 };
      const seat = this.map.meetingSeats[i % this.map.meetingSeats.length];
      o.x = seat.x;
      o.y = seat.y;
    });

    this.meetings.start({ calledBy: caller.id, voterIds: active.filter((o) => o.connected).map((o) => o.id), now });
    this.broadcast(S2C.EVENT, { kind: 'meeting', playerId: caller.id, name: caller.name });
    this.broadcast(S2C.CHAT, { backlog: [] });
    this.broadcastRoom();
    this.broadcast(S2C.SNAPSHOT, this.snapshot());
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
      result.wasManagement = ejected.isManagement;
      this.broadcast(S2C.EVENT, { kind: 'ejected', playerId: ejected.id, name: ejected.name, wasManagement: ejected.isManagement });
      this.roomDirty = true;
    }
    this.broadcast(S2C.MEETING, this.meetings.serialize(now));
  }

  endMeeting(now) {
    this.meetings.end();
    this.phase = PHASE.PLAYING;
    if (this.checkWin(now)) return;

    // Everyone goes back to their desk, then a short freeze.
    for (const o of this.players.values()) {
      if (!o.isActive) continue;
      const seat = this.roles.seatOf(o);
      o.x = seat.x;
      o.y = seat.y;
      o.selfDirty = true;
    }
    this.freezeUntil = now + 1500;
    this.meetingAvailableAt = now + MEETING_COOLDOWN_MS;
    this.broadcast(S2C.MEETING, { stage: 'closed' });
    this.broadcastRoom();
    this.broadcast(S2C.SNAPSHOT, this.snapshot());
  }

  // ===========================================================================
  // Chat
  // ===========================================================================

  handleChat(p, rawText, now) {
    const text = cleanText(rawText, CHAT_MAX);
    if (!text) return;

    const inMeeting = this.phase === PHASE.MEETING && this.meetings.current?.stage === 'discussing';
    const open = this.phase === PHASE.LOBBY || this.phase === PHASE.ENDED || inMeeting;
    if (!open) return this.toast(p, 'Chat opens during meetings.');
    if (inMeeting && !p.isActive) return this.toast(p, "You're home. Only people in the office can talk.");

    const line = { from: p.id, text, at: now };
    this.chat.push(line);
    if (this.chat.length > CHAT_HISTORY) this.chat.shift();
    this.broadcast(S2C.CHAT, { line });
  }

  // ===========================================================================
  // Win conditions (all evaluated here, never on the client)
  // ===========================================================================

  workdayProgress() {
    const workers = [...this.players.values()].filter((p) => p.role === ROLE.WORKER && p.status !== STATUS.LEFT);
    const goal = Math.max(1, Math.ceil(workers.length * GO_HOME_RATIO));
    const home = workers.filter((p) => p.status === STATUS.HOME).length;
    const inOffice = workers.filter((p) => p.status === STATUS.ACTIVE).length;
    return { goal, home, inOffice };
  }

  /** Returns true if the game ended. */
  checkWin(now) {
    if (this.phase !== PHASE.PLAYING && this.phase !== PHASE.MEETING) return false;

    const mgmt = [...this.players.values()].find((p) => p.isManagement);
    if (!mgmt || mgmt.status === STATUS.LEFT) return this.endGame('workers', 'Management left the building.', mgmt, now);
    // During a meeting, let the result screen play out; endMeeting() checks again.
    if (this.phase === PHASE.MEETING) return false;
    if (mgmt.status === STATUS.SENT_HOME) return this.endGame('workers', `${mgmt.name} was Management — and got voted out.`, mgmt, now);

    const { goal, home, inOffice } = this.workdayProgress();
    if (home >= goal) return this.endGame('workers', 'Enough of the team clocked out. The workday is done.', mgmt, now);
    if (home + inOffice < goal) return this.endGame('management', 'Too few workers are left to finish the workday.', mgmt, now);
    return false;
  }

  endGame(winner, reason, mgmt, now) {
    this.meetings.end();
    this.phase = PHASE.ENDED;
    for (const p of this.players.values()) {
      p.input = { dx: 0, dy: 0 };
      this.tasks.cancel(p);
    }
    this.result = { winner, reason, managementId: mgmt?.id ?? null, managementName: mgmt?.name ?? null };
    this.broadcast(S2C.GAME_OVER, this.result);
    this.broadcastRoom();
    return true;
  }

  // ===========================================================================
  // Tick
  // ===========================================================================

  tick(now) {
    // Disconnect grace periods
    for (const p of [...this.players.values()]) {
      if (p.connected || !p.token) continue;
      const grace = this.phase === PHASE.LOBBY ? LOBBY_GRACE_MS : RECONNECT_GRACE_MS;
      if (now - p.disconnectedAt > grace) this.expire(p, now);
    }

    if (this.phase === PHASE.PLAYING) {
      const dt = TICK_MS / 1000;
      const frozen = now < this.freezeUntil;
      for (const p of this.players.values()) {
        if (!p.isActive) continue;
        if (!frozen && (p.input.dx || p.input.dy)) {
          const next = stepMovement(this.map, p, p.input, dt);
          p.x = next.x;
          p.y = next.y;
        }
        const finished = this.tasks.update(p, now);
        if (finished) {
          const left = p.tasks.filter((t) => !t.done).length;
          this.toast(p, left ? `Done: ${finished.label}.` : 'All tasks done! Clock out at the time clock in the Lobby.');
        }
      }
      this.broadcast(S2C.SNAPSHOT, this.snapshot());
    }

    if (this.phase === PHASE.MEETING && this.meetings.current) {
      const m = this.meetings.current;
      if (m.stage === 'discussing' && (now >= m.endsAt || this.meetings.everyoneVoted())) this.resolveVote(now);
      else if (m.stage === 'results' && now >= m.endsAt) this.endMeeting(now);
    }

    // Private state: send when it changed, or every tick while a task bar is filling.
    if (this.phase !== PHASE.LOBBY) {
      for (const p of this.players.values()) {
        if (p.connected && (p.selfDirty || p.activeTask)) this.sendSelf(p, now);
      }
    }

    if (this.roomDirty) this.broadcastRoom();
  }

  // ===========================================================================
  // Serialisation
  // ===========================================================================

  snapshot() {
    const p = [];
    for (const pl of this.players.values()) {
      if (!pl.isActive) continue;
      let flags = 0;
      if (pl.activeTask) flags |= PFLAG.BUSY;
      if (this.roles.isAtDesk(pl)) flags |= PFLAG.AT_DESK;
      p.push([pl.id, Math.round(pl.x * 10) / 10, Math.round(pl.y * 10) / 10, flags]);
    }
    return { p };
  }

  roomState() {
    const progress = this.phase === PHASE.LOBBY ? null : this.workdayProgress();
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      players: [...this.players.values()].map((p) => p.publicInfo()),
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      progress,
    };
  }

  broadcastRoom() {
    this.roomDirty = false;
    this.broadcast(S2C.ROOM, this.roomState());
  }

  /** Private to one player: their role, desk and tasks. */
  selfState(p, now) {
    return {
      role: p.role,
      status: p.status,
      deskId: p.deskId,
      ...this.tasks.serialize(p, now),
      reportReadyIn: p.isManagement ? Math.max(0, p.reportReadyAt - now) : null,
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
