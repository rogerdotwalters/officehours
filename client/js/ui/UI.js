/**
 * UI — every DOM element on top of the canvas: menu, lobby folder (people,
 * house rules, chat), in-game HUD (to-do note, punch clock, actions, desk terminal, emotes),
 * role memo, meeting, game over, toasts and the event feed.
 *
 * User-supplied text (names, chat) is always inserted with textContent, never
 * innerHTML, so it can't inject markup.
 */
import { COLORS, PHASE, STATUS, ROLE } from '../../shared/constants.js';
import { TASKS_BY_ID, TARGET_HINT, rarityOf } from '../../shared/tasks.js';
import { SETTINGS_SPEC, effectiveSnitches } from '../../shared/settings.js';
import { EMOTES } from '../../shared/emotes.js';

const $ = (id) => document.getElementById(id);
const PENDING_MS = 1500;
const EMPTY_CHAT = {
  all: 'No messages yet.',
  general: 'No messages yet. Everyone with an open terminal reads this, Management included.',
  team: 'Nothing yet. Tip each other off about who is where.',
  crew: 'Nothing yet. Compare notes on who is acting suspicious, but remember snitches are listening.',
};
const CHANNEL_SUB = {
  general: 'Everyone in the office.',
  crew: "Workers only. Management can't see this, but snitches can.",
  team: 'Only Management and snitches can see this.',
};
const TERMINAL_CHANNELS = ['general', 'crew', 'team'];

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}

/** Only touch the DOM when a value actually changes (the HUD updates every frame). */
function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}
function setHidden(node, hidden) {
  if (node.hidden !== hidden) node.hidden = hidden;
}

function formatClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function listNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.keys = {};             // last-rendered keys, to skip unchanged DOM work
    this.toastTimer = null;
    this.pending = {};          // host's in-flight setting edits: key -> { value, at }
    this.lobbyTab = 'people';
    this.unread = { all: 0, general: 0, team: 0, crew: 0 };
    this.terminalChannel = 'general';
    this.settingRefs = null;

    // ---- Menu ----
    $('menu-name').value = localStorage.getItem('office-hours:name') || '';
    $('menu-create').addEventListener('click', () => this.h.onCreate(this.menuName()));
    $('menu-join').addEventListener('click', () => this.h.onJoin(this.menuName(), this.menuCode()));
    $('menu-code').addEventListener('keydown', (e) => e.key === 'Enter' && this.h.onJoin(this.menuName(), this.menuCode()));
    $('menu-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

    // ---- Lobby folder ----
    $('lobby-ready').addEventListener('click', () => this.h.onReady());
    $('lobby-start').addEventListener('click', () => this.h.onStart());
    $('lobby-leave').addEventListener('click', () => this.h.onLeave());
    $('lobby-code').addEventListener('click', () => this.h.onCopyCode());
    $('lobby-grip').addEventListener('click', () => this.setFolderOpen($('lobby-panel').dataset.open !== 'true'));
    for (const tab of document.querySelectorAll('#lobby-panel [role=tab]')) {
      tab.addEventListener('click', () => this.selectTab(tab.dataset.tab));
    }
    this.setFolderOpen(!this.compact());
    this.buildSettingsForm();

    // ---- Chat forms (lobby + meeting): data-chat-form="all" ----
    for (const form of document.querySelectorAll('[data-chat-form]')) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = form.querySelector('input');
        const text = input.value.trim();
        if (text) this.h.onChat(text, form.dataset.chatForm);
        input.value = '';
      });
    }

    // ---- HUD / overlays ----
    $('act-use').addEventListener('click', () => this.h.onUse());
    $('act-report').addEventListener('click', () => this.h.onReport());
    $('act-deskcheck').addEventListener('click', () => this.h.onDeskCheck());
    // ---- Desk terminal ----
    $('act-terminal').addEventListener('click', () => this.h.onTerminal());
    $('terminal-close').addEventListener('click', () => this.h.onTerminal(false));
    for (const tab of document.querySelectorAll('#terminal [data-channel]')) {
      tab.addEventListener('click', () => this.selectChannel(tab.dataset.channel));
    }
    $('terminal-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = e.target.querySelector('input');
      const text = input.value.trim();
      if (text) this.h.onChat(text, this.terminalChannel);
      input.value = '';
    });
    $('terminal-form').querySelector('input').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.h.onTerminal(false); }
    });

    // ---- Emotes (keys 1-8, or these buttons) ----
    $('hud-emotes').replaceChildren(...EMOTES.map((em, i) => el('button', {
      class: 'emote-btn', type: 'button', title: em.label, 'aria-label': em.label,
      onclick: () => this.h.onEmote(em.id),
    }, em.glyph, el('kbd', {}, String(i + 1)))));
    $('meeting-skip').addEventListener('click', () => this.h.onVote('skip'));
    $('over-lobby').addEventListener('click', () => this.h.onReturnToLobby());
  }

  /** Phone-sized: bottom sheet lobby, collapsed to-do note. */
  compact() {
    return window.innerWidth < 760 || window.innerHeight < 520;
  }
  get isTouch() {
    return document.body.classList.contains('is-touch');
  }

  menuName() { return $('menu-name').value.trim(); }
  menuCode() { return $('menu-code').value.trim().toUpperCase(); }
  setMenuCode(code) { $('menu-code').value = code; }

  setMenuError(text) { $('menu-error').textContent = text || ''; }
  setMenuBusy(busy) {
    $('menu-create').disabled = busy;
    $('menu-join').disabled = busy;
  }

  showScreen(name) {
    for (const s of ['menu', 'game']) setHidden($(`screen-${s}`), s !== name);
    if (name !== 'game') this.hideOverlays();
  }

  hideOverlays() {
    for (const id of ['overlay-role', 'overlay-meeting', 'overlay-over']) $(id).hidden = true;
    this.closeTerminalUi();
  }

  /** Called when a new match starts. */
  resetMatchUi() {
    this.unread.general = 0;
    this.unread.team = 0;
    this.unread.crew = 0;
    this.terminalChannel = 'general';
    this.renderUnread();
    this.closeTerminalUi();
    $('hud-tasks').open = !this.compact();
    this.keys = {};
  }

  // ===========================================================================
  // Lobby folder
  // ===========================================================================
  setFolderOpen(open) {
    $('lobby-panel').dataset.open = String(open);
    $('lobby-grip').setAttribute('aria-expanded', String(open));
  }

  selectTab(name) {
    this.lobbyTab = name;
    for (const tab of document.querySelectorAll('#lobby-panel [role=tab]')) {
      tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
    }
    for (const panel of document.querySelectorAll('#lobby-panel [data-panel]')) {
      panel.hidden = panel.dataset.panel !== name;
    }
    if (name === 'chat') {
      this.unread.all = 0;
      this.renderUnread();
      const log = document.querySelector('#lobby-panel [data-chat-log]');
      log.scrollTop = log.scrollHeight;
    }
    this.setFolderOpen(true);
  }

  renderLobby(game, now) {
    const room = game.room;
    if (!room) return;
    const inLobby = room.phase === PHASE.LOBBY;
    setHidden($('lobby-panel'), !inLobby);
    setHidden($('hud'), inLobby);
    if (!inLobby) return;

    setText($('lobby-code'), room.code);
    setText($('lobby-sub'), `${room.players.length} of ${room.maxPlayers} here. Walk around while you wait.`);

    const roster = $('lobby-roster');
    roster.replaceChildren(
      ...room.players.map((p) => {
        const isHost = p.id === room.hostId;
        const stamp = isHost
          ? el('span', { class: 'stamp stamp--host' }, 'Host')
          : el('span', { class: `stamp ${p.ready ? 'stamp--in' : ''}` }, p.ready ? 'Ready' : 'Not ready');
        return el('li', { class: p.connected ? '' : 'offline' },
          el('span', { class: 'swatch', style: `background:${COLORS[p.colorId].hex}` }),
          el('span', { class: 'name' }, p.name, p.id === game.selfId ? el('small', {}, '(you)') : null,
            p.connected ? null : el('small', {}, 'reconnecting')),
          stamp);
      }),
    );

    const me = game.me;
    const isHost = game.isHost;
    const others = room.players.filter((p) => p.id !== room.hostId);
    const waiting = room.sandbox ? [] : others.filter((p) => !p.ready); // no ready-up in test rooms
    const enough = room.players.length >= room.minPlayers;

    setHidden($('lobby-ready'), isHost);
    setText($('lobby-ready'), me?.ready ? 'Not ready yet' : "I'm ready");
    $('lobby-ready').classList.toggle('btn--primary', !me?.ready);
    setHidden($('lobby-start'), !isHost);
    $('lobby-start').disabled = !(enough && waiting.length === 0);

    let hint;
    if (!enough) hint = `Need at least ${room.minPlayers} people to start. Share code ${room.code}.`;
    else if (waiting.length) hint = `Waiting for ${listNames(waiting.map((p) => p.name))} to get ready.`;
    else hint = isHost ? "Everyone's ready. Start the workday when you like." : 'Everyone is ready. Waiting for the host to start.';
    setText($('lobby-hint'), hint);

    this.renderSettings(game, now);
  }

  // ---- House rules (settings steppers) ----
  buildSettingsForm() {
    const groups = new Map();
    this.settingRefs = {};
    for (const [key, spec] of Object.entries(SETTINGS_SPEC)) {
      if (!groups.has(spec.group)) groups.set(spec.group, el('fieldset', { class: 'settings__group' }, el('legend', {}, spec.group)));
      const out = el('output', { class: 'stepper__value', 'aria-live': 'polite' });
      const minus = el('button', { type: 'button', class: 'stepper__btn', 'aria-label': `Less ${spec.label.toLowerCase()}`, onclick: () => this.nudgeSetting(key, -1) }, '\u2212');
      const plus = el('button', { type: 'button', class: 'stepper__btn', 'aria-label': `More ${spec.label.toLowerCase()}`, onclick: () => this.nudgeSetting(key, 1) }, '+');
      groups.get(spec.group).append(el('div', { class: 'setting' },
        el('span', { class: 'setting__label' }, spec.label, spec.help ? el('small', {}, spec.help) : null),
        el('span', { class: 'stepper' }, minus, out, plus)));
      this.settingRefs[key] = { out, minus, plus };
    }
    $('settings-form').replaceChildren(...groups.values());
  }

  settingValue(game, key, now) {
    const p = this.pending[key];
    return p && now - p.at < PENDING_MS ? p.value : game.settings[key];
  }

  nudgeSetting(key, dir) {
    const game = this.lastGame;
    if (!game?.isHost) return;
    const spec = SETTINGS_SPEC[key];
    const now = performance.now();
    const value = Math.max(spec.min, Math.min(spec.max, this.settingValue(game, key, now) + dir * spec.step));
    this.pending[key] = { value, at: now };
    this.h.onSettings({ [key]: value });
    this.renderSettings(game, now);
  }

  renderSettings(game, now) {
    this.lastGame = game;
    const host = game.isHost;
    $('settings-form').classList.toggle('is-readonly', !host);
    for (const [key, spec] of Object.entries(SETTINGS_SPEC)) {
      const { out, minus, plus } = this.settingRefs[key];
      const v = this.settingValue(game, key, now);
      setText(out, spec.format(v));
      minus.disabled = !host || v <= spec.min;
      plus.disabled = !host || v >= spec.max;
    }
    const players = game.room.players.length;
    const snitches = effectiveSnitches({ snitches: this.settingValue(game, 'snitches', now) }, players);
    const minutes = this.settingValue(game, 'workdayMinutes', now);
    const tasks = this.settingValue(game, 'tasks', now);
    const perTask = Math.round((minutes * 60) / tasks);
    setText($('settings-note'),
      `${host ? 'You set the rules for everyone.' : 'The host sets these.'} `
      + `A new task every ${perTask} seconds. With ${players} ${players === 1 ? 'person' : 'people'}, `
      + `${snitches === 0 ? 'there would be no snitches' : `${snitches} ${snitches === 1 ? 'person' : 'people'} would be a snitch`}.`);
  }

  // ===========================================================================
  // Chat
  // ===========================================================================
  renderChat(channel, lines, game) {
    for (const log of document.querySelectorAll(`[data-chat-log="${channel}"]`)) {
      const items = lines.length
        ? lines.map((l) => el('li', {},
          el('b', { style: `color:${game.colorOf(l.from)}` }, game.nameOf(l.from)),
          l.from === game.selfId ? el('small', {}, ' (you)') : null, ': ', l.text))
        : [el('li', { class: 'empty' }, EMPTY_CHAT[channel])];
      log.replaceChildren(...items);
      log.scrollTop = log.scrollHeight;
    }
  }

  /** A new line arrived on a channel that may not be on screen. */
  noteUnread(channel, game) {
    if (channel === 'all' && game.inLobby && !(this.lobbyTab === 'chat' && $('lobby-panel').dataset.open === 'true')) this.unread.all++;
    if (TERMINAL_CHANNELS.includes(channel) && ($('terminal').hidden || this.terminalChannel !== channel)) this.unread[channel]++;
    this.renderUnread();
  }

  renderUnread() {
    setText($('lobby-unread'), String(this.unread.all));
    setHidden($('lobby-unread'), this.unread.all === 0);
    for (const ch of TERMINAL_CHANNELS) {
      const badge = document.querySelector(`#terminal [data-channel="${ch}"] .count`);
      setText(badge, String(this.unread[ch]));
      setHidden(badge, this.unread[ch] === 0);
    }
  }

  /** Show the desk terminal if it's open, with the tabs this player's role can read. */
  renderTerminal(game) {
    const panel = $('terminal');
    const wasHidden = panel.hidden;
    setHidden(panel, !game.terminal.open);
    if (!game.terminal.open) {
      // Give the keyboard back to movement.
      if (panel.contains(document.activeElement)) document.activeElement.blur();
      return;
    }
    const readable = game.terminalChannels();
    if (!readable.includes(this.terminalChannel)) this.terminalChannel = 'general';
    for (const tab of panel.querySelectorAll('[data-channel]')) setHidden(tab, !readable.includes(tab.dataset.channel));
    // A lone #general tab isn't worth a tab bar.
    setHidden(panel.querySelector('.terminal__tabs'), readable.length < 2);
    this.selectChannel(this.terminalChannel, wasHidden);
  }

  selectChannel(channel, focus = true) {
    this.terminalChannel = channel;
    const panel = $('terminal');
    for (const tab of panel.querySelectorAll('[data-channel]')) tab.setAttribute('aria-selected', String(tab.dataset.channel === channel));
    for (const log of panel.querySelectorAll('[data-chat-log]')) setHidden(log, log.dataset.chatLog !== channel);
    setText(panel.querySelector('.terminal__sub'), CHANNEL_SUB[channel]);
    const input = panel.querySelector('input');
    input.placeholder = `message ${channel === 'general' ? '#general' : channel === 'crew' ? 'the water cooler' : 'the back office'}, Esc to close`;
    this.unread[channel] = 0;
    this.renderUnread();
    const log = panel.querySelector(`[data-chat-log="${channel}"]`);
    log.scrollTop = log.scrollHeight;
    if (focus && !this.isTouch) input.focus();
  }

  closeTerminalUi() {
    const panel = $('terminal');
    if (panel.contains(document.activeElement)) document.activeElement.blur();
    setHidden(panel, true);
  }

  // ===========================================================================
  // HUD (called every frame; only writes to the DOM when something changed)
  // ===========================================================================
  renderHud(game, now, frame) {
    if (game.inLobby) return;
    const self = game.self;
    const room = game.room;
    const mgmt = game.isManagement;
    const playing = game.phase === PHASE.PLAYING;
    const day = game.dayInfo(now);

    // Role tag
    const roleTag = $('hud-role');
    setText(roleTag, !self ? '' : mgmt ? 'Management' : game.isSnitch ? 'Snitch' : 'Worker');
    roleTag.classList.toggle('is-mgmt', game.isTeam);

    const brk = game.breakInfo(now);
    this.renderTasks(game, day, brk);
    this.renderClock(game, day, brk);
    this.renderBreak(game, brk, playing);

    // Top pills
    const cam = game.cameraTarget();
    let where = game.map.roomName(cam.x, cam.y);
    if (cam.spectating) where = `Watching ${game.nameOf(cam.spectating)}`;
    setText($('hud-room'), where);
    const progress = room?.progress;
    setText($('hud-progress'), progress ? `${progress.home} of ${progress.goal} clocked out` : '');

    // Social meter
    const social = $('hud-social');
    setHidden(social, !progress);
    if (progress) {
      social.querySelector('.meter__fill').style.width = `${Math.min(100, (progress.social / progress.socialGoal) * 100)}%`;
      setText(social.querySelector('.social-pill__count'), `${progress.social}/${progress.socialGoal}`);
    }

    // Wifi
    const wifi = game.wifiInfo(now);
    setText($('hud-wifi'), !wifi ? '' : wifi.down ? `Wifi down ${formatClock(wifi.msLeft)}` : 'Wifi on');
    $('hud-wifi').classList.toggle('is-down', !!wifi?.down);

    // Desk check banner
    const dcLeft = game.deskCheckLeft(now);
    const dcBox = $('hud-deskcheck');
    setHidden(dcBox, dcLeft == null || !playing);
    document.body.classList.toggle('is-deskcheck', dcLeft != null && playing);
    if (dcLeft != null) {
      let body;
      if (mgmt) body = 'Anyone away from their desk when this hits zero goes home.';
      else if (!game.inOffice) body = 'Everyone in the office has to be at their desk.';
      else body = (frame.atDesk ? "You're at your desk. Stay put." : 'Get back to your desk!');
      setText(dcBox.querySelector('.deskcheck__body'), body);
      setText(dcBox.querySelector('.deskcheck__count'), String(Math.ceil(dcLeft / 1000)));
      dcBox.classList.toggle('is-safe', !!frame.atDesk && !mgmt);
    }

    // Status banner
    let banner = '';
    const freezeLeft = (self?.freezeUntil ?? 0) - now;
    const watch = this.isTouch ? 'Tap Watch to follow someone else.' : 'Press E to watch someone else.';
    if (self?.status === STATUS.HOME) banner = `You clocked out. Enjoy your evening. ${watch}`;
    else if (self?.status === STATUS.SENT_HOME) banner = `You were sent home. ${watch}`;
    else if (playing && freezeLeft > 0) banner = `Back to work in ${Math.ceil(freezeLeft / 1000)}`;
    setText($('hud-status'), banner);
    setHidden($('hud-status'), !banner || !$('overlay-role').hidden);

    // Interaction hint
    const usable = frame.usable;
    const keyLabel = this.isTouch ? '' : 'E';
    let hint = '';
    if (playing && usable && !self?.active) {
      if (usable.action) hint = `${keyLabel}|${usable.action}`;
      else if (usable.object.type !== 'desk') hint = `|${usable.object.label}: nothing to do here`;
    }
    if (hint !== this.keys.hint) {
      this.keys.hint = hint;
      const node = $('hud-hint');
      if (hint) {
        const [k, text] = hint.split('|');
        node.replaceChildren(...(k ? [el('kbd', {}, k)] : []), text);
      }
      setHidden(node, !hint);
    }

    // Task progress bar (extrapolated between server updates)
    const bar = $('hud-taskbar');
    if (self?.active && playing) {
      const def = TASKS_BY_ID.get(self.active.taskId);
      const p = Math.min(1, self.active.progress + (now - self.receivedAt) / def.duration);
      bar.firstElementChild.style.width = `${(p * 100).toFixed(1)}%`;
      setText(bar.lastElementChild, `${def.label}. Move to cancel.`);
      setHidden(bar, false);
    } else {
      setHidden(bar, true);
    }

    this.renderActions(game, now, frame);
  }

  renderTasks(game, day, brk) {
    const self = game.self;
    const tasks = self?.tasks ?? [];
    const total = self?.totalTasks ?? 0;
    const activeId = self?.active?.taskId;
    const doneCount = tasks.filter((t) => t.done).length;
    const allDone = game.allTasksDone();
    const key = JSON.stringify([tasks, activeId, game.role, self?.status, total, brk.current?.id, brk.next?.id]);
    if (key !== this.keys.tasks) {
      this.keys.tasks = key;
      setText($('hud-task-count'), total ? `${doneCount}/${total}` : '');
      const items = tasks.map((t) => {
        const def = TASKS_BY_ID.get(t.id);
        const rarity = rarityOf(def);
        const breakOnly = def.during === 'break';
        const waits = breakOnly && !t.done && !brk.current && brk.next;
        return el('li', { class: [t.done && 'done', t.id === activeId && 'active'].filter(Boolean).join(' ') },
          el('span', {}, def.label,
            breakOnly ? el('em', { class: 'rarity rarity--break' }, 'break') : null,
            rarity ? el('em', { class: `rarity rarity--${rarity}` }, rarity) : null,
            def.minigame ? el('em', { class: 'rarity rarity--game' }, 'puzzle') : null,
            el('small', {}, `${TARGET_HINT[def.target] ?? ''}${waits ? `. Wait for ${brk.next.label.toLowerCase()}` : ''}`)));
      });
      if (allDone && !game.isTeam && self.status === STATUS.ACTIVE) {
        items.push(el('li', { class: 'active clockout' }, el('span', {}, 'Clock out', el('small', {}, 'time clock, Lobby'))));
      }
      if (game.isTeam) {
        items.push(el('li', { class: 'fake' }, el('span', {},
          'Your cover story. These tasks don\u2019t count, but doing them helps you blend in.')));
      }
      $('hud-task-list').replaceChildren(...items);
    }

    // "Next task in 0:42" line
    let next = '';
    if (day && total && tasks.length < total && self?.status === STATUS.ACTIVE) {
      const remaining = total - tasks.length;
      next = day.running
        ? `Next task in ${formatClock(day.nextTaskIn)}. ${remaining} more to come.`
        : `${remaining} more ${remaining === 1 ? 'task' : 'tasks'} to come.`;
    } else if (total && tasks.length >= total && !allDone && self?.status === STATUS.ACTIVE) {
      next = "That's everything for today.";
    }
    setText($('hud-next'), next);
    setHidden($('hud-next'), !next);
  }

  /** Break banner: what's safe right now and how long is left. */
  renderBreak(game, brk, playing) {
    const box = $('hud-break');
    const show = playing && !!brk.current;
    setHidden(box, !show);
    document.body.classList.toggle('is-break', show);
    if (!show) return;
    setText(box.querySelector('.deskcheck__title'), brk.current.label);
    setText(box.querySelector('.deskcheck__body'), game.isManagement
      ? "Anyone in the Break Room or outside can't be reported. No desk checks."
      : "You're safe in the Break Room and outside. No desk checks.");
    setText(box.querySelector('.deskcheck__count'), formatClock(brk.current.endMs - brk.elapsed));
  }

  /** The punch clock: office time plus one segment per task section. */
  renderClock(game, day, brk) {
    const box = $('hud-clock');
    setHidden(box, !day);
    if (!day) return;
    const track = box.querySelector('.punchclock__track');
    if (track.childElementCount !== day.sections) {
      track.replaceChildren(...Array.from({ length: day.sections }, () => el('i')));
    }
    const segs = track.children;
    for (let i = 0; i < segs.length; i++) {
      const state = i < day.section ? 'done' : i === day.section ? 'now' : '';
      if (segs[i].className !== state) segs[i].className = state;
    }
    const fill = `${Math.round(day.sectionProgress * 100)}%`;
    if (segs[day.section] && segs[day.section].style.getPropertyValue('--fill') !== fill) {
      segs[day.section].style.setProperty('--fill', fill);
    }
    setText(box.querySelector('.punchclock__time'), game.officeTime(day.elapsed, day.lengthMs));
    // Break bands along the track
    const bands = box.querySelector('.punchclock__breaks');
    const bandKey = brk.windows.map((w) => w.id).join(',') + day.lengthMs;
    if (bands.dataset.key !== bandKey) {
      bands.dataset.key = bandKey;
      bands.replaceChildren(...brk.windows.map((w) => el('i', {
        title: w.label,
        style: `left:${(w.startMs / day.lengthMs) * 100}%;width:${((w.endMs - w.startMs) / day.lengthMs) * 100}%`,
      })));
    }
    let note = `${formatClock(day.timeLeft)} left`;
    if (brk.current) note = `${brk.current.label} now`;
    else if (brk.next && brk.next.startMs - day.elapsed < 45_000) note = `${brk.next.label} in ${formatClock(brk.next.startMs - day.elapsed)}`;
    if (!day.running && game.phase === PHASE.MEETING) note = 'Paused';
    setText(box.querySelector('.punchclock__note'), note);
    box.classList.toggle('is-late', day.timeLeft < 60_000);
  }

  renderActions(game, now, frame) {
    const self = game.self;
    const playing = game.phase === PHASE.PLAYING;
    const working = game.inOffice && playing;
    const roleShowing = !$('overlay-role').hidden;

    // Use / Watch (touch only)
    const use = $('act-use');
    const showUse = this.isTouch && playing && !roleShowing;
    setHidden(use, !showUse);
    if (showUse) {
      setText(use, game.inOffice ? 'Use' : 'Watch');
      use.classList.toggle('is-idle', game.inOffice && !frame.usable?.action);
    }

    // Report (Management)
    const report = $('act-report');
    const showReport = game.isManagement && working && !roleShowing;
    setHidden(report, !showReport);
    if (showReport) {
      const cd = Math.max(0, (self.reportReadyAt ?? 0) - now);
      const target = game.reportableTargets().find((t) => t.inRange);
      report.disabled = game.wifiDown || cd > 0 || !target;
      setText(report.querySelector('.act__sub'),
        game.wifiDown ? 'wifi is down'
          : cd > 0 ? `ready in ${Math.ceil(cd / 1000)}s` : target ? game.nameOf(target.id) : 'nobody in sight');
    }

    // Desk check (Management)
    const dc = $('act-deskcheck');
    const showDc = game.isManagement && working && !roleShowing;
    setHidden(dc, !showDc);
    if (showDc) {
      const active = game.deskCheckLeft(now) != null;
      const cd = self.deskCheckReadyAt == null ? Infinity : Math.max(0, self.deskCheckReadyAt - now);
      const brk = game.breakInfo(now);
      const breakSoon = brk.next && brk.next.startMs - brk.elapsed < game.settings.deskCheckWarning * 1000;
      dc.disabled = active || cd > 0 || !!brk.current || !!breakSoon || game.wifiDown;
      setText(dc.querySelector('.act__sub'),
        active || cd === Infinity ? 'underway'
          : game.wifiDown ? 'wifi is down'
          : brk.current ? 'not on a break'
            : breakSoon ? `${brk.next.label.toLowerCase()} soon`
              : cd > 0 ? `ready in ${Math.ceil(cd / 1000)}s` : `${game.settings.deskCheckWarning}s warning`);
    }

    // Desk terminal: shows up while you're sitting at your own desk.
    const term = $('act-terminal');
    const showTerm = working && !roleShowing && game.atOwnDesk && !game.terminal.open;
    setHidden(term, !showTerm);
    if (showTerm) {
      term.disabled = game.wifiDown;
      setText(term.querySelector('.act__sub'), game.wifiDown ? 'offline: no wifi' : '');
    }

    // Emotes: the only way to "talk" out on the floor.
    setHidden($('hud-emotes'), !working || roleShowing || game.terminal.open);
  }

  // ===========================================================================
  // Role reveal memo
  // ===========================================================================
  showRoleReveal(game, durationMs) {
    const role = game.role;
    const team = game.self?.team ?? [];
    const mgmtMate = team.find((t) => t.role === ROLE.MANAGEMENT);
    const snitchMates = team.filter((t) => t.role === ROLE.SNITCH).map((t) => game.nameOf(t.id));
    let title, body, teamLine = '';
    if (role === ROLE.MANAGEMENT) {
      title = "You're Management";
      body = 'Catch workers away from their desks and Report them, or call a desk check and send home anyone who doesn\u2019t make it back in time. Pretend to do your tasks so nobody suspects you.';
      teamLine = snitchMates.length
        ? `Your snitches: ${listNames(snitchMates)}. Coordinate in the back office on your desk terminal.`
        : "No snitches today. You're on your own.";
    } else if (role === ROLE.SNITCH) {
      title = "You're a snitch";
      body = 'Work like everyone else, but you\u2019re on Management\u2019s side. At your desk terminal you can read and post in both the workers\u2019 water cooler and Management\u2019s back office, so pass on what you hear. You win if Management wins. Snitches can\u2019t clock out.';
      teamLine = [
        mgmtMate ? `Management is ${game.nameOf(mgmtMate.id)}.` : '',
        snitchMates.length ? `Fellow snitches: ${listNames(snitchMates)}.` : '',
      ].filter(Boolean).join(' ');
    } else {
      title = "You're a worker";
      body = 'Tasks arrive one at a time through the day. Finish them all, then clock out at the time clock in the Lobby. Management is watching, and might call a desk check at any moment. Out on the floor you can only emote. To talk, open the terminal at your desk (it needs wifi). The water cooler channel is for workers, but careful: snitches are listening.';
    }
    setText($('role-to'), game.me?.name ?? 'You');
    setText($('role-title'), title);
    setText($('role-body'), body);
    setText($('role-team'), teamLine);
    setHidden($('role-team'), !teamLine);
    $('overlay-role').querySelector('.memo').classList.toggle('is-mgmt', game.isTeam);
    $('overlay-role').hidden = false;
    clearTimeout(this.roleTimer);
    this.roleTimer = setTimeout(() => ($('overlay-role').hidden = true), Math.max(1500, durationMs));
  }

  // ===========================================================================
  // Meeting
  // ===========================================================================
  renderMeeting(game, now) {
    const m = game.meeting;
    const overlay = $('overlay-meeting');
    if (!m) { overlay.hidden = true; this.keys.meeting = ''; return; }
    overlay.hidden = false;

    const msLeft = m.msLeft - (now - m.receivedAt);
    setText($('meeting-timer'), formatClock(msLeft));

    // Rebuild the cards only when meeting state or roster changes.
    const key = JSON.stringify([m.stage, m.voted, m.result, [...game.roster.values()].map((p) => p.status)]);
    if (key === this.keys.meeting) return;
    this.keys.meeting = key;

    const canVote = m.stage === 'discussing' && m.voters.includes(game.selfId) && !m.voted.includes(game.selfId);
    const results = m.stage === 'results' ? m.result : null;
    const ballotsFor = (targetId) => results
      ? Object.entries(results.ballots).filter(([, t]) => t === targetId).map(([voter]) => voter)
      : [];

    setText($('meeting-sub'), results
      ? 'Votes are in.'
      : `${game.nameOf(m.calledBy)} rang the bell. The workday clock is paused. ${m.voted.length} of ${m.voters.length} have voted.`);

    const cards = [...game.roster.values()].map((p) => {
      const inOffice = p.status === STATUS.ACTIVE || (results && p.id === results.ejectedId);
      const note = !inOffice ? (p.status === STATUS.HOME ? 'Clocked out' : 'Sent home')
        : m.voted.includes(p.id) ? 'Voted' : m.voters.includes(p.id) ? 'Thinking\u2026' : '';
      const ballots = ballotsFor(p.id);
      const teamRole = game.teamRoleOf(p.id);
      return el('li', {},
        el('button', {
          class: `vote-card ${inOffice ? '' : 'is-out'} ${results?.ballots?.[game.selfId] === p.id ? 'is-mine' : ''}`,
          disabled: !(canVote && inOffice && p.status === STATUS.ACTIVE),
          onclick: () => this.h.onVote(p.id),
        },
        el('span', { class: 'swatch', style: `background:${COLORS[p.colorId].hex}` }),
        el('span', {}, p.name, p.id === game.selfId ? ' (you)' : '',
          teamRole ? el('em', { class: 'team-mark' }, teamRole === ROLE.MANAGEMENT ? 'Management' : 'Snitch') : null,
          el('small', {}, note),
          ballots.length ? el('span', { class: 'ballots' }, ballots.map((v) => el('i', { style: `background:${game.colorOf(v)}`, title: game.nameOf(v) }))) : null)));
    });
    $('meeting-cards').replaceChildren(...cards);

    const skip = $('meeting-skip');
    skip.disabled = !canVote;
    setHidden(skip, !!results);

    const out = $('meeting-result');
    if (results) {
      const skips = ballotsFor('skip').length;
      let text;
      if (results.ejectedId) {
        const name = game.nameOf(results.ejectedId);
        if (results.ejectedRole === ROLE.MANAGEMENT) text = `${name} was Management.`;
        else if (results.ejectedRole === ROLE.SNITCH) text = `${name} was a snitch. They're sent home.`;
        else text = `${name} was an honest worker. They're sent home.`;
      } else {
        text = results.tie ? 'Tie vote. Nobody is sent home.' : 'Nobody was voted out.';
      }
      if (skips) text += ` (${skips} skipped)`;
      setText(out, text);
      out.hidden = false;
    } else {
      out.hidden = true;
    }
  }

  // ===========================================================================
  // Game over
  // ===========================================================================
  showGameOver(result, game) {
    const snitchIds = (result.snitches ?? []).map((s) => s.id);
    const iWasTeam = result.managementId === game.selfId || snitchIds.includes(game.selfId);
    const won = (result.winner === 'management') === iWasTeam;
    setText($('over-title'), result.winner === 'workers' ? 'Workers win' : 'Management wins');
    setText($('over-reason'), `${result.reason} ${won ? 'You won.' : 'You lost.'}`);
    const you = (id, name) => (id === game.selfId ? 'you' : name);
    let reveal = result.managementName ? `Management was ${you(result.managementId, result.managementName)}.` : '';
    if (result.snitches?.length) {
      reveal += ` ${result.snitches.length === 1 ? 'The snitch was' : 'The snitches were'} ${listNames(result.snitches.map((s) => you(s.id, s.name)))}.`;
    }
    setText($('over-mgmt'), reveal.trim());
    $('overlay-over').querySelector('.memo').classList.toggle('is-mgmt', result.winner === 'management');
    setHidden($('over-lobby'), !game.isHost);
    setHidden($('over-wait'), game.isHost);
    $('overlay-meeting').hidden = true;
    this.closeTerminalUi();
    $('overlay-over').hidden = false;
  }

  hideGameOver() { $('overlay-over').hidden = true; }

  // ===========================================================================
  // Toasts & feed
  // ===========================================================================
  toast(text, ms = 2600) {
    const node = $('toast');
    node.textContent = text;
    node.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (node.hidden = true), ms);
  }

  feed(text, kind = '') {
    const list = $('hud-feed');
    const item = el('li', { class: kind }, text);
    list.append(item);
    while (list.children.length > (this.compact() ? 3 : 5)) list.firstElementChild.remove();
    setTimeout(() => item.classList.add('fading'), 7000);
    setTimeout(() => item.remove(), 7700);
  }
}

