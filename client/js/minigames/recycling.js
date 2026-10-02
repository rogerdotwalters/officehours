/** Recycling: drag everything out of the box and into the recycling bin. */
import { ITEMS_BY_ID, itemUrl } from '../../shared/minigames/items.js';
import { el, draggable, over } from './kit.js';

export function mountRecycling(root, puzzle, { submit }) {
  const binned = new Set();
  let sent = false;

  const boxEl = el('div', { class: 'rc-box', 'aria-label': 'Box of recycling' }, el('span', { class: 'rc-box__flap' }));
  const slacker = puzzle.variant === 'slacker';
  const bin = slacker
    ? el('div', { class: 'rc-bin rc-ground', 'aria-label': 'The parking lot' }, el('span', { class: 'rc-ground__label' }, 'Just... here'))
    : el('div', { class: 'rc-bin', 'aria-label': 'Recycling bin' }, el('span', { class: 'rc-bin__lid' }), el('span', { class: 'rc-bin__mark' }, '\u267b'));
  const count = el('p', { class: 'cf-count' });
  const status = el('p', { class: 'fridge__hint' }, slacker ? 'Drag everything onto the parking lot. Who\u2019s going to know?' : 'Drag each item into the blue bin.');
  root.append(el('div', { class: 'rcwrap' }, el('div', { class: 'rc-scene' }, boxEl, bin), count, status));

  for (const it of puzzle.items) {
    const def = ITEMS_BY_ID.get(it.item);
    const node = el('div', { class: 'rc-item', title: def.name, 'aria-label': def.name, style: `left:${it.x}%;top:${it.y}%;--tilt:${it.tilt}deg;width:${def.w * 1.3}px` },
      el('img', { src: itemUrl(def), alt: '', draggable: 'false' }));
    boxEl.append(node);
    draggable(node, {
      onStart: () => !sent && !binned.has(it.key),
      onMove(e) { bin.classList.toggle('is-hover', over(bin, e.clientX, e.clientY, 10)); },
      onEnd(e) {
        bin.classList.remove('is-hover');
        if (!over(bin, e.clientX, e.clientY, 10)) return;
        binned.add(it.key);
        node.remove();
        bin.classList.add('is-plop');
        setTimeout(() => bin.classList.remove('is-plop'), 300);
        render();
        if (binned.size === puzzle.items.length && !sent) {
          sent = true;
          submit({ binned: [...binned] });
          setTimeout(() => { sent = false; }, 1500);
        }
      },
    });
  }

  function render() {
    count.textContent = `${binned.size} of ${puzzle.items.length} ${slacker ? 'on the ground' : 'in the bin'}`;
    if (binned.size === puzzle.items.length) status.textContent = slacker ? 'Beautiful. The planet weeps.' : 'All sorted. The planet thanks you.';
  }
  render();
  return { destroy() { root.replaceChildren(); } };
}
