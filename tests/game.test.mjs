/**
 * Headless tests for the authoritative game logic. No Cloudflare runtime needed:
 *   npm test   (node --test tests/*.test.mjs)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game/Game.js';
import { PHASE, STATUS, ROLE, START_FREEZE_MS, REPORT_INITIAL_COOLDOWN_MS, MEETING_COOLDOWN_MS, TICK_MS, MAX_PLAYERS, DESK_CHECK_INITIAL_DELAY_MS } from '../shared/constants.js';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../shared/settings.js';
import { LOBBY_ROOM } from '../shared/lobbyMap.js';
import { TASKS } from '../shared/tasks.js';
import { TaskSystem } from '../server/game/TaskSystem.js';
import { S2C } from '../shared/protocol.js';
import { buildOfficeMap, distPointRect } from '../shared/mapBuilder.js';
import { positionBlocked } from '../shared/physics.js';

function makeGame() {
  const outbox = [];
  const game = new Game({
    code: 'TEST1',
    send: (id, t, d) => outbox.push({ to: id, t, d }),
    broadcast: (t, d) => outbox.push({ to: '*', t, d }),
  });
  return { game, outbox };
}

function startedGame(n = 4, settings = { snitches: 0 }) {
  const { game, outbox } = makeGame();
  let now = 1_000_000;
  const players = [];
  for (let i = 0; i < n; i++) players.push(game.join(`P${i}`, null, now).player);
  game.handleSettings(players[0], settings);
  players.slice(1).forEach((p) => game.handleReady(p, true));
  game.handleStart(players[0], now);
  assert.equal(game.phase, PHASE.PLAYING);
  const mgmt = players.find((p) => p.isManagement);
  const workers = players.filter((p) => p.role === ROLE.WORKER);
  const snitches = players.filter((p) => p.isSnitch);
  return { game, outbox, players, mgmt, workers, snitches, now };
}

/** Mark every task of the day as handed out and done. */
function finishDay(game, p) {
  p.tasks = Array.from({ length: game.match.tasks }, (_, i) => ({ id: TASKS[i].id, done: true }));
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
  const desk = game.office.getInteractable(w.deskId);
  w.tasks = [{ id: 'emails', done: false }];

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
  let now = 1_000_000 + START_FREEZE_MS + MEETING_COOLDOWN_MS + 10;
  const caller = workers[0];
  const bell = game.office.getInteractable('bell');
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
  const now = 1_000_000 + START_FREEZE_MS + MEETING_COOLDOWN_MS + 10;
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
  const clock = game.office.getInteractable('time_clock');
  for (const w of workers.slice(0, 2)) {
    finishDay(game, w);
    w.x = clock.x + clock.w / 2; w.y = clock.y - 20;
    game.handleInteract(w, 'time_clock', now);
  }
  assert.equal(game.phase, PHASE.ENDED);
  assert.equal(game.result.winner, 'workers');
});

