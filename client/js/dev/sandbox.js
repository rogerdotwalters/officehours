/**
 * Test tools for sandbox rooms (see server/dev/Sandbox.js).
 *
 * Adds an "Open a test room" button to the menu (if the server allows it), and
 * inside a test room a "Test tools" drawer: invite link, role picker, match
 * controls, time skips, Management tools, teleports, dummies and quick settings.
 * Everything here talks to the server through DEV messages; the server does
 * the real work, so you're testing real game code.
 *
 * REMOVING IT: delete this folder and every line tagged SANDBOX.
 */
import { C2S, S2C } from '../../shared/protocol.js';
import { PHASE, ROLE } from '../../shared/constants.js';
import { SETTINGS_SPEC } from '../../shared/settings.js';
import { TASKS } from '../../shared/tasks.js';

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

const ROLE_CHOICES = [
  ['random', 'Random'],
  [ROLE.WORKER, 'Worker'],
  [ROLE.MANAGEMENT, 'Management'],
  [ROLE.SNITCH, 'Snitch'],
];
const PLACES = [
  ['desk', 'My desk'],
  ['bell', 'Meeting bell'],
  ['time_clock', 'Time clock'],
  ['fridge', 'Fridge (puzzle)'],
  ['microwave', 'Microwave (puzzle)'],
  ['cat_bowl', 'Cat bowl (puzzle)'],
  ['dumpster', 'Recycling bin (puzzle)'],
  ['copier', 'Copier (puzzle)'],
  ['toilet_2', 'Toilet (puzzle)'],
  ['coffee', 'Coffee machine (puzzle)'],
  ['whiteboard', 'Whiteboard (puzzle)'],
  ['hr_box', 'HR complaint box'],
  ['office_a', 'Open Office A'],
  ['office_b', 'Open Office B'],
  ['studio', 'Design Studio'],
  ['accounting', 'Accounting'],
  ['manager', "Manager's Office"],
  ['conference', 'Conference Room'],
  ['break', 'Break Room'],
  ['restroom', 'Restrooms'],
  ['lobby', 'Lobby'],
  ['mailroom', 'Mail & Copy Room'],
  ['patio', 'Patio (outside)'],
  ['lawn', 'Lawn (outside)'],
  ['parking', 'Parking Lot (outside)'],
];
const QUICK_SETTINGS = ['playerSpeed', 'sightRange', 'reportRange', 'deskCheckWarning'];

/**
 * @param {{ net, game, ui, enterRoom: (code, name) => void, leaveRoom: () => void }} ctx
 */
