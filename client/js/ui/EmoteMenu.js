/**
 * EmoteMenu: hold the emote button and the emotes pop out in a ring of bubbles
 * around it; drag onto one and let go to send it. Let go in the middle to
 * cancel. A quick tap opens the ring instead, then tap a bubble. Keyboard: G
 * opens it too.
 */
import { EMOTES } from '../../shared/emotes.js';

const RADIUS = 92;      // px from the centre of the ring to each bubble
const PICK_DIST = 44;   // how close the pointer has to be to a bubble
const TAP_MS = 220;

export class EmoteMenu {
  constructor({ onPick }) {
    this.onPick = onPick;
    this.btn = document.getElementById('emote-btn');
    this.ring = document.getElementById('emote-ring');
    this.open = false;
    this.sticky = false;     // opened with a tap; stays open until you pick
    this.hover = -1;
    this.center = { x: 0, y: 0 };

    this.bubbles = EMOTES.map((e, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'emote-bubble';
      b.textContent = e.glyph;
      b.title = e.label;
      b.setAttribute('aria-label', e.label);
      b.style.setProperty('--i', i);
      b.addEventListener('click', () => { if (this.sticky) this.pick(i); });
      this.ring.append(b);
      return b;
    });

    this.btn.addEventListener('pointerdown', (e) => this.press(e));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyG' && !e.repeat && !this.btn.hidden && !isTyping()) { e.preventDefault(); this.show(true); }
      else if (e.code === 'Escape' && this.open) this.hide();
    });
    window.addEventListener('pointerdown', (e) => {
      if (this.sticky && !this.ring.contains(e.target) && e.target !== this.btn) this.hide();
    });
  }

  setAvailable(on) {
    if (this.btn.hidden === !on) return;
    this.btn.hidden = !on;
    if (!on) this.hide();
  }

  press(e) {
    if (this.sticky) { this.hide(); return; }
    e.preventDefault();
    this.btn.setPointerCapture(e.pointerId);
    const started = performance.now();
    this.show(false);
    const move = (ev) => this.track(ev.clientX, ev.clientY);
    const up = () => {
      this.btn.removeEventListener('pointermove', move);
      this.btn.removeEventListener('pointerup', up);
      this.btn.removeEventListener('pointercancel', up);
      if (this.hover >= 0) this.pick(this.hover);
      else if (performance.now() - started < TAP_MS) this.sticky = true; // quick tap: keep it open
      else this.hide();
    };
    this.btn.addEventListener('pointermove', move);
    this.btn.addEventListener('pointerup', up);
    this.btn.addEventListener('pointercancel', up);
  }

  show(sticky) {
    // Centre the ring on the button, nudged inward so no bubble falls off screen.
    const r = this.btn.getBoundingClientRect();
    const pad = RADIUS + 34;
    this.center = {
      x: Math.min(window.innerWidth - pad, Math.max(pad, r.left + r.width / 2)),
      y: Math.min(window.innerHeight - pad, Math.max(pad, r.top + r.height / 2)),
    };
    this.ring.style.left = `${this.center.x}px`;
    this.ring.style.top = `${this.center.y}px`;
    const n = this.bubbles.length;
    this.bubbles.forEach((b, i) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      b.style.setProperty('--x', `${Math.cos(a) * RADIUS}px`);
      b.style.setProperty('--y', `${Math.sin(a) * RADIUS}px`);
    });
    this.ring.hidden = false;
    this.open = true;
    this.sticky = sticky;
    this.setHover(-1);
  }

  hide() {
    this.ring.hidden = true;
    this.open = false;
    this.sticky = false;
    this.setHover(-1);
  }

  track(x, y) {
    let best = -1, bestD = PICK_DIST;
    this.bubbles.forEach((b, i) => {
      const r = b.getBoundingClientRect();
      const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (d < bestD) { best = i; bestD = d; }
    });
    this.setHover(best);
  }

  setHover(i) {
    this.hover = i;
    this.bubbles.forEach((b, k) => b.classList.toggle('is-hover', k === i));
  }

  pick(i) {
    this.onPick(EMOTES[i].id);
    this.hide();
  }
}

function isTyping() {
  const a = document.activeElement;
  return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
}