test('win: Management wins when the goal becomes unreachable', () => {
  const { game, mgmt, workers } = startedGame(3); // 2 workers -> goal 1
  let now = 1_000_000 + START_FREEZE_MS + REPORT_INITIAL_COOLDOWN_MS + 10;
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

// ===========================================================================
// Settings, progressive tasks, snitches, desk checks, sight, lobby room
// ===========================================================================

test('settings: clamped, snapped, host-only, frozen at start', () => {
  const s = sanitizeSettings({ playerSpeed: 9999, tasks: 4.4, sightRange: 'lots', bogus: 1 });
  assert.equal(s.playerSpeed, 280);
  assert.equal(s.tasks, 4);
  assert.equal(s.sightRange, DEFAULT_SETTINGS.sightRange);
  assert.equal('bogus' in s, false);

  const { game } = makeGame();
  const host = game.join('Host', null, 0).player;
  const guest = game.join('Guest', null, 0).player;
  game.handleSettings(guest, { tasks: 9 });
  assert.equal(game.settings.tasks, DEFAULT_SETTINGS.tasks, 'guest cannot change settings');
  game.handleSettings(host, { tasks: 9 });
  assert.equal(game.settings.tasks, 9);
});

test('tasks: chance weights are respected and 0 means never', () => {
  const catalogue = [
    { id: 'a', target: 'x', duration: 1, chance: 9 },
    { id: 'b', target: 'x', duration: 1, chance: 1 },
    { id: 'off', target: 'x', duration: 1, chance: 0 },
  ];
  const ts = new TaskSystem(null, catalogue);
  const counts = { a: 0, b: 0, off: 0 };
  for (let i = 0; i < 4000; i++) {
    const p = {};
    ts.reset(p);
    counts[ts.issueNext(p).id]++;
  }
  assert.equal(counts.off, 0);
  assert.ok(counts.a > counts.b * 5, JSON.stringify(counts));

  // No repeats within a match while the catalogue lasts.
  const p = {};
  ts.reset(p);
  ts.issueNext(p); ts.issueNext(p);
  assert.notEqual(p.tasks[0].id, p.tasks[1].id);
});

test('tasks: handed out one per section; clock pauses during meetings', () => {
  const { game, players, workers } = startedGame(4, { snitches: 0, tasks: 4, workdayMinutes: 4 });
  const section = 60_000; // 4 min / 4 tasks
  const t0 = 1_000_000 + START_FREEZE_MS;
  for (const p of players) assert.equal(p.tasks.length, 1, 'first task at the start');

  game.tick(t0 + section - 100);
  assert.equal(workers[0].tasks.length, 1);
  game.tick(t0 + section + 10);
  assert.equal(workers[0].tasks.length, 2, 'second task after one section');

  // A 50s meeting doesn't eat into the workday.
  game.startMeeting(workers[0], t0 + section + 100);
  game.tick(t0 + section + 50_000);
  game.endMeeting(t0 + section + 50_100);
  game.tick(t0 + 2 * section + 10);
  assert.equal(workers[0].tasks.length, 2, 'paused time does not count');
  game.tick(t0 + 2 * section + 50_100);
  assert.equal(workers[0].tasks.length, 3);

  // Can't clock out before the last task has even been handed out.
  workers[0].tasks.forEach((t) => (t.done = true));
  const clock = game.office.getInteractable('time_clock');
  workers[0].x = clock.x + clock.w / 2; workers[0].y = clock.y - 20;
  game.handleInteract(workers[0], 'time_clock', t0 + 2 * section + 50_200);
  assert.equal(workers[0].status, STATUS.ACTIVE);
});

test('workday: Management wins if the day ends first', () => {
  const { game } = startedGame(4, { snitches: 0, tasks: 3, workdayMinutes: 3 });
  const t0 = 1_000_000 + START_FREEZE_MS;
  game.tick(t0 + 3 * 60_000 + 10);
  assert.equal(game.phase, PHASE.ENDED);
  assert.equal(game.result.winner, 'management');
});

test('snitches: count clamps to keep 2 real workers; private team chat', () => {
  const small = startedGame(4, { snitches: 3 });
  assert.equal(small.snitches.length, 1, '4 players -> 1 snitch max');
  assert.equal(small.workers.length, 2);

  const { game, outbox, mgmt, snitches, workers } = startedGame(7, { snitches: 2 });
  assert.equal(snitches.length, 2);

  // Team members learn about each other; workers learn nothing.
  const selfOf = (p) => [...outbox].reverse().find((m) => m.to === p.id && m.t === S2C.SELF).d;
  assert.deepEqual(selfOf(snitches[0]).team.map((t) => t.id).sort(), [mgmt.id, snitches[1].id].sort());
  assert.deepEqual(selfOf(workers[0]).team, []);

  // Back-office chat reaches only the team, and workers can't post to it.
  outbox.length = 0;
  game.handleChat(snitches[0], 'Blue is in the break room', 'team', 1);
  const recipients = outbox.filter((m) => m.t === S2C.CHAT).map((m) => m.to).sort();
  assert.deepEqual(recipients, [mgmt.id, ...snitches.map((s) => s.id)].sort());
  outbox.length = 0;
  game.handleChat(workers[0], 'let me in', 'team', 1);
  assert.equal(outbox.filter((m) => m.t === S2C.CHAT).length, 0);

  // Snitches can't clock out, and don't count toward the workers' goal.
  finishDay(game, snitches[0]);
  const clock = game.office.getInteractable('time_clock');
  snitches[0].x = clock.x + clock.w / 2; snitches[0].y = clock.y - 20;
  game.handleInteract(snitches[0], 'time_clock', 1_000_000 + START_FREEZE_MS + 10);
  assert.equal(snitches[0].status, STATUS.ACTIVE);
  assert.equal(game.workdayProgress().goal, 2); // 4 real workers
});

test('desk check: away from your desk when it ends = sent home', () => {
  const { game, mgmt, workers } = startedGame(4, { snitches: 0, deskCheckWarning: 10, deskCheckCooldown: 60 });
  let now = 1_000_000 + START_FREEZE_MS + 10;

  game.handleDeskCheck(workers[0], now + DESK_CHECK_INITIAL_DELAY_MS);
  assert.equal(game.deskCheck, null, 'workers cannot call one');
  game.handleDeskCheck(mgmt, now);
  assert.equal(game.deskCheck, null, 'initial cooldown');

  now += DESK_CHECK_INITIAL_DELAY_MS;
  game.handleDeskCheck(mgmt, now);
  assert.ok(game.deskCheck);

  const [atDesk, away] = workers;
  const seat = game.roles.seatOf(atDesk);
  atDesk.x = seat.x; atDesk.y = seat.y;
  away.x = 300; away.y = 540;
  mgmt.x = 1000; mgmt.y = 540; // Management itself is exempt
  game.tick(now + 9_000);
  assert.equal(away.status, STATUS.ACTIVE, 'still counting down');
  game.tick(now + 10_001);
  assert.equal(away.status, STATUS.SENT_HOME);
  assert.equal(atDesk.status, STATUS.ACTIVE);
  assert.equal(mgmt.status, STATUS.ACTIVE);
  assert.equal(game.deskCheck, null);
  assert.ok(mgmt.deskCheckReadyAt >= now + 10_000 + 60_000, 'cooldown starts after it resolves');
});

test('sight: snapshots only include players within sight range', () => {
  const { game, outbox, workers } = startedGame(4, { snitches: 0, sightRange: 300 });
  const [a, b, c] = workers;
  a.x = 300; a.y = 540; b.x = 500; b.y = 540; c.x = 1500; c.y = 540;
  outbox.length = 0;
  game.tick(1_000_000 + START_FREEZE_MS + 10);
  const snapFor = (p) => outbox.find((m) => m.to === p.id && m.t === S2C.SNAPSHOT).d.p.map((e) => e[0]);
  const seen = snapFor(a);
  assert.ok(seen.includes(a.id) && seen.includes(b.id));
  assert.ok(!seen.includes(c.id), 'far player hidden');

  // Out of the office: you can watch everyone.
  c.status = STATUS.SENT_HOME;
  outbox.length = 0;
  game.tick(1_000_000 + START_FREEZE_MS + 60);
  assert.ok(snapFor(c).includes(a.id) && snapFor(c).includes(b.id));
});

test('lobby: players spawn apart and can walk around the waiting room', () => {
  const { game } = makeGame();
  const a = game.join('A', null, 0).player;
  const b = game.join('B', null, 0).player;
  assert.notDeepEqual({ x: a.x, y: a.y }, { x: b.x, y: b.y });
  const start = a.x;
  game.handleInput(a, 1, 0);
  for (let i = 0; i < 10; i++) game.tick(i * TICK_MS);
  assert.ok(a.x > start, 'moved in the lobby');
  assert.ok(a.x < LOBBY_ROOM.width);
});

test('lobby map: spawns are free and connected', () => {
  const map = buildOfficeMap(LOBBY_ROOM);
  for (const s of map.spawnPoints) assert.equal(positionBlocked(map, s.x, s.y, 14), false, JSON.stringify(s));
  const STEP = 8;
  const key = (x, y) => `${x},${y}`;
  const s0 = map.spawnPoints[0];
  const seen = new Set([key(s0.x, s0.y)]);
  const queue = [[s0.x, s0.y]];
  while (queue.length) {
    const [x, y] = queue.pop();
    for (const [dx, dy] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]]) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (seen.has(k) || positionBlocked(map, nx, ny, 14)) continue;
      seen.add(k); queue.push([nx, ny]);
    }
  }
  const pts = [...seen].map((k) => k.split(',').map(Number));
  for (const s of map.spawnPoints) assert.ok(pts.some(([x, y]) => Math.hypot(x - s.x, y - s.y) < 12), JSON.stringify(s));
});

