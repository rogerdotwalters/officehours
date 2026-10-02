/**
 * Headless tests for the authoritative game logic. No Cloudflare runtime needed:
 *   npm test   (node --test tests/*.test.mjs)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game/Game.js';
import { PHASE, STATUS, ROLE, START_FREEZE_MS, MEETING_COOLDOWN_MS, TICK_MS, MAX_PLAYERS } from '../shared/constants.js';
import { DEFAULT_SETTINGS, sanitizeSettings, effectiveSlackers } from '../shared/settings.js';
import { LOBBY_ROOM } from '../shared/lobbyMap.js';
import { TASKS, TASKS_BY_ID, taskVersion } from '../shared/tasks.js';
import { EVIDENCE, CHAOS } from '../shared/evidence.js';
import { breakWindows } from '../shared/breaks.js';
import { TaskSystem } from '../server/game/TaskSystem.js';
import { S2C } from '../shared/protocol.js';
import { buildOfficeMap, distPointRect } from '../shared/mapBuilder.js';
import { positionBlocked } from '../shared/physics.js';

const T0 = 1_000_000;
const DAY = T0 + START_FREEZE_MS;   // when the workday starts

function makeGame() {
  const outbox = [];
  const game = new Game({
    code: 'TEST1',
    send: (id, t, d) => outbox.push({ to: id, t, d }),
    broadcast: (t, d) => outbox.push({ to: '*', t, d }),
  });
  return { game, outbox };
}

function startedGame(n = 4, settings = {}) {
  const { game, outbox } = makeGame();
  const players = [];
  for (let i = 0; i < n; i++) players.push(game.join(`P${i}`, null, T0).player);
  game.handleSettings(players[0], settings);
  players.slice(1).forEach((p) => game.handleReady(p, true));
  game.handleStart(players[0], T0);
  assert.equal(game.phase, PHASE.PLAYING);
  const slackers = players.filter((p) => p.isSlacker);
  const productive = players.filter((p) => !p.isSlacker);
  return { game, outbox, players, slackers, productive };
}

/** Stand a player right next to an object. */
function standAt(game, p, objectId) {
  const o = game.office.getInteractable(objectId);
  p.x = o.x + o.w / 2;
  p.y = o.y + o.h + 20;
  if (positionBlocked(game.office, p.x, p.y, 14)) p.y = o.y - 20;
}

/** Mark all of a player's tasks for the day as handed out and done. */
function finishDay(game, p) {
  p.tasks = TASKS.slice(0, game.match.tasks).map((t) => ({ id: t.id, done: true }));
}

const lastToast = (outbox, id) => [...outbox].reverse().find((m) => m.to === id && m.t === S2C.TOAST)?.d.text ?? '';
const events = (outbox, kind) => outbox.filter((m) => m.t === S2C.EVENT && m.d.kind === kind).map((m) => m.d);

// ===========================================================================
// Map and lobby
// ===========================================================================

test('map: every seat, meeting seat and spawn is free space', () => {
  const map = buildOfficeMap();
  for (const d of map.desks) assert.equal(positionBlocked(map, d.seat.x, d.seat.y, 14), false, d.id);
  for (const s of map.meetingSeats) assert.equal(positionBlocked(map, s.x, s.y, 14), false, 'meeting seat');
  assert.ok(map.desks.length >= MAX_PLAYERS);
});

test('map: every desk, prop and meeting seat is reachable on foot', () => {
  const map = buildOfficeMap();
  const STEP = 8;
  const key = (x, y) => `${x},${y}`;
  const start = map.desks[0].seat;
  const sx = Math.round(start.x / STEP) * STEP, sy = Math.round(start.y / STEP) * STEP;
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
  const reachable = (fn) => points.some(([x, y]) => fn(x, y));
  for (const o of map.interactables) assert.ok(reachable((x, y) => distPointRect(x, y, o) <= 40), `can't reach ${o.id}`);
  for (const d of map.desks) assert.ok(reachable((x, y) => Math.hypot(x - d.seat.x, y - d.seat.y) < 12), `seat ${d.id}`);
  for (const s of map.meetingSeats) assert.ok(reachable((x, y) => Math.hypot(x - s.x, y - s.y) < 12), 'meeting seat');
  // Every task's target exists somewhere on the map.
  for (const t of TASKS) {
    if (!t.target.endsWith('_desk')) assert.ok(map.interactables.some((o) => o.type === t.target), `no ${t.target} for ${t.id}`);
  }
});

