/**
 * ClientGame — the client's view of the world.
 *
 * - Stores the latest server state (room roster, settings, snapshots, private self state).
 * - Predicts the local player's movement with the SAME physics as the server so
 *   controls feel instant, then gently reconciles toward the server position.
 * - Interpolates remote players between snapshots for smooth motion.
 *
 * Nothing here decides game outcomes; the server is authoritative. The server also
 * only sends players within your sight range, so the fog drawn by the renderer is
 * cosmetic: what's hidden simply isn't here.
 */
import { buildOfficeMap, distPointRect } from '../../shared/mapBuilder.js';
import { LOBBY_ROOM } from '../../shared/lobbyMap.js';
import { stepMovement } from '../../shared/physics.js';
import { DEFAULT_SETTINGS } from '../../shared/settings.js';
import {
  PHASE, STATUS, ROLE, INTERP_DELAY_MS, INTERACT_RANGE, COLORS, OFFICE_OPEN_HOUR, OFFICE_CLOSE_HOUR,
} from '../../shared/constants.js';
import { PFLAG } from '../../shared/protocol.js';
import { TASKS_BY_ID } from '../../shared/tasks.js';
import { breakWindows, breakAt, nextBreak } from '../../shared/breaks.js';
import { lineOfSight } from '../../shared/sight.js';

const SNAP_DISTANCE = 150;   // further than this from the server = teleport, don't smooth
const BUFFER_SIZE = 12;

export class ClientGame {
  constructor() {
    this.officeMap = buildOfficeMap();
    this.lobbyMap = buildOfficeMap(LOBBY_ROOM);
    this.selfId = null;
    this.room = null;          // latest ROOM message (+ receivedAt)
    this.roster = new Map();   // id -> public info
    this.self = null;          // latest SELF message (+ local timestamps)
    this.entities = new Map(); // id -> { buffer: [{t,x,y}], flags, x, y }
    this.local = null;         // predicted local position { x, y }
    this.serverSelf = null;    // last authoritative local position
    this.meeting = null;
    this.spectateIndex = 0;
    this.emotes = new Map();   // playerId -> { emote, at }
  }

  // ---- Applying server messages -------------------------------------------
  applyRoom(room, now) {
    this.room = { ...room, receivedAt: now };
    this.roster = new Map(room.players.map((p) => [p.id, p]));
  }

