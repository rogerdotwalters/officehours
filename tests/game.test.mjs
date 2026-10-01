/**
 * Headless tests for the authoritative game logic. No Cloudflare runtime needed:
 *   node --test tests/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game/Game.js';
import {
  PHASE, STATUS, START_FREEZE_MS, REPORT_INITIAL_COOLDOWN_MS, MEETING_COOLDOWN_MS, TICK_MS, MAX_PLAYERS,
  BREAKER_INITIAL_COOLDOWN_MS, BREAKER_HOLD_MS, WIFI_OUTAGE_MS,
} from '../shared/constants.js';
import { S2C } from '../shared/protocol.js';
import { buildOfficeMap, distPointRect } from '../shared/mapBuilder.js';
import { positionBlocked } from '../shared/physics.js';
import { hasLineOfSight, canSee, visibilityPolygon } from '../shared/vision.js';

function makeGame() {
  const outbox = [];
  const game = new Game({
    code: 'TEST1',
    send: (id, t, d) => outbox.push({ to: id, t, d }),
    broadcast: (t, d) => outbox.push({ to: '*', t, d }),
  });
  return { game, outbox };
}

function startedGame(n = 4) {
  const { game, outbox } = makeGame();
  let now = 1_000_000;
  const players = [];
  for (let i = 0; i < n; i++) players.push(game.join(`P${i}`, null, now).player);
  players.slice(1).forEach((p) => game.handleReady(p, true));
  game.handleStart(players[0], now);
  assert.equal(game.phase, PHASE.PLAYING);
  const mgmt = players.find((p) => p.isManagement);
  const workers = players.filter((p) => !p.isManagement);
  return { game, outbox, players, mgmt, workers, now };
}

const lastToast = (outbox, id) => [...outbox].reverse().find((m) => m.to === id && m.t === S2C.TOAST)?.d.text;

test('map: every seat, meeting seat and spawn is free space', () => {
  const map = buildOfficeMap();
  for (const d of map.desks) assert.equal(positionBlocked(map, d.seat.x, d.seat.y, 14), false, d.id);
  for (const s of map.meetingSeats) assert.equal(positionBlocked(map, s.x, s.y, 14), false, JSON.stringify(s));
  assert.ok(map.desks.length >= MAX_PLAYERS);
});

test('lobby: room cap, unique names and colours, host start rules', () => {
  const { game } = makeGame();
  const a = game.join('Sam', null, 0).player;
  const b = game.join('sam', null, 0).player;
  assert.notEqual(a.name.toLowerCase(), b.name.toLowerCase());
  assert.notEqual(a.colorId, b.colorId);
  for (let i = 2; i < MAX_PLAYERS; i++) game.join(`X${i}`, null, 0);
  assert.equal(game.join('Late', null, 0).error.code, 'full');

  game.handleStart(b, 0); // not host
  assert.equal(game.phase, PHASE.LOBBY);
  game.handleStart(a, 0); // not everyone ready
  assert.equal(game.phase, PHASE.LOBBY);
});

test('roles: exactly one Management, roles never in public info', () => {
  const { players, outbox } = startedGame(6);
  assert.equal(players.filter((p) => p.isManagement).length, 1);
  const rooms = outbox.filter((m) => m.t === S2C.ROOM);
  for (const r of rooms) for (const p of r.d.players) assert.equal('role' in p, false);
  for (const s of outbox.filter((m) => m.t === S2C.SELF)) {
    const target = players.find((p) => p.id === s.to);
    assert.equal(s.d.role, target.role); // SELF only goes to its owner
  }
});

test('movement: frozen at start, then server moves by input and respects walls', () => {
  const { game, workers } = startedGame();
  const w = workers[0];
  let now = 1_000_000;
  const start = { x: w.x, y: w.y };
  game.handleInput(w, 0, 1);
  game.tick(now + 100);
  assert.deepEqual({ x: w.x, y: w.y }, start, 'frozen during role reveal');

  now += START_FREEZE_MS + 10;
  for (let i = 0; i < 200; i++) game.tick(now + i * TICK_MS);
  assert.ok(w.y > start.y, 'moved');
  assert.ok(w.y < 1400, 'stayed inside building');
  // A hacked client sending huge values still only gets a unit direction.
  game.handleInput(w, 9999, 0);
  assert.deepEqual(w.input, { dx: 1, dy: 0 });
});

test('tasks: must stay in range for the full duration', () => {
  const { game, workers } = startedGame();
  const w = workers[0];
  const now = 1_000_000 + START_FREEZE_MS + 10;
  const desk = game.map.getInteractable(w.deskId);

  game.handleInteract(w, w.deskId, now);
  assert.ok(w.activeTask, 'desk task started');
  const dur = w.activeTask.duration;
  game.tick(now + dur / 2);
  assert.equal(w.tasks.filter((t) => t.done).length, 0);
  game.tick(now + dur + 1);
  assert.equal(w.tasks.filter((t) => t.done).length, 1);

  // Far-away object is rejected.
  game.handleInteract(w, 'shredder', now + dur + 10);
  assert.equal(w.activeTask, null);
  assert.ok(desk);
});

test('reports: blocked at desk, on cooldown, out of range; allowed when caught away', () => {
  const { game, outbox, mgmt, workers } = startedGame();
  const w = workers[0];
  let now = 1_000_000 + START_FREEZE_MS + 10;

  // Cooldown at start
  mgmt.x = w.x; mgmt.y = w.y - 40;
  w.x = 300; w.y = 540; mgmt.x = 340; mgmt.y = 540; // both in the hallway
  game.handleReport(mgmt, w.id, now);
  assert.equal(w.status, STATUS.ACTIVE);
  assert.match(lastToast(outbox, mgmt.id), /cooldown/);

  now += REPORT_INITIAL_COOLDOWN_MS;
  // Worker at desk is safe
  const seat = game.roles.seatOf(w);
  w.x = seat.x; w.y = seat.y; mgmt.x = seat.x + 60; mgmt.y = seat.y;
  game.handleReport(mgmt, w.id, now);
  assert.equal(w.status, STATUS.ACTIVE);

  // Too far away
  w.x = 300; w.y = 540; mgmt.x = 1800; mgmt.y = 540;
  game.handleReport(mgmt, w.id, now);
  assert.equal(w.status, STATUS.ACTIVE);

  // Caught in the hallway
  mgmt.x = 400;
  game.handleReport(mgmt, w.id, now);
  assert.equal(w.status, STATUS.SENT_HOME);

  // Workers cannot report
  const w2 = workers[1];
  game.handleReport(w2, mgmt.id, now);
  assert.equal(mgmt.status, STATUS.ACTIVE);
});

test('meeting: voting out Management ends the game for workers', () => {
  const { game, mgmt, workers, players } = startedGame(4);
  let now = 1_000_000 + MEETING_COOLDOWN_MS + 10;
  const caller = workers[0];
  const bell = game.map.getInteractable('bell');
  caller.x = bell.x + bell.w / 2; caller.y = bell.y + bell.h + 20;
  game.handleInteract(caller, 'bell', now);
  assert.equal(game.phase, PHASE.MEETING);

  for (const p of players) game.handleVote(p, mgmt.id, now);
  game.tick(now + 10);     // everyone voted -> results
  assert.equal(game.meetings.current.stage, 'results');
  game.tick(now + 60_000); // results over
  assert.equal(game.phase, PHASE.ENDED);
  assert.equal(game.result.winner, 'workers');
});

test('meeting: tie ejects nobody and play resumes at desks', () => {
  const { game, mgmt, workers } = startedGame(4);
  const now = 1_000_000 + MEETING_COOLDOWN_MS + 10;
  game.startMeeting(workers[0], now);
  game.handleVote(workers[0], mgmt.id, now);
  game.handleVote(workers[1], workers[2].id, now);
  game.handleVote(workers[2], 'skip', now);
  game.handleVote(mgmt, 'skip', now);
  game.tick(now + 10);
  assert.equal(game.meetings.current.result.ejectedId, null);
  game.tick(now + 60_000);
  assert.equal(game.phase, PHASE.PLAYING);
  const seat = game.roles.seatOf(workers[1]);
  assert.deepEqual({ x: workers[1].x, y: workers[1].y }, seat);
});

test('win: enough workers clock out', () => {
  const { game, workers } = startedGame(5); // 4 workers -> goal 2
  const now = 1_000_000 + START_FREEZE_MS + 10;
  const clock = game.map.getInteractable('time_clock');
  for (const w of workers.slice(0, 2)) {
    w.tasks.forEach((t) => (t.done = true));
    w.x = clock.x + clock.w / 2; w.y = clock.y - 20;
    game.handleInteract(w, 'time_clock', now);
  }
  assert.equal(game.phase, PHASE.ENDED);
  assert.equal(game.result.winner, 'workers');
});

test('win: Management wins when the goal becomes unreachable', () => {
  const { game, mgmt, workers } = startedGame(3); // 2 workers -> goal 1
  let now = 1_000_000 + REPORT_INITIAL_COOLDOWN_MS + 10;
  for (const w of workers) {
    w.x = 300; w.y = 540; mgmt.x = 350; mgmt.y = 540;
    game.handleReport(mgmt, w.id, now);
    now += 30_000;
  }
  assert.equal(game.phase, PHASE.ENDED);
  assert.equal(game.result.winner, 'management');
});

test('reconnect: token resumes the same player mid-game; strangers cannot join', () => {
  const { game, workers } = startedGame();
  const w = workers[0];
  game.onDisconnect(w.id, 1_000_000);
  assert.equal(game.join('Intruder', null, 1_000_001).error.code, 'in_progress');
  const again = game.join('whatever', w.token, 1_000_002);
  assert.equal(again.player, w);
  assert.equal(again.resumed, true);
});

test('map: every desk, prop and meeting seat is reachable on foot', () => {
  const map = buildOfficeMap();
  const STEP = 8;
  const key = (x, y) => `${x},${y}`;
  const start = map.desks[0].seat;
  const sx = Math.round(start.x / STEP) * STEP;
  const sy = Math.round(start.y / STEP) * STEP;
  const seen = new Set([key(sx, sy)]);
  const queue = [[sx, sy]];
  while (queue.length) {
    const [x, y] = queue.pop();
    for (const [dx, dy] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]]) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (seen.has(k) || positionBlocked(map, nx, ny, 14)) continue;
      seen.add(k);
      queue.push([nx, ny]);
    }
  }
  const points = [...seen].map((k) => k.split(',').map(Number));
  const reachable = (test) => points.some(([x, y]) => test(x, y));
  for (const o of map.interactables) {
    assert.ok(reachable((x, y) => distPointRect(x, y, o) <= 40), `can't reach ${o.id}`);
  }
  for (const d of map.desks) assert.ok(reachable((x, y) => Math.hypot(x - d.seat.x, y - d.seat.y) < 12), `seat ${d.id}`);
  for (const s of map.meetingSeats) assert.ok(reachable((x, y) => Math.hypot(x - s.x, y - s.y) < 12), 'meeting seat');
});

// ---------------------------------------------------------------------------
// Line of sight, breaker box / wifi, social meter, desk terminal
// ---------------------------------------------------------------------------

const lastSnapFor = (outbox, id) => [...outbox].reverse().find((m) => m.to === id && m.t === S2C.SNAPSHOT)?.d.p.map((e) => e[0]);

/** Stand next to the breaker and hold it until it flips. Returns the new time. */
function flipBreaker(game, p, now) {
  const b = game.map.getInteractable('breaker');
  p.x = b.x + b.w / 2; p.y = b.y - 22;
  game.handleInteract(p, 'breaker', now);
  assert.ok(p.activeTask, 'breaker hold started');
  now += BREAKER_HOLD_MS + 10;
  game.tick(now);
  return now;
}

