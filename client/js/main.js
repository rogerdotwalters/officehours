/**
 * main — wires Network, ClientGame, Input, Renderer and UI together and runs
 * the render loop. Each module stays ignorant of the others; this file is the glue.
 */
import { Network } from './net/Network.js';
import { ClientGame } from './game/ClientGame.js';
import { Input } from './input/Input.js';
import { Renderer } from './render/Renderer.js';
import { Minimap } from './render/Minimap.js';
import { UI } from './ui/UI.js';
import { C2S, S2C, PFLAG } from '../shared/protocol.js';
import { PHASE, INTERACT_RANGE, ROOM_CODE_LENGTH, ROLE } from '../shared/constants.js';
import { distPointRect } from '../shared/mapBuilder.js';
import { TASKS_BY_ID } from '../shared/tasks.js';

const net = new Network();
const game = new ClientGame();
const canvas = document.getElementById('game-canvas');
const renderer = new Renderer(canvas);
const minimap = new Minimap(document.getElementById('hud-minimap'));
const lobbyPanel = document.getElementById('lobby-panel');
const chat = { all: [], team: [], crew: [] };
let awaitingRoleReveal = false;
let screen = 'menu';

// ---------------------------------------------------------------------------
// UI actions
// ---------------------------------------------------------------------------
const ui = new UI({
  async onCreate(name) {
    if (!name) return ui.setMenuError('Enter your name first.');
    ui.setMenuBusy(true);
    ui.setMenuError('');
    try {
      enterRoom(await net.createRoom(), name);
    } catch (err) {
      ui.setMenuError(err.message);
      ui.setMenuBusy(false);
    }
  },
  onJoin(name, code) {
    if (!name) return ui.setMenuError('Enter your name first.');
    if (code.length !== ROOM_CODE_LENGTH) return ui.setMenuError(`Room codes are ${ROOM_CODE_LENGTH} characters.`);
    ui.setMenuError('');
    ui.setMenuBusy(true);
    enterRoom(code, name);
  },
  onReady: () => net.send(C2S.READY, { ready: !game.me?.ready }),
  onStart: () => net.send(C2S.START),
  onLeave: () => leaveRoom(),
  onSettings: (settings) => net.send(C2S.SETTINGS, { settings }),
  onChat: (text, channel) => net.send(C2S.CHAT, { text, channel }),
  onVote: (targetId) => net.send(C2S.VOTE, { targetId }),
  onUse: () => interact(),
  onReport: () => report(),
  onDeskCheck: () => deskCheck(),
  onReturnToLobby: () => net.send(C2S.RETURN_TO_LOBBY),
  async onCopyCode() {
    const url = `${location.origin}${location.pathname}?room=${game.room?.code}`;
    try {
      await navigator.clipboard.writeText(url);
      ui.toast('Invite link copied.');
    } catch {
      ui.toast(`Room code: ${game.room?.code}`);
    }
  },
});

function show(name) {
  screen = name;
  ui.showScreen(name);
  if (name === 'game') renderer.resize();
}

function enterRoom(code, name) {
  localStorage.setItem('office-hours:name', name);
  history.replaceState(null, '', `?room=${code}`);
  net.connect(code, name);
}

