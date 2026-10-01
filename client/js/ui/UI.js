/**
 * UI — every DOM screen and overlay: menu, lobby time card, HUD, role memo,
 * meeting, game over, toasts and the event feed.
 *
 * User-supplied text (names, chat) is always inserted with textContent, never
 * innerHTML, so it can't inject markup.
 */
import { COLORS, PHASE, STATUS } from '../../shared/constants.js';
import { TASKS_BY_ID, TIMED_BY_ID, TARGET_HINT } from '../../shared/tasks.js';

const $ = (id) => document.getElementById(id);

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

export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.hudKey = { tasks: '', hint: '' };
    this.toastTimer = null;
    this.meetingKey = '';
    this.isTouch = document.body.classList.contains('is-touch') || matchMedia('(pointer: coarse)').matches;

    // ---- Menu ----
    $('menu-name').value = localStorage.getItem('office-hours:name') || '';
    $('menu-create').addEventListener('click', () => this.h.onCreate(this.menuName()));
    $('menu-join').addEventListener('click', () => this.h.onJoin(this.menuName(), this.menuCode()));
    $('menu-code').addEventListener('keydown', (e) => e.key === 'Enter' && this.h.onJoin(this.menuName(), this.menuCode()));
    $('menu-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

    // ---- Lobby ----
    $('lobby-ready').addEventListener('click', () => this.h.onReady());
    $('lobby-start').addEventListener('click', () => this.h.onStart());
    $('lobby-leave').addEventListener('click', () => this.h.onLeave());
    $('lobby-code').addEventListener('click', () => this.h.onCopyCode());

    // ---- Chat forms (lobby + meeting share one log) ----
    for (const form of document.querySelectorAll('[data-chat-form]')) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = form.querySelector('input');
        const text = input.value.trim();
        if (text) this.h.onChat(text);
        input.value = '';
      });
    }

    // ---- Desk terminal ----
    $('hud-terminal').addEventListener('click', () => this.h.onTerminal());
    $('terminal-close').addEventListener('click', () => this.h.onTerminal(false));
    $('terminal-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = e.target.querySelector('input');
      const text = input.value.trim();
      if (text) this.h.onChat(text);
      input.value = '';
    });
    $('terminal-form').querySelector('input').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.h.onTerminal(false); }
    });

    // ---- HUD / overlays ----
    $('hud-report').addEventListener('click', () => this.h.onReport());
    $('meeting-skip').addEventListener('click', () => this.h.onVote('skip'));
    $('over-lobby').addEventListener('click', () => this.h.onReturnToLobby());
    if (window.innerWidth < 600) $('hud-tasks').open = false;
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
    for (const s of ['menu', 'lobby', 'game']) setHidden($(`screen-${s}`), s !== name);
    if (name !== 'game') this.hideOverlays();
  }

  hideOverlays() {
    for (const id of ['overlay-role', 'overlay-meeting', 'overlay-over']) $(id).hidden = true;
  }

  // ===========================================================================
  // Lobby
  // ===========================================================================
  renderLobby(game) {
    const room = game.room;
    if (!room) return;
    setText($('lobby-code'), room.code);
    setText($('lobby-count'), String(room.players.length));
    setText($('lobby-max'), String(room.maxPlayers));

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
      ...Array.from({ length: Math.max(0, room.maxPlayers - room.players.length) }, () =>
        el('li', { class: 'empty' }, el('span'), el('span', {}, 'Open slot'), el('span'))),
    );

    const me = game.me;
    const isHost = game.isHost;
    const others = room.players.filter((p) => p.id !== room.hostId);
    const waiting = others.filter((p) => !p.ready);
    const enough = room.players.length >= room.minPlayers;

    setHidden($('lobby-ready'), isHost);
    setText($('lobby-ready'), me?.ready ? 'Not ready yet' : "I'm ready");
    setHidden($('lobby-start'), !isHost);
    $('lobby-start').disabled = !(enough && waiting.length === 0);

    let hint;
    if (!enough) hint = `Need at least ${room.minPlayers} people to start. Share code ${room.code}.`;
    else if (waiting.length) hint = `Waiting for ${waiting.map((p) => p.name).join(', ')} to get ready.`;
    else hint = isHost ? "Everyone's ready. Start the workday when you like." : 'Everyone is ready. Waiting for the host to start.';
    setText($('lobby-hint'), hint);
  }

  // ===========================================================================
  // Chat
  // ===========================================================================
  renderChat(lines, game) {
    for (const log of document.querySelectorAll('[data-chat-log]')) {
      const items = lines.length
        ? lines.map((l) => el('li', {}, el('b', { style: `color:${game.colorOf(l.from)}` }, game.nameOf(l.from)), ': ', l.text))
        : [el('li', { class: 'empty' }, 'No messages yet.')];
      log.replaceChildren(...items);
      log.scrollTop = log.scrollHeight;
    }
  }

  // ===========================================================================
  // HUD (called every frame; only writes to the DOM when something changed)
  // ===========================================================================
  renderHud(game, now, frame) {
    const self = game.self;
    const room = game.room;
    const mgmt = game.isManagement;

    // Role tag
    const roleTag = $('hud-role');
    setText(roleTag, self ? (mgmt ? 'Management' : 'Worker') : '');
    roleTag.classList.toggle('is-mgmt', mgmt);

    // Task list
    const tasks = self?.tasks ?? [];
    const activeId = self?.active?.taskId;
    const allDone = tasks.length > 0 && tasks.every((t) => t.done);
    const key = JSON.stringify([tasks, activeId, mgmt, self?.status]);
    if (key !== this.hudKey.tasks) {
      this.hudKey.tasks = key;
      setText($('hud-task-count'), tasks.length ? `${tasks.filter((t) => t.done).length}/${tasks.length}` : '');
      const items = tasks.map((t) => {
        const def = TASKS_BY_ID.get(t.id);
        return el('li', { class: [t.done && 'done', t.id === activeId && 'active'].filter(Boolean).join(' ') },
          el('span', {}, def.label, el('small', {}, TARGET_HINT[def.target] ?? '')));
      });
      if (allDone && !mgmt && self.status === STATUS.ACTIVE) {
        items.push(el('li', { class: 'active' }, el('span', {}, 'Clock out', el('small', {}, 'time clock, Lobby'))));
      }
      if (mgmt) items.push(el('li', { class: 'fake' }, el('span', {}, 'Your cover story. These tasks don\u2019t count, but doing them helps you blend in.')));
      $('hud-task-list').replaceChildren(...items);
    }

    // Top pills
    const cam = game.cameraTarget();
    let where = game.map.roomName(cam.x, cam.y);
    if (cam.spectating) where = `Watching ${game.nameOf(cam.spectating)}`;
    setText($('hud-room'), where);
    const progress = room?.progress;
    setText($('hud-progress'), progress ? `Clocked out ${progress.home} of ${progress.goal} needed` : '');

    // Social meter
    const social = $('hud-social');
    setHidden(social, !progress);
    if (progress) {
      const pct = Math.min(100, (progress.social / progress.socialGoal) * 100);
      social.querySelector('.meter__fill').style.width = `${pct}%`;
      setText(social.querySelector('.social-pill__count'), `${progress.social}/${progress.socialGoal}`);
    }

    // Wifi
    const wifi = $('hud-wifi');
    const wifiDown = game.wifiDown;
    setText(wifi, !game.wifi ? '' : wifiDown ? `Wifi down ${formatClock(game.wifi.until - now)}` : 'Wifi on');
    wifi.classList.toggle('is-down', wifiDown);

    // Status banner
    let banner = '';
    const freezeLeft = (self?.freezeUntil ?? 0) - now;
    if (self?.status === STATUS.HOME) banner = 'You clocked out. Enjoy your evening. Press E to watch someone else.';
    else if (self?.status === STATUS.SENT_HOME) banner = 'Management sent you home. Press E to watch someone else.';
    else if (game.phase === PHASE.PLAYING && freezeLeft > 0) banner = `Back to work in ${Math.ceil(freezeLeft / 1000)}`;
    setText($('hud-status'), banner);
    setHidden($('hud-status'), !banner || !$('overlay-role').hidden);

    // Interaction hint
    const usable = frame.usable;
    const keyLabel = this.isTouch ? '' : 'E';
    let hint = '';
    if (game.phase === PHASE.PLAYING && usable && !self?.active) {
      hint = usable.action ? `${keyLabel}|${usable.action}` : `|${usable.object.label}: nothing to do here`;
    }
    if (hint !== this.hudKey.hint) {
      this.hudKey.hint = hint;
      const node = $('hud-hint');
      if (hint) {
        const [k, text] = hint.split('|');
        node.replaceChildren(...(k ? [el('kbd', {}, k)] : []), text);
      }
      setHidden(node, !hint);
    }

    // Task progress bar (extrapolated between server updates)
    const bar = $('hud-taskbar');
    if (self?.active && game.phase === PHASE.PLAYING) {
      const def = TIMED_BY_ID.get(self.active.taskId);
      const p = Math.min(1, self.active.progress + (now - self.receivedAt) / def.duration);
      bar.firstElementChild.style.width = `${(p * 100).toFixed(1)}%`;
      setText(bar.lastElementChild, `${def.label}. Move to cancel.`);
      setHidden(bar, false);
    } else {
      setHidden(bar, true);
    }

    // Report button (Management only)
    const btn = $('hud-report');
    const showReport = mgmt && game.inOffice && game.phase === PHASE.PLAYING;
    setHidden(btn, !showReport);
    if (showReport) {
      const cd = Math.max(0, (self.reportReadyAt ?? 0) - now);
      const target = game.reportableTargets().find((t) => t.inRange);
      btn.disabled = wifiDown || cd > 0 || !target;
      setText(btn.querySelector('.report-btn__cd'),
        wifiDown ? 'wifi is down'
          : cd > 0 ? `ready in ${Math.ceil(cd / 1000)}s`
            : target ? game.nameOf(target.id) : 'nobody away from their desk in sight');
    }

    // Desk terminal button
    const termBtn = $('hud-terminal');
    const showTerm = game.phase === PHASE.PLAYING && game.inOffice && game.atOwnDesk && !game.terminal.open;
    setHidden(termBtn, !showTerm);
    if (showTerm) {
      termBtn.disabled = wifiDown;
      setText(termBtn.lastElementChild, wifiDown ? 'Terminal offline (no wifi)' : 'Open terminal');
    }
  }

  // ===========================================================================
  // Desk terminal
  // ===========================================================================
  renderTerminal(game) {
    const panel = $('terminal');
    const wasHidden = panel.hidden;
    setHidden(panel, !game.terminal.open);
    if (!game.terminal.open) {
      // Give the keyboard back to movement.
      if (panel.contains(document.activeElement)) document.activeElement.blur();
      return;
    }
    const lines = game.terminal.lines;
    const log = $('terminal-log');
    log.replaceChildren(
      el('li', { class: 'sys' }, 'Connected. Messages here reach every open terminal in the office.'),
      ...(lines.length ? [] : [el('li', { class: 'sys' }, 'No messages yet.')]),
      ...lines.map((l) => el('li', {}, el('b', { style: `color:${game.colorOf(l.from)}` }, game.nameOf(l.from)), ': ', l.text)),
    );
    log.scrollTop = log.scrollHeight;
    if (wasHidden && !this.isTouch) panel.querySelector('input').focus();
  }

  // ===========================================================================
  // Role reveal memo
  // ===========================================================================
  showRoleReveal(game, durationMs) {
    const mgmt = game.isManagement;
    setText($('role-to'), game.me?.name ?? 'You');
    setText($('role-title'), mgmt ? "You're Management" : "You're a worker");
    setText($('role-body'), mgmt
      ? 'Catch workers away from their desks and send them home with Report. Nobody else knows who you are, so keep it that way. Pretend to do your tasks.'
      : 'Finish your to-do list, then clock out at the time clock in the Lobby. Management is watching: when you leave your desk, keep an eye out.');
    $('overlay-role').querySelector('.memo').classList.toggle('is-mgmt', mgmt);
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
    if (!m) { overlay.hidden = true; this.meetingKey = ''; return; }
    overlay.hidden = false;

    const msLeft = m.msLeft - (now - m.receivedAt);
    setText($('meeting-timer'), formatClock(msLeft));

    // Rebuild the cards only when meeting state or roster changes.
    const key = JSON.stringify([m.stage, m.voted, m.result, [...game.roster.values()].map((p) => p.status)]);
    if (key === this.meetingKey) return;
    this.meetingKey = key;

    const canVote = m.stage === 'discussing' && m.voters.includes(game.selfId) && !m.voted.includes(game.selfId);
    const results = m.stage === 'results' ? m.result : null;
    const ballotsFor = (targetId) => results
      ? Object.entries(results.ballots).filter(([, t]) => t === targetId).map(([voter]) => voter)
      : [];

    setText($('meeting-sub'), results
      ? 'Votes are in.'
      : `${game.nameOf(m.calledBy)} rang the bell. Talk it over, then vote. ${m.voted.length} of ${m.voters.length} have voted.`);

    const cards = [...game.roster.values()].map((p) => {
      const inOffice = p.status === STATUS.ACTIVE || (results && p.id === results.ejectedId);
      const note = !inOffice ? (p.status === STATUS.HOME ? 'Clocked out' : 'Sent home')
        : m.voted.includes(p.id) ? 'Voted' : m.voters.includes(p.id) ? 'Thinking…' : '';
      const ballots = ballotsFor(p.id);
      return el('li', {},
        el('button', {
          class: `vote-card ${inOffice ? '' : 'is-out'} ${results?.ballots?.[game.selfId] === p.id ? 'is-mine' : ''}`,
          disabled: !(canVote && inOffice && p.status === STATUS.ACTIVE),
          onclick: () => this.h.onVote(p.id),
        },
        el('span', { class: 'swatch', style: `background:${COLORS[p.colorId].hex}` }),
        el('span', {}, p.name, p.id === game.selfId ? ' (you)' : '', el('small', {}, note),
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
        text = results.wasManagement
          ? `${game.nameOf(results.ejectedId)} was Management.`
          : `${game.nameOf(results.ejectedId)} was not Management. They're sent home.`;
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
    const iWasMgmt = result.managementId === game.selfId;
    const won = (result.winner === 'management') === iWasMgmt;
    setText($('over-title'), result.winner === 'workers' ? 'Workers win' : 'Management wins');
    setText($('over-reason'), `${result.reason} ${won ? 'You won.' : 'You lost.'}`);
    setText($('over-mgmt'), result.managementName ? `Management was ${iWasMgmt ? 'you' : result.managementName}.` : '');
    $('overlay-over').querySelector('.memo').classList.toggle('is-mgmt', result.winner === 'management');
    setHidden($('over-lobby'), !game.isHost);
    setHidden($('over-wait'), game.isHost);
    $('overlay-meeting').hidden = true;
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
    while (list.children.length > 5) list.firstElementChild.remove();
    setTimeout(() => item.classList.add('fading'), 7000);
    setTimeout(() => item.remove(), 7700);
  }
}
