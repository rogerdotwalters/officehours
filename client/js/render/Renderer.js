/**
 * Renderer — draws one frame of the office from ClientGame state.
 * World-space drawing happens inside a camera transform that follows the local
 * player (or a spectated colleague). HUD elements live in the DOM (see UI.js).
 *
 * The view is angled (see scene.js): walls and furniture stand up, and every
 * frame is drawn in layers:
 *   1. floor: floors, rugs, floor messes, your desk zone, room labels
 *   2. one pass of everything that stands up, sorted by where it meets the floor:
 *      walls, furniture, wall-mounted things, people. Walls and furniture in
 *      front of YOU fade, so you can always see yourself.
 *   3. smells and smoke, emotes
 *   4. the dark: what you can't see (walls block sight; wall faces are only lit
 *      if you're in front of them and can see them)
 *   5. see-through outlines of people you can see who are hidden behind a wall
 *      or furniture
 */
import { drawFloors, drawRoomLabels, drawDecorItem, drawMeetingChairs, roundRect, WALL_ART } from './officeArt.js';
import { buildScene, drawWall, drawTall, drawShadow, raisedRect, raiseOf, mountedRect, heightOf, WALL_H } from './scene.js';
import { microwaveWindow } from './boxArt.js';
import { DRAWINGS_BY_ID, BOARD_W, BOARD_H } from '../../shared/minigames/whiteboard.js';
import { PFLAG } from '../../shared/protocol.js';
import { COLORS, DESK_RANGE, PLAYER_RADIUS, PHASE, ROLE } from '../../shared/constants.js';
import { EMOTES_BY_ID, EMOTE_MS } from '../../shared/emotes.js';
import { visibilityPolygon, lineOfSight, canReach } from '../../shared/sight.js';
import { drawEvidence } from './evidenceArt.js';

const SKIN = ['#f3cfae', '#e0ac85', '#c68b62', '#9a6545', '#6f4630'];
const HAIR = ['#2b1d14', '#5a3a1f', '#9b6b2f', '#d9b25b', '#1a1a1a', '#7b2f1d'];

const SPRITE = { w: 32, top: 52, bottom: 4 };   // how far a person's sprite reaches around their feet

