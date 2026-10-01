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
  dev(game, me, 'role', { role: ROLE.SNITCH });
  dev(game, me, 'start');
  assert.equal(game.phase, PHASE.PLAYING);
  assert.equal(me.role, ROLE.SNITCH);
  assert.equal(game.hostId, me.id);
  game.tick(T0 + START_FREEZE_MS + 10_000);
  assert.equal(game.phase, PHASE.PLAYING, 'no automatic win with one player');
});

test('sandbox: switch roles live; only one Management at a time', () => {
  const { game, outbox } = makeGame();
  const a = game.join('A', null, T0).player;
  const b = game.join('B', null, T0).player;
  dev(game, a, 'role', { role: ROLE.MANAGEMENT });
  dev(game, a, 'start');
  assert.equal(a.role, ROLE.MANAGEMENT);
  game.handleTerminal(b, true); // B is sitting at their desk terminal
  dev(game, b, 'role', { role: ROLE.MANAGEMENT }, T0 + 10);
  assert.equal(b.role, ROLE.MANAGEMENT);
  assert.equal(a.role, ROLE.WORKER, 'previous Management demoted');
  assert.ok(b.reportReadyAt <= T0 + 10, 'tools ready straight away');
  // B's open terminal now carries the back-office history it can read.
  assert.ok(outbox.some((m) => m.to === b.id && m.t === S2C.CHAT && m.d.channel === 'team'));
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

test('sandbox: skip to the next task, finish tasks, force a desk check', () => {
  const { game } = makeGame();
  const me = game.join('Me', null, T0).player;
  const other = game.join('Other', null, T0).player;
  dev(game, me, 'role', { role: ROLE.WORKER });
  dev(game, other, 'role', { role: ROLE.MANAGEMENT });
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
  dev(game, me, 'deskCheck', {}, now);
  assert.ok(game.deskCheck);
  game.tick(now + game.match.deskCheckWarning * 1000 + 10);
  assert.equal(me.status, STATUS.SENT_HOME, 'caught away from desk');
  dev(game, me, 'backToWork', {}, now + 20_000);
  assert.equal(me.status, STATUS.ACTIVE);
});

test('sandbox: real win rules are opt-in; end the match on demand', () => {
  const { game } = makeGame();
  const me = game.join('Me', null, T0).player;
  dev(game, me, 'role', { role: ROLE.MANAGEMENT });
  dev(game, me, 'start');
  dev(game, me, 'realWins', { on: true }, T0 + 10);
  assert.equal(game.phase, PHASE.ENDED, 'no workers left -> Management wins under real rules');
  dev(game, me, 'lobby');
  assert.equal(game.phase, PHASE.LOBBY);
  dev(game, me, 'start');
  dev(game, me, 'realWins', { on: false });
  dev(game, me, 'end', { winner: 'workers' }, T0 + 20);
  assert.equal(game.result.winner, 'workers');
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

// ---------------------------------------------------------------------------
// Worker: test rooms are off unless ENABLE_SANDBOX is "true" or the secret test code matches.
// ---------------------------------------------------------------------------
import worker from '../server/worker.js';

function fakeEnv(vars) {
  const inits = [];
  const ROOMS = {
    idFromName: (name) => name,
    get: () => ({ fetch: async (_url, init) => { inits.push(JSON.parse(init.body)); return new Response('ok'); } }),
  };
  return { env: { ROOMS, ...vars }, inits };
}
const mint = (env, body) => worker.fetch(new Request('http://x/api/rooms', { method: 'POST', body: JSON.stringify(body) }), env);

test('worker: test rooms off by default, unlocked only by the right test code', async () => {
  const { env, inits } = fakeEnv({ ENABLE_SANDBOX: 'false', SANDBOX_CODE: 'correct horse battery' });
  const config = await (await worker.fetch(new Request('http://x/api/config'), env)).json();
  assert.deepEqual(config, { sandbox: false, sandboxCode: true });

  assert.equal((await mint(env, { sandbox: true })).status, 403);
  assert.equal((await mint(env, { sandbox: true, testCode: 'wrong' })).status, 403);
  assert.equal((await mint(env, { sandbox: true, testCode: 'correct horse batter' })).status, 403);
  assert.equal(inits.length, 0, 'no room minted for a bad code');

  assert.equal((await mint(env, { sandbox: true, testCode: 'correct horse battery' })).status, 201);
  assert.equal(inits.at(-1).sandbox, true);
  assert.equal((await mint(env, {})).status, 201, 'normal rooms need no code');
  assert.equal(inits.at(-1).sandbox, false);

  // No code configured and the flag off: nothing unlocks it, not even an empty code.
  const off = fakeEnv({ ENABLE_SANDBOX: 'false' });
  assert.equal((await mint(off.env, { sandbox: true, testCode: '' })).status, 403);
  assert.equal((await mint(off.env, { sandbox: true, testCode: 'undefined' })).status, 403);
});
