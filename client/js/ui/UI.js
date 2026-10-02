/**
 * UI — every DOM element on top of the canvas: menu, lobby folder (people,
 * house rules, chat), in-game HUD (to-do note, punch clock, actions, back office),
 * role memo, meeting, game over, toasts and the event feed.
 *
 * User-supplied text (names, chat) is always inserted with textContent, never
 * innerHTML, so it can't inject markup.
 */
import { COLORS, PHASE, STATUS, ROLE } from '../../shared/constants.js';
import { TASKS_BY_ID, TARGET_HINT, rarityOf, taskVersion, SHENANIGANS } from '../../shared/tasks.js';
import { PRANK_CONTENT } from '../../shared/minigames/prank.js';
import { SETTINGS_SPEC, effectiveSlackers } from '../../shared/settings.js';

const $ = (id) => document.getElementById(id);
const PENDING_MS = 1500;
const EMPTY_CHAT = {
  all: 'No messages yet.',
  team: 'Nothing yet. Coordinate your shenanigans. Nobody else can see this.',
  crew: 'Nothing yet. Compare notes on who smells like fish. (Careful: slackers read this too.)',
};
const CHAT_PANEL = { team: 'team-chat', crew: 'crew-chat' }; // how long a host's local setting edit wins over the last server echo

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
    this.unread = { all: 0, team: 0, crew: 0 };
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

    // ---- Chat forms: data-chat-form="all" | "team" ----
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
    $('act-team').addEventListener('click', () => this.toggleChat('team'));
    $('act-crew').addEventListener('click', () => this.toggleChat('crew'));
    for (const btn of document.querySelectorAll('[data-close-chat]')) btn.addEventListener('click', () => this.closeChats());
    // Slackers have both chats; let them hop between them without closing first.
    for (const btn of document.querySelectorAll('[data-switch-chat]')) btn.addEventListener('click', () => this.toggleChat(btn.dataset.switchChat, true));
    $('meeting-skip').addEventListener('click', () => this.h.onVote('skip'));
    $('over-lobby').addEventListener('click', () => this.h.onReturnToLobby());
    $('hr-cancel').addEventListener('click', () => this.hideHrForm());
    $('hr-submit').addEventListener('click', () => {
      if (!this.hrPick) return;
      this.hrSubmit?.(this.hrPick);
      this.hideHrForm();
    });
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
    for (const id of ['overlay-role', 'overlay-meeting', 'overlay-over', 'overlay-hr']) $(id).hidden = true;
    this.closeChats();
  }

  /** Called when a new match starts. */
  resetMatchUi() {
    this.unread.team = 0;
    this.unread.crew = 0;
    this.renderUnread();
    this.closeChats();
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
    const slackers = effectiveSlackers({ slackers: this.settingValue(game, 'slackers', now) }, players);
    const minutes = this.settingValue(game, 'workdayMinutes', now);
    const tasks = this.settingValue(game, 'tasks', now);
    const perTask = Math.round((minutes * 60) / tasks);
    const days = this.settingValue(game, 'days', now);
    setText($('settings-note'),
      `${host ? 'You set the rules for everyone.' : 'The host sets these.'} `
      + `${days} ${days === 1 ? 'day' : 'days'} of ${minutes} minutes, a new task every ${perTask} seconds. With ${players} ${players === 1 ? 'person' : 'people'}, `
      + `${slackers} ${slackers === 1 ? 'person' : 'people'} would secretly be a slacker.`);
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
    if (CHAT_PANEL[channel] && $(CHAT_PANEL[channel]).hidden) this.unread[channel]++;
    this.renderUnread();
  }

  renderUnread() {
    for (const [id, n] of [['lobby-unread', this.unread.all], ['team-unread', this.unread.team], ['crew-unread', this.unread.crew]]) {
      setText($(id), String(n));
      setHidden($(id), n === 0);
    }
  }

  /** Open or close a private chat panel ('team' = back office, 'crew' = water cooler). */
  toggleChat(channel, open = $(CHAT_PANEL[channel]).hidden) {
    for (const [ch, id] of Object.entries(CHAT_PANEL)) setHidden($(id), !(open && ch === channel));
    if (!open) return;
    this.unread[channel] = 0;
    this.renderUnread();
    const panel = $(CHAT_PANEL[channel]);
    const log = panel.querySelector('.chat__log');
    log.scrollTop = log.scrollHeight;
    if (!this.isTouch) panel.querySelector('input').focus();
  }

  closeChats() {
    for (const id of Object.values(CHAT_PANEL)) setHidden($(id), true);
  }

  // ===========================================================================
  // HUD (called every frame; only writes to the DOM when something changed)
  // ===========================================================================
  renderHud(game, now, frame) {
    if (game.inLobby) return;
    const self = game.self;
    const room = game.room;
    const playing = game.phase === PHASE.PLAYING;
    const day = game.dayInfo(now);

    // Role tag
    const roleTag = $('hud-role');
    setText(roleTag, !self ? '' : game.isSlacker ? 'Slacker' : 'Productive');
    roleTag.classList.toggle('is-mgmt', game.isSlacker);

    const brk = game.breakInfo(now);
    if (game.isSlacker) this.renderShenanigans(game, now);
    else this.renderTasks(game, day, brk);
    this.renderClock(game, day, brk);
    this.renderBreak(game, brk, playing);

    // Top pills
    const cam = game.cameraTarget();
    let where = game.map.roomName(cam.x, cam.y);
    if (cam.spectating) where = `Watching ${game.nameOf(cam.spectating)}`;
    setText($('hud-room'), where);
    const progress = room?.progress;
    this.renderMeters(progress);

    // Status banner
    let banner = '';
    const freezeLeft = (self?.freezeUntil ?? 0) - now;
    const watch = this.isTouch ? 'Tap Watch to follow someone else.' : 'Press E to watch someone else.';
    if (self?.status === STATUS.SENT_HOME) banner = `You're fired! Clear out your desk. ${watch}`;
    else if (self?.status === STATUS.SICK) banner = `You went home sick. Back tomorrow. ${watch}`;
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
      const def = game.version(self.active.taskId);
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
      setText($('hud-task-title'), 'To do');
      $('hud-tasks').classList.remove('is-slacker');
      setText($('hud-task-count'), total ? `${doneCount}/${total}` : '');
      const items = tasks.map((t) => {
        const def = game.version(t.id);
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

  /** Slackers: no to-do list, a menu of shenanigans instead. */
  renderShenanigans(game, now) {
    const self = game.self;
    const wait = Math.max(0, (self?.receivedAt ?? 0) + (self?.shenaniganReadyIn ?? 0) - now);
    const key = JSON.stringify([self?.prankedToday, self?.status, Math.ceil(wait / 1000) > 0]);
    if (key !== this.keys.tasks) {
      this.keys.tasks = key;
      setText($('hud-task-title'), 'Shenanigans');
      setText($('hud-task-count'), '');
      $('hud-tasks').classList.add('is-slacker');
      $('hud-task-list').replaceChildren(...SHENANIGANS.map((s) => {
        const used = s.oncePerDay && self?.prankedToday;
        return el('li', { class: `shenanigan ${used ? 'done' : ''}` },
          el('span', {}, s.label,
            s.oncePerDay ? el('em', { class: 'rarity rarity--rare' }, 'once a day') : null,
            el('small', {}, TARGET_HINT[s.target] ?? '')));
      }));
    }
    const note = self?.status !== STATUS.ACTIVE ? '' : wait > 0 ? `Lie low: next shenanigan in ${Math.ceil(wait / 1000)}s.` : 'Ready. Pick a target and don\u2019t get seen.';
    setText($('hud-next'), note);
    setHidden($('hud-next'), !note);
  }

  /** Today's meters: Productivity (with the target) and Chaos; the score is the difference. */
  renderMeters(progress) {
    const box = $('hud-meters');
    setHidden(box, !progress);
    if (!progress) return;
    const target = `${Math.round((progress.target ?? 0) * 100)}%`;
    const marker = box.querySelector('.meter__target');
    if (marker.style.left !== target) marker.style.left = target;
    const score = Math.max(0, Math.round(progress.productivity * 100) - Math.round(progress.chaos * 100));
    const sc = box.querySelector('.meter__score');
    setText(sc, `Today: ${score}% (target ${target})`);
    sc.classList.toggle('is-below', score < (progress.target ?? 0) * 100);
    for (const [cls, v] of [['prod', progress.productivity], ['chaos', progress.chaos]]) {
      const pct = `${Math.round(v * 100)}%`;
      const fill = box.querySelector(`.meter--${cls} .meter__fill`);
      if (fill.style.width !== pct) fill.style.width = pct;
      setText(box.querySelector(`.meter--${cls} .meter__pct`), pct);
    }
  }

  /** Break banner: what's on and how long is left. */
  renderBreak(game, brk, playing) {
    const box = $('hud-break');
    const show = playing && !!brk.current;
    setHidden(box, !show);
    document.body.classList.toggle('is-break', show);
    if (!show) return;
    setText(box.querySelector('.deskcheck__title'), brk.current.label);
    setText(box.querySelector('.deskcheck__body'), 'Lunch tasks are open. Grab a bite.');
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
    const dayTag = game.room?.days > 1 ? `Day ${game.room.dayNumber} of ${game.room.days}. ` : '';
    let note = `${dayTag}${formatClock(day.timeLeft)} left`;
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

    // Chats: water cooler (everyone), slackers' group chat (slackers with company)
    const chatsOpen = (playing || game.phase === PHASE.MEETING) && !roleShowing && !!game.role;
    const showTeam = chatsOpen && game.isSlacker && (game.self?.team?.length ?? 0) > 0;
    const showCrew = chatsOpen;
    setHidden($('act-team'), !showTeam);
    setHidden($('act-crew'), !showCrew);
    if (!showTeam) setHidden($('team-chat'), true);
    if (!showCrew) setHidden($('crew-chat'), true);
    for (const btn of document.querySelectorAll('[data-switch-chat]')) setHidden(btn, !showTeam);
    // Unread badges for the *other* chat show on the switch button too.
    for (const btn of document.querySelectorAll('[data-switch-chat]')) {
      const n = this.unread[btn.dataset.switchChat];
      const label = `${btn.dataset.switchChat === 'team' ? 'Slacker chat' : 'Water cooler'}${n ? ` (${n})` : ''}`;
      setText(btn, label);
    }
  }

  // ===========================================================================
  // Role reveal memo
  // ===========================================================================
  showRoleReveal(game, durationMs) {
    const role = game.role;
    const team = game.self?.team ?? [];
    const mates = team.map((t) => game.nameOf(t.id));
    let title, body, teamLine = '';
    if (role === ROLE.SLACKER) {
      title = "You're a slacker";
      body = 'Everyone else is here to work. You are not. You get no to-do list: cause chaos whenever you like. Microwave fish, doodle on the whiteboard, spike the water cooler, put something unprofessional on a coworker\u2019s screen. Chaos drags the day\u2019s score down, and a bad day means someone gets fired. Survive until the end of the week.';
      teamLine = mates.length ? `Fellow slackers: ${listNames(mates)}. Plan in your group chat.` : 'You\u2019re the only slacker. Act natural.';
    } else {
      title = "You're a productive employee";
      body = 'Do your tasks to fill the Productivity meter, and clean up messes. Someone here is a slacker. At 5 PM, if the day missed its target, management makes the team fire someone: make sure it\u2019s the slacker. Follow the fish smell, check the whiteboard, notice who was near the cooler. You can also ring the bell or report them to HR (wrong guess, you\u2019re fired).';
    }
    setText($('role-to'), game.me?.name ?? 'You');
    setText($('role-title'), title);
    setText($('role-body'), body);
    setText($('role-team'), teamLine);
    setHidden($('role-team'), !teamLine);
    $('overlay-role').querySelector('.memo').classList.toggle('is-mgmt', game.isSlacker);
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
    setHidden($('meeting-cards'), m.kind === 'eod' && (m.stage === 'report' || !m.voteNeeded));
    const results = m.stage === 'results' ? m.result : null;
    const ballotsFor = (targetId) => results
      ? Object.entries(results.ballots).filter(([, t]) => t === targetId).map(([voter]) => voter)
      : [];

    const eod = m.kind === 'eod';
    setText($('meeting-title'), eod ? `End of day ${m.report.day}${m.report.days > 1 ? ` of ${m.report.days}` : ''}` : 'All-hands meeting');
    this.renderReport(game, m);
    let sub;
    if (results) sub = !m.voteNeeded ? 'No one gets fired today.' : 'Votes are in.';
    else if (eod && m.stage === 'report') sub = 'Management has the numbers.';
    else if (eod) sub = `Management wants someone fired. Pick who. No skipping. ${m.voted.length} of ${m.voters.length} have voted.`;
    else sub = `${game.nameOf(m.calledBy)} rang the bell. The workday clock is paused. ${m.voted.length} of ${m.voters.length} have voted.`;
    setText($('meeting-sub'), sub);

    const cards = [...game.roster.values()].map((p) => {
      const inOffice = p.status === STATUS.ACTIVE || (results && p.id === results.ejectedId);
      const note = !inOffice ? 'Fired'
        : m.voted.includes(p.id) ? 'Voted' : m.voters.includes(p.id) ? 'Thinking\u2026' : '';
      const ballots = ballotsFor(p.id);
      const mate = game.isTeammate(p.id);
      return el('li', {},
        el('button', {
          class: `vote-card ${inOffice ? '' : 'is-out'} ${results?.ballots?.[game.selfId] === p.id ? 'is-mine' : ''}`,
          disabled: !(canVote && inOffice && p.status === STATUS.ACTIVE),
          onclick: () => this.h.onVote(p.id),
        },
        el('span', { class: 'swatch', style: `background:${COLORS[p.colorId].hex}` }),
        el('span', {}, p.name, p.id === game.selfId ? ' (you)' : '',
          mate ? el('em', { class: 'team-mark' }, 'Slacker') : null,
          el('small', {}, note),
          ballots.length ? el('span', { class: 'ballots' }, ballots.map((v) => el('i', { style: `background:${game.colorOf(v)}`, title: game.nameOf(v) }))) : null)));
    });
    $('meeting-cards').replaceChildren(...cards);

    const skip = $('meeting-skip');
    skip.disabled = !canVote;
    setHidden(skip, !!results || m.kind === 'eod');

    const out = $('meeting-result');
    if (results) {
      const skips = ballotsFor('skip').length;
      let text;
      if (results.ejectedId) {
        const name = game.nameOf(results.ejectedId);
        if (results.ejectedRole === ROLE.SLACKER) text = `${name} was a slacker. Fired!`;
        else text = `${name} was a productive employee. Fired anyway. Oops.`;
        if (results.drawn) text = `${results.tie ? 'Tie vote' : 'Nobody voted'}, so management picked at random. ${text}`;
      } else if (m.kind === 'eod' && !m.voteNeeded) {
        text = m.report.day >= m.report.days ? 'The week is over.' : 'Good work today. See you tomorrow.';
      } else {
        text = results.tie ? 'Tie vote. Nobody gets fired.' : 'Nobody was voted out.';
      }
      if (skips) text += ` (${skips} skipped)`;
      setText(out, text);
      out.hidden = false;
    } else {
      out.hidden = true;
    }
  }

  /** The end-of-day numbers, IT's findings, and the verdict. */
  renderReport(game, m) {
    const box = $('meeting-report');
    setHidden(box, m.kind !== 'eod');
    if (m.kind !== 'eod') return;
    const r = m.report;
    const key = JSON.stringify(r);
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    const below = r.score < r.target;
    const bar = (label, v, cls) => el('div', { class: `eod-row eod-row--${cls}` },
      el('span', {}, label), el('i', {}, el('b', { style: `width:${Math.min(100, v)}%` })), el('strong', {}, `${v}%`));
    box.replaceChildren(
      bar('Productivity', r.productivity, 'prod'),
      bar(`Chaos${r.messes ? ` (incl. ${r.messes} mess${r.messes === 1 ? '' : 'es'} left)` : ''}`, r.chaos, 'chaos'),
      el('p', { class: `eod-score ${below ? 'is-below' : ''}` }, `Score ${r.score}%. Target ${r.target}%.`,
        el('span', {}, below ? ' Management is not happy. Someone has to go.' : ' Management is satisfied. For now.')),
      ...r.itFired.map((f) => {
        const c = PRANK_CONTENT.find((x) => x.id === f.content);
        return el('p', { class: 'eod-it' }, el('b', {}, 'IT report: '),
          `${f.id === game.selfId ? 'you had' : `${f.name} had`} "${c?.label ?? 'something'}" on ${f.id === game.selfId ? 'your' : 'their'} screen. `,
          el('span', { class: 'eod-censor' }, 'CENSORED'), ` ${f.id === game.selfId ? 'You\u2019re' : `${f.name} is`} fired.`);
      }));
  }

  // ===========================================================================
  // Game over
  // ===========================================================================
  showGameOver(result, game) {
    const slackerIds = (result.slackers ?? []).map((s) => s.id);
    const iWasSlacker = slackerIds.includes(game.selfId);
    const won = (result.winner === 'slackers') === iWasSlacker;
    setText($('over-title'), result.winner === 'slackers' ? 'Slackers win' : 'Productive employees win');
    setText($('over-reason'), `${result.reason} ${won ? 'You won.' : 'You lost.'}`);
    const you = (id, name) => (id === game.selfId ? 'you' : name);
    const reveal = `${slackerIds.length === 1 ? 'The slacker was' : 'The slackers were'} ${listNames(result.slackers.map((s) => you(s.id, s.name)))}.`
      + (result.day ? ` It ended on day ${result.day}.` : '');
    setText($('over-mgmt'), reveal);
    $('overlay-over').querySelector('.memo').classList.toggle('is-mgmt', result.winner === 'slackers');
    setHidden($('over-lobby'), !game.isHost);
    setHidden($('over-wait'), game.isHost);
    $('overlay-meeting').hidden = true;
    this.closeChats();
    $('overlay-over').hidden = false;
  }

  hideGameOver() { $('overlay-over').hidden = true; }

  // ===========================================================================
  // HR complaint form
  // ===========================================================================
  get hrOpen() { return !$('overlay-hr').hidden; }

  showHrForm(game, onSubmit) {
    this.hrSubmit = onSubmit;
    this.hrPick = null;
    $('hr-submit').disabled = true;
    const people = [...game.roster.values()].filter((p) => p.id !== game.selfId && p.status === STATUS.ACTIVE);
    $('hr-list').replaceChildren(...(people.length ? people.map((p) => el('li', {},
      el('label', { class: 'hrform__row' },
        el('input', {
          type: 'radio', name: 'hr-pick', value: p.id,
          onchange: () => { this.hrPick = p.id; $('hr-submit').disabled = false; },
        }),
        el('span', { class: 'swatch', style: `background:${COLORS[p.colorId].hex}` }),
        el('span', {}, p.name)))) : [el('li', { class: 'em-empty' }, 'Nobody left to complain about.')]));
    $('overlay-hr').hidden = false;
  }

  hideHrForm() { $('overlay-hr').hidden = true; }

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

