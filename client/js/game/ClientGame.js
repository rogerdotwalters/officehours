/**
 * ClientGame — the client's view of the world.
 *
 * - Stores the latest server state (room roster, snapshots, private self state).
 * - Predicts the local player's movement with the SAME physics as the server so
 *   controls feel instant, then gently reconciles toward the server position.
 * - Interpolates remote players between snapshots for smooth motion.
 *
 * Nothing here decides game outcomes; the server is authoritative.
 */
import { buildOfficeMap, distPointRect } from '../../shared/mapBuilder.js';
import { stepMovement } from '../../shared/physics.js';
import { PHASE, STATUS, ROLE, INTERP_DELAY_MS, INTERACT_RANGE, REPORT_RANGE, COLORS, DESK_RANGE } from '../../shared/constants.js';
import { PFLAG } from '../../shared/protocol.js';
import { TASKS_BY_ID } from '../../shared/tasks.js';
import { hasLineOfSight } from '../../shared/vision.js';

const SNAP_DISTANCE = 150;   // further than this from the server = teleport, don't smooth
const BUFFER_SIZE = 12;

export class ClientGame {
  constructor() {
    this.map = buildOfficeMap();
    this.selfId = null;
    this.room = null;          // latest ROOM message
    this.roster = new Map();   // id -> public info
    this.self = null;          // latest SELF message (+ local timestamps)
    this.entities = new Map(); // id -> { buffer: [{t,x,y}], flags, x, y }
    this.local = null;         // predicted local position { x, y }
    this.serverSelf = null;    // last authoritative local position
    this.meeting = null;
    this.spectateIndex = 0;
    this.wifi = null;          // { down, until, readyAt } in local performance.now() time
    this.terminal = { open: false, lines: [] };
  }

  // ---- Applying server messages -------------------------------------------
  applyRoom(room, now) {
    this.room = room;
    this.roster = new Map(room.players.map((p) => [p.id, p]));
    this.wifi = room.wifi
      ? { down: room.wifi.down, until: now + room.wifi.msLeft, readyAt: now + room.wifi.readyIn }
      : null;
  }

  applySelf(self, now) {
    this.self = {
      ...self,
      receivedAt: now,
      reportReadyAt: self.reportReadyIn == null ? null : now + self.reportReadyIn,
      meetingReadyAt: now + self.meetingReadyIn,
      freezeUntil: now + self.freezeMs,
    };
  }

  applySnapshot(snap, now) {
    const seen = new Set();
    for (const [id, x, y, flags] of snap.p) {
      seen.add(id);
      let e = this.entities.get(id);
      if (!e) {
        e = { buffer: [], x, y, flags };
        this.entities.set(id, e);
      }
      const last = e.buffer[e.buffer.length - 1];
      if (last && Math.hypot(last.x - x, last.y - y) > SNAP_DISTANCE) e.buffer.length = 0; // teleported
      e.buffer.push({ t: now, x, y });
      if (e.buffer.length > BUFFER_SIZE) e.buffer.shift();
      e.flags = flags;

      if (id === this.selfId) {
        this.serverSelf = { x, y };
        if (!this.local || Math.hypot(this.local.x - x, this.local.y - y) > SNAP_DISTANCE) this.local = { x, y };
      }
    }
    // Players missing from the snapshot are no longer in the office.
    for (const id of this.entities.keys()) if (!seen.has(id)) this.entities.delete(id);
    if (!seen.has(this.selfId)) { this.local = null; this.serverSelf = null; }
  }

  reset() {
    this.entities.clear();
    this.local = null;
    this.serverSelf = null;
    this.self = null;
    this.meeting = null;
    this.terminal = { open: false, lines: [] };
  }

  // ---- Derived state -------------------------------------------------------
  get phase() { return this.room?.phase ?? PHASE.LOBBY; }
  get me() { return this.roster.get(this.selfId) ?? null; }
  get isHost() { return this.room?.hostId === this.selfId; }
  get isManagement() { return this.self?.role === ROLE.MANAGEMENT; }
  get inOffice() { return !!this.local && this.self?.status === STATUS.ACTIVE; }
  get wifiDown() { return !!this.wifi?.down; }

  /** Fog of war applies while you're walking the floor (not to spectators or meetings). */
  get fogged() { return this.phase === PHASE.PLAYING && this.inOffice; }

  /** Within DESK_RANGE of your own seat (display only; the server re-checks). */
  get atOwnDesk() {
    const desk = this.self?.deskId && this.map.desksById.get(this.self.deskId);
    return !!(desk && this.local && Math.hypot(this.local.x - desk.seat.x, this.local.y - desk.seat.y) <= DESK_RANGE);
  }

  nameOf(id) { return this.roster.get(id)?.name ?? 'Someone'; }
  colorOf(id) { return COLORS[this.roster.get(id)?.colorId ?? 9].hex; }