test('lobby: room cap, unique names and colours, host start rules', () => {
  const { game } = makeGame();
  const a = game.join('Pam', null, 0).player;
  const b = game.join('pam', null, 0).player;
  assert.notEqual(a.name.toLowerCase(), b.name.toLowerCase());
  assert.notEqual(a.colorId, b.colorId);
  for (let i = 2; i < MAX_PLAYERS; i++) game.join(`P${i}`, null, 0);
  assert.equal(game.join('Late', null, 0).error.code, 'full');
  game.handleStart(b, 0);
  assert.equal(game.phase, PHASE.LOBBY, 'only the host starts');
  game.handleStart(a, 0);
  assert.equal(game.phase, PHASE.LOBBY, 'everyone must be ready');
});

test('lobby: players spawn apart and can walk around the waiting room', () => {
  const { game } = makeGame();
  const a = game.join('A', null, 0).player;
  const b = game.join('B', null, 0).player;
  assert.notDeepEqual({ x: a.x, y: a.y }, { x: b.x, y: b.y });
  const start = a.x;
  game.handleInput(a, 1, 0);
  for (let i = 0; i < 10; i++) game.tick(i * TICK_MS);
  assert.ok(a.x > start && a.x < LOBBY_ROOM.width);
});

test('settings: clamped, snapped, host-only; slackers always outnumbered', () => {
  const s = sanitizeSettings({ playerSpeed: 9999, tasks: 4.4, sightRange: 'lots', bogus: 1 });
  assert.equal(s.playerSpeed, 280);
  assert.equal(s.tasks, 4);
  assert.equal(s.sightRange, DEFAULT_SETTINGS.sightRange);
  assert.equal('bogus' in s, false);
  assert.equal(effectiveSlackers({ slackers: 3 }, 3), 1);
  assert.equal(effectiveSlackers({ slackers: 3 }, 6), 2);
  assert.equal(effectiveSlackers({ slackers: 3 }, 10), 3);

  const { game } = makeGame();
  const host = game.join('Host', null, 0).player;
  const guest = game.join('Guest', null, 0).player;
  game.handleSettings(guest, { tasks: 9 });
  assert.equal(game.settings.tasks, DEFAULT_SETTINGS.tasks);
  game.handleSettings(host, { tasks: 9 });
  assert.equal(game.settings.tasks, 9);
});

// ===========================================================================
// Roles and two-version tasks
// ===========================================================================

test('roles: slackers are secret; slackers know each other', () => {
  const { game, outbox, slackers, productive } = startedGame(7, { slackers: 2 });
  assert.equal(slackers.length, 2);
  assert.equal(productive.length, 5);
  for (const p of game.roomState().players) assert.equal('role' in p, false, 'roles never in public info');
  const selfOf = (p) => [...outbox].reverse().find((m) => m.to === p.id && m.t === S2C.SELF).d;
  assert.deepEqual(selfOf(slackers[0]).team.map((t) => t.id), [slackers[1].id]);
  assert.deepEqual(selfOf(productive[0]).team, []);
});

test('tasks: same task, two versions; the role decides which', () => {
  for (const t of TASKS) {
    const p = taskVersion(t, ROLE.PRODUCTIVE), s = taskVersion(t, ROLE.SLACKER);
    assert.ok(p.label && s.label && p.label !== s.label, `${t.id} has two labels`);
    assert.equal(p.evidence, null, `${t.id}: productive work leaves no mess`);
    if (s.evidence) assert.ok(EVIDENCE[s.evidence], `${t.id}: evidence kind exists`);
  }
  const { game, slackers, productive } = startedGame(4);
  const now = DAY + 10;
  for (const p of [slackers[0], productive[0]]) {
    p.tasks = [{ id: 'reheat', done: false }];
    standAt(game, p, 'microwave');
    game.handleInteract(p, 'microwave', now);
    assert.equal(p.activeTask.minigame, 'microwave');
  }
  assert.equal(slackers[0].activeTask.puzzle.food, 'fish');
  assert.notEqual(productive[0].activeTask.puzzle.food, 'fish');
});