test('chat: water cooler reaches workers and snitches, never Management', () => {
  const { game, outbox, mgmt, snitches, workers } = startedGame(6, { snitches: 1 });
  const [snitch] = snitches;
  const chatTo = () => outbox.filter((m) => m.t === S2C.CHAT).map((m) => m.to).sort();

  outbox.length = 0;
  game.handleChat(workers[0], 'Who rang the bell?', 'crew', 1);
  assert.deepEqual(chatTo(), [...workers, snitch].map((p) => p.id).sort(), 'workers + snitch hear it');

  // The snitch can post in both channels.
  outbox.length = 0;
  game.handleChat(snitch, 'Not me!', 'crew', 1);
  assert.ok(!chatTo().includes(mgmt.id));
  assert.equal(chatTo().length, workers.length + 1);
  outbox.length = 0;
  game.handleChat(snitch, 'They suspect Ana', 'team', 1);
  assert.deepEqual(chatTo(), [mgmt.id, snitch.id].sort());

  // Management can't post to (or read) the water cooler.
  outbox.length = 0;
  game.handleChat(mgmt, 'hello?', 'crew', 1);
  assert.equal(chatTo().length, 0);

  // Reconnecting players get only the backlogs they're allowed to read.
  outbox.length = 0;
  game.sendFullState(mgmt, 1);
  const mgmtChannels = outbox.filter((m) => m.t === S2C.CHAT).map((m) => m.d.channel).sort();
  assert.deepEqual(mgmtChannels, ['all', 'team']);
  outbox.length = 0;
  game.sendFullState(snitch, 1);
  assert.deepEqual(outbox.filter((m) => m.t === S2C.CHAT).map((m) => m.d.channel).sort(), ['all', 'crew', 'team']);
});

