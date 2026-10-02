/**
 * TaskSystem — hands out tasks progressively and runs timed interactions.
 *
 * Tasks arrive one at a time during the workday (Game decides WHEN; this class
 * decides WHICH, using each task's `chance` weight from shared/tasks.js).
 *
 * A task is only completed if the player stays within range of the target for
 * the full duration. The client just shows a progress bar; the server owns the
 * timer, so a modified client cannot finish tasks instantly or remotely.
 */
import { TASKS, TASKS_BY_ID, taskVersion } from '../../shared/tasks.js';
import { INTERACT_RANGE } from '../../shared/constants.js';
import { canReach } from '../../shared/sight.js';
import { pickWeighted, randomInt } from './random.js';
import { MINIGAMES } from '../../shared/minigames/index.js';

const rand = () => randomInt(2 ** 30) / 2 ** 30;

export class TaskSystem {
  constructor(map, catalogue = TASKS) {
    this.map = map;
    this.catalogue = catalogue.filter((t) => t.chance > 0);
  }

  /** Clear a player's list at the start of a match. */
  reset(player) {
    player.tasks = [];
    player.taskHistory = new Set();
    player.activeTask = null;
    player.selfDirty = true;
  }

  /**
   * Give the player one new task, drawn by chance. Never repeats a task they've
   * already had this match unless the catalogue is exhausted; never duplicates a
   * task that's still on their list. Returns the task definition (or null).
   */
  issueNext(player) {
    const pending = new Set(player.tasks.filter((t) => !t.done).map((t) => t.id));
    let pool = this.catalogue.filter((t) => !player.taskHistory.has(t.id));
    if (!pool.length) pool = this.catalogue.filter((t) => !pending.has(t.id));
    const def = pickWeighted(pool, (t) => t.chance);
    if (!def) return null;
    player.tasks.push({ id: def.id, done: false });
    player.taskHistory.add(def.id);
    player.selfDirty = true;
    return def;
  }

  /** True when every task of the day has been handed out AND finished. */
  allDone(player, totalForDay) {
    return player.tasks.length >= totalForDay && player.tasks.every((t) => t.done);
  }

  /** Does this object satisfy the task's target for this player? */
  matches(player, task, object) {
    if (task.target === 'own_desk') return object.type === 'desk' && object.id === player.deskId;
    return object.type === task.target;
  }

  inRange(player, object) {
    return canReach(this.map, player.x, player.y, object, INTERACT_RANGE);
  }

  /**
   * Try to begin a task at an object. Returns { ok, reason?, task? }.
   * Caller has already checked the phase and that the player is active.
   * `breakRule(def)` returns a reason string if a break-only task can't be done yet.
   */
  start(player, object, now, breakRule = () => null) {
    if (!this.inRange(player, object)) return { ok: false, reason: 'Too far away.' };

    const entry = player.tasks.find((t) => !t.done && this.matches(player, TASKS_BY_ID.get(t.id), object));
    // Same task, but your role decides which version you do.
    if (!entry) {
      if (object.type === 'desk' && object.id !== player.deskId) return { ok: false, reason: "That's not your desk." };
      return { ok: false, reason: 'Nothing on your list here.' };
    }

    const def = taskVersion(TASKS_BY_ID.get(entry.id), player.role);
    if (def.during === 'break') {
      const wait = breakRule(def);
      if (wait) return { ok: false, reason: wait };
    }
    player.activeTask = { taskId: def.id, objectId: object.id, startedAt: now, duration: def.duration };
    // Task window: the server makes the puzzle and keeps the answer.
    if (def.minigame && MINIGAMES[def.minigame]) {
      player.activeTask.minigame = def.minigame;
      player.activeTask.puzzle = MINIGAMES[def.minigame].generate(rand, def.variant);
    }
    player.selfDirty = true;
    return { ok: true, task: def };
  }

  cancel(player) {
    if (player.activeTask) {
      player.activeTask = null;
      player.selfDirty = true;
    }
  }

  /**
   * Advance a player's active task. Returns the finished task definition when it
   * completes this tick, otherwise null. Walking out of range cancels it.
   */
  update(player, now) {
    const active = player.activeTask;
    if (!active) return null;

    const object = this.map.getInteractable(active.objectId);
    if (!object || !this.inRange(player, object)) {
      this.cancel(player);
      return null;
    }
    if (active.minigame) return null; // finished by solving it, see submitMinigame()
    if (now - active.startedAt < active.duration) return null;
    return this.completeActive(player);
  }

  completeActive(player) {
    const active = player.activeTask;
    const entry = player.tasks.find((t) => t.id === active.taskId && !t.done);
    if (entry) entry.done = true;
    player.activeTask = null;
    player.selfDirty = true;
    return taskVersion(TASKS_BY_ID.get(active.taskId), player.role);
  }

  /**
   * Check a task-window answer without finishing anything: { ok, reason? }.
   * The player must still be at the object; answers that come back impossibly
   * fast are refused; any valid solution counts.
   */
  checkMinigame(player, answer, now = Infinity) {
    const active = player.activeTask;
    if (!active?.minigame) return { ok: false };
    const game = MINIGAMES[active.minigame];
    if (now - active.startedAt < game.minMs(active.puzzle)) return { ok: false, reason: 'Too quick! Take a second look.' };
    const object = this.map.getInteractable(active.objectId);
    if (!object || !this.inRange(player, object)) { this.cancel(player); return { ok: false, reason: 'You walked away.' }; }
    if (!game.check(active.puzzle, answer)) return { ok: false, reason: 'Not quite right. Try again.' };
    return { ok: true };
  }

  /** Check and finish in one go (for simple task windows). */
  submitMinigame(player, answer, now = Infinity) {
    const res = this.checkMinigame(player, answer, now);
    return res.ok ? { ok: true, task: this.completeActive(player) } : res;
  }

  /** Private, per-player view of the task list. */
  serialize(player, now) {
    const a = player.activeTask;
    return {
      tasks: player.tasks.map((t) => ({ id: t.id, done: t.done })),
      active: !a ? null : a.minigame
        ? { taskId: a.taskId, objectId: a.objectId, progress: 0, minigame: a.minigame, puzzle: MINIGAMES[a.minigame].publicView(a.puzzle) }
        : { taskId: a.taskId, objectId: a.objectId, progress: Math.min(1, (now - a.startedAt) / a.duration) },
    };
  }
}
