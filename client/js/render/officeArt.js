/**
 * officeArt — how every floor, wall, prop and interactable looks.
 *
 * Each prop kind/type maps to a small draw function that receives the canvas
 * context and the object's rect. To add a new prop: add it to officeMap.js and
 * (optionally) a drawer here. Unknown kinds fall back to a labelled box.
 */

// ---------------------------------------------------------------------------
// Floors (patterns built once from tiny offscreen tiles)
// ---------------------------------------------------------------------------
function tile(size, paint) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  paint(c.getContext('2d'), size);
  return c;
}

const FLOOR_TILES = {
  hallway: () => tile(40, (g, s) => {
    g.fillStyle = '#d9d6ce'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#cdc9bf'; g.fillRect(0, 0, s, 1); g.fillRect(0, 0, 1, s);
  }),
  carpet_blue: () => tile(48, (g, s) => {
    g.fillStyle = '#a4b6ca'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#9aadc2'; g.fillRect(0, 0, s / 2, s / 2); g.fillRect(s / 2, s / 2, s / 2, s / 2);
  }),
  carpet_green: () => tile(48, (g, s) => {
    g.fillStyle = '#adc6a8'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#a3bd9e'; g.fillRect(0, 0, s / 2, s / 2); g.fillRect(s / 2, s / 2, s / 2, s / 2);
  }),
  carpet_red: () => tile(12, (g, s) => {
    g.fillStyle = '#c7a49b'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#bd988f'; g.fillRect(0, 0, 2, 2);
  }),
  wood: () => tile(80, (g, s) => {
    g.fillStyle = '#caa274'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#b98f61';
    for (let y = 0; y < s; y += 20) g.fillRect(0, y, s, 1.5);
    g.fillRect(30, 0, 1.5, 20); g.fillRect(65, 20, 1.5, 20); g.fillRect(15, 40, 1.5, 20); g.fillRect(50, 60, 1.5, 20);
  }),
  tile_warm: () => tile(60, (g, s) => {
    g.fillStyle = '#ecdfc6'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#e0cfae'; g.fillRect(0, 0, s / 2, s / 2); g.fillRect(s / 2, s / 2, s / 2, s / 2);
  }),
  tile_cool: () => tile(24, (g, s) => {
    g.fillStyle = '#e1ebef'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#c9d7dd'; g.fillRect(0, 0, s, 1); g.fillRect(0, 0, 1, s);
  }),
  marble: () => tile(90, (g, s) => {
    g.fillStyle = '#eeebe5'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#dcd7cd'; g.lineWidth = 1; g.strokeRect(0.5, 0.5, s - 1, s - 1);
    g.strokeStyle = '#e3dfd7'; g.beginPath(); g.moveTo(10, 70); g.bezierCurveTo(30, 40, 50, 60, 80, 20); g.stroke();
  }),
  carpet_grey: () => tile(16, (g, s) => {
    g.fillStyle = '#b9bcc2'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#afb2b9'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
  }),
  concrete: () => tile(64, (g, s) => {
    g.fillStyle = '#cfccc6'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#c4c0b9';
    for (const [x, y, r] of [[10, 12, 2], [40, 30, 1.5], [22, 50, 2.5], [55, 8, 1]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    g.fillStyle = '#bdb9b1'; g.fillRect(0, 0, s, 1); g.fillRect(0, 0, 1, s);
  }),
  grass: () => tile(48, (g, s) => {
    g.fillStyle = '#8cc56b'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#7bb65b'; g.lineWidth = 1.5;
    for (const [x, y] of [[6, 10], [20, 30], [36, 14], [40, 40], [12, 42], [28, 6]]) {
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - 2, y - 5); g.moveTo(x, y); g.lineTo(x + 2, y - 5); g.stroke();
    }
  }),
  pavers: () => tile(40, (g, s) => {
    g.fillStyle = '#d8c3a5'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#c4ad8c';
    g.fillRect(0, 0, s, 2); g.fillRect(0, s / 2, s, 2); g.fillRect(0, 0, 2, s / 2); g.fillRect(s / 2, s / 2, 2, s / 2);
  }),
  asphalt: () => tile(40, (g, s) => {
    g.fillStyle = '#5d6470'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#666d79';
    for (const [x, y] of [[5, 8], [22, 3], [33, 25], [12, 30], [28, 16]]) g.fillRect(x, y, 2, 2);
  }),
  linoleum: () => tile(32, (g, s) => {
    g.fillStyle = '#d6dccd'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#c6cdbb';
    for (const [x, y] of [[4, 7], [19, 3], [27, 22], [11, 25], [22, 14]]) g.fillRect(x, y, 2, 2);
  }),
};

const patternCache = new WeakMap();
function patterns(ctx) {
  let p = patternCache.get(ctx);
  if (!p) {
    p = {};
    for (const [key, make] of Object.entries(FLOOR_TILES)) p[key] = ctx.createPattern(make(), 'repeat');
    patternCache.set(ctx, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Small drawing helpers
// ---------------------------------------------------------------------------
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

function box(ctx, o, fill, stroke = '#1d2742', r = 4) {
  roundRect(ctx, o.x, o.y, o.w, o.h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

function circle(ctx, x, y, r, fill, stroke) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.lineWidth = 2; ctx.strokeStyle = stroke; ctx.stroke(); }
}

function leaves(ctx, cx, cy, r) {
  const greens = ['#2f7d4a', '#3f9a5c', '#57b06f'];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    circle(ctx, cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r * 0.5, greens[i % 3]);
  }
  circle(ctx, cx, cy, r * 0.45, '#3f9a5c');
}

// ---------------------------------------------------------------------------
// Decor (non-interactive) drawers, keyed by decor.kind
// ---------------------------------------------------------------------------
const DECOR = {
  counter: (ctx, o) => box(ctx, o, '#c9b89a', '#8d7a5c', 3),
  vending: (ctx, o) => {
    box(ctx, o, '#c8413a', '#6e1f1a', 4);
    ctx.fillStyle = '#2c3645'; ctx.fillRect(o.x + 6, o.y + 6, o.w - 22, o.h - 20);
    ctx.fillStyle = '#ffd35c';
    for (let i = 0; i < 4; i++) ctx.fillRect(o.x + o.w - 12, o.y + 8 + i * 10, 6, 5);
  },
  partition: (ctx, o) => { ctx.fillStyle = '#8f98a5'; ctx.fillRect(o.x, o.y, o.w, o.h); },
  reception: (ctx, o) => {
    box(ctx, o, '#8a5a3c', '#4e3120', 8);
    ctx.fillStyle = '#a8744f'; ctx.fillRect(o.x + 6, o.y + 6, o.w - 12, 10);
    ctx.fillStyle = '#1d2742'; ctx.fillRect(o.x + o.w / 2 - 18, o.y + 22, 36, 18);
  },
  sofa: (ctx, o) => {
    box(ctx, o, '#577aa2', '#2d4260', 12);
    ctx.strokeStyle = '#3e5c80'; ctx.lineWidth = 2;
    for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(o.x + (o.w / 3) * i, o.y + 8); ctx.lineTo(o.x + (o.w / 3) * i, o.y + o.h - 6); ctx.stroke(); }
  },
  exit: (ctx, o) => {
    box(ctx, o, '#2d8a54', '#1b5a36', 3);
    ctx.fillStyle = '#fff'; ctx.font = '600 13px Fredoka, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('EXIT', o.x + o.w / 2, o.y + o.h / 2 + 1);
  },
  table: (ctx, o) => {
    roundRect(ctx, o.x, o.y, o.w, o.h, 60);
    ctx.fillStyle = '#8b6a4a'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#4f3a26'; ctx.stroke();
    roundRect(ctx, o.x + 14, o.y + 14, o.w - 28, o.h - 28, 48);
    ctx.strokeStyle = '#a07c58'; ctx.lineWidth = 2; ctx.stroke();
  },
  whiteboard: (ctx, o) => {
    box(ctx, o, '#ffffff', '#8f98a5', 2);
    // A few marker scribbles so it reads as a whiteboard, not a UI bar.
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    const inks = ['#3a6fd8', '#d8433a', '#2f9e5b'];
    const mid = o.y + o.h / 2;
    for (let i = 0; i < 3; i++) {
      const x0 = o.x + 16 + i * (o.w / 3);
      ctx.strokeStyle = inks[i];
      ctx.beginPath();
      ctx.moveTo(x0, mid);
      for (let k = 1; k <= 6; k++) ctx.lineTo(x0 + k * 9, mid + (k % 2 ? -3 : 3));
      ctx.stroke();
    }
    // Marker tray.
    ctx.fillStyle = '#8f98a5';
    ctx.fillRect(o.x + o.w * 0.3, o.y + o.h, o.w * 0.4, 3);
  },
  bookshelf: (ctx, o) => {
    box(ctx, o, '#7a5234', '#3f2a1a', 3);
    const spines = ['#d8433a', '#3a6fd8', '#e8c21c', '#2f9e5b', '#8b5bd6'];
    for (let y = o.y + 6, i = 0; y < o.y + o.h - 8; y += 12, i++) {
      ctx.fillStyle = spines[i % spines.length];
      ctx.fillRect(o.x + 6, y, o.w - 12, 8);
    }
  },
  plant: (ctx, o) => {
    circle(ctx, o.x + o.w / 2, o.y + o.h / 2, o.w / 2, '#b0673f', '#6e3b20');
    leaves(ctx, o.x + o.w / 2, o.y + o.h / 2, o.w / 2 + 4);
  },
  elevator: (ctx, o) => {
    box(ctx, o, '#b9c0c9', '#5d6673', 2);
    ctx.fillStyle = '#8f98a5';
    ctx.fillRect(o.x + o.w / 2 - 1, o.y + 2, 2, o.h - 4);
    circle(ctx, o.x + o.w + 10, o.y + o.h / 2, 4, '#ffd35c', '#5d6673');
  },
  rug: (ctx, o) => {
    roundRect(ctx, o.x, o.y, o.w, o.h, 14);
    ctx.fillStyle = '#c96f55'; ctx.fill();
    roundRect(ctx, o.x + 10, o.y + 10, o.w - 20, o.h - 20, 10);
    ctx.lineWidth = 3; ctx.strokeStyle = '#ecd9a4'; ctx.stroke();
  },
  drafting: (ctx, o) => {
    box(ctx, o, '#e8e4da', '#5d6673', 3);
    ctx.save(); ctx.translate(o.x + o.w / 2, o.y + o.h / 2); ctx.rotate(-0.08);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(-40, -22, 80, 44);
    ctx.strokeStyle = '#3a6fd8'; ctx.lineWidth = 1.5; ctx.strokeRect(-30, -14, 30, 22);
    ctx.beginPath(); ctx.arc(18, 0, 10, 0, 7); ctx.stroke(); ctx.restore();
  },
  beanbag: (ctx, o) => {
    ctx.beginPath(); ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, o.w / 2, o.h / 2.2, 0.4, 0, 7);
    ctx.fillStyle = '#f08a24'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#9c5513'; ctx.stroke();
    circle(ctx, o.x + o.w / 2 + 5, o.y + o.h / 2 - 4, o.w / 5, '#f5a352');
  },
  doormat: (ctx, o) => {
    box(ctx, o, '#8a5a3c', '#5e3c27', 4);
    ctx.fillStyle = '#ecd9a4'; ctx.font = '600 13px Fredoka, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('WELCOME', o.x + o.w / 2, o.y + o.h / 2 + 1);
  },
  exec_desk: (ctx, o) => {
    box(ctx, o, '#6b3f26', '#3b2215', 8);
    ctx.fillStyle = '#8a5a3c'; ctx.fillRect(o.x + 8, o.y + 8, o.w - 16, 8);
    ctx.fillStyle = '#1d2742'; ctx.fillRect(o.x + o.w / 2 - 30, o.y + 22, 60, 12);
    circle(ctx, o.x + o.w - 26, o.y + 34, 9, '#e9eef2', '#3b2215');
  },
  tree: (ctx, o) => {
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2, r = o.w / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.14)'; ctx.beginPath(); ctx.ellipse(cx + 8, cy + 10, r, r * 0.8, 0, 0, 7); ctx.fill();
    circle(ctx, cx, cy, r * 0.25, '#6e4a2e');
    const greens = ['#3f8f4a', '#4fa35a', '#5cb868'];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      circle(ctx, cx + Math.cos(a) * r * 0.45, cy + Math.sin(a) * r * 0.45, r * 0.55, greens[i % 3]);
    }
    circle(ctx, cx - r * 0.1, cy - r * 0.1, r * 0.5, '#6cc576');
  },
  bench: (ctx, o) => {
    box(ctx, o, '#a87b52', '#5e4127', 4);
    ctx.strokeStyle = '#8a6342'; ctx.lineWidth = 2;
    for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(o.x + 4, o.y + (o.h / 3) * i); ctx.lineTo(o.x + o.w - 4, o.y + (o.h / 3) * i); ctx.stroke(); }
  },
  cat: (ctx, o) => {
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    ctx.fillStyle = '#e08a3c';
    ctx.beginPath(); ctx.ellipse(cx, cy + 3, 13, 10, 0, 0, 7); ctx.fill();
    circle(ctx, cx + 10, cy - 6, 8, '#e08a3c');
    ctx.beginPath(); ctx.moveTo(cx + 4, cy - 10); ctx.lineTo(cx + 6, cy - 18); ctx.lineTo(cx + 10, cy - 12); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx + 12, cy - 12); ctx.lineTo(cx + 16, cy - 18); ctx.lineTo(cx + 17, cy - 9); ctx.fill();
    ctx.strokeStyle = '#e08a3c'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - 12, cy + 4); ctx.quadraticCurveTo(cx - 22, cy, cx - 18, cy - 8); ctx.stroke();
  },
  umbrella: (ctx, o) => {
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2, r = o.w / 2;
    for (let i = 0; i < 8; i++) {
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, (i / 8) * Math.PI * 2, ((i + 1) / 8) * Math.PI * 2); ctx.closePath();
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.88)' : 'rgba(207,59,49,0.88)'; ctx.fill();
    }
    circle(ctx, cx, cy, 4, '#5d6673');
  },
  planter_box: (ctx, o) => {
    box(ctx, o, '#8a5a3c', '#5e3c27', 4);
    for (let i = 0; i < 4; i++) circle(ctx, o.x + 12 + i * ((o.w - 24) / 3), o.y + o.h / 2, 9, i % 2 ? '#e56aa8' : '#ffd23f');
  },
  path: (ctx, o) => { ctx.fillStyle = '#d8c3a5'; ctx.fillRect(o.x, o.y, o.w, o.h); },
  parking_lines: (ctx, o) => {
    ctx.fillStyle = '#e8e4da';
    for (let x = o.x; x <= o.x + o.w; x += 100) ctx.fillRect(x, o.y, 4, o.h);
  },
  car: (ctx, o) => drawCar(ctx, o, o.color || '#7d8793'),
  bike_rack: (ctx, o) => {
    ctx.strokeStyle = '#8f98a5'; ctx.lineWidth = 4;
    for (let x = o.x + 10; x < o.x + o.w; x += 22) { ctx.beginPath(); ctx.arc(x + 8, o.y + o.h, 10, Math.PI, 0); ctx.stroke(); }
  },
  copier: (ctx, o) => {
    box(ctx, o, '#cfd4da', '#5d6673', 4);
    ctx.fillStyle = '#5d6673'; ctx.fillRect(o.x + 8, o.y + 8, o.w - 16, 12);
  },
};

