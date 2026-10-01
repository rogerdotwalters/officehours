/**
 * TaskWindow — the popup for mini-game tasks.
 *
 * Opens when the server says your active task is a mini-game (SELF.active.minigame),
 * closes when that task ends (solved, cancelled, or you walked away). The window
 * itself is generic; each mini-game supplies a mount function:
 *
 *   mount(root, puzzle, { submit(answer), isTouch }) -> { destroy(), onKey?(event) }
 *
 * To add a mini-game: write client/js/minigames/<name>.js exporting mount, add it
 * to UIS below, and add the server side in shared/minigames/.
 */
import { mountFridge } from './fridge.js';
import { TASKS_BY_ID } from '../../shared/tasks.js';

const UIS = {
  fridge: { mount: mountFridge, sub: 'Coworkers\u2019 food everywhere. Rotate your things to make them fit, then close the door.' },
};

export class TaskWindow {
  /** @param {{ onSubmit(answer), onClose() }} handlers */
  constructor(handlers) {
    this.h = handlers;
    this.overlay = document.getElementById('overlay-task');
    this.body = document.getElementById('taskwin-body');
    this.key = null;
    this.instance = null;
    document.getElementById('taskwin-close').addEventListener('click', () => this.h.onClose());
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.key === 'Escape') { e.preventDefault(); this.h.onClose(); return; }
      this.instance?.onKey?.(e);
    });
  }

  get isOpen() {
    return !this.overlay.hidden;
  }

  /** Call whenever private state arrives. */
  sync(self) {
    const a = self?.active;
    const ui = a?.minigame && UIS[a.minigame];
    if (!ui) return this.close();
    const key = `${a.taskId}:${JSON.stringify(a.puzzle.pieces)}`;
    if (key === this.key) return;
    this.close();
    this.key = key;
    document.getElementById('taskwin-title').textContent = TASKS_BY_ID.get(a.taskId)?.label ?? 'Task';
    document.getElementById('taskwin-sub').textContent = ui.sub;
    this.instance = ui.mount(this.body, a.puzzle, {
      submit: (answer) => this.h.onSubmit(answer),
      isTouch: document.body.classList.contains('is-touch'),
    });
    this.overlay.hidden = false;
  }

  close() {
    this.instance?.destroy?.();
    this.instance = null;
    this.key = null;
    this.body.replaceChildren();
    this.overlay.hidden = true;
  }
}