function leaveRoom(errorText = '') {
  net.leave();
  game.reset();
  game.room = null;
  game.selfId = null;
  history.replaceState(null, '', location.pathname);
  ui.setMenuBusy(false);
  ui.setMenuError(errorText);
  show('menu');
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------
function interact() {
  if (game.inLobby) return;
  if (!game.inOffice) return game.cycleSpectate();
  const usable = game.nearestUsable();
  if (!usable) return ui.toast('Nothing to use here.', 1200);
  net.send(C2S.INTERACT, { objectId: usable.object.id });
}

function report(targetId) {
  if (!game.isManagement || !game.inOffice) return;
  const now = performance.now();
  if ((game.self.reportReadyAt ?? 0) > now) return ui.toast('Report is on cooldown.', 1200);
  const id = targetId ?? game.reportableTargets().find((t) => t.inRange)?.id;
  if (!id) return ui.toast('Nobody nearby is away from their desk.', 1500);
  net.send(C2S.REPORT, { targetId: id });
}

function deskCheck() {
  if (!game.isManagement || !game.inOffice) return;
  net.send(C2S.DESK_CHECK);
}

const input = new Input(canvas, {
  onInteract: interact,
  onReport: () => report(),
  onDeskCheck: deskCheck,
  // T opens your main private chat (water cooler, or back office for Management); B the back office.
  onChatKey(which) {
    if (game.inLobby || !game.role) return;
    if (which === 'team') return game.isTeam && ui.toggleChat('team');
    ui.toggleChat(game.isManagement ? 'team' : 'crew');
  },
  onCancel: () => net.send(C2S.CANCEL),
  onClick(sx, sy) {
    if (game.inLobby) return;
    const w = renderer.screenToWorld(sx, sy);
    const pid = game.playerAt(w.x, w.y);
    if (pid && pid !== game.selfId && game.isManagement) return report(pid);
    const obj = game.interactableAt(w.x, w.y);
    if (!obj || !game.local) return;
    if (distPointRect(game.local.x, game.local.y, obj) > INTERACT_RANGE) return ui.toast('Walk closer to use that.', 1200);
    net.send(C2S.INTERACT, { objectId: obj.id });
  },
});

// ---------------------------------------------------------------------------
// Server messages
// ---------------------------------------------------------------------------
net.on(S2C.WELCOME, (msg) => {
  game.selfId = msg.playerId;
  ui.setMenuBusy(false);
});

net.on(S2C.ROOM, (room) => {
  const prev = game.room ? game.phase : null;
  game.applyRoom(room, performance.now());
  if (room.phase === PHASE.LOBBY && prev !== PHASE.LOBBY) {
    game.reset();
    ui.hideOverlays();
    chat.team = [];
    chat.crew = [];
  }
  if (screen !== 'game') show('game');
  ui.renderLobby(game, performance.now());
  ui.renderChat('all', chat.all, game);
});

net.on(S2C.GAME_START, () => {
  game.reset();
  chat.all = [];
  chat.team = [];
  chat.crew = [];
  ui.resetMatchUi();
  ui.renderChat('team', chat.team, game);
  ui.renderChat('crew', chat.crew, game);
  awaitingRoleReveal = true;
  show('game');
});

net.on(S2C.SELF, (self) => {
  game.applySelf(self, performance.now());
  if (awaitingRoleReveal) {
    awaitingRoleReveal = false;
    ui.showRoleReveal(game, self.freezeMs);
  }
});

net.on(S2C.SNAPSHOT, (snap) => game.applySnapshot(snap, performance.now()));

net.on(S2C.MEETING, (m) => {
  game.meeting = m.stage === 'closed' ? null : { ...m, receivedAt: performance.now() };
});

net.on(S2C.CHAT, (msg) => {
  const channel = ['team', 'crew'].includes(msg.channel) ? msg.channel : 'all';
  if (msg.backlog) chat[channel] = msg.backlog;
  if (msg.line) {
    chat[channel].push(msg.line);
    if (msg.line.from !== game.selfId) ui.noteUnread(channel, game);
  }
  if (chat[channel].length > 60) chat[channel] = chat[channel].slice(-60);
  ui.renderChat(channel, chat[channel], game);
});

net.on(S2C.EVENT, (e) => {
  const you = e.playerId === game.selfId;
  const who = you ? 'You' : e.name;
  switch (e.kind) {
    case 'new_task': {
      const def = TASKS_BY_ID.get(e.taskId);
      return ui.feed(`${e.last ? 'Last task of the day' : 'New task'}: ${def?.label ?? 'something'}.`);
    }
    case 'reported': return ui.feed(`${who} got caught in the ${e.where === 'Hallway' ? 'hallway' : e.where} and sent home.`, 'bad');
    case 'went_home': return ui.feed(`${who} clocked out for the day.`, 'good');
    case 'meeting': return ui.feed(`${who} called an all-hands meeting.`);
    case 'desk_check':
      if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
      return ui.feed(`Desk check! Everyone has ${e.seconds} seconds to get to their desk.`, 'bad');
    case 'desk_check_done': {
      const names = e.caught.map((c) => (c.id === game.selfId ? 'you' : c.name));
      return ui.feed(names.length ? `Desk check over. Sent home: ${names.join(', ')}.` : 'Desk check over. Everyone was at their desk.', names.length ? 'bad' : 'good');
    }
    case 'ejected': {
      const what = e.role === ROLE.MANAGEMENT ? 'Management' : e.role === ROLE.SNITCH ? 'a snitch' : 'a worker';
      return ui.feed(`${who} ${you ? 'were' : 'was'} voted out. ${you ? 'You were' : 'They were'} ${what}.`, 'bad');
    }
    case 'left': return ui.feed(`${e.name} left the building.`);
  }
});

net.on(S2C.GAME_OVER, (result) => {
  game.meeting = null;
  ui.renderMeeting(game, performance.now());
  ui.showGameOver(result, game);
});

net.on(S2C.TOAST, (msg) => ui.toast(msg.text));

net.on(S2C.ERROR, (err) => {
  if (screen === 'menu' || ['not_found', 'full', 'in_progress'].includes(err.code)) leaveRoom(err.message);
  else ui.toast(err.message);
});

net.on('reconnecting', () => ui.toast('Connection dropped. Reconnecting\u2026', 3000));
net.on('disconnected', (e) => {
  if (e.code === 4001) return leaveRoom('You opened this room in another tab.');
  if (e.code === 4404) return leaveRoom('No room with that code.');
  leaveRoom('Lost connection to the server.');
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let lastFrame = performance.now();
let sentDir = { dx: 0, dy: 0 };
let lastInputSent = 0;
let lastLobbyRender = 0;

function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  input.enabled = screen === 'game' && (game.phase === PHASE.PLAYING || game.phase === PHASE.LOBBY);
  const dir = game.canMove(now) ? input.direction() : { dx: 0, dy: 0 };

  // Send movement intent when it changes, plus a slow heartbeat while moving.
  const changed = dir.dx !== sentDir.dx || dir.dy !== sentDir.dy;
  if (changed || ((dir.dx || dir.dy) && now - lastInputSent > 1000)) {
    net.send(C2S.INPUT, dir);
    sentDir = dir;
    lastInputSent = now;
  }

  if (screen === 'game' && game.room) {
    // In the lobby, keep the waiting room centred in the space beside/above the folder.
    let insetR = 0, insetB = 0;
    if (game.inLobby) {
      const r = lobbyPanel.getBoundingClientRect();
      if (r.width) {
        if (r.left > window.innerWidth * 0.3) insetR = Math.round(window.innerWidth - r.left);
        else insetB = Math.round(window.innerHeight - r.top);
      }
    }
    renderer.setInsets(insetR, insetB);
    game.update(dt, dir, now);
    const usable = game.phase === PHASE.PLAYING ? game.nearestUsable() : null;
    const atDesk = !!(game.entities.get(game.selfId)?.flags & PFLAG.AT_DESK);
    renderer.render(game, now, { usable });
    if (!game.inLobby) {
      minimap.render(game, now);
      ui.renderHud(game, now, { usable, atDesk });
      ui.renderMeeting(game, now);
    } else if (now - lastLobbyRender > 500) {
      // Pending setting edits expire on a timer, so refresh the steppers now and then.
      lastLobbyRender = now;
      ui.renderSettings(game, now);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------------------
// Boot: ?room=CODE in the URL pre-fills the join form, and rejoins automatically
// after a refresh if we still hold a session token for that room.
// ---------------------------------------------------------------------------
const urlCode = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
if (urlCode) {
  ui.setMenuCode(urlCode);
  const savedName = localStorage.getItem('office-hours:name');
  if (savedName && sessionStorage.getItem(net.tokenKey(urlCode))) enterRoom(urlCode, savedName);
}
show('menu');
