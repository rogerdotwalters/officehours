/**
 * Evidence art: the messes slackers leave around the office (shared/evidence.js).
 * Drawn in world space by the Renderer, in three layers:
 *   floor  under people (floods, papers, litter)
 *   object on top of furniture (angry notes, the whiteboard, the cat)
 *   air    over people (fish fumes, smoke)
 */
import { DRAWINGS_BY_ID } from '../../shared/minigames/whiteboard.js';

export const LAYER = {
  flood: 'floor', copies: 'floor', memes: 'floor', litter: 'floor',
  stolen_lunch: 'object', fat_cat: 'object', screen: 'object',   // (rude doodles show on the whiteboard itself)
  fish: 'air', empty_pot: 'air',
};

/** Small deterministic random numbers, so scattered things don't jump around. */
function seeded(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const centre = (o) => ({ x: o.x + o.w / 2, y: o.y + o.h / 2 });

const DRAW = {
  // ---- air ----
  fish(ctx, o, e, now, map) {
    const room = map.roomAt(o.x, o.y);
    const c = centre(o);
    if (room) {
      ctx.fillStyle = `rgba(150, 200, 70, ${0.18 + 0.05 * Math.sin(now / 700)})`;
      ctx.fillRect(room.x, room.y, room.w, room.h);
    }
    const rnd = seeded(e.objectId);
    ctx.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      // Each wisp drifts out from the microwave across the room on a loop.
      const speed = 0.00006 + rnd() * 0.00005;
      const t = ((now * speed) + rnd()) % 1;
      const ang = rnd() * Math.PI * 2;
      const reach = 40 + t * (room ? Math.min(room.w, room.h) * 0.6 : 200);
      const x = c.x + Math.cos(ang) * reach;
      const y = c.y + Math.sin(ang) * reach * 0.8 - t * 40;
      ctx.strokeStyle = `rgba(100, 165, 30, ${0.9 * (1 - t * 0.7)})`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      for (let k = 0; k <= 12; k++) {
        const yy = y - k * 3;
        const xx = x + Math.sin(k * 0.9 + now / 250 + i) * 5;
        k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
      }
      ctx.stroke();
    }
  },
  empty_pot(ctx, o, e, now) {
    const c = centre(o);
    for (let i = 0; i < 7; i++) {
      const t = ((now / 2200) + i / 7) % 1;
      ctx.beginPath();
      ctx.arc(c.x + Math.sin(t * 6 + i) * 10, o.y - t * 70, 8 + t * 16, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(70, 70, 75, ${0.55 * (1 - t)})`;
      ctx.fill();
    }
  },

  // ---- floor ----
  flood(ctx, o, e, now, map) {
    const c = centre(o);
    const room = map.roomAt(c.x, c.y);
    const grow = Math.min(1, e.ageMs / 12_000 + (now - e.receivedAt) / 12_000);
    const rx = 40 + grow * (room ? room.w * 0.45 : 200);
    const ry = 30 + grow * (room ? room.h * 0.4 : 150);
    ctx.save();
    if (room) { ctx.beginPath(); ctx.rect(room.x + 12, room.y + 12, room.w - 24, room.h - 24); ctx.clip(); }
    ctx.beginPath();
    ctx.ellipse(c.x, c.y - ry * 0.4, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(91, 180, 227, 0.55)';
    ctx.fill();
    for (let k = 0; k < 3; k++) {
      const t = ((now / 1600) + k / 3) % 1;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y - ry * 0.4, rx * t, ry * t, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.5 * (1 - t)})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  },
  copies(ctx, o, e) {
    const rnd = seeded(e.objectId + 'copies');
    const c = centre(o);
    for (let i = 0; i < 9; i++) {
      const x = c.x - 90 + rnd() * 180, y = o.y + o.h + 10 + rnd() * 120;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((rnd() - 0.5) * 1.6);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#8f98a5';
      ctx.lineWidth = 1;
      ctx.fillRect(-11, -14, 22, 28);
      ctx.strokeRect(-11, -14, 22, 28);
      ctx.fillStyle = i % 3 === 0 ? '#e8b49a' : '#9aa3ae';
      if (i % 3 === 0) { ctx.beginPath(); ctx.arc(0, -2, 7, 0, Math.PI * 2); ctx.fill(); } // a scanned face
      else for (let k = 0; k < 4; k++) ctx.fillRect(-7, -9 + k * 5, 14, 1.5);
      ctx.restore();
    }
  },
  memes(ctx, o) {
    const x = o.x + o.w + 8, y = o.y + 6;
    for (let k = 0; k < 8; k++) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#8f98a5';
      ctx.fillRect(x + (k % 2) * 2, y + 40 - k * 4, 30, 22);
      ctx.strokeRect(x + (k % 2) * 2, y + 40 - k * 4, 30, 22);
    }
    ctx.fillStyle = '#cf3b31';
    ctx.font = '700 10px Fredoka, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('LOL', x + 16, y + 19);
  },
  litter(ctx, o, e) {
    const rnd = seeded(e.objectId + 'litter');
    const c = centre(o);
    const colours = ['#c7e6f3', '#cfd5dc', '#e8e2d0', '#c99b66', '#a8d8c8'];
    for (let i = 0; i < 14; i++) {
      const x = c.x - 160 + rnd() * 320, y = o.y + o.h + 10 + rnd() * 140;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rnd() * Math.PI);
      ctx.fillStyle = colours[i % colours.length];
      ctx.strokeStyle = '#1d2742';
      ctx.lineWidth = 1.2;
      if (i % 3 === 0) { ctx.fillRect(-12, -9, 24, 18); ctx.strokeRect(-12, -9, 24, 18); }
      else { ctx.beginPath(); ctx.ellipse(0, 0, 5, 12, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      ctx.restore();
    }
  },

  // ---- object ----
  /** A coworker's monitor with something unprofessional on it (PG: censored). */
  screen(ctx, o, e, now) {
    const x = o.x + o.w / 2 - 22, y = o.y + 2, w = 44, h = 13;
    ctx.save();
    ctx.shadowColor = '#ff6fb1';
    ctx.shadowBlur = 10 + 4 * Math.sin(now / 250);
    ctx.fillStyle = '#ff9fcf';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    ctx.fillStyle = '#ffd6ea';
    ctx.fillRect(x + 4, y + 2, 10, 9);
    ctx.fillStyle = '#1d2742';
    ctx.fillRect(x + 2, y + 4, w - 4, 5);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 4.5px Fredoka, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('CENSORED', x + w / 2, y + 6.6);
  },
  stolen_lunch(ctx, o, e, now) {
    const wob = Math.sin(now / 300) * 0.04;
    ctx.save();
    ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
    ctx.rotate(-0.12 + wob);
    ctx.fillStyle = '#ffe766';
    ctx.strokeStyle = '#c9b23a';
    ctx.fillRect(-30, -22, 60, 44);
    ctx.strokeRect(-30, -22, 60, 44);
    ctx.fillStyle = '#cf3b31';
    ctx.font = '700 9px Fredoka, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('WHO ATE', 0, -8);
    ctx.fillText('MY LUNCH', 0, 4);
    ctx.fillText('?!?!', 0, 16);
    ctx.restore();
  },
  doodle(ctx, o, e) {
    const d = DRAWINGS_BY_ID.get(e.data?.drawing);
    scrawl(ctx, o, d?.scrawl ?? '???', '#cf3b31');
  },
  fat_cat(ctx, o) {
    const cx = o.x + o.w + 34, cy = o.y + 8;
    ctx.fillStyle = '#e08a3c';
    ctx.strokeStyle = '#1d2742';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(cx, cy + 6, 34, 26, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + 26, cy - 16, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 16, cy - 24); ctx.lineTo(cx + 18, cy - 38); ctx.lineTo(cx + 26, cy - 28); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx + 30, cy - 28); ctx.lineTo(cx + 38, cy - 38); ctx.lineTo(cx + 39, cy - 22); ctx.fill();
    ctx.fillStyle = '#1d2742';
    ctx.beginPath(); ctx.arc(cx + 22, cy - 17, 1.8, 0, Math.PI * 2); ctx.arc(cx + 31, cy - 17, 1.8, 0, Math.PI * 2); ctx.fill();
  },
};

/** Marker writing on the conference whiteboard. */
function scrawl(ctx, o, text, colour) {
  ctx.save();
  ctx.fillStyle = '#fbfcfd';
  ctx.fillRect(o.x + 4, o.y + 2, o.w - 8, o.h - 4);
  ctx.fillStyle = colour;
  ctx.font = '700 13px "Comic Sans MS", Fredoka, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(o.x + o.w / 2, o.y + o.h / 2 + 1);
  ctx.rotate(-0.02);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/**
 * Draw every piece of evidence on one layer. `raise(o)` says how far an object
 * is drawn raised in the angled view, so notes and smoke sit on top of it.
 */
export function drawEvidence(ctx, game, layer, now, raise = () => 0) {
  const room = game.room;
  if (!room || game.inLobby) return;
  for (const e of room.evidence ?? []) {
    if (LAYER[e.kind] !== layer || !DRAW[e.kind]) continue;
    const o = game.map.getInteractable(e.objectId);
    if (!o) continue;
    e.receivedAt ??= room.receivedAt;
    const z = layer === 'floor' ? 0 : raise(o);
    DRAW[e.kind](ctx, z ? { ...o, y: o.y - z } : o, e, now, game.map);
  }
}
