/**
 * Input — keyboard (WASD / arrows), mouse clicks on the canvas, and an optional
 * on-screen joystick for touch devices. Produces a direction and fires callbacks;
 * it never talks to the network directly.
 */

const KEY_DIRS = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1],  ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0],  ArrowRight: [1, 0],
};

function isTyping() {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export class Input {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ onInteract, onReport, onCancel, onTerminal, onClick }} callbacks
   */
  constructor(canvas, callbacks) {
    this.canvas = canvas;
    this.cb = callbacks;
    this.held = new Set();
    this.stick = { dx: 0, dy: 0 };
    this.enabled = false;

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());

    canvas.addEventListener('click', (e) => {
      if (!this.enabled) return;
      const rect = canvas.getBoundingClientRect();
      this.cb.onClick?.(e.clientX - rect.left, e.clientY - rect.top);
    });

    this.setupTouch();
  }

  onKeyDown(e) {
    if (!this.enabled || isTyping()) return;
    if (KEY_DIRS[e.code]) {
      this.held.add(e.code);
      e.preventDefault();
      return;
    }
    if (e.repeat) return;
    if (e.code === 'KeyE' || e.code === 'Space') { e.preventDefault(); this.cb.onInteract?.(); }
    else if (e.code === 'KeyR') this.cb.onReport?.();
    else if (e.code === 'KeyT') { e.preventDefault(); this.cb.onTerminal?.(); }
    else if (e.code === 'Escape' || e.code === 'KeyQ') this.cb.onCancel?.();
  }

  /** Current movement direction, each axis in {-1, 0, 1}. */
  direction() {
    if (!this.enabled || isTyping()) return { dx: 0, dy: 0 };
    let dx = this.stick.dx;
    let dy = this.stick.dy;
    for (const code of this.held) {
      dx += KEY_DIRS[code][0];
      dy += KEY_DIRS[code][1];
    }
    return { dx: Math.sign(dx), dy: Math.sign(dy) };
  }

  // ---- Touch joystick -------------------------------------------------------
  setupTouch() {
    const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    if (!isTouch) return;
    document.body.classList.add('is-touch');

    const base = document.getElementById('touch-stick');
    const knob = base.querySelector('.touch-stick__knob');
    const use = document.getElementById('touch-use');
    base.hidden = false;
    use.hidden = false;

    let pointerId = null;
    const reset = () => {
      pointerId = null;
      this.stick = { dx: 0, dy: 0 };
      knob.style.transform = '';
    };
    const update = (e) => {
      const r = base.getBoundingClientRect();
      const x = e.clientX - (r.left + r.width / 2);
      const y = e.clientY - (r.top + r.height / 2);
      const max = r.width / 2 - 20;
      const len = Math.hypot(x, y);
      const k = len > max ? max / len : 1;
      knob.style.transform = `translate(${x * k}px, ${y * k}px)`;
      if (len < 14) { this.stick = { dx: 0, dy: 0 }; return; }
      // Snap to 8 directions, matching the keyboard.
      const angle = Math.round(Math.atan2(y, x) / (Math.PI / 4)) * (Math.PI / 4);
      this.stick = { dx: Math.round(Math.cos(angle)), dy: Math.round(Math.sin(angle)) };
    };

    base.addEventListener('pointerdown', (e) => {
      pointerId = e.pointerId;
      base.setPointerCapture(e.pointerId);
      update(e);
    });
    base.addEventListener('pointermove', (e) => e.pointerId === pointerId && update(e));
    base.addEventListener('pointerup', reset);
    base.addEventListener('pointercancel', reset);

    use.addEventListener('click', () => this.enabled && this.cb.onInteract?.());
  }
}
