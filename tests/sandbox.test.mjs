/**
 * Test rooms (server/dev/Sandbox.js). Delete this file if you remove the sandbox.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game/Game.js';
import { handleDevCommand } from '../server/dev/Sandbox.js';
import { PHASE, STATUS, ROLE, START_FREEZE_MS } from '../shared/constants.js';
import { S2C } from '../shared/protocol.js';

function makeGame(sandbox = true) {
  const outbox = [];
  const game = new Game({
    code: 'TEST1',
    sandbox,
    send: (id, t, d) => outbox.push({ to: id, t, d }),
    broadcast: (t, d) => outbox.push({ to: '*', t, d }),
  });
  return { game, outbox };
}
const T0 = 1_000_000;
const dev = (game, p, cmd, args = {}, now = T0) => handleDevCommand(game, p, { cmd, ...args }, now);

test('sandbox: start alone with your chosen role', () => {
  const { game } = makeGame();
  const me = game.join('Tester', null, T0).player;
  dev(game, me, 'role', { role: ROLE.SLACKER });
  dev(game, me, 'start');
  assert.equal(game.phase, PHASE.PLAYING);
  assert.equal(me.role, ROLE.SLACKER);
  assert.equal(game.hostId, me.id);
  game.tick(T0 + START_FREEZE_MS + 10_000);
  assert.equal(game.phase, PHASE.PLAYING, 'no automatic win with one player');
});

test('sandbox: switch roles live', () => {
  const { game, outbox } = makeGame();
  const a = game.join('A', null, T0).player;
  dev(game, a, 'role', { role: ROLE.PRODUCTIVE });
  dev(game, a, 'start');
  assert.equal(a.role, ROLE.PRODUCTIVE);
  dev(game, a, 'role', { role: ROLE.SLACKER }, T0 + 10);
  assert.equal(a.role, ROLE.SLACKER);
  assert.ok(outbox.some((m) => m.to === a.id && m.t === S2C.CHAT && m.d.channel === 'team'), 'gets the slacker chat');
});

test('sandbox: invite link joins mid-game; dummies wander and can be cleared', () => {
  const { game } = makeGame();
  const me = game.join('Me', null, T0).player;
  dev(game, me, 'start');
  const friend = game.join('Friend', null, T0 + 100);
  assert.ok(friend.player, 'joined while the match runs');
  assert.equal(friend.player.status, STATUS.ACTIVE);
  assert.ok(friend.player.deskId && friend.player.deskId !== me.deskId);
  assert.ok(friend.player.tasks.length >= 1);

  dev(game, me, 'addDummy');
  const dummy = [...game.players.values()].find((p) => p.dummy);
  assert.ok(dummy);
  const start = { x: dummy.x, y: dummy.y };
  for (let i = 0; i < 60; i++) game.tick(T0 + START_FREEZE_MS + i * 50);
  assert.notDeepEqual({ x: dummy.x, y: dummy.y }, start, 'dummy wandered');
  dev(game, me, 'clearDummies');
  assert.equal([...game.players.values()].some((p) => p.dummy), false);
});

test('sandbox: skip to the next task, finish tasks, teleport, go home and back', () => {
  const { game } = makeGame();
  const me = game.join('Me', null, T0).player;
  dev(game, me, 'role', { role: ROLE.PRODUCTIVE });
  dev(game, me, 'start');
  const now = T0 + START_FREEZE_MS + 100;
  assert.equal(me.tasks.length, 1);
  dev(game, me, 'nextTask', {}, now);
  assert.equal(me.tasks.length, 2);
  dev(game, me, 'allTasks', {}, now);
  assert.equal(me.tasks.length, game.match.tasks);
  dev(game, me, 'finishTasks', {}, now);
  assert.ok(me.tasks.every((t) => t.done));
  dev(game, me, 'teleport', { to: 'break' }, now);
  assert.equal(game.office.roomName(me.x, me.y), 'Break Room');
  dev(game, me, 'goHome', {}, now);
  assert.equal(me.status, STATUS.SENT_HOME);
  dev(game, me, 'backToWork', {}, now + 1000);
  assert.equal(me.status, STATUS.ACTIVE);
});

test('sandbox: real win rules are opt-in; end the match on demand', () => {
  const { game } = makeGame();
  const me = game.join('Me', null, T0).player;
  dev(game, me, 'role', { role: ROLE.PRODUCTIVE });
  dev(game, me, 'start');
  dev(game, me, 'realWins', { on: true }, T0 + 10);
  assert.equal(game.phase, PHASE.ENDED, 'no slackers at all -> productive win under real rules');
  dev(game, me, 'lobby');
  assert.equal(game.phase, PHASE.LOBBY);
  dev(game, me, 'start');
  dev(game, me, 'realWins', { on: false });
  dev(game, me, 'end', { winner: 'productive' }, T0 + 20);
  assert.equal(game.result.winner, 'productive');
});

test('sandbox: dev commands do nothing in normal rooms', async () => {
  const { GameRoom } = await import('../server/GameRoom.js');
  const room = Object.create(GameRoom.prototype);
  const { game } = makeGame(false);
  room.game = game;
  room.sockets = new Map();
  const me = game.join('Me', null, T0).player;
  room.dispatch(me, { t: 'dev', cmd: 'start' }, T0);
  assert.equal(game.phase, PHASE.LOBBY);
  room.dispatch(me, { t: 'dev', cmd: 'addDummy' }, T0);
  assert.equal(game.players.size, 1);
});
