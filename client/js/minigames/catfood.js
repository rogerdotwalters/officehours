/**
 * Cat food: drag the spoon into the can to scoop, then over the bowl to drop
 * it in. Repeat until the bowl's full.
 */
import { el, svg, draggable, over } from './kit.js';

export function mountCatfood(root, puzzle, { submit }) {
  const need = puzzle.scoops;
  let done = 0;
  let full = false;
  let sent = false;

  const can = el('div', { class: 'cf-can', 'aria-label': 'Can of cat food' },
    el('span', { class: 'cf-can__food' }), el('span', { class: 'cf-can__label' }, 'MEOW', el('small', {}, 'chunks in gravy')));
  const bowlFill = el('span', { class: 'cf-bowl__food' });
  const bowl = el('div', { class: 'cf-bowl', 'aria-label': 'Cat bowl' }, bowlFill, el('span', { class: 'cf-bowl__name' }, 'MITTENS'));
  const cat = svg('svg', { class: 'cf-cat', viewBox: '0 0 100 80', 'aria-hidden': 'true' },
    svg('path', { d: 'M18 30 L26 6 L40 24 L60 24 L74 6 L82 30 Q92 70 50 76 Q8 70 18 30 Z', fill: '#e08a3c', stroke: '#1d2742', 'stroke-width': 3 }),
    svg('circle', { cx: 38, cy: 44, r: 5, fill: '#1d2742' }), svg('circle', { cx: 62, cy: 44, r: 5, fill: '#1d2742' }),
    svg('path', { d: 'M46 56 L54 56 L50 61 Z', fill: '#e56aa8' }),
    svg('path', { d: 'M20 54 L4 50 M20 60 L4 64 M80 54 L96 50 M80 60 L96 64', stroke: '#1d2742', 'stroke-width': 2 }));
  const spoonFood = el('span', { class: 'cf-spoon__food' });
  const spoon = el('div', { class: 'cf-spoon', 'aria-label': 'Spoon' }, el('span', { class: 'cf-spoon__head' }, spoonFood), el('span', { class: 'cf-spoon__handle' }));
  const rest = el('div', { class: 'cf-rest' }, spoon);
  const count = el('p', { class: 'cf-count' });
  const status = el('p', { class: 'fridge__hint' });
  root.append(el('div', { class: 'cfwrap' }, el('div', { class: 'cf-scene' }, can, rest, el('div', { class: 'cf-bowlwrap' }, cat, bowl)), count, status));

  draggable(spoon, {
    onStart: () => !sent,
    onMove(e) {
      // Dipping into the can picks up a scoop.
      if (!full && over(can, e.clientX, e.clientY, -6)) { full = true; render(); }
    },
    onEnd(e) {
      if (full && over(bowl, e.clientX, e.clientY, 16)) {
        full = false;
        done++;
        bowl.classList.add('is-plop');
        setTimeout(() => bowl.classList.remove('is-plop'), 300);
      }
      render();
      if (done >= need && !sent) {
        sent = true;
        submit({ scoops: done });
        setTimeout(() => { sent = false; }, 1500);
      }
    },
  });

  function render() {
    spoon.classList.toggle('is-full', full);
    bowlFill.style.height = `${Math.min(1, done / need) * 70}%`;
    can.style.setProperty('--left', `${Math.max(0.15, 1 - done / need)}`);
    count.textContent = `${done} of ${need} scoops`;
    status.textContent = done >= need ? 'Bon app\u00e9tit, Mittens.'
      : full ? 'Now tip it into the bowl.' : 'Drag the spoon into the can to scoop some food.';
    cat.classList.toggle('is-happy', done >= need);
  }
  render();
  return { destroy() { root.replaceChildren(); } };
}