test('tasks: must stay in range for the full duration', () => {
  const { game, productive } = startedGame(4);
  const p = productive[0];
  p.tasks = [{ id: 'tps', done: false }];
  const desk = game.office.getInteractable(p.deskId);
  const seat = game.roles.seatOf(p);
  p.x = seat.x; p.y = seat.y;
  game.handleInteract(p, desk.id, DAY + 10);
  assert.ok(p.activeTask);
  p.x += 300;
  game.tick(DAY + 20);
  assert.equal(p.activeTask, null, 'walking away cancels');
  p.x = seat.x;
  game.handleInteract(p, desk.id, DAY + 100);
  game.tick(DAY + 100 + taskVersion(TASKS_BY_ID.get('tps'), p.role).duration + 10);
  assert.equal(p.tasks[0].done, true);
});

test('tasks: chance weights are respected and 0 means never', () => {
  const catalogue = [
    { id: 'a', target: 'x', chance: 9 },
    { id: 'b', target: 'x', chance: 1 },
    { id: 'off', target: 'x', chance: 0 },
  ];
  const ts = new TaskSystem(null, catalogue);
  const counts = { a: 0, b: 0, off: 0 };
  for (let i = 0; i < 4000; i++) { const p = {}; ts.reset(p); counts[ts.issueNext(p).id]++; }
  assert.equal(counts.off, 0);
  assert.ok(counts.a > counts.b * 5, JSON.stringify(counts));
});

test('tasks: handed out one per section; clock pauses during meetings', () => {
  const { game, slackers, productive } = startedGame(4, { tasks: 4, workdayMinutes: 4 });
  const section = 60_000;
  const p = productive[0];
  assert.equal(p.tasks.length, 1);
  assert.equal(slackers[0].tasks.length, 0, 'slackers get no list');
  game.tick(DAY + section + 10);
  assert.equal(p.tasks.length, 2);
  game.startMeeting(p, DAY + section + 100);
  game.tick(DAY + section + 50_000);
  game.endMeeting(DAY + section + 50_100);
  game.tick(DAY + 2 * section + 10);
  assert.equal(p.tasks.length, 2, 'paused time does not count');
  game.tick(DAY + 2 * section + 50_100);
  assert.equal(p.tasks.length, 3);
});

// ===========================================================================
// Evidence
// ===========================================================================

test('evidence: fumes fade on their own; the whiteboard shows what was drawn', () => {
  const { game, slackers, productive } = startedGame(4);
  game.evidence.set('microwave', { kind: 'fish', objectId: 'microwave', at: DAY, until: DAY + EVIDENCE.fish.ttl, data: null });
  game.tick(DAY + EVIDENCE.fish.ttl + 10);
  assert.equal(game.evidence.has('microwave'), false);

  // A slacker doodle stays until a productive drawing replaces it.
  const s = slackers[0], p = productive[0];
  for (const who of [s, p]) {
    who.tasks = [{ id: 'whiteboard', done: false }];
    standAt(game, who, 'whiteboard');
  }
  let now = DAY + 1000;
  game.handleInteract(s, 'whiteboard', now);
  const doodle = s.activeTask.puzzle.drawing;
  // Trace it perfectly.
  return import('../shared/minigames/whiteboard.js').then(({ DRAWINGS_BY_ID }) => {
    const ink = (id) => DRAWINGS_BY_ID.get(id).strokes.map((st) => st.flatMap(([x, y]) => [Math.round(x), Math.round(y)]));
    game.handleMinigame(s, { ink: ink(doodle) }, now + 5000);
    assert.equal(game.roomState().evidence.find((e) => e.objectId === 'whiteboard').data.drawing, doodle);
    now += 10_000;
    game.handleInteract(p, 'whiteboard', now);
    const chart = p.activeTask.puzzle.drawing;
    game.handleMinigame(p, { ink: ink(chart) }, now + 5000);
    assert.equal(game.evidence.has('whiteboard'), false);
    assert.equal(game.roomState().whiteboard.drawing, chart);
  });
});

// ===========================================================================
// Meters and winning
// ===========================================================================