  applySelf(self, now) {
    this.self = {
      ...self,
      receivedAt: now,
      reportReadyAt: self.reportReadyIn == null ? null : now + self.reportReadyIn,
      deskCheckReadyAt: self.deskCheckReadyIn == null ? null : now + self.deskCheckReadyIn,
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
    // Players missing from the snapshot are out of sight or out of the office.
    for (const id of this.entities.keys()) if (!seen.has(id)) this.entities.delete(id);
    if (!seen.has(this.selfId)) { this.local = null; this.serverSelf = null; }
  }

  reset() {
    this.entities.clear();
    this.local = null;
    this.serverSelf = null;
    this.self = null;
    this.meeting = null;
  }

  // ---- Derived state -------------------------------------------------------
  get phase() { return this.room?.phase ?? PHASE.LOBBY; }
  get inLobby() { return this.phase === PHASE.LOBBY; }
  get map() { return this.inLobby ? this.lobbyMap : this.officeMap; }
  get settings() { return this.room?.settings ?? DEFAULT_SETTINGS; }
  get me() { return this.roster.get(this.selfId) ?? null; }
  get isHost() { return this.room?.hostId === this.selfId; }
  get role() { return this.self?.role ?? null; }
  get isManagement() { return this.role === ROLE.MANAGEMENT; }
  get isSnitch() { return this.role === ROLE.SNITCH; }
  get isTeam() { return this.isManagement || this.isSnitch; }
  get inOffice() { return !!this.local && !this.inLobby && this.self?.status === STATUS.ACTIVE; }

  nameOf(id) { return this.roster.get(id)?.name ?? 'Someone'; }
  colorOf(id) { return COLORS[this.roster.get(id)?.colorId ?? 9].hex; }

  /** Teammate role for a player id, as seen by me (Management/snitches only). */
  teamRoleOf(id) {
    return this.self?.team?.find((t) => t.id === id)?.role ?? null;
  }

  canMove(now) {
    if (!this.local) return false;
    if (this.inLobby) return true;
    return this.phase === PHASE.PLAYING && this.inOffice && now >= (this.self?.freezeUntil ?? 0);
  }

  // ---- Workday clock -------------------------------------------------------
  /** { elapsed, lengthMs, sections, sectionMs, section, sectionProgress, running } or null. */
  dayInfo(now) {
    const d = this.room?.day;
    if (!d) return null;
    const drift = d.running ? now - this.room.receivedAt : 0;
    const elapsed = Math.max(0, Math.min(d.lengthMs, d.elapsed + drift));
    const sectionMs = d.lengthMs / d.sections;
    const section = Math.min(d.sections - 1, Math.floor(elapsed / sectionMs));
    return {
      ...d,
      elapsed,
      sectionMs,
      section,
      sectionProgress: (elapsed - section * sectionMs) / sectionMs,
      nextTaskIn: section < d.sections - 1 ? (section + 1) * sectionMs - elapsed : null,
      timeLeft: d.lengthMs - elapsed,
    };
  }

  /** Break windows for this match (empty in the lobby). */
  breakWindows() {
    const d = this.room?.day;
    return d ? breakWindows(this.settings.breaks ?? 0, d.lengthMs) : [];
  }

  /** { current, next, windows } for the workday clock right now. */
  breakInfo(now) {
    const day = this.dayInfo(now);
    const windows = this.breakWindows();
    if (!day) return { current: null, next: null, windows };
    return { current: breakAt(windows, day.elapsed), next: nextBreak(windows, day.elapsed), windows, elapsed: day.elapsed };
  }

  /** "11:20 AM" style office time for a point in the workday. */
  officeTime(elapsed, lengthMs) {
    const hours = OFFICE_OPEN_HOUR + (OFFICE_CLOSE_HOUR - OFFICE_OPEN_HOUR) * (elapsed / lengthMs);
    const totalMin = Math.floor(hours * 60 / 10) * 10; // tick in 10-minute steps, like a wall clock
    const h24 = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const h12 = ((h24 + 11) % 12) + 1;
    return `${h12}:${String(m).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
  }

  /** Desk check countdown in ms, or null. */
  deskCheckLeft(now) {
    const dc = this.room?.deskCheck;
    if (!dc) return null;
    return Math.max(0, dc.msLeft - (now - this.room.receivedAt));
  }

  // ---- Per-frame update ----------------------------------------------------
  /** Advance local prediction. `dir` is the current input direction. */
  update(dt, dir, now) {
    if (!this.local || !this.serverSelf) return;
    const moving = this.canMove(now) && (dir.dx || dir.dy);
    if (moving) this.local = stepMovement(this.map, this.local, dir, dt, undefined, this.settings.playerSpeed);

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
  /** Nearest interactable within range, with a label describing what Use will do. */
  nearestUsable() {
    if (!this.local || this.inLobby) return null;
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
    if (o.type === 'time_clock') return this.isTeam ? null : 'Clock out and go home';
    if (o.type === 'hr_box') return this.isManagement || this.self?.hrReportUsed ? null : 'File an HR complaint';
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
    if (this.inLobby) return [];
    return this.map.interactables.filter((o) => this.pendingTaskFor(o));
  }

  allTasksDone() {
    const s = this.self;
    return !!s && s.tasks.length >= s.totalTasks && s.tasks.every((t) => t.done);
  }

  /** Management only: players I could report right now. */
  reportableTargets() {
    if (!this.isManagement || !this.local || this.phase !== PHASE.PLAYING) return [];
    const range = this.settings.reportRange;
    const onBreak = !!this.breakInfo(performance.now()).current;
    const out = [];
    for (const [id, e] of this.entities) {
      if (id === this.selfId || e.flags & PFLAG.AT_DESK) continue;
      if (onBreak && this.map.inBreakArea(e.x, e.y)) continue; // safe on break
      const d = Math.hypot(e.x - this.local.x, e.y - this.local.y);
      const clear = d <= range && lineOfSight(this.map, this.local.x, this.local.y, e.x, e.y);
      out.push({ id, d, inRange: clear });
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