// ===========================================================================
// Breaks and task windows
// ===========================================================================
import { breakWindows } from '../shared/breaks.js';
import { generateFridge, checkFridge, placedCells, rotate } from '../shared/minigames/fridge.js';

test('breaks: schedule maps office time onto the workday', () => {
  const w = breakWindows(3, 8 * 60_000); // 8-minute day: one office hour = one minute
  assert.deepEqual(w.map((b) => b.id), ['coffee', 'lunch', 'afternoon']);
  const lunch = w.find((b) => b.id === 'lunch');
  assert.equal(lunch.startMs, 3 * 60_000);
  assert.equal(lunch.endMs, 4 * 60_000);
  assert.deepEqual(breakWindows(0, 1000), []);
});

test('breaks: safe in break areas, desk checks off, break tasks gated', () => {
  const { game, outbox, mgmt, workers } = startedGame(4, { snitches: 0, workdayMinutes: 8, breaks: 1 }); // lunch only
  const t0 = 1_000_000 + START_FREEZE_MS;
  const lunchAt = t0 + 3 * 60_000 + 10;
  const w = workers[0];

  // Before lunch: a break-only task waits for the break.
  w.tasks = [{ id: 'lunch', done: false }];
  const table = game.office.getInteractable('lunch_table');
  w.x = table.x + table.w / 2; w.y = table.y + table.h + 20;
  game.handleInteract(w, 'lunch_table', t0 + 1000);
  assert.equal(w.activeTask, null);
  assert.match(lastToast(outbox, w.id), /break/);

  // Lunch starts: announced to everyone.
  outbox.length = 0;
  game.tick(lunchAt);
  assert.ok(outbox.some((m) => m.t === S2C.EVENT && m.d.kind === 'break_start'));
  game.handleInteract(w, 'lunch_table', lunchAt + 10);
  assert.ok(w.activeTask, 'can eat lunch on the lunch break');

  // On break in the break room: can't be reported. In the hallway: fair game.
  mgmt.x = w.x + 40; mgmt.y = w.y;
  game.handleReport(mgmt, w.id, lunchAt + 20);
  assert.equal(w.status, STATUS.ACTIVE);
  assert.match(lastToast(outbox, mgmt.id), /on break/);
  const w2 = workers[1];
  w2.x = 300; w2.y = 520; mgmt.x = 340; mgmt.y = 520;
  game.handleReport(mgmt, w2.id, lunchAt + 30);
  assert.equal(w2.status, STATUS.SENT_HOME);

  // No desk checks during lunch.
  mgmt.deskCheckReadyAt = 0;
  game.handleDeskCheck(mgmt, lunchAt + 40);
  assert.equal(game.deskCheck, null);
});