test('vision: walls block sight, open floor and doorways do not', () => {
  const map = buildOfficeMap();
  // Open Office A and the Conference Room are separated by walls.
  assert.equal(hasLineOfSight(map, 300, 200, 900, 200), false);
  // Same room, nothing in between but desks.
  assert.equal(hasLineOfSight(map, 100, 200, 500, 200), true);
  // Straight through Open Office A's south door into the hallway.
  assert.equal(hasLineOfSight(map, 320, 300, 320, 560), true);
  // Around the corner: deep inside Open Office A vs. the hallway off to the side.
  assert.equal(hasLineOfSight(map, 60, 300, 620, 560), false);
  // Too far, even with a clear view down the hallway.
  assert.equal(canSee(map, { x: 40, y: 540 }, { x: 1900, y: 540 }), false);
  assert.ok(visibilityPolygon(map, 320, 540).length > 50);
});

test('vision: snapshots only include colleagues you can see', () => {
  const { game, outbox, workers, mgmt } = startedGame(4);
  const [a, b] = workers;
  const now = 1_000_000 + START_FREEZE_MS + 10;
  a.x = 300; a.y = 200;       // Open Office A
  b.x = 1000; b.y = 380;      // Conference Room
  mgmt.x = 320; mgmt.y = 540; // hallway outside Open Office A's door
  game.tick(now);
  const seenByA = lastSnapFor(outbox, a.id);
  assert.ok(seenByA.includes(a.id), 'always see yourself');
  assert.ok(!seenByA.includes(b.id), 'not through the wall');
  assert.ok(seenByA.includes(mgmt.id), 'through the open door');

  // Spectators (clocked out / sent home) see everyone.
  workers[2].status = STATUS.HOME;
  game.tick(now + TICK_MS);
  const seenBySpectator = lastSnapFor(outbox, workers[2].id);
  assert.ok(seenBySpectator.includes(b.id) && seenBySpectator.includes(a.id));
});

