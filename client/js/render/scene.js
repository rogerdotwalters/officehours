/**
 * Scene: the angled ("three-quarter") view.
 *
 * The world itself is still a flat floor plan (that's what the server, physics,
 * line of sight and collisions all use). This module only changes how it's
 * DRAWN: walls stand WALL_H tall so you see the face of each room's back wall,
 * furniture is raised with a visible front face, and everything that stands
 * up (walls, furniture, people) is drawn in one pass sorted by where it
 * touches the floor, so whatever is further down the screen covers whatever
 * is behind it.
 *
 * Things mounted on walls (the whiteboard, posters, clocks) are drawn on the
 * face of the wall above them.
 *
 * Like most angled-view games, a room's FRONT (bottom) wall is cut away to a
 * low ledge, so it doesn't hide the bottom of the room. Back walls and the
 * outside of the building stand full height.
 */
import { drawDecorItem, drawObjectItem, roundRect } from './officeArt.js';
import { BOX, drawBox } from './boxArt.js';

export const WALL_H = 76;          // how tall back walls are drawn, in world units
export const FRONT_H = 16;         // front walls are cut down to a low ledge so you can see into rooms
const CHUNK = 28;                  // walls are cut into pieces this long for depth sorting

/** How tall things stand (world units). Missing = flat on the floor. */
export const HEIGHT = {
  // decor kinds
  counter: 22, vending: 58, partition: 34, reception: 26, sofa: 18, table: 16, bookshelf: 62,
  plant: 34, drafting: 24, beanbag: 14, exec_desk: 22, tree: 74, bench: 12, planter_box: 16,
  car: 22, bike_rack: 10, copier: 30, cat: 6,
  // interactable types
  water_cooler: 46, coffee_machine: 24, microwave: 18, fridge: 66, lunch_table: 16, toilet: 18,
  sink: 24, time_clock: 40, printer: 26, mailbox: 32, supplies: 48, shredder: 30, easel: 52,
  filing_cabinet: 48, manager_inbox: 20, picnic_table: 14, dumpster: 34, hr_box: 38, desk: 16,
};
/**
 * Things that sit ON other furniture (a microwave on the counter, the bell on
 * the conference table). They're lifted by the height of whatever holds them
 * and drawn after it, so the counter never covers its own microwave. LIFT is
 * the fallback when nothing is under them.
 */
export const ON_TOP = new Set(['microwave', 'coffee_machine', 'meeting_bell', 'candy_bowl']);
export const LIFT = { meeting_bell: 16, candy_bowl: 22 };

const kindOf = (item) => item.kind ?? item.type;
export const heightOf = (item) => (item.wall ? 0 : HEIGHT[kindOf(item)] ?? 0);
export const liftOf = (item) => LIFT[kindOf(item)] ?? 0;

/** Screen-space box an item covers once raised: { x, y, w, h } in world units. */
export function raisedRect(item, lift = liftOf(item)) {
  const z = heightOf(item) + lift;
  return { x: item.x, y: item.y - z, w: item.w, h: item.h + z };
}

/**
 * Everything static that stands up, prepared once per map:
 *   walls:   wall pieces { x, y, w, h, base, horizontal, outdoorFace }
 *   tall:    furniture/props with height { item, isObject, base }
 *   mounted: wall-mounted things { item, isObject, base }
 *   flat:    decor drawn flat on the floor (rugs, doormats, paths, lines)
 */
export function buildScene(map) {
  if (map._scene) return map._scene;
  const walls = [];
  for (const w of map.walls) {
    const horizontal = w.w >= w.h;
    if (horizontal) {
      for (let x = w.x; x < w.x + w.w; x += CHUNK * 4) {
        const cw = Math.min(CHUNK * 4, w.x + w.w - x);
        walls.push(wallPiece(map, x, w.y, cw, w.h, true));
      }
    } else {
      for (let y = w.y; y < w.y + w.h; y += CHUNK) {
        const ch = Math.min(CHUNK, w.y + w.h - y);
        walls.push(wallPiece(map, w.x, y, w.w, ch, false));
      }
    }
  }
  const tall = [], mounted = [], flat = [];
  for (const d of map.decor) {
    if (d.wall) mounted.push({ item: d, isObject: false, base: d.y + 0.5 });
    else if (heightOf(d)) tall.push({ item: d, isObject: false, base: d.y + d.h });
    else flat.push(d);
  }
  for (const o of map.interactables) {
    if (o.wall) mounted.push({ item: o, isObject: true, base: o.y - 1.5 });
    else tall.push({ item: o, isObject: true, base: o.y + o.h + (liftOf(o) ? 0.1 : 0) });
  }
  // Work out what each "sits on" item rests on.
  for (const t of tall) {
    t.lift = 0;
    if (!ON_TOP.has(kindOf(t.item))) continue;
    const cx = t.item.x + t.item.w / 2, cy = t.item.y + t.item.h / 2;
    let best = null;
    for (const sup of tall) {
      const r = sup.item;
      if (sup === t || !heightOf(r) || ON_TOP.has(kindOf(r))) continue;
      if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h && (!best || heightOf(r) > heightOf(best.item))) best = sup;
    }
    if (best) { t.lift = heightOf(best.item); t.base = best.base + 0.5; }   // draw after what it's on
    else t.lift = liftOf(t.item);
  }
  const byId = new Map(tall.filter((t) => t.isObject).map((t) => [t.item.id, t]));
  map._scene = { walls, tall, mounted, flat, byId };
  return map._scene;
}

