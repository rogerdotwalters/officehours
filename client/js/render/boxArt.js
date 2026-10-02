/**
 * Box art: appliances and cabinets drawn as real boxes in the angled view.
 *
 * A raised object has two faces, as in scene.js:
 *   top:   the footprint rectangle lifted up by its height
 *   front: the strip below the top, down to the footprint's bottom edge
 *
 * Each BOX spec says what the front looks like (doors, drawers, a window...)
 * and whether the top is a plain surface or the object's top-down sprite.
 * Kinds without a spec fall back to the sprite-plus-shading in scene.js.
 *
 *   top:     'plain' paints the top in `topColor`; 'sprite' uses the top-down art
 *   front:   base colour of the front face
 *   detail:  (ctx, F, o) draws doors, handles and so on onto the front rect F
 */
import { roundRect } from './officeArt.js';

const INK = '#1d2742';

function rect(ctx, x, y, w, h, fill, stroke = null, lw = 1) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw); }
}

/** Where a microwave's window is on its front face (shared with the "it's running" glow). */
export function microwaveWindow(F) {
  return { x: F.x + 4, y: F.y + 3, w: F.w - 20, h: F.h - 7 };
}

export const BOX = {
  fridge: {
    top: 'plain', topColor: '#fafcfd', front: '#d6dde5', trim: '#7d8793',
    detail(ctx, F) {
      const split = F.y + F.h * 0.32;                       // freezer on top, fridge below
      rect(ctx, F.x, split - 1, F.w, 3, '#b8c1cb');
      for (const [y0, y1] of [[F.y + 5, split - 5], [split + 6, split + 24]]) rect(ctx, F.x + F.w - 11, y0, 4, y1 - y0, '#8f98a5', INK, 1);
      rect(ctx, F.x + 4, F.y + F.h - 5, F.w - 8, 3, 'rgba(0,0,0,0.12)');
    },
  },
  microwave: {
    top: 'plain', topColor: '#dde2e8', front: '#c9d0d8', trim: '#5d6673',
    detail(ctx, F) {
      const w = microwaveWindow(F);
      rect(ctx, w.x, w.y, w.w, w.h, '#2b3245', INK, 1);
      rect(ctx, w.x + 2, w.y + 2, w.w * 0.4, 3, 'rgba(255,255,255,0.18)');
      for (let i = 0; i < 3; i++) rect(ctx, F.x + F.w - 12, F.y + 3 + i * 4.5, 8, 3, i === 2 ? '#cf3b31' : '#7d8793');
    },
  },
  coffee_machine: {
    top: 'plain', topColor: '#454a57', front: '#2f333d', trim: '#14171d',
    detail(ctx, F) {
      rect(ctx, F.x + 5, F.y + 4, F.w - 10, 7, '#1d2742');
      rect(ctx, F.x + F.w - 13, F.y + 5, 5, 4, '#7dffa0');
      rect(ctx, F.x + F.w / 2 - 3, F.y + 11, 6, 4, '#8f98a5');         // spout
      rect(ctx, F.x + F.w / 2 - 6, F.y + F.h - 8, 12, 7, '#ffffff', INK, 1);   // cup
    },
  },
  vending: {
    top: 'plain', topColor: '#e05a4f', front: '#cf3b31', trim: '#7d1c16',
    detail(ctx, F) {
      const gx = F.x + 5, gy = F.y + 6, gw = F.w - 22, gh = F.h - 22;
      rect(ctx, gx, gy, gw, gh, '#bfe3f2', INK, 1);
      const cols = ['#ffd23f', '#3a6fd8', '#2f9e5b', '#e56aa8', '#ffffff'];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) rect(ctx, gx + 3 + c * ((gw - 6) / 4), gy + 3 + r * ((gh - 6) / 4), (gw - 6) / 4 - 2, (gh - 6) / 4 - 3, cols[(r + c * 2) % cols.length]);
      rect(ctx, F.x + F.w - 14, F.y + 8, 9, 22, '#2b3245');
      for (let i = 0; i < 4; i++) rect(ctx, F.x + F.w - 12, F.y + 10 + i * 5, 5, 3, '#ffd23f');
      rect(ctx, F.x + 8, F.y + F.h - 10, F.w - 16, 6, '#14171d');       // dispenser flap
    },
  },
  bookshelf: {
    top: 'plain', topColor: '#a87b52', front: '#8a5a3c', trim: '#4a2f1d',
    detail(ctx, F, o) {
      const rows = Math.max(3, Math.floor(F.h / 18));
      const rh = F.h / rows;
      const cols = ['#cf3b31', '#3a6fd8', '#ffd23f', '#2f9e5b', '#8d5bd1', '#e8e4da', '#f08a24'];
      for (let r = 0; r < rows; r++) {
        let x = F.x + 3, i = Math.floor(o.x / 7) + r * 3;
        while (x < F.x + F.w - 4) {
          const bw = 3 + ((i * 7) % 4);
          rect(ctx, x, F.y + r * rh + 3, Math.min(bw, F.x + F.w - 3 - x), rh - 5, cols[i % cols.length]);
          x += bw + 1; i++;
        }
        rect(ctx, F.x, F.y + (r + 1) * rh - 2, F.w, 2, '#4a2f1d');
      }
    },
  },
  filing_cabinet: {
    top: 'plain', topColor: '#b4bcc6', front: '#9aa3ae', trim: '#3d475e',
    detail(ctx, F) {
      const n = 3, dh = F.h / n;
      for (let i = 0; i < n; i++) {
        rect(ctx, F.x + 3, F.y + i * dh + 3, F.w - 6, dh - 5, '#a9b1bb', '#3d475e', 1);
        rect(ctx, F.x + F.w / 2 - 7, F.y + i * dh + dh / 2 - 1, 14, 3, '#3d475e');
      }
    },
  },
  supplies: {
    top: 'plain', topColor: '#c6ccd4', front: '#adb4bd', trim: '#3d475e',
    detail(ctx, F) {
      rect(ctx, F.x + F.w / 2 - 1, F.y + 3, 2, F.h - 6, '#3d475e');
      rect(ctx, F.x + F.w / 2 - 7, F.y + F.h / 2 - 5, 3, 10, '#3d475e');
      rect(ctx, F.x + F.w / 2 + 4, F.y + F.h / 2 - 5, 3, 10, '#3d475e');
    },
  },
  dumpster: {
    top: 'plain', topColor: '#245a7e', front: '#2f6f9a', trim: '#173d57',
    detail(ctx, F) {
      for (let x = F.x + 8; x < F.x + F.w - 4; x += 16) rect(ctx, x, F.y + 3, 3, F.h - 6, '#245a7e');
      rect(ctx, F.x, F.y, F.w, 4, '#173d57');
    },
  },
  shredder: {
    top: 'plain', topColor: '#6b7280', front: '#4a4f5a', trim: '#14171d',
    detail(ctx, F) {
      rect(ctx, F.x + 6, F.y + 5, F.w - 12, 4, '#14171d');
      rect(ctx, F.x + 6, F.y + F.h - 9, F.w - 12, 5, '#5d6370', '#14171d', 1);
    },
  },
  mailbox: {
    top: 'plain', topColor: '#c79a69', front: '#b58a5a', trim: '#5e4127',
    detail(ctx, F) {
      const cols = Math.floor(F.w / 22), rows = 2;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        rect(ctx, F.x + 3 + c * ((F.w - 6) / cols), F.y + 3 + r * (F.h - 4) / rows, (F.w - 6) / cols - 2, (F.h - 4) / rows - 3, '#9d7448', '#5e4127', 1);
      }
    },
  },
  printer: {
    top: 'sprite', front: '#dfe4ea', trim: '#5d6673',
    detail(ctx, F) {
      rect(ctx, F.x + 6, F.y + 5, F.w - 12, 4, '#2b3245');
      rect(ctx, F.x + 10, F.y + F.h - 8, F.w - 20, 5, '#ffffff', '#8f98a5', 1);
    },
  },
  copier: {
    top: 'sprite', front: '#dfe4ea', trim: '#5d6673',
    detail(ctx, F) {
      rect(ctx, F.x + 6, F.y + 5, 16, 8, '#2b3245');
      rect(ctx, F.x + F.w - 14, F.y + 6, 7, 3, '#7dffa0');
      rect(ctx, F.x + 6, F.y + F.h - 8, F.w - 12, 5, '#c9d0d8', '#8f98a5', 1);
    },
  },
  hr_box: {
    top: 'plain', topColor: '#ea6a5f', front: '#e0473b', trim: '#7d1c16',
    detail(ctx, F) {
      rect(ctx, F.x + 8, F.y + 7, F.w - 16, 4, '#1d2742');
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 12px Fredoka, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('HR', F.x + F.w / 2, F.y + F.h * 0.65);
    },
  },
  counter: {
    top: 'sprite', front: '#c4ad8c', trim: '#7a6444',
    detail(ctx, F) {
      const n = Math.max(2, Math.round(F.w / 42));
      const dw = (F.w - 4) / n;
      for (let i = 0; i < n; i++) {
        rect(ctx, F.x + 2 + i * dw + 1, F.y + 3, dw - 3, F.h - 5, '#cdb899', '#7a6444', 1);
        rect(ctx, F.x + 2 + i * dw + dw / 2 - 3, F.y + 6, 6, 2, '#5e4a2e');
      }
    },
  },
  water_cooler: {
    top: 'sprite', front: '#e9eef2', trim: '#8f98a5',
    detail(ctx, F) {
      rect(ctx, F.x + F.w / 2 - 9, F.y + 10, 6, 5, '#3a6fd8');
      rect(ctx, F.x + F.w / 2 + 3, F.y + 10, 6, 5, '#cf3b31');
      rect(ctx, F.x + 6, F.y + F.h - 14, F.w - 12, 8, '#d3dae1', '#8f98a5', 1);
    },
  },
};