test('fridge: generated puzzles are solvable; wrong answers rejected', () => {
  for (let i = 0; i < 200; i++) {
    const p = generateFridge(Math.random);
    assert.equal(p.pieces.length, 2);
    const filled = p.items.reduce((n, it) => n + it.cells.length, 0) + p.pieces.reduce((n, pc) => n + pc.cells.length, 0);
    assert.ok(filled < p.cols * p.rows, 'there is a decoy gap');
    // Solve using the stored answer.
    const placements = p.pieces.map((pc, k) => {
      const target = [...p.answer[k]].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      for (let rot = 0; rot < 4; rot++) {
        const cells = placedCells(pc, rot, target[0][0], target[0][1]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
        if (JSON.stringify(cells) === JSON.stringify(target)) return { piece: k, rot, x: target[0][0], y: target[0][1] };
      }
      return null;
    });
    assert.ok(checkFridge(p, placements), 'answer fits');
    assert.equal(checkFridge(p, [placements[0], placements[0]]), false, 'same piece twice');
    assert.equal(checkFridge(p, [{ ...placements[0], x: -1 }, placements[1]]), false, 'out of the fridge');
  }
  assert.deepEqual(rotate([[0, 0], [1, 0]], 1), [[0, 0], [0, 1]]);
});

test('fridge task: window opens, answer checked by the server', () => {
  const { game, outbox, workers } = startedGame(4, { snitches: 0 });
  const w = workers[0];
  const now = 1_000_000 + START_FREEZE_MS + 10;
  w.tasks = [{ id: 'fridge', done: false }];
  const fridge = game.office.getInteractable('fridge');
  w.x = fridge.x + fridge.w / 2; w.y = fridge.y + fridge.h + 20;
  game.handleInteract(w, 'fridge', now);
  assert.equal(w.activeTask?.minigame, 'fridge');

  // The client sees the puzzle but never the answer.
  game.sendSelf(w, now);
  const self = [...outbox].reverse().find((m) => m.to === w.id && m.t === S2C.SELF).d;
  assert.ok(self.active.puzzle.items.length);
  assert.equal('answer' in self.active.puzzle, false);

  // Waiting doesn't finish it (no timer), a bad answer doesn't either.
  game.tick(now + 60_000);
  assert.equal(w.tasks[0].done, false);
  game.handleMinigame(w, [{ piece: 0, rot: 0, x: 99, y: 99 }, { piece: 1, rot: 0, x: 0, y: 0 }], now + 61_000);
  assert.equal(w.tasks[0].done, false);

  const p = w.activeTask.puzzle;
  const answer = p.pieces.map((pc, k) => {
    const target = [...p.answer[k]].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    for (let rot = 0; rot < 4; rot++) {
      const cells = placedCells(pc, rot, target[0][0], target[0][1]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      if (JSON.stringify(cells) === JSON.stringify(target)) return { piece: k, rot, x: target[0][0], y: target[0][1] };
    }
  });
  game.handleMinigame(w, answer, now + 62_000);
  assert.equal(w.tasks[0].done, true);
  assert.equal(w.activeTask, null);
});