test('win: voting out the last slacker; tie ejects nobody', () => {
  const { game, players, slackers } = startedGame(4);
  let now = DAY + MEETING_COOLDOWN_MS + 10;
  game.startMeeting(players[0], now);
  // Tie first.
  game.handleVote(players[0], players[1].id, now);
  game.handleVote(players[1], players[0].id, now);
  game.handleVote(players[2], 'skip', now);
  game.handleVote(players[3], 'skip', now);
  game.tick(now += 10);
  game.tick(now += 10_000);
  assert.equal(game.phase, PHASE.PLAYING);
  assert.ok(players.every((p) => p.status === STATUS.ACTIVE));
  // Now everyone votes the slacker out.
  game.startMeeting(players[1], now += 60_000);
  for (const p of players) game.handleVote(p, slackers[0].id, now);
  game.tick(now += 10);
  game.tick(now += 10_000);
  assert.equal(game.phase, PHASE.ENDED);
  assert.equal(game.result.winner, 'productive');
  assert.deepEqual(game.result.slackers.map((s) => s.id), [slackers[0].id]);
});

test('win: slackers win once they match the productive employees', () => {
  const { game, slackers, productive } = startedGame(4);
  game.sendHome(productive[0]);
  game.sendHome(productive[1]);
  game.checkWin(DAY + 10);
  assert.equal(game.result.winner, 'slackers');
  void slackers;
});

// ===========================================================================
// Chat, HR, emotes, sight, breaks, reconnect
// ===========================================================================

test('chat: water cooler is for everyone; the group chat is slackers only', () => {
  const { game, outbox, slackers, productive } = startedGame(7, { slackers: 2 });
  const chatTo = () => outbox.filter((m) => m.t === S2C.CHAT).map((m) => m.to).sort();
  outbox.length = 0;
  game.handleChat(productive[0], 'Who microwaved fish?', 'crew', 1);
  assert.equal(chatTo().length, 7);
  outbox.length = 0;
  game.handleChat(slackers[0], 'not me lol', 'team', 1);
  assert.deepEqual(chatTo(), slackers.map((s) => s.id).sort());
  outbox.length = 0;
  game.handleChat(productive[0], 'let me in', 'team', 1);
  assert.equal(chatTo().length, 0);
});

test('HR: right guess fires the slacker; wrong guess fires you; once per game', () => {
  const { game, outbox, slackers, productive } = startedGame(6, { slackers: 1 });
  const now = DAY + 10;
  const [a, b, c] = productive;
  a.x = 300; a.y = 520;
  game.handleHrReport(a, slackers[0].id, now);
  assert.equal(slackers[0].status, STATUS.ACTIVE, 'must be at the HR box');
  standAt(game, a, 'hr_box');
  game.handleHrReport(a, slackers[0].id, now);
  assert.equal(slackers[0].status, STATUS.SENT_HOME);
  assert.ok(events(outbox, 'hr').some((e) => e.outcome === 'slacker'));
  game.handleHrReport(a, b.id, now);
  assert.equal(b.status, STATUS.ACTIVE, 'only once');
  void c;
});

test('HR: a false complaint gets you fired', () => {
  const { game, productive } = startedGame(6, { slackers: 1 });
  const [a, b] = productive;
  standAt(game, a, 'hr_box');
  game.handleHrReport(a, b.id, DAY + 10);
  assert.equal(a.status, STATUS.SENT_HOME);
  assert.equal(b.status, STATUS.ACTIVE);
});

test('emotes: only people who can see you get them', () => {
  const { game, outbox, players } = startedGame(4, { sightRange: 300 });
  game.tick(DAY + 10);
  const [a, b, c] = players;
  a.x = 300; a.y = 520; b.x = 400; b.y = 520; c.x = 1500; c.y = 520;
  outbox.length = 0;
  game.handleEmote(a, 'lol');
  const to = outbox.filter((m) => m.t === S2C.EMOTE).map((m) => m.to);
  assert.ok(to.includes(a.id) && to.includes(b.id) && !to.includes(c.id));
  outbox.length = 0;
  game.handleEmote(a, '<script>');
  assert.equal(outbox.length, 0);
});