/** How far above the floor an interactable's top is drawn (its height plus whatever it sits on). */
export function raiseOf(map, o) {
  const t = buildScene(map).byId.get(o.id);
  return heightOf(o) + (t ? t.lift : liftOf(o));
}

function wallPiece(map, x, y, w, h, horizontal) {
  // Brick outside the building, painted plaster inside.
  const below = map.roomAt(x + w / 2, y + h + 6);
  const outdoorFace = !!below?.open;
  // A front wall: the bottom edge of an indoor room (but not the building's outside).
  const front = horizontal && !outdoorFace && map.rooms.some((r) => !r.open && !r.hall
    && Math.abs(r.y + r.h - (y + h)) < 1 && x + w / 2 > r.x && x + w / 2 < r.x + r.w);
  return { x, y, w, h, base: y + h, horizontal, outdoorFace, height: front ? FRONT_H : WALL_H };
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/** One piece of wall: the darker top cap, and (for walls facing the camera) the face. */
export function drawWall(ctx, w, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  // Face: from the floor line up the wall's height.
  const H = w.height;
  const fy = w.y + w.h - H;
  if (w.outdoorFace) {
    ctx.fillStyle = '#b4553f';
    ctx.fillRect(w.x, fy, w.w, H);
    ctx.fillStyle = 'rgba(255, 230, 210, 0.35)';
    for (let r = 0; r < H; r += 10) {
      ctx.fillRect(w.x, fy + r, w.w, 1.2);
      const off = (r / 10) % 2 ? 0 : 12;
      for (let c = w.x - (w.x % 24) + off; c < w.x + w.w; c += 24) if (c >= w.x) ctx.fillRect(c, fy + r, 1.2, 10);
    }
  } else {
    ctx.fillStyle = '#ece6d8';
    ctx.fillRect(w.x, fy, w.w, H);
    ctx.fillStyle = '#ddd5c3';
    ctx.fillRect(w.x, fy + H * 0.55, w.w, H * 0.45);   // a darker lower half (wainscot)
    ctx.fillStyle = '#c4b89e';
    ctx.fillRect(w.x, fy + H * 0.55, w.w, 2);
  }
  ctx.fillStyle = w.outdoorFace ? '#7a3324' : '#a99b80';
  ctx.fillRect(w.x, w.y + w.h - 5, w.w, 5);                      // skirting board
  // Cap: the top of the wall, raised.
  ctx.fillStyle = '#3d475e';
  ctx.fillRect(w.x, w.y - H, w.w, w.h);
  ctx.fillStyle = '#56617b';
  ctx.fillRect(w.x, w.y - H, w.w, 2);
  ctx.restore();
}

/**
 * Furniture with height. Appliances and cabinets (boxArt.js) get a proper front
 * and a plain top; everything else is its top-down sprite lifted up over a
 * shaded front.
 *
 *   hooks.front(ctx, F, lift)   paint on the front face (a microwave's glow)
 *   hooks.top(ctx, o)           paint on the top, in footprint coordinates (desk nameplates)
 *   hooks.outline(ctx, rect)    draw around the whole raised object (task highlights)
 */
export function drawTall(ctx, entry, alpha = 1, hooks = {}) {
  const o = entry.item;
  const z = heightOf(o);
  const lift = entry.lift ?? liftOf(o);
  const draw = entry.isObject ? drawObjectItem : drawDecorItem;
  const spec = z ? BOX[kindOf(o)] : null;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (spec) {
    drawBox(ctx, o, spec, z, lift, draw, {
      front: hooks.front ? (c, F) => hooks.front(c, F, lift) : undefined,
      top: hooks.top,
    });
  } else {
    ctx.translate(0, -lift);
    if (z) {
      const fy = o.y + o.h - z;
      ctx.save();
      ctx.beginPath();
      ctx.rect(o.x, fy, o.w, z);
      ctx.clip();
      ctx.fillStyle = '#6b6f78';
      ctx.fillRect(o.x, fy, o.w, z);
      draw(ctx, o);                         // the object's own colours, darkened, as its front
      ctx.fillStyle = 'rgba(20, 24, 36, 0.32)';
      ctx.fillRect(o.x, fy, o.w, z);
      ctx.restore();
    }
    ctx.translate(0, -z);
    draw(ctx, o);
    hooks.top?.(ctx, o);
  }
  ctx.restore();
  hooks.outline?.(ctx, raisedRect(o, lift));
}

/** A shadow under raised things and people, so they sit on the floor. */
export function drawShadow(ctx, o) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
  roundRect(ctx, o.x + 3, o.y + o.h - 4, o.w, 8, 4);
  ctx.fill();
}

/** Face rect of a wall-mounted item: on the wall right above its y. */
export function mountedRect(item) {
  const bottom = item.y - (item.type ? 2 : 0);
  // The whiteboard gets most of the wall; posters and clocks a bit less.
  return item.type === 'whiteboard'
    ? { x: item.x, y: bottom - WALL_H + 4, w: item.w, h: WALL_H - 12 }
    : { x: item.x, y: bottom - WALL_H + 10, w: item.w, h: WALL_H - 22 };
}
