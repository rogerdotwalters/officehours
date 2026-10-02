/**
 * Whiteboard: trace a drawing. It's shown as grey dotted lines; draw over it with the marker.
 *   productive: charts and inspirational quotes
 *   slacker:    something unprofessional (but PG), which stays up for everyone to see
 *
 * Scoring (same code in the browser for the progress bar and on the server to
 * check the answer):
 *   coverage: how much of the dotted outline your ink passed close to
 *   every part: each stroke (an eye, the tie, the arrow) is at least mostly traced
 *   accuracy: how much of your ink stayed near the outline (no scribbling it out)
 *
 * `scrawl` is the short version shown on the whiteboard in the office afterwards.
 * Drawings live on a 160 x 100 board. Each one is a list of strokes, each stroke
 * a list of [x, y] points, built from the little shape helpers below. `labels`
 * are printed text that doesn't need tracing. Add your own drawings to DRAWINGS.
 */
export const BOARD_W = 160;
export const BOARD_H = 100;
export const RADIUS = 4.5;          // ink within this distance covers the outline
export const NEED_COVERAGE = 0.82;
export const NEED_ACCURACY = 0.6;
export const NEED_EACH_PART = 0.6;  // every stroke (eye, tie, arrow...) needs at least this much
const SAMPLE_STEP = 2;

// ---- Shape helpers ---------------------------------------------------------
const deg = (d) => (d * Math.PI) / 180;
function ellipse(cx, cy, rx, ry, wobble = 0, n = 40) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const k = 1 + wobble * (Math.sin(3 * t) * 0.6 + Math.cos(5 * t) * 0.4);
    pts.push([cx + Math.cos(t) * rx * k, cy + Math.sin(t) * ry * k]);
  }
  return pts;
}
const circle = (cx, cy, r, n = 24) => ellipse(cx, cy, r, r, 0, n);
function arc(cx, cy, r, from, to, n = 16) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = deg(from + ((to - from) * i) / n);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}
const line = (...pts) => pts;
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
function squiggle(x, y0, y1, amp = 3, waves = 2, n = 16) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([x + Math.sin(t * Math.PI * 2 * waves) * amp, y0 + (y1 - y0) * t]);
  }
  return pts;
}

// A tiny stroke font so words can be traced. Glyphs live in a 6 x 10 box.
const GLYPHS = {
  A: [[[0, 10], [3, 0], [6, 10]], [[1.2, 6], [4.8, 6]]],
  B: [[[0, 10], [0, 0], [4, 0], [5.5, 1.5], [5.5, 3.5], [4, 5], [0, 5]], [[4, 5], [6, 6.5], [6, 8.5], [4.5, 10], [0, 10]]],
  C: [[[6, 1.5], [4.5, 0], [1.5, 0], [0, 2], [0, 8], [1.5, 10], [4.5, 10], [6, 8.5]]],
  E: [[[6, 0], [0, 0], [0, 10], [6, 10]], [[0, 5], [4.5, 5]]],
  I: [[[3, 0], [3, 10]], [[1, 0], [5, 0]], [[1, 10], [5, 10]]],
  K: [[[0, 0], [0, 10]], [[6, 0], [0, 6]], [[2, 4.5], [6, 10]]],
  M: [[[0, 10], [0, 0], [3, 5], [6, 0], [6, 10]]],
  N: [[[0, 10], [0, 0], [6, 10], [6, 0]]],
  O: [[[1.5, 0], [4.5, 0], [6, 2], [6, 8], [4.5, 10], [1.5, 10], [0, 8], [0, 2], [1.5, 0]]],
  P: [[[0, 10], [0, 0], [4.5, 0], [6, 1.5], [6, 3.5], [4.5, 5], [0, 5]]],
  R: [[[0, 10], [0, 0], [4.5, 0], [6, 1.5], [6, 3.5], [4.5, 5], [0, 5]], [[3, 5], [6, 10]]],
  S: [[[6, 1.5], [4.5, 0], [1.5, 0], [0, 1.5], [0, 3.5], [1.5, 5], [4.5, 5], [6, 6.5], [6, 8.5], [4.5, 10], [1.5, 10], [0, 8.5]]],
  T: [[[0, 0], [6, 0]], [[3, 0], [3, 10]]],
  U: [[[0, 0], [0, 8], [1.5, 10], [4.5, 10], [6, 8], [6, 0]]],
  W: [[[0, 0], [1.5, 10], [3, 4], [4.5, 10], [6, 0]]],
  Z: [[[0, 0], [6, 0], [0, 10], [6, 10]]],
};
/** Strokes for a word, top-left at (x, y), each letter `k` times the 6 x 10 box. */
function text(str, x, y, k) {
  const out = [];
  let cx = x;
  for (const ch of str) {
    if (ch === ' ') { cx += 5 * k; continue; }
    for (const g of GLYPHS[ch] ?? []) out.push(g.map(([gx, gy]) => [cx + gx * k, y + gy * k]));
    cx += 8.5 * k;
  }
  return out;
}
const textWidth = (str, k) => [...str].reduce((w, ch) => w + (ch === ' ' ? 5 : 8.5) * k, 0) - 2.5 * k;
const centred = (str, y, k) => text(str, (BOARD_W - textWidth(str, k)) / 2, y, k);

