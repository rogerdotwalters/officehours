/**
 * Task-window mini-games: pixel masks, puzzle generation, and the server
 * checking answers (including the "too quick" guard).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMask, encodeMask, decodeMask, maskEdges } from '../shared/minigames/pixelMask.js';
import { ITEMS, ITEMS_BY_ID, itemsFor } from '../shared/minigames/items.js';
import { generateFridge, checkFridge, Fridge, CELL } from '../shared/minigames/fridge.js';
import { MINIGAMES } from '../shared/minigames/index.js';
import { Game } from '../server/game/Game.js';
import { PHASE, START_FREEZE_MS } from '../shared/constants.js';
import { S2C } from '../shared/protocol.js';

test('pixel mask: solid vs transparent cells, round trip, edges', () => {
  // 8x8 picture: left half opaque, right half transparent -> 2x2 cells: [1,0],[1,0]
  const px = new Uint8Array(8 * 8 * 4);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) px[(y * 8 + x) * 4 + 3] = 255;
  const mask = buildMask(px, 8, 8, 2, 2);
  assert.deepEqual([...mask], [1, 0, 1, 0]);
  assert.deepEqual([...decodeMask(encodeMask(mask, 2, 2), 2)], [...mask]);
  // Outline of a 1x2 column: top, bottom, left, right edges.
  const edges = maskEdges(mask, 2, 2);
  assert.equal(edges.length, 4);
  assert.ok(edges.some(([x1, y1, x2, y2]) => x1 === 1 && x2 === 1 && y1 === 0 && y2 === 2), 'right-hand edge');
});

test('item table: every picture produced a shape; transparent parts are empty', () => {
  assert.ok(ITEMS.length >= 20);
  for (const it of ITEMS) {
    assert.ok(it.cells.length > 0, it.id);
    assert.ok(it.cells.length < it.cols * it.rows, `${it.id} has some transparency`);
  }
  assert.equal(itemsFor('yours').length, 2);
  // The pizza slice is a triangle: well under 70% of its box is solid.
  const pizza = ITEMS_BY_ID.get('pizza');
  assert.ok(pizza.cells.length / (pizza.cols * pizza.rows) < 0.7);
});

test('fridge: pixel collision lets shapes nest where boxes would not', () => {
  const f = new Fridge();
  const cheese = ITEMS_BY_ID.get('cheese');     // right-angled wedge: its top-left corner is empty
  const cy = 26 - 1 - cheese.bottom;            // standing on the top shelf's floor
  f.put(cheese, 10, cy, 0);
  // A 2x2-cell block: inside the wedge's bounding box in both spots below.
  const block = { cells: [[0, 0], [1, 0], [0, 1], [1, 1]], left: 0, right: 1, top: 0, bottom: 1 };
  assert.equal(f.fits(block, 10, cy), true, 'fits in the wedge\u2019s transparent corner');
  assert.equal(f.fits(block, 10 + cheese.cols - 3, cy + cheese.rows - 3), false, 'but not in its solid part');
});

test('fridge: puzzles are solvable, start crowded, answers checked', () => {
  for (let i = 0; i < 60; i++) {
    const p = generateFridge(Math.random);
    assert.ok(checkFridge(p, { positions: p.solution }), 'known solution works');
    const others = p.pieces.filter((q) => !q.yours);
    assert.ok(others.length >= 7);
    // Leaving your food out isn't an answer.
    const startOnly = Object.fromEntries(others.map((q) => [q.key, { x: q.x, y: q.y }]));
    assert.equal(checkFridge(p, { positions: startOnly }), false);
    // Overlapping isn't either.
    const clash = { ...p.solution, y0: { ...p.solution[others[0].key] } };
    assert.equal(checkFridge(p, { positions: clash }), false);
    // Off-grid coordinates are refused.
    assert.equal(checkFridge(p, { positions: { ...p.solution, y0: { x: p.solution.y0.x + 1, y: p.solution.y0.y } } }), false);
  }
  assert.equal(CELL, 4);
});

test('microwave, cat food, email, recycling: right answers pass, wrong fail', () => {
  const r = Math.random;
  const mw = MINIGAMES.microwave.generate(r);
  assert.ok(MINIGAMES.microwave.check(mw, { inside: true, code: mw.code }));
  assert.equal(MINIGAMES.microwave.check(mw, { inside: false, code: mw.code }), false);
  assert.equal(MINIGAMES.microwave.check(mw, { inside: true, code: '999' }), false);

  const cf = MINIGAMES.catfood.generate(r);
  assert.ok(cf.scoops >= 3 && cf.scoops <= 5);
  assert.ok(MINIGAMES.catfood.check(cf, { scoops: cf.scoops }));
  assert.equal(MINIGAMES.catfood.check(cf, { scoops: cf.scoops - 1 }), false);

  const em = MINIGAMES.email.generate(r);
  const ids = em.emails.map((e) => e.id);
  assert.ok(ids.length >= 3 && ids.length <= 5);
  assert.ok(MINIGAMES.email.check(em, { opened: ids, deleted: ids }));
  assert.equal(MINIGAMES.email.check(em, { opened: ids.slice(1), deleted: ids }), false, 'must open every email');
  assert.equal(MINIGAMES.email.check(em, { opened: ids, deleted: ids.slice(1) }), false, 'must delete every email');

  const rc = MINIGAMES.recycling.generate(r);
  const keys = rc.items.map((i) => i.key);
  assert.ok(MINIGAMES.recycling.check(rc, { binned: keys }));
  assert.equal(MINIGAMES.recycling.check(rc, { binned: keys.slice(1) }), false);
});

test('task windows on the server: too-quick answers refused, real ones accepted', () => {
  const outbox = [];
  const game = new Game({ code: 'MINI1', sandbox: true, send: (to, t, d) => outbox.push({ to, t, d }), broadcast: () => {} });
  const me = game.join('Me', null, 0).player;
  game.handleStart(me, 0);
  const now = START_FREEZE_MS + 100;
  me.tasks = [{ id: 'cat', done: false }];
  const bowl = game.office.getInteractable('cat_bowl');
  me.x = bowl.x + bowl.w / 2; me.y = bowl.y + bowl.h + 20;
  game.handleInteract(me, 'cat_bowl', now);
  assert.equal(me.activeTask?.minigame, 'catfood');
  const scoops = me.activeTask.puzzle.scoops;
  game.handleMinigame(me, { scoops }, now + 100);
  assert.equal(me.tasks[0].done, false, 'too quick');
  game.handleMinigame(me, { scoops }, now + 10_000);
  assert.equal(me.tasks[0].done, true);
  assert.equal(game.phase, PHASE.PLAYING);

  // The fridge's solution never leaves the server.
  me.tasks.push({ id: 'fridge', done: false });
  const fridge = game.office.getInteractable('fridge');
  me.x = fridge.x + fridge.w / 2; me.y = fridge.y + fridge.h + 20;
  game.handleInteract(me, 'fridge', now + 11_000);
  game.sendSelf(me, now + 11_000);
  const self = [...outbox].reverse().find((m) => m.t === S2C.SELF).d;
  assert.ok(self.active.puzzle.pieces.length);
  assert.equal('solution' in self.active.puzzle, false);
  game.handleMinigame(me, { positions: me.activeTask.puzzle.solution }, now + 20_000);
  assert.equal(me.tasks[1].done, true);
});

import { DRAWINGS, scoreDrawing, checkWhiteboard } from '../shared/minigames/whiteboard.js';

test('copier: every document copied', () => {
  const p = MINIGAMES.copier.generate(Math.random);
  const ids = p.docs.map((d) => d.id);
  assert.ok(ids.length >= 3);
  assert.ok(MINIGAMES.copier.check(p, { copied: ids }));
  assert.equal(MINIGAMES.copier.check(p, { copied: ids.slice(1) }), false);
});

test('whiteboard: tracing passes, shaky tracing passes, skipping or scribbling fails', () => {
  for (const d of DRAWINGS) {
    const flat = (strokes) => strokes.map((s) => s.flatMap(([x, y]) => [Math.round(x), Math.round(y)]));
    assert.ok(checkWhiteboard({ drawing: d.id }, { ink: flat(d.strokes) }), `${d.id} traced`);
    const shaky = d.strokes.map((s) => s.map(([x, y], i) => [x + 2 * Math.sin(i), y + 2 * Math.cos(i)]));
    assert.ok(scoreDrawing(d, shaky).ok, `${d.id} shaky`);
    const scribble = [[[0, 0], [160, 100], [0, 100], [160, 0], [0, 50], [160, 50], [80, 0], [80, 100]]];
    assert.equal(scoreDrawing(d, scribble).ok, false, `${d.id} scribble`);
    assert.equal(checkWhiteboard({ drawing: d.id }, { ink: [] }), false);
  }
  // Skipping the potato's tie isn't allowed.
  const potato = DRAWINGS.find((d) => d.id === 'potato');
  assert.equal(scoreDrawing(potato, potato.strokes.slice(0, -1)).ok, false);
});

test('toilet: drop everything and flush; coffee: exact scoops and brew', () => {
  const t = MINIGAMES.toilet.generate(Math.random);
  const keys = t.items.map((i) => i.key);
  assert.ok(keys.length >= 4);
  assert.ok(t.items.every((i) => ITEMS_BY_ID.get(i.item).uses.includes('toilet')));
  assert.ok(MINIGAMES.toilet.check(t, { dropped: keys, flushed: true }));
  assert.equal(MINIGAMES.toilet.check(t, { dropped: keys, flushed: false }), false, 'must flush');
  assert.equal(MINIGAMES.toilet.check(t, { dropped: keys.slice(1), flushed: true }), false, 'everything goes in');

  const c = MINIGAMES.coffee.generate(Math.random);
  assert.ok(MINIGAMES.coffee.check(c, { scoops: c.scoops, brewed: true }));
  assert.equal(MINIGAMES.coffee.check(c, { scoops: c.scoops - 1, brewed: true }), false);
  assert.equal(MINIGAMES.coffee.check(c, { scoops: c.scoops, brewed: false }), false);
});