// ---------------------------------------------------------------------------
// Interactable drawers, keyed by interactable.type
// ---------------------------------------------------------------------------
const OBJECTS = {
  water_cooler: (ctx, o) => {
    box(ctx, o, '#e9eef2', '#5d6673', 6);
    circle(ctx, o.x + o.w / 2, o.y + o.h / 2, o.w * 0.34, '#7cc3ec', '#3d86b5');
    circle(ctx, o.x + o.w / 2 - 4, o.y + o.h / 2 - 4, 4, '#d8f0ff');
  },
  coffee_machine: (ctx, o) => {
    box(ctx, o, '#2f3440', '#12151b', 5);
    circle(ctx, o.x + 12, o.y + 12, 4, '#e0473b');
    circle(ctx, o.x + o.w - 16, o.y + o.h - 14, 8, '#ffffff', '#12151b');
    circle(ctx, o.x + o.w - 16, o.y + o.h - 14, 5, '#6b4226');
  },
  microwave: (ctx, o) => {
    box(ctx, o, '#d9dde2', '#5d6673', 4);
    ctx.fillStyle = '#2c3645'; ctx.fillRect(o.x + 6, o.y + 7, o.w - 22, o.h - 14);
    ctx.fillStyle = '#5d6673'; ctx.fillRect(o.x + o.w - 12, o.y + 8, 5, 5); ctx.fillRect(o.x + o.w - 12, o.y + 17, 5, 5);
  },
  fridge: (ctx, o) => {
    box(ctx, o, '#eef1f4', '#5d6673', 6);
    ctx.fillStyle = '#5d6673'; ctx.fillRect(o.x + 4, o.y + o.h * 0.38, o.w - 8, 2);
    ctx.fillRect(o.x + o.w - 12, o.y + 8, 4, 14); ctx.fillRect(o.x + o.w - 12, o.y + o.h * 0.45, 4, 18);
  },
  lunch_table: (ctx, o) => {
    box(ctx, o, '#d9c29a', '#8d7a5c', 10);
    for (const [px, py] of [[0.2, 0.3], [0.5, 0.3], [0.8, 0.3], [0.2, 0.72], [0.5, 0.72], [0.8, 0.72]]) {
      circle(ctx, o.x + o.w * px, o.y + o.h * py, 10, '#ffffff', '#b7a58a');
    }
    circle(ctx, o.x + o.w * 0.5, o.y + o.h * 0.3, 5, '#e0473b');
    circle(ctx, o.x + o.w * 0.8, o.y + o.h * 0.72, 5, '#2f9e5b');
  },
  toilet: (ctx, o) => {
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#8f98a5'; ctx.lineWidth = 2;
    ctx.fillRect(o.x + 4, o.y + o.h - 14, o.w - 8, 12); ctx.strokeRect(o.x + 4, o.y + o.h - 14, o.w - 8, 12);
    ctx.beginPath(); ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2 - 4, o.w / 2 - 6, o.h / 2 - 8, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2 - 4, o.w / 2 - 12, o.h / 2 - 13, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#cfe8f3'; ctx.fill();
  },
  sink: (ctx, o) => {
    box(ctx, o, '#cfd8de', '#5d6673', 4);
    for (const px of [0.28, 0.72]) {
      ctx.beginPath(); ctx.ellipse(o.x + o.w * px, o.y + o.h / 2 + 2, 20, 11, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = '#8f98a5'; ctx.stroke();
      ctx.fillStyle = '#8f98a5'; ctx.fillRect(o.x + o.w * px - 2, o.y + 3, 4, 8);
    }
  },
  plant: (ctx, o) => {
    circle(ctx, o.x + o.w / 2, o.y + o.h / 2, o.w / 2, '#b0673f', '#6e3b20');
    leaves(ctx, o.x + o.w / 2, o.y + o.h / 2, o.w / 2 + 8);
  },
  time_clock: (ctx, o) => {
    box(ctx, o, '#6d7684', '#2c3645', 5);
    circle(ctx, o.x + o.w / 2, o.y + 16, 10, '#ffffff', '#2c3645');
    ctx.strokeStyle = '#1d2742'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(o.x + o.w / 2, o.y + 16); ctx.lineTo(o.x + o.w / 2, o.y + 9);
    ctx.moveTo(o.x + o.w / 2, o.y + 16); ctx.lineTo(o.x + o.w / 2 + 5, o.y + 18); ctx.stroke();
    ctx.fillStyle = '#ecd9a4'; ctx.fillRect(o.x + o.w / 2 - 8, o.y + 29, 16, 6);
  },
  meeting_bell: (ctx, o) => {
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2 + 4;
    ctx.fillStyle = '#e8b52c'; ctx.strokeStyle = '#7a5a0e'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, 12, Math.PI, 0); ctx.lineTo(cx + 14, cy + 3); ctx.lineTo(cx - 14, cy + 3); ctx.closePath();
    ctx.fill(); ctx.stroke();
    circle(ctx, cx, cy - 13, 3, '#7a5a0e');
  },
  printer: (ctx, o) => {
    box(ctx, o, '#dfe3e8', '#5d6673', 5);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(o.x + 14, o.y - 4, o.w - 28, 14);
    ctx.strokeStyle = '#8f98a5'; ctx.strokeRect(o.x + 14, o.y - 4, o.w - 28, 14);
    circle(ctx, o.x + o.w - 12, o.y + o.h - 12, 4, '#2f9e5b');
  },
  mailbox: (ctx, o) => {
    box(ctx, o, '#b58a5a', '#5e4127', 3);
    const cols = 8;
    ctx.fillStyle = '#6e4d2f';
    for (let i = 0; i < cols; i++) ctx.fillRect(o.x + 5 + i * ((o.w - 10) / cols), o.y + 6, (o.w - 10) / cols - 4, o.h - 12);
  },
  supplies: (ctx, o) => {
    box(ctx, o, '#8e9aa8', '#3d475e', 4);
    ctx.fillStyle = '#3d475e'; ctx.fillRect(o.x + o.w / 2 - 1, o.y + 4, 2, o.h - 8);
    ctx.fillRect(o.x + o.w / 2 - 10, o.y + o.h / 2 - 2, 6, 4); ctx.fillRect(o.x + o.w / 2 + 4, o.y + o.h / 2 - 2, 6, 4);
  },
  shredder: (ctx, o) => {
    box(ctx, o, '#454c59', '#1d2742', 4);
    ctx.fillStyle = '#1d2742'; ctx.fillRect(o.x + 8, o.y + 10, o.w - 16, 4);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 4; i++) ctx.fillRect(o.x + 10 + i * 8, o.y + 20 + (i % 2) * 6, 3, 18);
  },
  easel: (ctx, o) => {
    ctx.strokeStyle = '#6e4a2e'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(o.x + 8, o.y + o.h); ctx.lineTo(o.x + o.w / 2, o.y); ctx.lineTo(o.x + o.w - 8, o.y + o.h); ctx.stroke();
    box(ctx, { x: o.x + 6, y: o.y + 8, w: o.w - 12, h: o.h - 22 }, '#ffffff', '#5d6673', 2);
    ctx.strokeStyle = '#e0473b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(o.x + o.w / 2, o.y + o.h / 2 - 4, 10, 0.3, 5.5); ctx.stroke();
  },
  filing_cabinet: (ctx, o) => {
    box(ctx, o, '#9aa3ae', '#3d475e', 3);
    for (let y = o.y + 8; y < o.y + o.h - 8; y += o.h / 4) {
      ctx.fillStyle = '#3d475e'; ctx.fillRect(o.x + 6, y + o.h / 8 - 2, o.w - 12, 2);
      ctx.fillRect(o.x + o.w / 2 - 6, y + 6, 12, 3);
    }
  },
  manager_inbox: (ctx, o) => {
    box(ctx, o, '#b58a5a', '#5e4127', 3);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(o.x + 6, o.y + 6, o.w - 12, 6); ctx.fillRect(o.x + 8, o.y + 14, o.w - 16, 6);
  },
  candy_bowl: (ctx, o) => {
    circle(ctx, o.x + o.w / 2, o.y + o.h / 2, o.w / 2, '#cfe8f3', '#5d6673');
    const sweets = ['#e0473b', '#ffffff', '#2f9e5b', '#e8c21c'];
    for (let i = 0; i < 5; i++) circle(ctx, o.x + o.w / 2 + Math.cos(i * 1.3) * 6, o.y + o.h / 2 + Math.sin(i * 1.3) * 5, 3, sweets[i % 4]);
  },
  planter: (ctx, o) => {
    box(ctx, o, '#a0613c', '#5e3c27', 4);
    for (let i = 0; i < 4; i++) leaves(ctx, o.x + 14 + i * ((o.w - 28) / 3), o.y + o.h / 2, 11);
  },
  picnic_table: (ctx, o) => {
    ctx.fillStyle = '#8a6342';
    ctx.fillRect(o.x, o.y - 10, o.w, 8); ctx.fillRect(o.x, o.y + o.h + 2, o.w, 8);
    box(ctx, o, '#b98b5e', '#5e4127', 3);
    ctx.strokeStyle = '#a07650'; ctx.lineWidth = 1.5;
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(o.x + 4, o.y + (o.h / 4) * i); ctx.lineTo(o.x + o.w - 4, o.y + (o.h / 4) * i); ctx.stroke(); }
  },
  cat_bowl: (ctx, o) => {
    ctx.beginPath(); ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, o.w / 2, o.h / 2, 0, 0, 7);
    ctx.fillStyle = '#3a6fd8'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#1d2742'; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, o.w / 3, o.h / 3, 0, 0, 7); ctx.fillStyle = '#c69c6d'; ctx.fill();
  },
  car: (ctx, o) => drawCar(ctx, o, '#cf3b31'),
  dumpster: (ctx, o) => {
    box(ctx, o, '#2f6f9a', '#173d57', 4);
    ctx.fillStyle = '#245a7e'; ctx.fillRect(o.x + 4, o.y + 4, o.w / 2 - 6, o.h - 8); ctx.fillRect(o.x + o.w / 2 + 2, o.y + 4, o.w / 2 - 6, o.h - 8);
    ctx.fillStyle = '#ffffff'; ctx.font = '700 12px Fredoka, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('\u267b', o.x + o.w / 2, o.y + o.h / 2);
  },
  breaker: (ctx, o, state = {}) => {
    box(ctx, o, '#8e9aa8', '#2c3645', 3);
    // Lightning bolt
    ctx.fillStyle = '#ffd52e';
    const bx = o.x + 12, by = o.y + o.h / 2;
    ctx.beginPath();
    ctx.moveTo(bx + 2, by - 10); ctx.lineTo(bx - 4, by + 1); ctx.lineTo(bx, by + 1);
    ctx.lineTo(bx - 2, by + 10); ctx.lineTo(bx + 5, by - 2); ctx.lineTo(bx + 1, by - 2);
    ctx.closePath(); ctx.fill();
    // Switches: thrown down when the power is cut
    ctx.fillStyle = '#2c3645';
    for (let i = 0; i < 3; i++) {
      const sx = o.x + 23 + i * 9;
      ctx.fillRect(sx, o.y + 6, 6, o.h - 12);
      ctx.fillStyle = state.wifiDown ? '#cf3b31' : '#e9eef2';
      ctx.fillRect(sx, state.wifiDown ? o.y + o.h - 14 : o.y + 6, 6, 8);
      ctx.fillStyle = '#2c3645';
    }
    // Status light (blinks red during an outage)
    const on = !state.wifiDown || Math.floor((state.now ?? 0) / 300) % 2 === 0;
    circle(ctx, o.x + o.w - 6, o.y + 6, 3, state.wifiDown ? (on ? '#ff4b3e' : '#5a1d19') : '#54c985');
  },
  desk: (ctx, o) => {
    box(ctx, o, '#b98b5e', '#5e4127', 5);
    ctx.fillStyle = '#1d2742'; ctx.fillRect(o.x + o.w / 2 - 20, o.y + 5, 40, 8);        // monitor
    ctx.fillStyle = '#e9eef2'; ctx.fillRect(o.x + o.w / 2 - 16, o.y + 20, 32, 8);       // keyboard
    circle(ctx, o.x + 12, o.y + 14, 5, '#ffffff', '#5e4127');                             // mug
  },
};