export const DRAWINGS = [
  // ---- Productive: charts and inspiration ----
  {
    id: 'q3_chart', scrawl: 'Q3: UP 4%', variant: 'productive',
    title: 'Q3 results', caption: 'Up and to the right. As it should be.',
    strokes: [
      line([22, 12], [22, 86], [146, 86]),
      rect(34, 66, 18, 20), rect(60, 54, 18, 32), rect(86, 40, 18, 46), rect(112, 24, 18, 62),
      line([36, 58], [66, 46], [92, 32], [124, 14]),
      line([116, 14], [124, 14], [123, 22]),
    ],
    labels: [{ x: 43, y: 94, text: 'Q1', size: 5 }, { x: 69, y: 94, text: 'Q2', size: 5 }, { x: 95, y: 94, text: 'Q3', size: 5 }, { x: 121, y: 94, text: 'Q4', size: 5 }],
  },
  {
    id: 'teamwork', scrawl: 'TEAMWORK!', variant: 'productive',
    title: 'Inspirational quote', caption: 'Teamwork makes the dream work.',
    strokes: [
      ...centred('TEAMWORK', 26, 1.6),
      line([30, 58], [60, 64], [100, 64], [130, 58]),
    ],
    labels: [{ x: 80, y: 76, text: 'makes the dream work', size: 7 }],
  },
  {
    id: 'pie', scrawl: 'WE: 61%', variant: 'productive',
    title: 'Market share', caption: 'We are the big slice.',
    strokes: [
      circle(64, 50, 32, 40),
      line([64, 50], [64, 18]), line([64, 50], [94, 62]), line([64, 50], [40, 72]),
    ],
    labels: [{ x: 120, y: 30, text: 'US: 61%', size: 7 }, { x: 120, y: 46, text: 'THEM: 27%', size: 7 }, { x: 120, y: 62, text: 'GARY: 12%', size: 7 }],
  },
  {
    id: 'strategy', scrawl: 'LINE GO UP', variant: 'productive',
    title: 'Growth strategy', caption: 'Line go up.',
    strokes: [
      line([20, 12], [20, 86], [146, 86]),
      line([26, 78], [44, 64], [60, 72], [80, 50], [95, 58], [114, 30], [128, 38], [140, 12]),
      line([131, 15], [140, 12], [141, 21]),
    ],
    labels: [{ x: 96, y: 18, text: 'PROFIT', size: 7 }],
  },

  // ---- Slacker: unprofessional, but PG ----
  {
    id: 'boss_sucks', scrawl: 'BOSS SUCKS', variant: 'slacker',
    title: 'A bold statement', caption: 'Brave. Anonymous. Probably.',
    strokes: [
      ...centred('BOSS', 14, 2.0),
      ...centred('SUCKS', 52, 2.0),
    ],
    labels: [],
  },
  {
    id: 'potato', scrawl: 'BOSS = POTATO', variant: 'slacker',
    title: 'The boss, as a potato', caption: 'Very accurate. Do not show the boss.',
    strokes: [
      ellipse(80, 50, 42, 30, 0.06),
      circle(66, 44, 4, 14), circle(94, 44, 4, 14),
      arc(80, 54, 12, 20, 160),
      line([80, 80], [75, 89], [80, 97], [85, 89], [80, 80]),
    ],
    labels: [],
  },
  {
    id: 'nap_time', scrawl: 'NAP TIME 2-5PM', variant: 'slacker',
    title: 'New company policy', caption: 'Effective immediately.',
    strokes: [
      ...centred('NAP TIME', 20, 1.7),
      ...text('Z', 108, 64, 1.1), ...text('Z', 122, 56, 1.4), ...text('Z', 140, 46, 1.8),
    ],
    labels: [{ x: 60, y: 76, text: 'mandatory, 2pm to 5pm', size: 7 }],
  },
  {
    id: 'org_chart', scrawl: 'GARY GARY GARY', variant: 'slacker',
    title: 'Org chart', caption: 'Drawn by Gary.',
    strokes: [
      rect(65, 8, 30, 15),
      line([80, 23], [80, 34]), line([35, 34], [125, 34]),
      line([35, 34], [35, 44]), line([80, 34], [80, 44]), line([125, 34], [125, 44]),
      rect(20, 44, 30, 15), rect(65, 44, 30, 15), rect(110, 44, 30, 15),
      line([80, 59], [80, 70]), rect(65, 70, 30, 15),
    ],
    labels: [
      { x: 80, y: 18, text: 'GARY', size: 6 }, { x: 35, y: 54, text: 'GARY', size: 6 },
      { x: 80, y: 54, text: 'GARY', size: 6 }, { x: 125, y: 54, text: 'GARY', size: 6 },
      { x: 80, y: 80, text: 'also GARY', size: 5 },
    ],
  },
  {
    id: 'evacuation', scrawl: 'SNACKS FIRST', variant: 'slacker',
    title: 'Fire evacuation plan', caption: 'Snacks first. Then people.',
    strokes: [
      circle(40, 33, 7, 18),
      line([40, 40], [40, 64]),
      line([30, 82], [40, 64], [52, 80]),
      line([27, 44], [40, 50], [54, 56]),
      line([64, 55], [110, 55]),
      line([102, 48], [110, 55], [102, 62]),
      rect(118, 20, 26, 62),
      circle(124, 53, 2, 10),
    ],
    labels: [{ x: 131, y: 15, text: 'SNACKS', size: 7 }],
  },
];
export const DRAWINGS_BY_ID = new Map(DRAWINGS.map((d) => [d.id, d]));

