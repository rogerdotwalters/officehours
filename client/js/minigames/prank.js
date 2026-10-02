/**
 * The computer prank: wake a coworker's computer, open the browser, pick
 * something unprofessional (shown PG, censored), set it as the wallpaper.
 */
import { PRANK_CONTENT } from '../../shared/minigames/prank.js';
import { el } from './kit.js';

export function mountPrank(root, puzzle, { submit }) {
  const owner = puzzle.owner ?? 'Someone';
  let step = 'asleep';      // asleep -> desktop -> browser -> chosen -> done
  let chosen = null;
  let sent = false;
  const screen = el('div', { class: 'pc-screen' });
  const status = el('p', { class: 'fridge__hint' });
  root.append(el('div', { class: 'pcwrap' },
    el('div', { class: 'pc-monitor' }, el('div', { class: 'pc-bezel' }, screen), el('span', { class: 'pc-stand' }),
      el('span', { class: 'pc-label' }, `${owner}\u2019s computer`)),
    status));

  function censored(c, big) {
    return el('div', { class: `pc-content ${big ? 'is-big' : ''}` },
      c.censored ? el('div', { class: 'pc-blur' }, el('span', { class: 'pc-bar' }, '[FILTERED]')) : el('div', { class: 'pc-plain' }, c.label));
  }

  function render() {
    if (step === 'asleep') {
      screen.className = 'pc-screen is-off';
      screen.replaceChildren(el('button', { type: 'button', class: 'pc-wake', onclick: () => { step = 'desktop'; render(); } }, 'Wiggle the mouse to wake it'));
      status.textContent = 'Quick, before anyone walks past.';
    } else if (step === 'desktop') {
      screen.className = 'pc-screen';
      const icon = (name, fn, cls = '') => el('button', { type: 'button', class: `pc-icon ${cls}`, onclick: fn }, el('i'), name);
      screen.replaceChildren(el('div', { class: 'pc-desktop' },
        icon('Browser', () => { step = 'browser'; render(); }, 'is-browser'),
        icon('Q3 Budget.xlsx', () => { status.textContent = 'Boring. Open the browser.'; }),
        icon('Recycle Bin', () => { status.textContent = 'Nothing fun in there.'; })));
      status.textContent = `${owner}\u2019s desktop. Open the browser.`;
    } else if (step === 'browser') {
      screen.replaceChildren(el('div', { class: 'pc-browser' },
        el('div', { class: 'pc-url' }, 'search: totally work related'),
        ...PRANK_CONTENT.map((c) => el('button', { type: 'button', class: 'pc-link', onclick: () => { chosen = c; step = 'chosen'; render(); } },
          el('b', {}, c.label), el('small', {}, c.site)))));
      status.textContent = 'Pick something IT won\u2019t like.';
    } else if (step === 'chosen') {
      screen.replaceChildren(el('div', { class: 'pc-browser' },
        el('div', { class: 'pc-url' }, chosen.site),
        censored(chosen, false),
        el('button', { type: 'button', class: 'btn btn--small pc-wall', onclick: () => setWallpaper() }, 'Set as desktop wallpaper'),
        el('button', { type: 'button', class: 'btn btn--small btn--quiet', onclick: () => { step = 'browser'; render(); } }, 'Back')));
      status.textContent = 'Make it the wallpaper so nobody can miss it.';
    } else {
      screen.replaceChildren(censored(chosen, true));
      status.textContent = 'Beautiful. IT sweeps the computers at 5 PM.';
    }
  }

  function setWallpaper() {
    if (sent) return;
    sent = true;
    step = 'done';
    render();
    setTimeout(() => submit({ woke: true, opened: true, content: chosen.id, wallpaper: true }), 700);
  }

  render();
  return { destroy() { root.replaceChildren(); } };
}
