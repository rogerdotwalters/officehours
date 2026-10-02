/**
 * Water cooler.
 *   productive: hold the tap to fill the cup between the lines, then drink
 *   slacker:    lid off, laxatives in, lid back on
 */
import { FILL_MIN, FILL_MAX } from '../../shared/minigames/cooler.js';
import { el, draggable, over } from './kit.js';

export function mountCooler(root, puzzle, opts) {
  return puzzle.variant === 'slacker' ? mountSpike(root, opts) : mountDrink(root, opts);
}

function cooler(extra = []) {
  return el('div', { class: 'wc-cooler' },
    el('div', { class: 'wc-bottle' }, el('span', { class: 'wc-water' }), ...extra),
    el('div', { class: 'wc-body' }));
}

function mountDrink(root, { submit }) {
  let level = 0;
  let holding = false;
  let spilled = false;
  let sent = false;
  let raf = 0;
  let last = 0;

  const fill = el('span', { class: 'wc-cup__fill' });
  const band = el('span', { class: 'wc-cup__band', style: `bottom:${FILL_MIN * 100}%;height:${(FILL_MAX - FILL_MIN) * 100}%` });
  const stream = el('span', { class: 'wc-stream' });
  const cup = el('div', { class: 'wc-cup', 'aria-label': 'Paper cup' }, band, fill);
  const tap = el('button', { type: 'button', class: 'wc-tap', 'aria-label': 'Hold to fill' }, 'Hold to fill');
  const drink = el('button', { type: 'button', class: 'btn btn--primary', onclick: () => doDrink() }, 'Drink');
  const empty = el('button', { type: 'button', class: 'btn btn--small', onclick: () => { level = 0; spilled = false; render(); } }, 'Empty the cup');
  const status = el('p', { class: 'fridge__hint' });
  const machine = cooler();
  root.append(el('div', { class: 'wcwrap' },
    el('div', { class: 'wc-scene' }, machine, el('div', { class: 'wc-under' }, stream, cup)),
    el('div', { class: 'fridge__controls wc-controls' }, tap, drink, empty), status));

  const start = (e) => { e.preventDefault(); if (sent || spilled) return; holding = true; last = performance.now(); loop(); };
  const stop = () => { holding = false; cancelAnimationFrame(raf); render(); };
  tap.addEventListener('pointerdown', start);
  tap.addEventListener('pointerup', stop);
  tap.addEventListener('pointerleave', stop);
  tap.addEventListener('pointercancel', stop);

  function loop() {
    const now = performance.now();
    level += ((now - last) / 1000) * 0.38;     // fills in about 2.5 s
    last = now;
    if (level > 1) { level = 1; spilled = true; holding = false; }
    render();
    if (holding) raf = requestAnimationFrame(loop);
  }

  function doDrink() {
    if (sent || level < FILL_MIN || level > FILL_MAX || spilled) return;
    sent = true;
    fill.style.height = '0%';
    status.textContent = 'Refreshing.';
    setTimeout(() => submit({ level, drank: true }), 400);
  }

  function render() {
    fill.style.height = `${level * 100}%`;
    stream.classList.toggle('is-on', holding);
    cup.classList.toggle('is-spilled', spilled);
    const ok = level >= FILL_MIN && level <= FILL_MAX && !spilled;
    drink.disabled = !ok || sent;
    empty.hidden = !spilled && level < FILL_MIN;
    if (!sent) {
      status.textContent = spilled ? 'You overfilled it. Water everywhere. Empty the cup and try again.'
        : holding ? 'Filling\u2026' : ok ? 'Perfect. Drink up.' : level > 0 ? 'Fill it up to the lines.' : 'Hold the tap to fill your cup up to the lines.';
    }
  }
  render();
  return { destroy() { cancelAnimationFrame(raf); root.replaceChildren(); } };
}

function mountSpike(root, { submit }) {
  let lidOff = false, poured = false, lidOn = false, sent = false;
  const lid = el('div', { class: 'wc-lid', 'aria-label': 'Tank lid' });
  const lidSpot = el('div', { class: 'wc-lidspot', 'aria-label': 'Put the lid here' });
  const bottle = el('div', { class: 'wc-lax', 'aria-label': 'Laxatives' }, el('span', { class: 'wc-lax__cap' }), el('span', { class: 'wc-lax__label' }, 'EXPRESS', el('small', {}, 'LAX')));
  const machine = cooler([lid]);
  const tankTop = machine.querySelector('.wc-bottle');
  const status = el('p', { class: 'fridge__hint' });
  root.append(el('div', { class: 'wcwrap' },
    el('div', { class: 'wc-scene wc-scene--spike' }, machine, el('div', { class: 'wc-side' }, lidSpot, bottle)), status));

  draggable(lid, {
    onStart: () => !sent && !lidOn,
    onEnd(e) {
      if (!lidOff && over(lidSpot, e.clientX, e.clientY, 30)) { lidOff = true; lidSpot.append(lid); }
      else if (lidOff && poured && over(tankTop, e.clientX, e.clientY, 20)) { lidOn = true; tankTop.append(lid); }
      render();
    },
  });
  draggable(bottle, {
    onStart: () => !sent && lidOff && !poured,
    onMove(e) {
      if (!poured && lidOff && over(tankTop, e.clientX, e.clientY, 10)) {
        poured = true;
        machine.classList.add('is-spiked');
        render();
      }
    },
  });

  function render() {
    status.textContent = !lidOff ? 'Pull the lid off the tank (drag it to the side).'
      : !poured ? 'Tip the laxatives into the tank.'
        : !lidOn ? 'Put the lid back on. Nobody needs to know.' : 'Perfect. Now walk away.';
    bottle.classList.toggle('is-empty', poured);
    if (lidOff && poured && lidOn && !sent) {
      sent = true;
      setTimeout(() => submit({ lidOff: true, poured: true, lidOn: true }), 500);
    }
  }
  render();
  return { destroy() { root.replaceChildren(); } };
}
