/**
 * Email: open each message, read it, delete it. When the inbox is empty,
 * the task is done.
 */
import { el } from './kit.js';

export function mountEmail(root, puzzle, { submit }) {
  const inbox = puzzle.emails.map((m) => ({ ...m }));
  const opened = new Set();
  const deleted = new Set();
  let current = null;
  let sent = false;

  const list = el('ul', { class: 'em-list', role: 'list' });
  const pane = el('section', { class: 'em-pane', 'aria-live': 'polite' });
  const status = el('p', { class: 'fridge__hint' });
  const app = el('div', { class: 'em' }, el('div', { class: 'em-side' }, el('p', { class: 'em-folder' }, 'Inbox'), list), pane);
  root.append(el('div', { class: 'emwrap' }, app, status));

  function open(m) {
    current = m;
    opened.add(m.id);
    render();
  }

  function remove(m) {
    deleted.add(m.id);
    current = null;
    render();
    if (deleted.size === inbox.length && !sent) {
      sent = true;
      submit({ opened: [...opened], deleted: [...deleted] });
      setTimeout(() => { sent = false; }, 1500);
    }
  }

  function render() {
    const left = inbox.filter((m) => !deleted.has(m.id));
    list.replaceChildren(...left.map((m) => el('li', {},
      el('button', {
        type: 'button',
        class: `em-row ${opened.has(m.id) ? '' : 'is-unread'} ${current?.id === m.id ? 'is-current' : ''}`,
        onclick: () => open(m),
      }, el('b', {}, m.from), el('span', {}, m.subject)))));
    if (!left.length) list.append(el('li', { class: 'em-empty' }, 'Inbox zero. Treat yourself.'));
    app.classList.toggle('is-reading', !!current);
    pane.replaceChildren(...(current
      ? [
        el('div', { class: 'em-toolbar' },
          el('button', { type: 'button', class: 'btn btn--small em-back', onclick: () => { current = null; render(); } }, 'Back'),
          el('button', { type: 'button', class: 'btn btn--small em-delete', onclick: () => remove(current) }, 'Delete')),
        el('h3', { class: 'em-subject' }, current.subject),
        el('p', { class: 'em-from' }, `From: ${current.from}`),
        el('p', { class: 'em-body' }, current.body),
      ]
      : [el('p', { class: 'em-placeholder' }, left.length ? 'Pick an email to read it.' : 'All done.')]));
    status.textContent = `${left.length} left. Open each one, read it, then delete it.`;
  }
  render();
  return { destroy() { root.replaceChildren(); } };
}
