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
import { mountMicrowave } from './microwave.js';
import { mountCatfood } from './catfood.js';
import { mountEmail } from './email.js';
import { mountRecycling } from './recycling.js';
import { mountCopier } from './copier.js';
import { mountWhiteboard } from './whiteboard.js';
import { mountToilet } from './toilet.js';
import { mountCoffee } from './coffee.js';
import { mountCooler } from './cooler.js';
import { mountPrank } from './prank.js';
import { TASKS_BY_ID, taskVersion } from '../../shared/tasks.js';

// sub: [productive subtitle, slacker subtitle]
const UIS = {
  fridge:     { mount: mountFridge,     sub: ['It\u2019s packed. Rearrange your coworkers\u2019 food until your lunch fits, then close the door.', 'Find the right lunch, drag it out, eat it. Leave no trace.'] },
  microwave:  { mount: mountMicrowave,  sub: ['Food in, time from the sticky note, Start. Then come back when it dings.', 'Fish in. Way too long. Start. Then walk away.'] },
  catfood:    { mount: mountCatfood,    sub: ['Scoop food from the can into Mittens\u2019 bowl.', 'Mittens deserves more. Much, much more.'] },
  email:      { mount: mountEmail,      sub: ['Open each work email and reply.', 'Open every chain email and forward it to All Staff.'] },
  recycling:  { mount: mountRecycling,  sub: ['Everything in the box goes in the blue bin.', 'Bins are for quitters. The parking lot is right there.'] },
  copier:     { mount: mountCopier,     sub: ['Copy every document in the stack.', 'Copy every document in the stack. Don\u2019t read them. (Read them.)'] },
  whiteboard: { mount: mountWhiteboard, sub: ['Trace the dotted lines. Make the team proud.', 'Trace the dotted lines. Nobody will know it was you.'] },
  toilet:     { mount: mountToilet,     sub: ['Stock the holder with fresh rolls.', 'Everything goes in. Then flush. Then leave very quickly.'] },
  cooler:     { mount: mountCooler,     sub: ['Fill the cup to the lines. Not over.', 'Nobody will suspect the water cooler.'] },
  prank:      { mount: mountPrank,      sub: ['', 'Their computer, your masterpiece. IT will find it at 5 PM.'] },
  coffee:     { mount: mountCoffee,     sub: ['Follow the recipe on the sticky note, then Brew.', 'There\u2019s one cup left. It\u2019s yours now.'] },
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
    const key = `${a.taskId}:${JSON.stringify(a.puzzle)}`;
    if (key === this.key) return;
    this.close();
    this.key = key;
    const def = TASKS_BY_ID.get(a.taskId);
    const slacker = a.puzzle?.variant === 'slacker';
    document.getElementById('taskwin-title').textContent = def ? taskVersion(def, slacker ? 'slacker' : 'productive').label : 'Task';
    document.getElementById('taskwin-sub').textContent = ui.sub[slacker ? 1 : 0];
    document.querySelector('.taskwin').classList.toggle('is-slacker', slacker);
    this.instance = ui.mount(this.body, a.puzzle, {
      submit: (answer) => this.h.onSubmit(answer),
      progress: (data) => this.h.onProgress?.(data),
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
