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
import { C2S, S2C } from '../shared/protocol.js';
import { PHASE, INTERACT_RANGE, ROOM_CODE_LENGTH } from '../shared/constants.js';
import { distPointRect } from '../shared/mapBuilder.js';

const net = new Network();
const game = new ClientGame();
const canvas = document.getElementById('game-canvas');
const renderer = new Renderer(canvas);
const minimap = new Minimap(document.getElementById('hud-minimap'));
let chatLines = [];
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
  onChat: (text) => net.send(C2S.CHAT, { text }),
  onVote: (targetId) => net.send(C2S.VOTE, { targetId }),
  onReport: () => report(),
  onTerminal: (open) => toggleTerminal(open),
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
  ui.renderTerminal(game);
  game.room = null;
  game.selfId = null;
  history.replaceState(null, '', location.pathname);
  ui.setMenuBusy(false);
  ui.setMenuError(errorText);
  show('menu');
}

// ---------------------------------------------------------------------------
// Player actions (input callbacks)
// ---------------------------------------------------------------------------
function interact() {
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

/** Open/close the desk terminal. The server decides; this just pre-checks for a quick hint. */
function toggleTerminal(open = !game.terminal.open) {
  if (!open) {
    game.terminal.open = false;
    ui.renderTerminal(game);
    return net.send(C2S.TERMINAL, { open: false });
  }
  if (!game.inOffice || game.phase !== PHASE.PLAYING) return;
  if (!game.atOwnDesk) return ui.toast('Your terminal is at your desk.', 1500);
  if (game.wifiDown) return ui.toast('No wifi. Your terminal is offline.', 1500);
  net.send(C2S.TERMINAL, { open: true });
}

const input = new Input(canvas, {
  onInteract: interact,
  onReport: () => report(),
  onTerminal: () => toggleTerminal(),
  onCancel: () => net.send(C2S.CANCEL),
  onClick(sx, sy) {
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
  const prev = game.phase;
  game.applyRoom(room, performance.now());
  if (room.phase === PHASE.LOBBY) {
    if (prev !== PHASE.LOBBY) { game.reset(); ui.renderTerminal(game); }
    ui.hideGameOver();
    show('lobby');
  } else if (screen !== 'game') {
    show('game');
  }
  ui.renderLobby(game);
  ui.renderChat(chatLines, game);
});

net.on(S2C.GAME_START, () => {
  game.reset();
  ui.renderTerminal(game);
  chatLines = [];
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
  if (msg.backlog) chatLines = msg.backlog;
  if (msg.line) chatLines.push(msg.line);
  if (chatLines.length > 60) chatLines = chatLines.slice(-60);
  ui.renderChat(chatLines, game);
});

const TERMINAL_CLOSED = {
  left_desk: 'You left your desk. Terminal closed.',
  wifi: 'The wifi went down. Your terminal is offline.',
};

net.on(S2C.TERMINAL, (msg) => {
  const t = game.terminal;
  if (!msg.open) {
    t.open = false;
    if (TERMINAL_CLOSED[msg.reason]) ui.toast(TERMINAL_CLOSED[msg.reason], 2000);
  } else {
    t.open = true;
    if (msg.backlog) t.lines = msg.backlog;
    if (msg.line) t.lines.push(msg.line);
    if (t.lines.length > 60) t.lines = t.lines.slice(-60);
  }
  ui.renderTerminal(game);
});

net.on(S2C.EVENT, (e) => {
  const you = e.playerId === game.selfId;
  const who = you ? 'You' : e.name;
  switch (e.kind) {
    case 'reported': return ui.feed(`${who} got caught in the ${e.where === 'Hallway' ? 'hallway' : e.where} and sent home.`, 'bad');
    case 'went_home': return ui.feed(`${who} clocked out for the day.`, 'good');
    case 'meeting': return ui.feed(`${who} called an all-hands meeting.`);
    case 'ejected': return ui.feed(`${who} ${you ? 'were' : 'was'} voted out.`, 'bad');
    case 'left': return ui.feed(`${e.name} left the building.`);
    case 'wifi_down': return ui.feed(`Someone flipped the breaker. The wifi is down for ${Math.round(e.ms / 1000)}s, so nobody can be sent home. Go socialise!`, 'good');
    case 'wifi_up': return ui.feed(e.why === 'breaker' ? 'Someone switched the power back on. Wifi is up.' : 'The wifi is back. Management is watching again.', 'bad');
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

net.on('reconnecting', () => ui.toast('Connection dropped. Reconnecting…', 3000));
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

function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  input.enabled = screen === 'game' && game.phase === PHASE.PLAYING;
  const dir = game.canMove(now) ? input.direction() : { dx: 0, dy: 0 };

  // Send movement intent when it changes, plus a slow heartbeat while moving.
  const changed = dir.dx !== sentDir.dx || dir.dy !== sentDir.dy;
  if (changed || ((dir.dx || dir.dy) && now - lastInputSent > 1000)) {
    net.send(C2S.INPUT, dir);
    sentDir = dir;
    lastInputSent = now;
  }

  if (screen === 'game') {
    game.update(dt, dir, now);
    const usable = game.phase === PHASE.PLAYING ? game.nearestUsable() : null;
    renderer.render(game, now, { usable });
    minimap.render(game, now);
    ui.renderHud(game, now, { usable });
    ui.renderMeeting(game, now);
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