/** Top-down car, nose pointing up. */
function drawCar(ctx, o, color) {
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  roundRect(ctx, o.x + 4, o.y + 6, o.w, o.h, 14); ctx.fill();
  roundRect(ctx, o.x, o.y, o.w, o.h, 14);
  ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#1d2742'; ctx.stroke();
  ctx.fillStyle = 'rgba(29,39,66,0.75)';
  roundRect(ctx, o.x + 8, o.y + 22, o.w - 16, 22, 5); ctx.fill();     // windscreen
  roundRect(ctx, o.x + 9, o.y + o.h - 30, o.w - 18, 16, 4); ctx.fill(); // rear window
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  roundRect(ctx, o.x + 8, o.y + 48, o.w - 16, o.h - 82, 4); ctx.fill();  // roof
}

// ---------------------------------------------------------------------------
// Public API used by the Renderer
// ---------------------------------------------------------------------------
export function drawFloors(ctx, map) {
  const p = patterns(ctx);
  ctx.fillStyle = p.hallway;
  ctx.fillRect(0, 0, map.width, map.height);
  for (const room of map.rooms) {
    ctx.fillStyle = p[room.floor] || p.hallway;
    ctx.fillRect(room.x, room.y, room.w, room.h);
  }
}

export function drawWalls(ctx, map) {
  ctx.fillStyle = '#b8b2a5';
  for (const d of map.doors) ctx.fillRect(d.x, d.y, d.w, d.h);
  ctx.fillStyle = '#3d475e';
  for (const w of map.walls) ctx.fillRect(w.x, w.y, w.w, w.h);
}