export function install(ctx) {
  const { net, game, ui } = ctx;
  const send = (cmd, args = {}) => net.send(C2S.DEV, { cmd, ...args });

  addStylesheet();
  addMenuButton(ctx);

  // ---- Drawer ---------------------------------------------------------------
  const tab = el('button', { class: 'sbx-tab', type: 'button', hidden: true, onclick: () => setOpen(true) }, 'Test tools');
  const body = el('div', { class: 'sbx-body' });
  const drawer = el('aside', { class: 'sbx', hidden: true, 'aria-label': 'Test tools' },
    el('header', { class: 'sbx-head' },
      el('div', {}, el('h2', {}, 'Test tools'), el('p', {}, 'Only in test rooms. Nothing here affects real games.')),
      el('button', { class: 'sbx-close', type: 'button', 'aria-label': 'Close test tools', onclick: () => setOpen(false) }, '\u00d7')),
    body);
  document.body.append(tab, drawer);

  let open = false;
  let lastKey = '';
  function setOpen(v) {
    open = v;
    drawer.hidden = !v;
    tab.hidden = v || !active();
    if (v) { lastKey = ''; render(); }
  }
  const active = () => !!game.room?.sandbox && !document.getElementById('screen-game').hidden;

  function render() {
    const on = active();
    document.body.classList.toggle('is-sandbox', on);
    tab.hidden = !on || open;
    if (!on) { drawer.hidden = true; open = false; return; }
    if (!open) return;

    const room = game.room;
    const sbx = room.sandbox;
    const inMatch = room.phase === PHASE.PLAYING || room.phase === PHASE.MEETING;
    const key = JSON.stringify([room.code, room.phase, sbx, game.role, game.self?.status, room.settings, room.players.length]);
    if (key === lastKey) return;
    lastKey = key;

    const myPref = sbx.prefs[game.selfId] ?? 'random';
    const currentRole = inMatch ? (game.role ?? 'random') : myPref;
    const out = game.self && game.self.status !== 'active';

    body.replaceChildren(
      section('Invite someone', inviteBlock(room.code),
        el('p', { class: 'sbx-note' }, 'Anyone with the link joins this test room, even mid-match. They get a free desk and the current tasks.')),

      section(inMatch ? 'Your role (switches now)' : 'Your role when the match starts',
        el('div', { class: 'sbx-seg', role: 'group' },
          ROLE_CHOICES.filter(([v]) => !(inMatch && v === 'random')).map(([value, text]) =>
            el('button', {
              type: 'button',
              class: value === currentRole ? 'is-on' : '',
              'aria-pressed': String(value === currentRole),
              onclick: () => send('role', { role: value === 'random' ? null : value }),
            }, text)))),

      section('Match',
        room.phase === PHASE.LOBBY
          ? buttons([['Start now, even alone', () => send('start'), 'primary']])
          : buttons([
            ['Back to the waiting room', () => send('lobby')],
            ['End: workers win', () => send('end', { winner: 'workers' })],
            ['End: Management wins', () => send('end', { winner: 'management' })],
          ]),
        toggle('Real win rules', sbx.realWins, (v) => send('realWins', { on: v }),
          'Off: the match only ends when you end it. On: normal win conditions apply.')),

      inMatch && section('Try a task',
        el('p', { class: 'sbx-note' }, 'Hand yourself any task, ready to do.'),
        taskBlock()),

      inMatch && section('Workday',
        buttons([
          ['Next task now', () => send('nextTask')],
          ['Hand out every task', () => send('allTasks')],
          ['Finish my tasks', () => send('finishTasks')],
          ['Start the next break', () => send('nextBreak')],
          ['Jump to 4:50 PM', () => send('almostFive')],
        ])),

      inMatch && section('Management and meetings',
        buttons([
          ['Reset all cooldowns', () => send('cooldowns')],
          ['Stand-up meeting now', () => send('deskCheck')],
          ['Call a meeting now', () => send('meeting')],
          ['End the meeting', () => send('endMeeting')],
        ])),

      inMatch && section('Move me',
        teleportBlock(),
        buttons(out
          ? [['Back to work', () => send('backToWork'), 'primary']]
          : [['Send me home', () => send('goHome')]]),
        toggle('See everyone', sbx.seeAll.includes(game.selfId), (v) => send('seeAll', { on: v }),
          'Ignore the sight range so you can watch what everyone is doing.')),

      section(`Dummies (${sbx.dummies})`,
        el('p', { class: 'sbx-note' }, 'Stand-in players for firing, stand-ups, HR complaints and chats. They don\u2019t vote.'),
        buttons([
          ['Add a dummy', () => send('addDummy')],
          ['Remove all dummies', () => send('clearDummies')],
        ]),
        toggle('Dummies wander', sbx.wander, (v) => send('wander', { on: v })),
        inMatch && dummySayBlock()),

      section('Quick settings', el('p', { class: 'sbx-note' }, 'Change these any time, even mid-match.'),
        QUICK_SETTINGS.map((key) => stepper(key))),

      section('Leave', buttons([['Leave the test room', () => ctx.leaveRoom()]])),
    );
  }

  // ---- Building blocks ---------------------------------------------------------
  function section(title, ...children) {
    return el('section', { class: 'sbx-section' }, el('h3', {}, title), ...children);
  }

  function buttons(list) {
    return el('div', { class: 'sbx-buttons' },
      list.map(([text, fn, kind]) => el('button', { type: 'button', class: `sbx-btn ${kind === 'primary' ? 'is-primary' : ''}`, onclick: fn }, text)));
  }

  function toggle(text, on, fn, help) {
    const input = el('input', { type: 'checkbox', onchange: (e) => fn(e.target.checked) });
    input.checked = !!on;
    return el('label', { class: 'sbx-toggle' }, input, el('span', {}, text, help ? el('small', {}, help) : null));
  }

  function inviteBlock(code) {
    const link = `${location.origin}${location.pathname}?room=${code}`;
    const field = el('input', { class: 'sbx-link', readonly: true, value: link, 'aria-label': 'Invite link', onfocus: (e) => e.target.select() });
    const list = [['Copy link', async () => {
      try { await navigator.clipboard.writeText(link); ui.toast('Invite link copied.'); }
      catch { field.focus(); field.select(); ui.toast('Select the link and copy it.'); }
    }, 'primary']];
    if (navigator.share) list.push(['Share\u2026', () => navigator.share({ title: 'Office Hours test room', url: link }).catch(() => {})]);
    return el('div', { class: 'sbx-invite' }, el('div', { class: 'sbx-code' }, code), field, buttons(list));
  }

  function teleportBlock() {
    const select = el('select', { class: 'sbx-select', 'aria-label': 'Teleport to' },
      PLACES.map(([v, t]) => el('option', { value: v }, t)));
    return el('div', { class: 'sbx-row' }, select,
      el('button', { type: 'button', class: 'sbx-btn', onclick: () => send('teleport', { to: select.value }) }, 'Go'));
  }

  function taskBlock() {
    const select = el('select', { class: 'sbx-select', 'aria-label': 'Task' },
      TASKS.map((t) => el('option', { value: t.id }, `${t.label}${t.minigame ? ' (puzzle)' : ''}`)));
    return el('div', { class: 'sbx-row' }, select,
      el('button', { type: 'button', class: 'sbx-btn', onclick: () => send('giveTask', { taskId: select.value }) }, 'Give'));
  }

  function dummySayBlock() {
    const input = el('input', { class: 'sbx-select', maxlength: 140, placeholder: 'Has anyone seen my stapler?', 'aria-label': 'What the dummy says' });
    const channel = el('select', { class: 'sbx-select', 'aria-label': 'Chat' },
      el('option', { value: 'crew' }, 'Water cooler'), el('option', { value: 'team' }, 'Back office'), el('option', { value: 'all' }, 'Everyone'));
    return el('div', { class: 'sbx-say' },
      el('span', { class: 'sbx-note' }, 'Make a dummy say something:'),
      input,
      el('div', { class: 'sbx-row' }, channel,
        el('button', { type: 'button', class: 'sbx-btn', onclick: () => { send('dummySay', { channel: channel.value, text: input.value }); input.value = ''; } }, 'Say it')));
  }

  function stepper(key) {
    const spec = SETTINGS_SPEC[key];
    const value = game.settings[key];
    const nudge = (dir) => send('setting', { key, value: value + dir * spec.step });
    return el('div', { class: 'sbx-setting' },
      el('span', {}, spec.label),
      el('span', { class: 'sbx-stepper' },
        el('button', { type: 'button', disabled: value <= spec.min, 'aria-label': `Less ${spec.label.toLowerCase()}`, onclick: () => nudge(-1) }, '\u2212'),
        el('output', {}, spec.format(value)),
        el('button', { type: 'button', disabled: value >= spec.max, 'aria-label': `More ${spec.label.toLowerCase()}`, onclick: () => nudge(1) }, '+')));
  }

  // ---- Keep in sync with the game ---------------------------------------------
  net.on(S2C.ROOM, render);
  net.on(S2C.SELF, render);
  net.on('disconnected', () => setTimeout(render, 0));
  // Leaving to the menu doesn't send a message, so check now and then.
  setInterval(() => { if (!active() && document.body.classList.contains('is-sandbox')) render(); }, 1000);
}

/** "Open a test room" on the menu, only if the server has test rooms switched on. */
async function addMenuButton(ctx) {
  try {
    const res = await fetch(`${ctx.net.httpBase}/api/config`);
    if (!res.ok || !(await res.json()).sandbox) return;
  } catch {
    return;
  }
  const createBtn = document.getElementById('menu-create');
  const btn = el('button', { class: 'btn sbx-menu-btn', type: 'button' }, 'Open a test room');
  btn.addEventListener('click', async () => {
    const name = document.getElementById('menu-name').value.trim() || 'Tester';
    btn.disabled = true;
    ctx.ui.setMenuError('');
    try {
      ctx.enterRoom(await ctx.net.createRoom({ sandbox: true }), name);
    } catch (err) {
      ctx.ui.setMenuError(err.message);
    } finally {
      btn.disabled = false;
    }
  });
  createBtn.after(btn);
}

function addStylesheet() {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./devpanel.css', import.meta.url).href;
  document.head.append(link);
}