  canMove(now) {
    return this.phase === PHASE.PLAYING && this.inOffice && now >= (this.self?.freezeUntil ?? 0);
  }

  // ---- Per-frame update ----------------------------------------------------
  /** Advance local prediction. `dir` is the current input direction. */
  update(dt, dir, now) {
    if (!this.local || !this.serverSelf) return;
    const moving = this.canMove(now) && (dir.dx || dir.dy);
    if (moving) this.local = stepMovement(this.map, this.local, dir, dt);

    // Reconciliation: drift toward the server, harder when standing still.
    const ex = this.serverSelf.x - this.local.x;
    const ey = this.serverSelf.y - this.local.y;
    const err = Math.hypot(ex, ey);
    const rate = moving ? (err > 40 ? 3 : 0) : 10;
    if (rate) {
      const k = 1 - Math.exp(-rate * dt);
      this.local = { x: this.local.x + ex * k, y: this.local.y + ey * k };
    }
  }

  /** Position to draw each player at this frame. */
  renderPositions(now) {
    const out = [];
    const renderAt = now - INTERP_DELAY_MS;
    for (const [id, e] of this.entities) {
      let x, y;
      if (id === this.selfId && this.local) {
        ({ x, y } = this.local);
      } else {
        ({ x, y } = interpolate(e.buffer, renderAt));
      }
      e.x = x;
      e.y = y;
      out.push({ id, x, y, flags: e.flags });
    }
    return out;
  }

  /** The point the camera should follow (you, or a spectated colleague). */
  cameraTarget() {
    if (this.local) return { ...this.local, spectating: null };
    const ids = [...this.entities.keys()];
    if (!ids.length) return { x: this.map.width / 2, y: this.map.height / 2, spectating: null };
    const id = ids[this.spectateIndex % ids.length];
    const e = this.entities.get(id);
    return { x: e.x, y: e.y, spectating: id };
  }

  cycleSpectate() {
    this.spectateIndex++;
  }

  // ---- Interaction helpers -------------------------------------------------
  /** Nearest interactable within range, with a label describing what E will do. */
  nearestUsable() {
    if (!this.local) return null;
    const near = this.map.interactablesNear(this.local.x, this.local.y, INTERACT_RANGE);
    for (const o of near) {
      const action = this.actionFor(o);
      if (action) return { object: o, action };
    }
    return near.length ? { object: near[0], action: null } : null;
  }

  /** What would interacting with this object do for me? (display only) */
  actionFor(o) {
    if (o.type === 'meeting_bell') return 'Call an all-hands meeting';
    if (o.type === 'time_clock') return this.isManagement ? null : 'Clock out and go home';
    if (o.type === 'breaker') {
      if (this.wifiDown) return 'Restore the power';
      const wait = (this.wifi?.readyAt ?? 0) - performance.now();
      return wait > 0 ? `Breaker is stuck (${Math.ceil(wait / 1000)}s)` : 'Cut the power and kill the wifi';
    }
    const task = this.pendingTaskFor(o);
    return task ? task.label : null;
  }

  pendingTaskFor(o) {
    for (const t of this.self?.tasks ?? []) {
      if (t.done) continue;
      const def = TASKS_BY_ID.get(t.id);
      if (def.target === 'own_desk' ? o.type === 'desk' && o.id === this.self.deskId : def.target === o.type) return def;
    }
    return null;
  }

  /** Objects that would progress my to-do list (for highlighting). */
  taskTargets() {
    return this.map.interactables.filter((o) => this.pendingTaskFor(o));
  }

  /** Management only: players I could report right now. */
  reportableTargets() {
    if (!this.isManagement || !this.local || this.wifiDown) return [];
    const out = [];
    for (const [id, e] of this.entities) {
      if (id === this.selfId || e.flags & PFLAG.AT_DESK) continue;
      const d = Math.hypot(e.x - this.local.x, e.y - this.local.y);
      const inRange = d <= REPORT_RANGE && hasLineOfSight(this.map, this.local.x, this.local.y, e.x, e.y);
      out.push({ id, d, inRange });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  /** Which player (if any) is under a world-space point. */
  playerAt(wx, wy) {
    for (const [id, e] of this.entities) if (Math.hypot(e.x - wx, e.y - wy) < 22) return id;
    return null;
  }

  interactableAt(wx, wy) {
    return this.map.interactables.find((o) => distPointRect(wx, wy, o) < 6) ?? null;
  }
}

/** Linear interpolation through a timestamped position buffer. */
function interpolate(buffer, t) {
  if (!buffer.length) return { x: 0, y: 0 };
  if (t <= buffer[0].t) return buffer[0];
  for (let i = buffer.length - 1; i > 0; i--) {
    const a = buffer[i - 1];
    const b = buffer[i];
    if (t >= a.t && t <= b.t) {
      const k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  return buffer[buffer.length - 1];
}