test('sight: range and walls limit who you receive', () => {
  const { game, outbox, players } = startedGame(4, { sightRange: 600 });
  const [a, b] = players;
  a.x = 100; a.y = 380; b.x = 100; b.y = 520; // wall between
  outbox.length = 0;
  game.tick(DAY + 10);
  const seen = (p) => outbox.filter((m) => m.to === p.id && m.t === S2C.SNAPSHOT).pop().d.p.map((e) => e[0]);
  assert.ok(!seen(a).includes(b.id));
  a.x = 300; b.x = 300; // in line with the doorway
  players[2].x = 1500; players[2].y = 520;
  players[3].x = 2700; players[3].y = 1900;
  outbox.length = 0;
  game.tick(DAY + 60);
  assert.ok(seen(a).includes(b.id));
  assert.ok(!seen(a).includes(players[2].id), 'too far');
  // Fired: watch everyone.
  game.sendHome(a);
  outbox.length = 0;
  game.tick(DAY + 120);
  assert.equal(seen(a).length, 3);
});

test('breaks: schedule maps office time; break tasks wait for a break', () => {
  const w = breakWindows(3, 8 * 60_000);
  assert.deepEqual(w.map((b) => b.id), ['coffee', 'lunch', 'afternoon']);
  assert.equal(w.find((b) => b.id === 'lunch').startMs, 3 * 60_000);

  const { game, outbox, productive } = startedGame(4, { workdayMinutes: 8, breaks: 1 });
  const p = productive[0];
  p.tasks = [{ id: 'lunch', done: false }];
  standAt(game, p, 'lunch_table');
  game.handleInteract(p, 'lunch_table', DAY + 1000);
  assert.equal(p.activeTask, null);
  assert.match(lastToast(outbox, p.id), /break/);
  outbox.length = 0;
  game.tick(DAY + 3 * 60_000 + 10);
  assert.equal(events(outbox, 'break_start').length, 1);
  game.handleInteract(p, 'lunch_table', DAY + 3 * 60_000 + 20);
  assert.ok(p.activeTask);
});

test('reconnect: token resumes the same player mid-game; strangers cannot join', () => {
  const { game, players } = startedGame(4);
  const p = players[1];
  game.onDisconnect(p.id, DAY);
  const back = game.join('whatever', p.token, DAY + 1000);
  assert.equal(back.player, p);
  assert.equal(back.resumed, true);
  assert.equal(game.join('Stranger', null, DAY).error.code, 'in_progress');
});

test('interactions: no using things through walls', () => {
  const { game, players } = startedGame(4);
  const p = players[0];
  p.tasks = [{ id: 'bathroom', done: false }, { id: 'clog', done: false }];
  const toilet = game.office.getInteractable('toilet_2');
  // On the lawn, just outside the restroom's outer wall: close, but a wall in the way.
  p.x = toilet.x + toilet.w / 2; p.y = 1496;
  assert.ok(distPointRect(p.x, p.y, toilet) < 46, 'within arm\u2019s reach on paper');
  game.handleInteract(p, 'toilet_2', DAY + 10);
  assert.equal(p.activeTask, null);
  // From inside the stall: fine.
  p.y = toilet.y - 18;
  game.handleInteract(p, 'toilet_2', DAY + 20);
  assert.ok(p.activeTask);
});

test('whiteboard: watched live by whoever can see it; the drawing stays up for everyone', async () => {
  const { DRAWINGS_BY_ID } = await import('../shared/minigames/whiteboard.js');
  const { game, outbox, players } = startedGame(4, { sightRange: 900 });
  const [artist, watcher, outsider] = players;
  artist.tasks = [{ id: 'whiteboard', done: false }];
  standAt(game, artist, 'whiteboard');
  watcher.x = 970; watcher.y = 400;              // in the Conference Room, facing the board
  outsider.x = 300; outsider.y = 200;            // in Open Office A, walls in the way
  let now = DAY + 10;
  game.handleInteract(artist, 'whiteboard', now);
  const strokes = DRAWINGS_BY_ID.get(artist.activeTask.puzzle.drawing).strokes;
  const ink = strokes.map((st) => st.flatMap(([x, y]) => [x, y]));
  outbox.length = 0;
  game.handleWhiteboardInk(artist, ink.slice(0, 2), now + 500);
  const liveTo = outbox.filter((m) => m.t === S2C.BOARD && m.d.live).map((m) => m.to);
  assert.ok(liveTo.includes(watcher.id), 'watcher sees it being drawn');
  assert.ok(!liveTo.includes(outsider.id), 'no peeking through walls');

  outbox.length = 0;
  game.handleMinigame(artist, { ink }, now + 5000);
  const final = outbox.find((m) => m.t === S2C.BOARD && m.d.final);
  assert.equal(final.to, '*', 'the finished drawing goes to everyone');
  assert.equal(final.d.final.drawing, game.board.drawing);
  assert.ok(final.d.final.ink.length >= strokes.length - 1);
});


