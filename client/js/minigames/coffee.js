/**
 * Coffee: scoop grounds from the canister into the filter (as many as the
 * recipe says), then press Brew.
 */
import { el, draggable, over } from './kit.js';

export function mountCoffee(root, puzzle, { submit }) {
  const need = puzzle.scoops;
  let scoops = 0;
  let full = false;
  let brewing = false;
  let sent = false;

  const canister = el('div', { class: 'cof-can', 'aria-label': 'Canister of coffee grounds' },
    el('span', { class: 'cof-can__lid' }), el('span', { class: 'cof-can__grounds' }), el('span', { class: 'cof-can__label' }, 'GROUNDS'));
  const scoopFill = el('span', { class: 'cof-scoop__fill' });
  const scoop = el('div', { class: 'cof-scoop', 'aria-label': 'Scoop' }, el('span', { class: 'cof-scoop__cup' }, scoopFill), el('span', { class: 'cof-scoop__handle' }));
  const filterFill = el('span', { class: 'cof-filter__fill' });
  const filter = el('div', { class: 'cof-filter', 'aria-label': 'Coffee filter' }, filterFill);
  const led = el('span', { class: 'cof-led' });
  const brewBtn = el('button', { type: 'button', class: 'cof-brew', onclick: () => brew() }, 'BREW');
  const potFill = el('span', { class: 'cof-pot__fill' });
  const maker = el('div', { class: 'cof-maker' },
    el('div', { class: 'cof-top' }, filter),
    el('div', { class: 'cof-body' }, el('div', { class: 'cof-panel' }, led, brewBtn), el('span', { class: 'cof-drip' }),
      el('div', { class: 'cof-pot' }, potFill)));
  const note = el('div', { class: 'cof-note' }, el('b', {}, `${need} scoops`), puzzle.note, el('i', {}, `\u2014 ${puzzle.by}`));
  const count = el('p', { class: 'cf-count' });
  const status = el('p', { class: 'fridge__hint' });
  root.append(el('div', { class: 'cofwrap' },
    el('div', { class: 'cof-scene' }, el('div', { class: 'cof-left' }, canister, el('div', { class: 'cof-rest' }, scoop)), maker, note),
    count, status));

  draggable(scoop, {
    onStart: () => !brewing,
    onMove(e) {
      if (!full && over(canister, e.clientX, e.clientY, -4)) { full = true; render(); }
      filter.classList.toggle('is-hover', full && over(filter, e.clientX, e.clientY, 12));
    },
    onEnd(e) {
      filter.classList.remove('is-hover');
      let msg = null;
      if (full && over(filter, e.clientX, e.clientY, 12)) {
        if (scoops >= need) msg = 'That\u2019s enough. Even Gary has limits.';
        else { scoops++; full = false; }
      }
      render();
      if (msg) status.textContent = msg;
    },
  });

  function brew() {
    if (brewing || sent) return;
    if (scoops < need) {
      status.textContent = scoops ? `Too weak. The recipe says ${need} scoops.` : 'Put some grounds in first.';
      maker.classList.add('is-shake');
      setTimeout(() => maker.classList.remove('is-shake'), 350);
      return;
    }
    brewing = true;
    maker.classList.add('is-brewing');
    status.textContent = 'Brewing\u2026 it smells like a bad decision.';
    render();
    setTimeout(() => {
      sent = true;
      submit({ scoops, brewed: true });
      setTimeout(() => { sent = false; brewing = false; maker.classList.remove('is-brewing'); render(); }, 1500);
    }, 1500);
  }

  function render() {
    scoop.classList.toggle('is-full', full);
    filterFill.style.height = `${Math.min(1, scoops / need) * 80}%`;
    canister.style.setProperty('--left', `${Math.max(0.2, 1 - scoops / (need + 2))}`);
    led.classList.toggle('is-on', scoops >= need);
    count.textContent = `${scoops} of ${need} scoops`;
    if (!brewing) {
      status.textContent = scoops >= need ? 'Press BREW.' : full ? 'Now tip it into the filter.' : 'Drag the scoop into the canister to grab some grounds.';
    }
  }
  render();
  return { destroy() { root.replaceChildren(); }, onKey(e) { if (e.code === 'Enter') { e.preventDefault(); brew(); } } };
}