/**
 * Draw a boxed object. `z` is its height, `lift` how far it sits above the
 * floor (on a counter, say). `hooks.front(ctx, F)` lets the caller paint on the
 * front face (a microwave's running glow).
 */
export function drawBox(ctx, o, spec, z, lift, drawSprite, hooks = {}) {
  ctx.save();
  ctx.translate(0, -lift);
  const F = { x: o.x, y: o.y + o.h - z, w: o.w, h: z };
  // Front face
  rect(ctx, F.x, F.y, F.w, F.h, spec.front, spec.trim, 1.5);
  spec.detail?.(ctx, F, o);
  hooks.front?.(ctx, F);
  // Soft shading along the bottom of the front
  const g = ctx.createLinearGradient(0, F.y, 0, F.y + F.h);
  g.addColorStop(0, 'rgba(255,255,255,0.10)');
  g.addColorStop(1, 'rgba(0,0,0,0.16)');
  ctx.fillStyle = g;
  ctx.fillRect(F.x, F.y, F.w, F.h);
  // Top face
  ctx.save();
  ctx.translate(0, -z);
  if (spec.top === 'plain') {
    roundRect(ctx, o.x, o.y, o.w, o.h, 3);
    ctx.fillStyle = spec.topColor; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = spec.trim; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(o.x + 3, o.y + 3, o.w - 6, 2);
  } else {
    drawSprite(ctx, o);
  }
  hooks.top?.(ctx, o);
  ctx.restore();
  ctx.restore();
}