// ---- Geometry ----------------------------------------------------------------
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Points every SAMPLE_STEP units along the drawing's strokes, tagged with their stroke. */
export function samplePoints(drawing) {
  const out = [];
  drawing.strokes.forEach((s, part) => {
    for (let i = 1; i < s.length; i++) {
      const [ax, ay] = s[i - 1], [bx, by] = s[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / SAMPLE_STEP));
      for (let k = 0; k < steps; k++) out.push([ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps, part]);
    }
  });
  return out;
}

/** Turn [[x,y,x,y,...], ...] (as sent over the network) into strokes of points. */
export function inkToStrokes(ink) {
  if (!Array.isArray(ink)) return [];
  return ink.slice(0, 200).map((flat) => {
    const pts = [];
    if (!Array.isArray(flat)) return pts;
    for (let i = 0; i + 1 < flat.length && pts.length < 3000; i += 2) {
      const x = Number(flat[i]), y = Number(flat[i + 1]);
      if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y]);
    }
    return pts;
  }).filter((s) => s.length);
}

/** { coverage, accuracy, ok } for some ink (strokes of points) on a drawing. */
export function scoreDrawing(drawing, strokes, samples = samplePoints(drawing)) {
  const segs = [];
  let inkPoints = 0;
  for (const s of strokes) {
    inkPoints += s.length;
    if (s.length === 1) segs.push([s[0][0], s[0][1], s[0][0], s[0][1]]);
    for (let i = 1; i < s.length; i++) segs.push([s[i - 1][0], s[i - 1][1], s[i][0], s[i][1]]);
  }
  const parts = drawing.strokes.map(() => ({ total: 0, covered: 0 }));
  if (!segs.length) return { coverage: 0, accuracy: 0, worstPart: 0, ok: false, covered: samples.map(() => false) };

  let covered = 0;
  const hit = samples.map(([px, py, part]) => {
    parts[part].total++;
    for (const [ax, ay, bx, by] of segs) {
      if (distToSegment(px, py, ax, ay, bx, by) <= RADIUS) { covered++; parts[part].covered++; return true; }
    }
    return false;
  });
  const targetSegs = [];
  for (const s of drawing.strokes) for (let i = 1; i < s.length; i++) targetSegs.push([...s[i - 1], ...s[i]]);
  let near = 0;
  for (const st of strokes) {
    for (const [px, py] of st) {
      for (const [ax, ay, bx, by] of targetSegs) {
        if (distToSegment(px, py, ax, ay, bx, by) <= RADIUS * 2) { near++; break; }
      }
    }
  }
  const coverage = covered / samples.length;
  const accuracy = near / Math.max(1, inkPoints);
  const worstPart = Math.min(...parts.map((p) => (p.total ? p.covered / p.total : 1)));
  return {
    coverage, accuracy, worstPart, covered: hit,
    ok: coverage >= NEED_COVERAGE && accuracy >= NEED_ACCURACY && worstPart >= NEED_EACH_PART,
  };
}

export function generateWhiteboard(rand, variant = 'productive') {
  const list = DRAWINGS.filter((d) => d.variant === (variant === 'slacker' ? 'slacker' : 'productive'));
  return { variant, drawing: list[Math.floor(rand() * list.length)].id };
}

export function checkWhiteboard(puzzle, answer) {
  const drawing = DRAWINGS_BY_ID.get(puzzle.drawing);
  return !!drawing && scoreDrawing(drawing, inkToStrokes(answer?.ink)).ok;
}
