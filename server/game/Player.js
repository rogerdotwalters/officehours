/**
 * Server-side player record. Holds BOTH public and private state; only the
 * explicit serialisers below decide what leaves the server.
 */
import { STATUS, ROLE } from '../../shared/constants.js';

export class Player {
  constructor({ id, token, name, colorId }) {
    this.id = id;           // public id, shared with other players
    this.token = token;     // private session secret, used to reconnect
    this.name = name;
    this.colorId = colorId;

    // Lobby
    this.ready = false;
    this.connected = true;
    this.disconnectedAt = 0;

    // Match state (reset by resetForMatch)
    this.resetForMatch();
  }

  resetForMatch() {
    this.role = ROLE.WORKER;
    this.status = STATUS.ACTIVE;
    this.deskId = null;
    this.x = 0;
    this.y = 0;
    this.input = { dx: 0, dy: 0 };
    this.tasks = [];              // [{ id, done }]
    this.activeTask = null;       // { taskId, objectId, startedAt, duration }
    this.reportReadyAt = 0;
    this.emergencyCallsLeft = 0;
    this.selfDirty = true;        // private state changed -> resend SELF
  }

  get isManagement() {
    return this.role === ROLE.MANAGEMENT;
  }

  get isActive() {
    return this.status === STATUS.ACTIVE;
  }

  /** Safe for everyone in the room. Never includes role or tasks. */
  publicInfo() {
    return {
      id: this.id,
      name: this.name,
      colorId: this.colorId,
      ready: this.ready,
      connected: this.connected,
      status: this.status,
      deskId: this.deskId,
    };
  }
}
