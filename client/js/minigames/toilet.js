/**
 * Clog the toilet: drag everything on the shelf into the bowl, then flush.
 * What happens next is not our problem.
 */
import { ITEMS_BY_ID, itemUrl } from '../../shared/minigames/items.js';
import { el, draggable, over } from './kit.js';

const setHidden = (node, hidden) => { node.hidden = hidden; };

export function mountToilet(root, puzzle, { submit }) {
  const productive = puzzle.variant !== 'slacker';
  const dropped = [];
  let flushed = false;
  let sent = false;

  const shelf = el('div', { class: 'tl-shelf', 'aria-label': 'Things you found around the office' });
  const pile = el('div', { class: 'tl-pile' });
  const water = el('span', { class: 'tl-water' });
  const bowl = el('div', { class: 'tl-bowl', 'aria-label': 'Toilet bowl' }, water, pile);
  const handle = el('button', { type: 'button', class: 'tl-handle', 'aria-label': 'Flush', onclick: () => flush() });
  const holder = el('div', { class: 'tl-holder', 'aria-label': 'Toilet paper holder' }, el('span', { class: 'tl-holder__bar' }));
  const target = productive ? holder : bowl;
  const toilet = el('div', { class: 'tl-toilet' },
    productive ? holder : null,
    el('div', { class: 'tl-tank' }, el('span', { class: 'tl-lid' }), handle),
    bowl,
    el('span', { class: 'tl-base' }),
    el('span', { class: 'tl-puddle' }));
  const flushBtn = el('button', { type: 'button', class: 'btn btn--primary tl-flush', onclick: () => flush() }, 'Flush');
  const count = el('p', { class: 'cf-count' });
  const status = el('p', { class: 'fridge__hint' });
  root.append(el('div', { class: 'tlwrap' },
    el('div', { class: 'tl-scene' }, el('div', { class: 'tl-shelfwrap' }, el('p', { class: 'fridge__label' }, productive ? 'Fresh rolls' : 'Found around the office'), shelf), toilet),
    el('div', { class: 'tl-controls' }, count, flushBtn),
    status));

  for (const it of puzzle.items) {
    const def = ITEMS_BY_ID.get(it.item);
    const node = el('div', { class: 'tl-item', title: def.name, 'aria-label': def.name, style: `width:${Math.min(def.w * 1.15, 110)}px` },
      el('img', { src: itemUrl(def), alt: '', draggable: 'false' }));
    shelf.append(node);
    draggable(node, {
      onStart: () => !flushed && !dropped.includes(it.key),
      onMove(e) { target.classList.toggle('is-hover', over(target, e.clientX, e.clientY, 14)); },
      onEnd(e) {
        target.classList.remove('is-hover');
        if (!over(target, e.clientX, e.clientY, 14)) return;
        dropped.push(it.key);
        node.remove();
        if (productive) {
          holder.append(el('img', { src: itemUrl(def), alt: '', draggable: 'false', class: 'tl-roll' }));
          render();
          if (dropped.length === puzzle.items.length && !sent) {
            sent = true;
            status.textContent = 'Fully stocked. A true hero.';
            setTimeout(() => submit({ dropped, flushed: false }), 500);
          }
          return;
        }
        // Pile it up in the bowl, a bit wonky.
        const n = dropped.length;
        const img = el('img', {
          src: itemUrl(def), alt: '', draggable: 'false', class: 'tl-in',
          style: `width:${Math.min(def.w * 0.7, 64)}px;left:${18 + ((n * 37) % 56)}%;bottom:${10 + n * 7}%;--r:${((n * 53) % 70) - 35}deg`,
        });
        pile.append(img);
        bowl.classList.add('is-plop');
        setTimeout(() => bowl.classList.remove('is-plop'), 300);
        render();
      },
    });
  }

  function flush() {
    if (flushed || sent) return;
    if (dropped.length < puzzle.items.length) {
      status.textContent = 'Not clogged enough yet. Put everything in first.';
      toilet.classList.add('is-shake');
      setTimeout(() => toilet.classList.remove('is-shake'), 350);
      return;
    }
    flushed = true;
    toilet.classList.add('is-flushing');
    status.textContent = 'Uh oh.';
    setTimeout(() => {
      toilet.classList.add('is-overflowing');
      status.textContent = 'Oh no. Oh no no no. Walk away casually.';
    }, 700);
    setTimeout(() => {
      sent = true;
      submit({ dropped, flushed: true });
      setTimeout(() => { sent = false; }, 1500);
    }, 1500);
    render();
  }

  function render() {
    const all = dropped.length === puzzle.items.length;
    count.textContent = `${dropped.length} of ${puzzle.items.length} in the bowl`;
    if (productive) {
      count.textContent = `${dropped.length} of ${puzzle.items.length} rolls stocked`;
      setHidden(flushBtn, true);
      if (!sent) status.textContent = 'Drag each roll onto the holder by the toilet.';
      return;
    }
    flushBtn.disabled = !all || flushed;
    handle.classList.toggle('is-ready', all && !flushed);
    if (!flushed) status.textContent = all ? 'Perfect. Now flush.' : 'Drag everything into the toilet.';
    water.style.setProperty('--level', `${30 + dropped.length * 8}%`);
  }
  render();
  return { destroy() { root.replaceChildren(); } };
}