test('reports need line of sight', () => {
  const { game, outbox, mgmt, workers } = startedGame();
  const w = workers[0];
  const now = 1_000_000 + REPORT_INITIAL_COOLDOWN_MS + 10;
  // Close, but on the other side of Open Office A's south wall.
  w.x = 600; w.y = 420; mgmt.x = 600; mgmt.y = 500;
  game.handleReport(mgmt, w.id, now);
  assert.equal(w.status, STATUS.ACTIVE);
  assert.match(lastToast(outbox, mgmt.id), /can't see/);
});

test('breaker: cooldown at start, outage blocks reports, then the wifi comes back', () => {
  const { game, outbox, mgmt, workers } = startedGame();
  let now = 1_000_000 + START_FREEZE_MS + 10;
  const w = workers[0];
  const b = game.map.getInteractable('breaker');

  w.x = b.x + b.w / 2; w.y = b.y - 22;
  game.handleInteract(w, 'breaker', now);
  assert.equal(w.activeTask, null);
  assert.match(lastToast(outbox, w.id), /won't budge/);

  now = 1_000_000 + Math.max(BREAKER_INITIAL_COOLDOWN_MS, REPORT_INITIAL_COOLDOWN_MS) + 10;
  now = flipBreaker(game, w, now);
  assert.equal(game.wifi.down, true);
  assert.equal(game.roomState().wifi.down, true);

  // Caught in the hallway, but there's no wifi to file the report.
  w.x = 300; w.y = 540; mgmt.x = 340; mgmt.y = 540;
  game.handleReport(mgmt, w.id, now);
  assert.equal(w.status, STATUS.ACTIVE);
  assert.match(lastToast(outbox, mgmt.id), /wifi/i);

  game.tick(now + WIFI_OUTAGE_MS + 10);
  assert.equal(game.wifi.down, false);
  game.handleReport(mgmt, w.id, now + WIFI_OUTAGE_MS + 20);
  assert.equal(w.status, STATUS.SENT_HOME);
});

test('breaker: anyone can switch the power back on early', () => {
  const { game, mgmt, workers } = startedGame();
  let now = 1_000_000 + BREAKER_INITIAL_COOLDOWN_MS + 10;
  now = flipBreaker(game, workers[0], now);
  assert.equal(game.wifi.down, true);
  now = flipBreaker(game, mgmt, now);
  assert.equal(game.wifi.down, false);
});

test('social meter: outage tasks by workers fill it, and a full meter wins', () => {
  const { game, workers, mgmt } = startedGame(3); // 2 workers -> goal 3
  let now = 1_000_000 + BREAKER_INITIAL_COOLDOWN_MS + 10;
  now = flipBreaker(game, workers[0], now);
  assert.equal(game.workdayProgress().socialGoal, 3);

  const finish = (p, id, desk = false) => game.taskFinished(p, { id, label: id, desk }, now);
  finish(workers[0], 'emails', true); // desk task: not social
  finish(mgmt, 'coffee');             // Management's cover story: doesn't count
  assert.equal(game.social, 0);
  finish(workers[0], 'coffee');
  finish(workers[1], 'water');
  assert.equal(game.social, 2);
  assert.equal(game.phase, PHASE.PLAYING);
  finish(workers[1], 'lunch');
  assert.equal(game.phase, PHASE.ENDED);
  assert.equal(game.result.winner, 'workers');
});

test('social meter: tasks with the wifi up do not count', () => {
  const { game, workers } = startedGame();
  game.taskFinished(workers[0], { id: 'coffee', label: 'coffee' }, 1_000_000);
  assert.equal(game.social, 0);
});

test('terminal: only at your own desk with wifi; messages reach open terminals', () => {
  const { game, outbox, workers } = startedGame(4);
  const [a, b, c] = workers;
  let now = 1_000_000 + START_FREEZE_MS + 10;
  for (const p of [a, b, c]) Object.assign(p, game.roles.seatOf(p));

  // Chat while playing is terminal-only.
  game.handleChat(a, 'hello?', now);
  assert.equal(game.terminalLog.length, 0);

  c.x = 1000; c.y = 540; // away from desk
  game.handleTerminal(c, true, now);
  assert.equal(c.terminalOpen, false);
  assert.match(lastToast(outbox, c.id), /desk/);

  game.handleTerminal(a, true, now);
  game.handleTerminal(b, true, now);
  assert.ok(a.terminalOpen && b.terminalOpen);
  game.handleChat(a, 'I saw Red near the printer', now);
  const liveTo = (p) => outbox.filter((m) => m.to === p.id && m.t === S2C.TERMINAL && m.d.line).length;
  assert.equal(liveTo(b), 1);
  assert.equal(liveTo(c), 0, 'closed terminals get nothing live');

  // Walking away closes it.
  b.x = 1000; b.y = 540;
  game.tick(now += TICK_MS);
  assert.equal(b.terminalOpen, false);

  // The wifi going down knocks every terminal offline.
  now = 1_000_000 + BREAKER_INITIAL_COOLDOWN_MS + 10;
  flipBreaker(game, c, now);
  assert.equal(a.terminalOpen, false);
  game.handleTerminal(a, true, now);
  assert.equal(a.terminalOpen, false);
  assert.match(lastToast(outbox, a.id), /wifi/i);
});