// ===========================================================================
// Microwaves, shenanigans, sick days, pranks, and the end of the day
// ===========================================================================

/** Do a task window properly (answers built from the puzzle the server made). */
function solve(game, p, now) {
  const a = p.activeTask;
  const answers = {
    microwave: () => ({ inside: true, code: a.puzzle.code }),
    cooler: () => (a.puzzle.variant === 'slacker' ? { lidOff: true, poured: true, lidOn: true } : { level: 0.8, drank: true }),
    prank: () => ({ woke: true, opened: true, content: 'memes', wallpaper: true }),
  };
  game.handleMinigame(p, answers[a.minigame](), now);
}

test('microwave: it really runs; open it after the ding to finish; busy for others', () => {
  const { game, outbox, productive } = startedGame(4);
  const [a, b] = productive;
  let now = DAY + 10;
  for (const p of [a, b]) { p.tasks = [{ id: 'reheat', done: false }]; standAt(game, p, 'microwave'); }
  game.handleInteract(a, 'microwave', now);
  const secs = Number(a.activeTask.puzzle.code);
  assert.ok(secs >= 15 && secs <= 45, 'sensible times');
  solve(game, a, now += 3000);
  assert.equal(a.tasks[0].done, false, 'not done just by starting it');
  assert.equal(game.roomState().microwaves[0].state, 'running');
  game.handleInteract(b, 'microwave', now += 100);
  assert.equal(b.activeTask, null, 'someone else is using it');
  assert.match(lastToast(outbox, b.id), /other microwave/);
  game.handleInteract(a, 'microwave', now += 100);
  assert.equal(a.tasks[0].done, false, 'still heating');
  game.tick(now += secs * 1000);
  assert.equal(game.roomState().microwaves[0].state, 'done');
  game.handleInteract(a, 'microwave', now += 100);
  assert.equal(a.tasks[0].done, true, 'opened it');
  assert.equal(game.roomState().microwaves.length, 0);
});

test('slackers: no task list; shenanigans any time with a cooldown; fish stinks when it dings', () => {
  const { game, outbox, slackers, productive } = startedGame(4, { shenaniganCooldown: 90 });
  const s = slackers[0], p = productive[0];
  assert.equal(s.tasks.length, 0, 'slackers get no to-do list');
  let now = DAY + 10;
  standAt(game, s, 'microwave');
  game.handleInteract(s, 'microwave', now);
  assert.equal(s.activeTask.puzzle.food, 'fish');
  solve(game, s, now += 3000);
  assert.equal(game.chaosToday, CHAOS.PER_SHENANIGAN);
  assert.equal(game.evidence.has('microwave'), false, 'no smell yet: still running');
  game.tick(now += 30_000);
  assert.ok(game.evidence.has('microwave'), 'ding: fumes');
  game.tick(now += EVIDENCE.fish.delay + 10);
  assert.ok(events(outbox, 'evidence').some((e) => /fish/.test(e.text)));
  // Cooldown before the next one.
  standAt(game, s, 'microwave_2');
  game.handleInteract(s, 'microwave_2', now += 100);
  assert.equal(s.activeTask, null);
  assert.match(lastToast(outbox, s.id), /Lie low/);
  // A productive employee opens it: fish out, fumes gone.
  standAt(game, p, 'microwave');
  game.handleInteract(p, 'microwave', now += 100);
  assert.equal(game.evidence.has('microwave'), false);
  assert.ok(events(outbox, 'cleaned').length >= 1);
});

