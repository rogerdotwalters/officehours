/**
 * Microwave: drag the food into the microwave, type the time from its sticky
 * note on the keypad, press Start.
 */
import { ITEMS_BY_ID, itemUrl } from '../../shared/minigames/items.js';
import { codeToClock } from '../../shared/minigames/microwave.js';
import { el, draggable, over } from './kit.js';

export function mountMicrowave(root, puzzle, { submit }) {
  const food = ITEMS_BY_ID.get(puzzle.food);
  let inside = false;
  let digits = '';
  let sent = false;

  const foodNode = el('div', { class: 'mw-food', 'aria-label': food.name },
    el('img', { src: itemUrl(food), alt: '', draggable: 'false' }),
    el('span', { class: 'mw-note' }, el('b', {}, `Heat ${codeToClock(puzzle.code)}`), puzzle.note));
  const counter = el('div', { class: 'mw-counter' }, foodNode);
  const windowEl = el('div', { class: 'mw-window' }, el('span', { class: 'mw-plate' }));
  const display = el('output', { class: 'mw-display', 'aria-live': 'polite' }, '0:00');
  const status = el('p', { class: 'fridge__hint' });
  const key = (label, fn, cls = '') => el('button', { type: 'button', class: `mw-key ${cls}`, onclick: fn }, label);
  const keypad = el('div', { class: 'mw-keypad' },
    ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => key(d, () => press(d))),
    key('Clear', () => { digits = ''; render(); }, 'mw-key--small'),
    key('0', () => press('0')),
    key('Start', () => start(), 'mw-key--start'));
  const micro = el('div', { class: 'mw' }, windowEl, el('div', { class: 'mw-panel' }, display, keypad));
  root.append(el('div', { class: 'mwwrap' }, micro, counter, status));

  draggable(foodNode, {
    onStart: () => !sent,
    onEnd(e) {
      if (over(windowEl, e.clientX, e.clientY, 10)) inside = true;
      else if (over(counter, e.clientX, e.clientY, 30)) inside = false;
      render();
    },
  });

  function press(d) {
    if (sent || digits.length >= 4) return;
    if (!digits && d === '0') return;
    digits += d;
    render();
  }

  function start() {
    if (sent) return;
    if (!inside) { status.textContent = 'Put the food in first.'; micro.classList.add('is-shake'); setTimeout(() => micro.classList.remove('is-shake'), 400); return; }
    if (!digits) { status.textContent = 'Type the time on the sticky note.'; return; }
    sent = true;
    micro.classList.add('is-on');
    submit({ inside: true, code: digits });
    render();
    setTimeout(() => { sent = false; micro.classList.remove('is-on'); render(); }, 2200);
  }

  function render() {
    (inside ? windowEl : counter).append(foodNode);
    micro.classList.toggle('is-loaded', inside);
    display.textContent = sent ? 'HEAT' : digits ? codeToClock(digits) : '0:00';
    if (!sent) {
      status.textContent = !inside
        ? 'Drag the food into the microwave.'
        : 'Now type the time from the sticky note and press Start. Then wait for the ding.';
    }
  }
  render();
  return {
    destroy() { root.replaceChildren(); },
    onKey(e) {
      if (/^Digit\d$/.test(e.code)) press(e.code.slice(5));
      else if (e.code === 'Backspace') { digits = digits.slice(0, -1); render(); }
      else if (e.code === 'Enter') start();
    },
  };
}