function hashIndex(id, mod) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % mod;
}

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c * (1 + amount))));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.scale = 1;
    this.cam = { x: 0, y: 0 };
    this.insets = { right: 0, bottom: 0 }; // screen area covered by UI panels
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = this.canvas.clientWidth || window.innerWidth;
    this.h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.updateScale();
  }

  /** Centre the view on the part of the screen not covered by a panel (lobby folder). */
  setInsets(right, bottom) {
    if (right === this.insets.right && bottom === this.insets.bottom) return;
    this.insets = { right, bottom };
    this.updateScale();
  }

  get viewW() { return Math.max(200, this.w - this.insets.right); }
  get viewH() { return Math.max(200, this.h - this.insets.bottom); }

  updateScale() {
    // Show roughly 1100 x 760 world units, but never zoom out too far on phones.
    this.scale = Math.max(0.58, Math.min(1.3, Math.min(this.viewW / 1100, this.viewH / 760)));
  }

  /** Convert a screen (CSS px) point to world coordinates. */
  screenToWorld(sx, sy) {
    return {
      x: (sx - this.viewW / 2) / this.scale + this.cam.x,
      y: (sy - this.viewH / 2) / this.scale + this.cam.y,
    };
  }

  updateCamera(map, target) {
    const halfW = this.viewW / 2 / this.scale;
    const halfH = this.viewH / 2 / this.scale;
    // Let the camera drift a little past the map edge so a player standing in a
    // corner is never hidden under the corner HUD (task note, minimap).
    // On tall phone screens the HUD covers more, so let the camera keep you centred.
    const portrait = this.viewH > this.viewW;
    const marginX = (this.viewW * (portrait ? 0.45 : 0.25)) / this.scale;
    const marginY = (this.viewH * (portrait ? 0.45 : 0.3)) / this.scale;
    const clampAxis = (v, half, size, margin) => {
      const lo = half - margin;
      const hi = size - half + margin;
      return lo >= hi ? size / 2 : Math.max(lo, Math.min(hi, v)); // whole map fits: centre it
    };
    this.cam.x = clampAxis(target.x, halfW, map.width, marginX);
    // Walls along the top edge stand up into negative y; leave room to see them.
    this.cam.y = clampAxis(target.y + WALL_H, halfH, map.height + WALL_H, marginY) - WALL_H;
  }

  /**
   * @param {import('../game/ClientGame.js').ClientGame} game
   * @param {number} now
   */
  render(game, now, frame) {
    const { ctx, map } = { ctx: this.ctx, map: game.map };
    const scene = buildScene(map);
    const positions = game.renderPositions(now);
    this.updateCamera(map, game.cameraTarget());

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#2c3645';
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.save();
    ctx.translate(this.viewW / 2, this.viewH / 2);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-this.cam.x, -this.cam.y);

    // ---- 1. Floor ----
    drawFloors(ctx, map);
    this.drawBreakAreas(game, now);
    drawRoomLabels(ctx, map);
    for (const d of scene.flat) drawDecorItem(ctx, d);
    drawMeetingChairs(ctx, map);
    drawEvidence(ctx, game, 'floor', now);
    this.drawOwnDeskZone(game, now);
    for (const t of scene.tall) if (heightOf(t.item)) drawShadow(ctx, t.item);

    // ---- 2. Everything that stands up, back to front ----
    const me = game.local && !game.inLobby ? game.local : (game.local ?? null);
    const meRect = me && spriteRect(me);
    const items = [];
    for (const w of scene.walls) items.push({ base: w.base, kind: 'wall', w });
    for (const t of scene.tall) items.push({ base: t.base, kind: 'tall', t });
    for (const m of scene.mounted) items.push({ base: m.base, kind: 'mounted', m });
    for (const p of positions) items.push({ base: p.y, kind: 'player', p });
    items.sort((a, b) => a.base - b.base);

    const view = this.viewBounds();
    const covers = [];          // opaque things drawn, to find who's hidden behind them
    const targets = new Set(game.taskTargets().map((o) => o.id));
    const usable = frame.usable?.object?.id;
    for (const it of items) {
      if (it.kind === 'wall') {
        const w = it.w;
        const r = { x: w.x, y: w.y - w.height, w: w.w, h: w.h + w.height };
        if (!overlaps(r, view)) continue;
        const fade = meRect && w.base > me.y && overlaps(r, meRect) ? 0.35 : 1;
        drawWall(ctx, w, fade);
        if (fade === 1 && w.height > 30) covers.push({ r, base: w.base });
      } else if (it.kind === 'tall') {
        const o = it.t.item;
        const r = raisedRect(o, it.t.lift);
        if (!overlaps(r, view)) continue;
        const fade = meRect && heightOf(o) > 20 && it.base > me.y && overlaps(r, meRect) ? 0.4 : 1;
        this.currentMicrowave = o;
        drawTall(ctx, it.t, fade, {
          front: o.type === 'microwave' ? (c, F) => this.drawMicrowaveGlow(game, c, F, now) : undefined,
          top: (c, obj) => {
            if (obj.type === 'desk') this.drawNameplate(game, c, obj);
            if (obj.type === 'microwave') this.drawMicrowaveLabel(game, c, obj, now);
          },
          outline: (c, rr) => {
            if (targets.has(o.id) || usable === o.id) this.drawHighlight(c, rr, now, usable === o.id, targets.has(o.id));
          },
        });
        if (fade === 1 && heightOf(o) > 20) covers.push({ r, base: it.base });
      } else if (it.kind === 'mounted') {
        this.drawMounted(game, it.m, now, targets, usable);
      } else {
        this.drawPlayer(game, it.p, now);
      }
    }
    drawEvidence(ctx, game, 'object', now, (o) => raiseOf(map, o));

    // ---- 3. In the air ----
    drawEvidence(ctx, game, 'air', now, (o) => raiseOf(map, o));
    for (const p of positions) this.drawEmote(game, p, now);

    // ---- 4. The dark ----
    this.drawFog(game, scene, positions);

    // ---- 5. People hidden behind walls or furniture: a see-through outline ----
    for (const p of positions) {
      const pr = spriteRect(p);
      const hidden = covers.some((c) => c.base > p.y + 1 && overlaps(c.r, pr, 6));
      if (hidden) this.drawGhost(game, p);
    }
    ctx.restore();
  }

  /** The part of the world on screen, in world units. */
  viewBounds() {
    const hw = this.w / 2 / this.scale + 40, hh = this.h / 2 / this.scale + 40;
    return { x: this.cam.x - hw, y: this.cam.y - hh, w: hw * 2, h: hh * 2 + WALL_H };
  }

  /** Find what's under a world point, allowing for things being drawn raised. */
  objectAt(map, wx, wy) {
    const scene = buildScene(map);
    for (const m of scene.mounted) if (m.isObject && inside(mountedRect(m.item), wx, wy)) return m.item;
    let best = null;
    for (const t of scene.tall) {
      if (!t.isObject) continue;
      if (inside(raisedRect(t.item, t.lift), wx, wy) && (!best || t.base > best.base)) best = t;
    }
    return best?.item ?? map.interactables.find((o) => inside(o, wx, wy)) ?? null;
  }

  playerAt(game, wx, wy) {
    for (const [id, e] of game.entities) if (inside(spriteRect(e), wx, wy)) return id;
    return null;
  }

  /** Wall-mounted things: posters, clocks, and the whiteboard (with what's drawn on it). */
  drawMounted(game, m, now, targets, usable) {
    const ctx = this.ctx;
    const o = m.item;
    const r = mountedRect(o);
    if (o.type === 'whiteboard') {
      this.drawWhiteboard(game, r);
      if (targets.has(o.id) || usable === o.id) this.drawHighlight(ctx, { ...o, ...r }, now, usable === o.id, targets.has(o.id));
      return;
    }
    (WALL_ART[o.kind] ?? (() => {}))(ctx, o, r);
  }

  /** The conference whiteboard: someone drawing live, or whatever was left on it. */
  drawWhiteboard(game, r) {
    const ctx = this.ctx;
    ctx.fillStyle = '#c4c9d0';
    ctx.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 12);
    ctx.fillStyle = '#fbfcfd';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#8f98a5';
    ctx.fillRect(r.x + r.w * 0.3, r.y + r.h + 2, r.w * 0.4, 4);   // marker tray

    const live = game.board?.live;
    const final = game.board?.final;
    let ink = live?.ink ?? final?.ink ?? null;
    let colour = '#2f5bd3';
    if (!ink) {
      // No real drawing yet: fall back to the template of whatever was drawn.
      const doodle = game.room?.evidence?.find((e) => e.kind === 'doodle')?.data?.drawing;
      const id = doodle ?? game.room?.whiteboard?.drawing;
      const d = id && DRAWINGS_BY_ID.get(id);
      if (d) ink = d.strokes.map((st) => st.flatMap(([x, y]) => [x, y]));
    }
    if (!ink) return;
    const k = Math.min(r.w / BOARD_W, r.h / BOARD_H);
    const ox = r.x + (r.w - BOARD_W * k) / 2, oy = r.y + (r.h - BOARD_H * k) / 2;
    ctx.save();
    ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(1.2, 2.2 * k);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const st of ink) {
      ctx.beginPath();
      for (let i = 0; i + 1 < st.length; i += 2) {
        const x = ox + st[i] * k, y = oy + st[i + 1] * k;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      if (st.length === 2) ctx.lineTo(ox + st[0] * k + 0.1, oy + st[1] * k);
      ctx.stroke();
    }
    ctx.restore();
    if (live) {                     // a little "someone's drawing" marker
      ctx.fillStyle = '#cf3b31';
      ctx.beginPath(); ctx.arc(r.x + r.w - 8, r.y + 8, 4 + Math.sin(performance.now() / 200), 0, Math.PI * 2); ctx.fill();
    }
  }

  /** A running microwave's window glows (yellow, or green for fish); a finished one is lit. */
  drawMicrowaveGlow(game, ctx, F, now) {
    const o = this.currentMicrowave;
    const m = o && game.microwave(o.id);
    if (!m) return;
    const win = microwaveWindow(F);
    if (m.state === 'running') {
      ctx.fillStyle = m.fish ? `rgba(150, 210, 80, ${0.75 + 0.2 * Math.sin(now / 150)})` : `rgba(255, 214, 90, ${0.8 + 0.2 * Math.sin(now / 150)})`;
      ctx.fillRect(win.x, win.y, win.w, win.h);
      ctx.fillStyle = 'rgba(255,255,255,0.65)';              // the plate going round
      const t = now / 300;
      ctx.beginPath(); ctx.ellipse(win.x + win.w / 2 + Math.cos(t) * 4, win.y + win.h * 0.7, 6, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    } else if (m.state === 'done') {
      ctx.fillStyle = m.fish ? 'rgba(150, 210, 80, 0.9)' : 'rgba(255, 238, 180, 0.95)';
      ctx.fillRect(win.x, win.y, win.w, win.h);
    }
  }

  /** The countdown (or DING) floating above a microwave. */
  drawMicrowaveLabel(game, ctx, o, now) {
    const m = game.microwave(o.id);
    if (!m) return;
    if (m.state === 'running') {
      const secs = Math.ceil(m.msLeft / 1000);
      this.labelAbove(ctx, o, `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, '#1d2742', '#7dffa0');
    } else if (m.state === 'done' && Math.floor(now / 400) % 2 === 0) {
      this.labelAbove(ctx, o, m.fish ? 'DING! (fish)' : 'DING!', '#cf3b31', '#ffffff');
    }
  }

  labelAbove(ctx, o, text, bg, fg) {
    ctx.font = '700 11px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width + 10;
    roundRect(ctx, o.x + o.w / 2 - tw / 2, o.y - 18, tw, 15, 4);
    ctx.fillStyle = bg; ctx.fill();
    ctx.fillStyle = fg;
    ctx.fillText(text, o.x + o.w / 2, o.y - 10);
  }

  drawNameplate(game, ctx, d) {
    const owner = [...game.roster.values()].find((p) => p.deskId === d.id);
    if (!owner) return;
    if (game.entities.get(owner.id)?.flags & PFLAG.AT_DESK) return; // their name tag says it already
    ctx.font = '700 11px "Atkinson Hyperlegible", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(owner.name).width + 12;
    const x = d.x + d.w / 2, y = d.y + d.h - 9;
    roundRect(ctx, x - tw / 2, y - 7, tw, 14, 3);
    ctx.fillStyle = '#ecd9a4'; ctx.fill();
    ctx.fillStyle = COLORS[owner.colorId].hex;
    ctx.fillRect(x - tw / 2, y - 7, 4, 14);
    ctx.fillStyle = '#1d2742';
    ctx.fillText(owner.name, x + 2, y + 1);
  }

  /** Yellow pulse: one of your tasks is here. White: you can use this right now. */
  drawHighlight(ctx, o, now, isUsable, isTarget) {
    ctx.save();
    if (isTarget) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(255, 213, 46, ${0.55 + 0.45 * Math.sin(now / 250)})`;
      roundRect(ctx, o.x - 6, o.y - 6, o.w + 12, o.h + 12, 8);
      ctx.stroke();
    }
    if (isUsable) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = 6;
      roundRect(ctx, o.x - 4, o.y - 4, o.w + 8, o.h + 8, 7);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Someone you can see, hidden behind a wall or furniture: a see-through outline. */
  drawGhost(game, p) {
    const ctx = this.ctx;
    const info = game.roster.get(p.id);
    const color = COLORS[info?.colorId ?? 9].hex;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.3;
    roundRect(ctx, p.x - 12, p.y - 30, 24, 30, 10); ctx.fill();
    ctx.beginPath(); ctx.arc(p.x, p.y - 38, 10, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.85;
    roundRect(ctx, p.x - 12, p.y - 30, 24, 30, 10); ctx.stroke();
    ctx.beginPath(); ctx.arc(p.x, p.y - 38, 10, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    const name = info?.name ?? '???';
    ctx.font = '600 11px "Atkinson Hyperlegible", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(name).width + 10;
    roundRect(ctx, p.x - tw / 2, p.y - 66, tw, 15, 5);
    ctx.fillStyle = 'rgba(29, 39, 66, 0.75)'; ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, p.x, p.y - 58);
    ctx.restore();
  }

  /** An emote bubble over someone's head: pops in, floats a little, fades out. */
  drawEmote(game, p, now) {
    const e = game.emotes.get(p.id);
    if (!e) return;
    const age = now - e.at;
    if (age > EMOTE_MS) { game.emotes.delete(p.id); return; }
    const def = EMOTES_BY_ID.get(e.emote);
    if (!def) return;
    const ctx = this.ctx;
    const pop = Math.min(1, age / 160);
    const scale = pop < 1 ? 0.4 + 0.8 * pop - 0.2 * pop * pop : 1;
    const fade = age > EMOTE_MS - 400 ? (EMOTE_MS - age) / 400 : 1;
    const x = p.x, y = p.y - SPRITE.top - 40 - Math.min(6, age / 200);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.arc(0, 0, 21, 0, Math.PI * 2);
    ctx.moveTo(-6, 18); ctx.lineTo(0, 30); ctx.lineTo(6, 18);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#1d2742';
    ctx.stroke();
    ctx.font = '24px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.glyph, 0, 2);
    ctx.restore();
  }

  /**
   * The dark: everything you can't see. On the floor it's a visibility polygon
   * from shared/sight.js (walls block your view, and it fades out at your sight
   * range). Things that stand up are cut out of the dark too when you can see
   * them: furniture whose footprint you can see, people, and wall faces you're
   * in front of with a clear line to their foot. So you see the back wall of
   * the room you're in, but not the far side of a wall you're behind. Cosmetic
   * only: the server doesn't send players you can't see.
   */
  drawFog(game, scene, positions) {
    if (!game.inOffice || game.phase !== PHASE.PLAYING) return;
    if (game.room?.sandbox?.seeAll?.includes(game.selfId)) return; // SANDBOX: see-everyone toggle
    const ctx = this.ctx;
    const map = game.map;
    const r = game.settings.sightRange;
    const { x, y } = game.local;

    // Recompute what's visible only when you've moved.
    const key = `${Math.round(x)},${Math.round(y)},${r}`;
    if (this.visKey !== key) {
      this.vis = visibilityPolygon(map, x, y, r);
      this.litRects = litRects(map, scene, x, y, r);
      this.visKey = key;
    }

    const fc = (this.fogCanvas ||= document.createElement('canvas'));
    if (fc.width !== this.canvas.width || fc.height !== this.canvas.height) {
      fc.width = this.canvas.width;
      fc.height = this.canvas.height;
    }
    const f = (this.fogCtx ||= fc.getContext('2d'));
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, fc.width, fc.height);
    f.fillStyle = 'rgba(20, 26, 40, 0.84)';
    f.fillRect(0, 0, fc.width, fc.height);
    f.setTransform(ctx.getTransform());
    f.globalCompositeOperation = 'destination-out';
    const g = f.createRadialGradient(x, y, r * 0.72, x, y, r);
    g.addColorStop(0, 'rgba(0, 0, 0, 1)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    f.fillStyle = g;
    f.beginPath();
    this.vis.forEach(([px, py], i) => (i ? f.lineTo(px, py) : f.moveTo(px, py)));
    f.closePath();
    f.fill();
    // Things standing up that you can see.
    f.fillStyle = 'rgba(0, 0, 0, 1)';
    for (const rr of this.litRects) {
      // Fade with distance like the floor does.
      const d = Math.hypot(rr.fx - x, rr.fy - y);
      f.globalAlpha = d < r * 0.72 ? 1 : Math.max(0, 1 - (d - r * 0.72) / (r * 0.28));
      if (f.globalAlpha > 0) f.fillRect(rr.x, rr.y, rr.w, rr.h);
    }
    f.globalAlpha = 1;
    for (const p of positions) {
      const s = spriteRect(p);
      f.fillRect(s.x, s.y - 30, s.w, s.h + 30);   // people (and their name tags)
    }
    f.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(fc, 0, 0);
    ctx.restore();
  }

  /** During a break, tint the places where you're safe from reports. */
  drawBreakAreas(game, now) {
    if (game.phase !== PHASE.PLAYING || !game.breakInfo(now).current) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = `rgba(84, 201, 133, ${0.16 + 0.05 * Math.sin(now / 400)})`;
    ctx.strokeStyle = 'rgba(45, 138, 84, 0.7)';
    ctx.lineWidth = 4;
    ctx.setLineDash([14, 10]);
    for (const r of game.map.rooms) {
      if (!r.breakArea) continue;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x + 8, r.y + 8, r.w - 16, r.h - 16);
    }
    ctx.restore();
  }

  drawOwnDeskZone(game, now) {
    const desk = game.self?.deskId && game.map.desksById.get(game.self.deskId);
    if (!desk || !game.local) return;
    const ctx = this.ctx;
    const alarm = false;
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -now / (alarm ? 25 : 60);
    ctx.strokeStyle = alarm ? '#cf3b31' : 'rgba(45, 138, 84, 0.9)';
    ctx.fillStyle = alarm ? `rgba(207, 59, 49, ${0.12 + 0.1 * Math.sin(now / 120)})` : 'rgba(45, 138, 84, 0.12)';
    ctx.lineWidth = alarm ? 4 : 2.5;
    ctx.beginPath();
    ctx.arc(desk.seat.x, desk.seat.y, DESK_RANGE, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }



  /** A person, standing: feet at (p.x, p.y). */
  drawPlayer(game, p, now) {
    const ctx = this.ctx;
    const info = game.roster.get(p.id);
    const color = COLORS[info?.colorId ?? 9].hex;
    const isSelf = p.id === game.selfId;
    const skin = SKIN[hashIndex(p.id, SKIN.length)];
    const hair = HAIR[hashIndex(p.id + 'h', HAIR.length)];
    const x = p.x, y = p.y;
    const walk = Math.sin(now / 90 + hashIndex(p.id, 10)) * (p.moving ? 2.5 : 0);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(x, y, 13, 5, 0, 0, Math.PI * 2); ctx.fill();
    // Legs
    ctx.fillStyle = '#2b3245';
    roundRect(ctx, x - 8, y - 12 + walk * 0.4, 6, 12 - walk * 0.4, 2); ctx.fill();
    roundRect(ctx, x + 2, y - 12 - walk * 0.4, 6, 12 + walk * 0.4, 2); ctx.fill();
    // Body (shirt)
    roundRect(ctx, x - 12, y - 32, 24, 22, 8);
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = shade(color, -0.45); ctx.stroke();
    // Collar + tie
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(x - 5, y - 32); ctx.lineTo(x, y - 26); ctx.lineTo(x + 5, y - 32); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(color, -0.5);
    ctx.beginPath(); ctx.moveTo(x - 2, y - 28); ctx.lineTo(x, y - 18); ctx.lineTo(x + 2, y - 28); ctx.closePath(); ctx.fill();
    // Head
    ctx.beginPath(); ctx.arc(x, y - 40, 10, 0, Math.PI * 2);
    ctx.fillStyle = skin; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = shade('#a07050', -0.3); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - 42, 10.5, Math.PI * 1.02, Math.PI * 1.98); ctx.lineTo(x + 9, y - 39); ctx.lineTo(x - 9, y - 39); ctx.closePath();
    ctx.fillStyle = hair; ctx.fill();
    ctx.fillStyle = '#1d2742';
    ctx.beginPath(); ctx.arc(x - 3.5, y - 38, 1.4, 0, Math.PI * 2); ctx.arc(x + 3.5, y - 38, 1.4, 0, Math.PI * 2); ctx.fill();

    // Busy bubble
    if (p.flags & PFLAG.BUSY) {
      const bx = x + 12, by = y - 54;
      roundRect(ctx, bx - 2, by - 8, 26, 14, 7);
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.fillStyle = '#1d2742';
      for (let i = 0; i < 3; i++) {
        const lift = Math.sin(now / 150 + i) > 0.3 ? -1.5 : 0;
        ctx.beginPath(); ctx.arc(bx + 5 + i * 7, by - 1 + lift, 2, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Fellow slacker badge (only slackers see these, about each other)
    if (!isSelf && game.isTeammate(p.id)) {
      ctx.font = '700 10px "Atkinson Hyperlegible", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const bw = ctx.measureText('Slacker').width + 10;
      roundRect(ctx, x - bw / 2, y - 86, bw, 14, 4);
      ctx.fillStyle = '#cf3b31'; ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.fillText('Slacker', x, y - 78.5);
    }
    // Name tag
    const name = info?.name ?? '???';
    ctx.font = `${isSelf ? 700 : 600} 12px "Atkinson Hyperlegible", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(name).width + 10;
    roundRect(ctx, x - tw / 2, y - 70, tw, 16, 5);
    ctx.fillStyle = isSelf ? '#1d2742' : 'rgba(255,255,255,0.92)'; ctx.fill();
    ctx.fillStyle = isSelf ? '#ffffff' : '#1d2742';
    ctx.fillText(name, x, y - 61.5);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The box a standing person covers on screen (world units). */
function spriteRect(p) {
  return { x: p.x - SPRITE.w / 2, y: p.y - SPRITE.top, w: SPRITE.w, h: SPRITE.top + SPRITE.bottom };
}

function overlaps(a, b, pad = 0) {
  return a.x < b.x + b.w - pad && a.x + a.w > b.x + pad && a.y < b.y + b.h - pad && a.y + a.h > b.y + pad;
}

function inside(r, x, y) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/**
 * Raised things you can see from (x, y), as rects to cut out of the dark.
 * Walls: lit if you have a clear line to the floor in front of the side
 * facing you. Furniture: lit if you can see its footprint.
 */
function litRects(map, scene, x, y, range) {
  const out = [];
  for (const w of scene.walls) {
    const mx = Math.max(w.x, Math.min(w.x + w.w, x));
    if (w.horizontal) {
      const inFront = y > w.y + w.h;         // you're below (in front of) the wall's face
      const fy = inFront ? w.y + w.h + 2 : w.y - 2;
      if (Math.hypot(mx - x, fy - y) > range || !lineOfSight(map, x, y, mx, fy)) continue;
      // From the front you see the whole face; from behind only its top.
      out.push({ x: w.x, y: w.y - w.height, w: w.w, h: w.h + w.height, fx: mx, fy });
    } else {
      const fx = x < w.x ? w.x - 2 : w.x + w.w + 2;
      const my = Math.max(w.y, Math.min(w.y + w.h, y));
      if (Math.hypot(fx - x, my - y) > range || !lineOfSight(map, x, y, fx, my)) continue;
      out.push({ x: w.x, y: w.y - w.height, w: w.w, h: w.h + w.height, fx, fy: my });
    }
  }
  // Wall-mounted things: only from in front.
  for (const m of scene.mounted) {
    const r = mountedRect(m.item);
    const mx = Math.max(m.item.x, Math.min(m.item.x + m.item.w, x));
    const fy = m.item.y + (m.item.h || 0) + 2;
    if (y < fy - 2 || Math.hypot(mx - x, fy - y) > range || !lineOfSight(map, x, y, mx, fy)) continue;
    out.push({ x: r.x - 6, y: r.y - 6, w: r.w + 12, h: r.h + 18, fx: mx, fy });
  }
  for (const t of scene.tall) {
    const o = t.item;
    if (!canReach(map, x, y, o, range)) continue;
    const rr = raisedRect(o, t.lift);
    out.push({ x: rr.x - 2, y: rr.y - 2, w: rr.w + 4, h: rr.h + 4, fx: o.x + o.w / 2, fy: o.y + o.h / 2 });
  }
  return out;
}