test('water cooler: spiked tank makes the next drinker sick until tomorrow', () => {
  const { game, outbox, slackers, productive } = startedGame(5, { workdayMinutes: 3 });
  const s = slackers[0], p = productive[0];
  let now = DAY + 10;
  standAt(game, s, 'cooler_mid');
  game.handleInteract(s, 'cooler_mid', now);
  assert.equal(s.activeTask.minigame, 'cooler');
  solve(game, s, now += 2000);
  assert.ok(game.spiked.has('cooler_mid'));
  p.tasks = [{ id: 'water', done: false }];
  standAt(game, p, 'cooler_mid');
  game.handleInteract(p, 'cooler_mid', now += 100);
  solve(game, p, now += 2000);
  assert.equal(p.tasks[0].done, true);
  assert.equal(p.status, STATUS.SICK);
  assert.ok(events(outbox, 'sick').length === 1);
  assert.equal(game.spiked.has('cooler_mid'), false, 'one dose');
  // End of day (no vote needed if we fake a good day), then the next day: back at work.
  game.match.target = 30;
  for (const q of productive) if (q !== p) q.tasks = [{ id: 'tps', done: true }, { id: 'x', done: true }, { id: 'y', done: true }];
  game.tick(DAY + 3 * 60_000 + 10);
  assert.equal(game.meetings.current.kind, 'eod');
  game.tick(DAY + 3 * 60_000 + 20_000);
  game.tick(DAY + 3 * 60_000 + 40_000);
  assert.equal(game.dayNumber, 2);
  assert.equal(p.status, STATUS.ACTIVE, 'feeling better');
});

test('prank: a coworker\u2019s screen; IT fires them at 5 PM; once per day', () => {
  const { game, slackers, productive } = startedGame(6, { slackers: 1, workdayMinutes: 3 });
  const s = slackers[0], victim = productive[0];
  let now = DAY + 10;
  standAt(game, s, victim.deskId);
  game.handleInteract(s, victim.deskId, now);
  assert.equal(s.activeTask.minigame, 'prank');
  solve(game, s, now += 3000);
  assert.ok(game.evidence.get(victim.deskId)?.kind === 'screen', 'anyone walking past can see it');
  // A second prank today: refused.
  const other = productive[1];
  s.shenaniganReadyAt = 0;
  standAt(game, s, other.deskId);
  game.handleInteract(s, other.deskId, now += 100);
  assert.equal(s.activeTask, null);
  game.tick(DAY + 3 * 60_000 + 10);
  const report = game.meetings.current.report;
  assert.deepEqual(report.itFired.map((f) => f.id), [victim.id]);
  assert.equal(victim.status, STATUS.SENT_HOME);
});

test('end of day: below target, management makes you fire someone (no skipping)', () => {
  const { game, players, slackers } = startedGame(5, { workdayMinutes: 3, days: 3, target: 60 });
  let now = DAY + 3 * 60_000 + 10;
  game.tick(now);                                 // 5 PM: nothing got done, so 0%
  const m = game.meetings.current;
  assert.equal(m.kind, 'eod');
  assert.equal(m.voteNeeded, true);
  assert.equal(m.stage, 'report');
  game.tick(now += 10_000);
  assert.equal(game.meetings.current.stage, 'discussing');
  game.handleVote(players[0], 'skip', now);
  assert.equal(game.meetings.current.votes.size, 0, 'no skipping');
  for (const p of players) if (p.isActive) game.handleVote(p, slackers[0].id, now);
  game.tick(now += 10);
  game.tick(now += 10_000);
  assert.equal(game.result?.winner, 'productive', 'they fired the slacker');
});

test('end of day: on target means no vote; surviving the last day wins it for the slackers', () => {
  const { game, productive } = startedGame(4, { workdayMinutes: 3, days: 2, target: 30 });
  let now = DAY;
  for (let day = 1; day <= 2; day++) {
    for (const p of productive) p.tasks = Array.from({ length: game.match.tasks }, (_, i) => ({ id: `t${i}`, done: true }));
    game.tick(now += 3 * 60_000 + 10);
    assert.equal(game.meetings.current.voteNeeded, false, `day ${day} hit the target`);
    game.tick(now += 10_000);
    game.tick(now += 10_000);
    if (day === 1) {
      assert.equal(game.dayNumber, 2);
      now = game.day.startAt;
    }
  }
  assert.equal(game.result.winner, 'slackers', 'still on the payroll at the end of the week');
});