export function drawRoomLabels(ctx, map) {
  ctx.font = '600 22px Fredoka, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(29, 39, 66, 0.32)';
  for (const r of map.rooms) {
    if (r.label === false) continue;
    const [x, y] = r.label ?? [r.x + 22, r.y + r.h - 22];
    ctx.fillStyle = r.open ? 'rgba(29, 39, 66, 0.45)' : 'rgba(29, 39, 66, 0.32)';
    ctx.fillText(r.name, x, y);
  }
}

export function drawDecor(ctx, map) {
  // Meeting chairs sit under the table edge.
  for (const s of map.meetingSeats) {
    roundRect(ctx, s.x - 13, s.y - 13, 26, 26, 7);
    ctx.fillStyle = '#56617b'; ctx.fill();
  }
  for (const d of map.decor) (DECOR[d.kind] || fallback)(ctx, d);
}

/** `state` carries live world state some props reflect (e.g. { wifiDown, now }). */
export function drawInteractable(ctx, o, state) {
  (OBJECTS[o.type] || fallback)(ctx, o, state);
}

function fallback(ctx, o) {
  box(ctx, o, '#cfd4da', '#5d6673', 4);
  if (o.label) {
    ctx.fillStyle = '#1d2742'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(o.label, o.x + o.w / 2, o.y + o.h / 2 + 4);
  }
}
