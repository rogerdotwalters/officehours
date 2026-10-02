/**
 * Whiteboard: trace a ridiculous drawing. The drawing is shown as grey dotted
 * lines; draw over it with the marker.
 *
 * Scoring (same code in the browser for the progress bar and on the server to
 * check the answer):
 *   coverage: how much of the dotted outline your ink passed close to
 *   every part: each stroke (an eye, the tie, the arrow) is at least mostly traced
 *   accuracy: how much of your ink stayed near the outline (no scribbling it out)
 *
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

export const DRAWINGS = [
  {
    id: 'potato',
    title: 'Bob from Accounting, as a potato',
    caption: 'Very accurate. Do not show Bob.',
    strokes: [
      ellipse(80, 50, 42, 30, 0.06),
      circle(66, 44, 4, 14), circle(94, 44, 4, 14),
      arc(80, 54, 12, 20, 160),
      line([80, 80], [75, 89], [80, 97], [85, 89], [80, 80]),
    ],
    labels: [],
  },
  {
    id: 'strategy',
    title: 'Q3 strategy',
    caption: 'Line go up. Questions?',
    strokes: [
      line([20, 12], [20, 86], [146, 86]),
      line([26, 78], [44, 64], [60, 72], [80, 50], [95, 58], [114, 30], [128, 38], [140, 12]),
      line([131, 15], [140, 12], [141, 21]),
    ],
    labels: [{ x: 96, y: 18, text: 'PROFIT???', size: 7 }],
  },
  {
    id: 'cat_ceo',
    title: 'Our new CEO',
    caption: 'He has been very decisive about naps.',
    strokes: [
      circle(80, 45, 25, 32),
      line([60, 30], [57, 8], [74, 21]),
      line([86, 21], [103, 8], [100, 30]),
      circle(70, 42, 3.5, 12), circle(90, 42, 3.5, 12),
      line([77, 52], [83, 52], [80, 56], [77, 52]),
      line([62, 54], [42, 50]), line([62, 58], [42, 63]),
      line([98, 54], [118, 50]), line([98, 58], [118, 63]),
      line([80, 70], [73, 77], [80, 97], [87, 77], [80, 70]),
    ],
    labels: [],
  },
  {
    id: 'org_chart',
    title: 'Org chart',
    caption: 'Drawn by Gary.',
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
    id: 'coffee_feelings',
    title: 'The coffee machine\u2019s feelings',
    caption: 'It\u2019s been a long week for it too.',
    strokes: [
      line([52, 32], [100, 32], [96, 86], [56, 86], [52, 32]),
      arc(100, 58, 13, -80, 80),
      circle(67, 50, 3, 12), circle(85, 50, 3, 12),
      arc(76, 76, 9, 200, 340),
      circle(63, 60, 2.5, 10),
      squiggle(62, 26, 8), squiggle(76, 26, 6), squiggle(90, 26, 8),
    ],
    labels: [],
  },
  {
    id: 'evacuation',
    title: 'Fire evacuation plan',
    caption: 'Snacks first. Then people.',
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

export function generateWhiteboard(rand) {
  return { drawing: DRAWINGS[Math.floor(rand() * DRAWINGS.length)].id };
}

export function checkWhiteboard(puzzle, answer) {
  const drawing = DRAWINGS_BY_ID.get(puzzle.drawing);
  return !!drawing && scoreDrawing(drawing, inkToStrokes(answer?.ink)).ok;
}
