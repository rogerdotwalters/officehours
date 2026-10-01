/**
 * TaskSystem — assigns task lists and runs timed interactions.
 *
 * A task is only completed if the player stays within range of the target for
 * the full duration. The client just shows a progress bar; the server owns the
 * timer, so a modified client cannot finish tasks instantly or remotely.
 */
import { TASKS, TASKS_BY_ID, TIMED_BY_ID } from '../../shared/tasks.js';
import { TASKS_PER_WORKER, INTERACT_RANGE } from '../../shared/constants.js';
import { distPointRect } from '../../shared/mapBuilder.js';
import { shuffle } from './random.js';

export class TaskSystem {
  constructor(map) {
    this.map = map;
  }

  /**
   * Give a player one desk task plus random away-from-desk tasks.
   * Management gets an identical-looking list so they can pretend to work;
   * their "completions" never count towards anything.
   */
  assign(player) {
    const deskTasks = shuffle(TASKS.filter((t) => t.desk));
    const awayTasks = shuffle(TASKS.filter((t) => !t.desk));
    const picked = [deskTasks[0], ...awayTasks.slice(0, TASKS_PER_WORKER - 1)];
    player.tasks = picked.map((t) => ({ id: t.id, done: false }));
    player.activeTask = null;
    player.selfDirty = true;
  }

  allDone(player) {
    return player.tasks.length > 0 && player.tasks.every((t) => t.done);
  }

  /** Does this object satisfy the task's target for this player? */
  matches(player, task, object) {
    if (task.target === 'own_desk') return object.type === 'desk' && object.id === player.deskId;
    return object.type === task.target;
  }

  inRange(player, object) {
    return distPointRect(player.x, player.y, object) <= INTERACT_RANGE;
  }

  /**
   * Try to begin a task at an object. Returns { ok, reason?, task? }.
   * Caller has already checked the phase and that the player is active.
   */
  start(player, object, now) {
    if (!this.inRange(player, object)) return { ok: false, reason: 'Too far away.' };

    const entry = player.tasks.find((t) => !t.done && this.matches(player, TASKS_BY_ID.get(t.id), object));
    if (!entry) {
      if (object.type === 'desk' && object.id !== player.deskId) return { ok: false, reason: "That's not your desk." };
      return { ok: false, reason: 'Nothing on your list here.' };
    }

    const def = TASKS_BY_ID.get(entry.id);
    this.startTimed(player, object, def, now);
    return { ok: true, task: def };
  }

  /** Begin a timed hold for a task or an action (see ACTIONS in tasks.js). */
  startTimed(player, object, def, now) {
    player.activeTask = { taskId: def.id, objectId: object.id, startedAt: now, duration: def.duration };
    player.selfDirty = true;
  }

  cancel(player) {
    if (player.activeTask) {
      player.activeTask = null;
      player.selfDirty = true;
    }
  }

  /**
   * Advance a player's active task. Returns the finished task (or action)
   * definition when it completes this tick, otherwise null. Walking out of range
   * cancels it.
   */
  update(player, now) {
    const active = player.activeTask;
    if (!active) return null;

    const object = this.map.getInteractable(active.objectId);
    if (!object || !this.inRange(player, object)) {
      this.cancel(player);
      return null;
    }
    if (now - active.startedAt < active.duration) return null;

    const entry = player.tasks.find((t) => t.id === active.taskId);
    if (entry) entry.done = true;
    player.activeTask = null;
    player.selfDirty = true;
    return TIMED_BY_ID.get(active.taskId);
  }

  /** Private, per-player view of the task list. */
  serialize(player, now) {
    const a = player.activeTask;
    return {
      tasks: player.tasks.map((t) => ({ id: t.id, done: t.done })),
      active: a ? { taskId: a.taskId, objectId: a.objectId, progress: Math.min(1, (now - a.startedAt) / a.duration) } : null,
    };
  }
}
