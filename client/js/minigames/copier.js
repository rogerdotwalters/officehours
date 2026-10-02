/**
 * Copier: drag the top document from the stack onto the glass, press Copy,
 * repeat. One of them jams first, because it's a copier.
 */
import { el, draggable, over } from './kit.js';

export function mountCopier(root, puzzle, { submit }) {
  const queue = [...puzzle.docs];
  const copied = [];
  let glass = null;          // the document on the glass
  let jammed = false;
  let busy = false;
  let sent = false;

  const paper = (doc, cls = '') => el('div', { class: `cp-paper ${cls}` },
    el('b', {}, doc.title), el('p', {}, doc.body), el('span', { class: 'cp-lines', 'aria-hidden': 'true' }));

  const stackEl = el('div', { class: 'cp-stack', 'aria-label': 'Stack of documents' });
  const glassEl = el('div', { class: 'cp-glass', 'aria-label': 'Copier glass' });
  const screen = el('output', { class: 'cp-screen', 'aria-live': 'polite' });
  const copyBtn = el('button', { type: 'button', class: 'cp-copy', onclick: () => copy() }, 'COPY');
  const tray = el('div', { class: 'cp-tray', 'aria-label': 'Output tray' });
  const machine = el('div', { class: 'cp-machine' },
    el('div', { class: 'cp-lid' }), glassEl,
    el('div', { class: 'cp-panel' }, screen, copyBtn),
    tray);
  const count = el('p', { class: 'cf-count' });
  const status = el('p', { class: 'fridge__hint' });
  root.append(el('div', { class: 'cpwrap' }, el('div', { class: 'cp-scene' }, stackEl, machine), count, status));

  function renderStack() {
    stackEl.replaceChildren(...queue.slice(0, 4).reverse().map((doc, i, arr) => {
      const isTop = i === arr.length - 1;
      const node = paper(doc, isTop ? 'is-top' : 'is-under');
      node.style.setProperty('--n', arr.length - 1 - i);
      if (isTop && !glass && !busy) {
        draggable(node, {
          onStart: () => !sent,
          onEnd(e) {
            if (over(glassEl, e.clientX, e.clientY, 20)) { glass = queue.shift(); render(); }
          },
        });
      }
      return node;
    }));
    if (!queue.length) stackEl.append(el('p', { class: 'cp-empty' }, 'All copied.'));
  }

  function copy() {
    if (busy || sent) return;
    if (!glass) { say('NO ORIGINAL'); status.textContent = 'Put a document on the glass first.'; return; }
    const index = puzzle.docs.indexOf(glass);
    if (index === puzzle.jam && !jammed) {
      jammed = true;
      say('PC LOAD LETTER');
      machine.classList.add('is-shake');
      setTimeout(() => machine.classList.remove('is-shake'), 400);
      status.textContent = 'Nobody knows what that means. Press Copy again. Firmly.';
      return;
    }
    busy = true;
    machine.classList.add('is-scanning');
    say('COPYING\u2026');
    setTimeout(() => {
      machine.classList.remove('is-scanning');
      copied.push(glass.id);
      tray.append(paper(glass, 'is-copy'));
      glass = null;
      busy = false;
      say('READY');
      render();
      if (copied.length === puzzle.docs.length && !sent) {
        sent = true;
        submit({ copied });
        setTimeout(() => { sent = false; }, 1500);
      }
    }, 700);
  }

  function say(text) { screen.textContent = text; }

  function render() {
    glassEl.replaceChildren(...(glass ? [paper(glass, 'is-on-glass')] : [el('span', { class: 'cp-glass__hint' }, 'Place original here')]));
    renderStack();
    count.textContent = `${copied.length} of ${puzzle.docs.length} copied`;
    status.textContent = copied.length === puzzle.docs.length ? 'Done. Distribute them to everyone, obviously.'
      : glass ? 'Press COPY.' : 'Drag the top document onto the copier glass.';
    copyBtn.disabled = busy;
  }
  say('READY');
  render();
  return { destroy() { root.replaceChildren(); }, onKey(e) { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); copy(); } } };
}
