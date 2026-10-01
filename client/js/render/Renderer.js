/**
 * Renderer — draws one frame of the office from ClientGame state.
 * World-space drawing happens inside a camera transform that follows the local
 * player (or a spectated colleague). HUD elements live in the DOM (see UI.js).
 */
import { drawFloors, drawWalls, drawRoomLabels, drawDecor, drawInteractable, roundRect } from './officeArt.js';
import { PFLAG } from '../../shared/protocol.js';
import { COLORS, DESK_RANGE, PLAYER_RADIUS } from '../../shared/constants.js';

const SKIN = ['#f3cfae', '#e0ac85', '#c68b62', '#9a6545', '#6f4630'];
const HAIR = ['#2b1d14', '#5a3a1f', '#9b6b2f', '#d9b25b', '#1a1a1a', '#7b2f1d'];

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
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = this.canvas.clientWidth || window.innerWidth;
    this.h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    // Show roughly 1100 x 760 world units, but never zoom out too far on phones.
    this.scale = Math.max(0.58, Math.min(1.3, Math.min(this.w / 1100, this.h / 760)));
  }

  /** Convert a screen (CSS px) point to world coordinates. */
  screenToWorld(sx, sy) {
    return {
      x: (sx - this.w / 2) / this.scale + this.cam.x,
      y: (sy - this.h / 2) / this.scale + this.cam.y,
    };
  }

  updateCamera(map, target) {
    const halfW = this.w / 2 / this.scale;
    const halfH = this.h / 2 / this.scale;
    // Let the camera drift a little past the map edge so a player standing in a
    // corner is never hidden under the corner HUD (task note, minimap).
    const marginX = (this.w * 0.25) / this.scale;
    const marginY = (this.h * 0.3) / this.scale;
    const clampAxis = (v, half, size, margin) =>
      (size <= half * 2 ? size / 2 : Math.max(half - margin, Math.min(size - half + margin, v)));
    this.cam.x = clampAxis(target.x, halfW, map.width, marginX);
    this.cam.y = clampAxis(target.y, halfH, map.height, marginY);
  }

  /**
   * @param {import('../game/ClientGame.js').ClientGame} game
   * @param {number} now
   * @param {{ usable: object|null }} frame  per-frame UI state from main.js
   */
  render(game, now, frame) {
    const { ctx, map } = { ctx: this.ctx, map: game.map };
    const positions = game.renderPositions(now);
    this.updateCamera(map, game.cameraTarget());

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#2c3645';
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.save();
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-this.cam.x, -this.cam.y);

    drawFloors(ctx, map);
    drawRoomLabels(ctx, map);
    drawDecor(ctx, map);
    this.drawOwnDeskZone(game, now);
    for (const o of map.interactables) drawInteractable(ctx, o);
    this.drawDeskNameplates(game);
    drawWalls(ctx, map);
    this.drawTaskHighlights(game, now, frame.usable);

    // Players, sorted by y so lower players overlap higher ones.
    positions.sort((a, b) => a.y - b.y);
    const reportable = new Map(game.reportableTargets().map((t) => [t.id, t]));
    for (const p of positions) this.drawPlayer(game, p, now, reportable.get(p.id));

    ctx.restore();
  }

  drawOwnDeskZone(game, now) {
    const desk = game.self?.deskId && game.map.desksById.get(game.self.deskId);
    if (!desk || !game.local) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -now / 60;
    ctx.strokeStyle = 'rgba(45, 138, 84, 0.9)';
    ctx.fillStyle = 'rgba(45, 138, 84, 0.12)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(desk.seat.x, desk.seat.y, DESK_RANGE, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawDeskNameplates(game) {
    const ctx = this.ctx;
    const owners = new Map();
    for (const p of game.roster.values()) if (p.deskId) owners.set(p.deskId, p);
    ctx.font = '700 11px "Atkinson Hyperlegible", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const d of game.map.desks) {
      const owner = owners.get(d.id);
      if (!owner) continue;
      const label = owner.name;
      const tw = ctx.measureText(label).width + 12;
      const x = d.x + d.w / 2;
      const y = d.y + d.h - 9;
      roundRect(ctx, x - tw / 2, y - 7, tw, 14, 3);
      ctx.fillStyle = '#ecd9a4';
      ctx.fill();
      ctx.fillStyle = COLORS[owner.colorId].hex;
      ctx.fillRect(x - tw / 2, y - 7, 4, 14);
      ctx.fillStyle = '#1d2742';
      ctx.fillText(label, x + 2, y + 1);
    }
  }

  drawTaskHighlights(game, now, usable) {
    const ctx = this.ctx;
    if (!game.inOffice) return;
    const pulse = 0.55 + 0.45 * Math.sin(now / 250);
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(255, 213, 46, ${pulse})`;
    for (const o of game.taskTargets()) {
      roundRect(ctx, o.x - 6, o.y - 6, o.w + 12, o.h + 12, 8);
      ctx.stroke();
    }
    if (usable?.object) {
      const o = usable.object;
      ctx.lineWidth = 3;
      ctx.strokeStyle = usable.action ? '#ffffff' : 'rgba(255,255,255,0.5)';
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = 6;
      roundRect(ctx, o.x - 4, o.y - 4, o.w + 8, o.h + 8, 7);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawPlayer(game, p, now, reportInfo) {
    const ctx = this.ctx;
    const info = game.roster.get(p.id);
    const color = COLORS[info?.colorId ?? 9].hex;
    const isSelf = p.id === game.selfId;
    const r = PLAYER_RADIUS;

    // Management's view: who can be reported right now.
    if (reportInfo) {
      ctx.save();
      ctx.lineWidth = 3;
      ctx.strokeStyle = reportInfo.inRange ? '#cf3b31' : 'rgba(207, 59, 49, 0.45)';
      if (!reportInfo.inRange) ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 9 + (reportInfo.inRange ? Math.sin(now / 120) * 2 : 0), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + r - 2, r, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    // Shoulders (shirt)
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 2, r, r * 0.82, 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = shade(color, -0.45);
    ctx.stroke();

    // Collar + tie
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(p.x - 5, p.y + 3); ctx.lineTo(p.x, p.y + 9); ctx.lineTo(p.x + 5, p.y + 3); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = shade(color, -0.5);
    ctx.beginPath();
    ctx.moveTo(p.x - 2, p.y + 6); ctx.lineTo(p.x, p.y + 13); ctx.lineTo(p.x + 2, p.y + 6); ctx.closePath();
    ctx.fill();

    // Head (top-down) with hair
    const skin = SKIN[hashIndex(p.id, SKIN.length)];
    const hair = HAIR[hashIndex(p.id + 'h', HAIR.length)];
    ctx.beginPath();
    ctx.arc(p.x, p.y - 4, 8, 0, Math.PI * 2);
    ctx.fillStyle = skin;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = shade('#a07050', -0.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y - 5, 8, Math.PI * 1.05, Math.PI * 1.95);
    ctx.lineTo(p.x, p.y - 8);
    ctx.closePath();
    ctx.fillStyle = hair;
    ctx.fill();

    // Busy bubble
    if (p.flags & PFLAG.BUSY) {
      const bx = p.x + 14, by = p.y - 26;
      roundRect(ctx, bx - 2, by - 8, 26, 14, 7);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.fillStyle = '#1d2742';
      for (let i = 0; i < 3; i++) {
        const lift = Math.sin(now / 150 + i) > 0.3 ? -1.5 : 0;
        ctx.beginPath(); ctx.arc(bx + 5 + i * 7, by - 1 + lift, 2, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Name tag
    const name = info?.name ?? '???';
    ctx.font = `${isSelf ? 700 : 600} 12px "Atkinson Hyperlegible", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(name).width + 10;
    roundRect(ctx, p.x - tw / 2, p.y - r - 22, tw, 16, 5);
    ctx.fillStyle = isSelf ? '#1d2742' : 'rgba(255,255,255,0.92)';
    ctx.fill();
    ctx.fillStyle = isSelf ? '#ffffff' : '#1d2742';
    ctx.fillText(name, p.x, p.y - r - 13.5);
  }
}
