/**
 * Turns the declarative OFFICE data into a queryable map:
 *   - wall rectangles (with door gaps) generated from room outlines
 *   - a flat list of solid colliders (walls + solid desks/props)
 *   - lookup helpers used by server validation AND client rendering/prediction
 *
 * Because both sides build the map from the same data with the same code,
 * client-side prediction collides with exactly the same geometry as the server.
 */
import { OFFICE } from './officeMap.js';

const DESK_W = 90;
const DESK_H = 46;
const SEAT_OFFSET = 26; // seat centre sits this far below the desk's bottom edge

/** Distance from a point to the nearest edge of an axis-aligned rect (0 if inside). */
export function distPointRect(px, py, r) {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
  return Math.hypot(dx, dy);
}

export function pointInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

/** Split [0, length] into solid spans, leaving gaps for doors. */
function solidSpans(length, gaps) {
  const sorted = gaps.map(([a, b]) => [Math.max(0, a), Math.min(length, b)]).sort((a, b) => a[0] - b[0]);
  const spans = [];
  let cursor = 0;
  for (const [a, b] of sorted) {
    if (a > cursor) spans.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < length) spans.push([cursor, length]);
  return spans;
}

/** Generate wall rects for one room. Walls sit just inside the room outline. */
function buildRoomWalls(room, t) {
  const walls = [];
  const doorRects = [];
  for (const side of ['n', 's', 'w', 'e']) {
    const horizontal = side === 'n' || side === 's';
    const length = horizontal ? room.w : room.h;
    const gaps = (room.doors || [])
      .filter((d) => d.side === side)
      .map((d) => [d.at * length - d.width / 2, d.at * length + d.width / 2]);

    for (const [a, b] of solidSpans(length, gaps)) {
      if (horizontal) {
        walls.push({ x: room.x + a, y: side === 'n' ? room.y : room.y + room.h - t, w: b - a, h: t });
      } else {
        walls.push({ x: side === 'w' ? room.x : room.x + room.w - t, y: room.y + a, w: t, h: b - a });
      }
    }
    // Door rects are only used for drawing thresholds.
    for (const [a, b] of gaps) {
      if (horizontal) doorRects.push({ x: room.x + a, y: side === 'n' ? room.y : room.y + room.h - t, w: b - a, h: t, side });
      else doorRects.push({ x: side === 'w' ? room.x : room.x + room.w - t, y: room.y + a, w: t, h: b - a, side });
    }
  }
  return { walls, doorRects };
}

export function buildOfficeMap(def = OFFICE) {
  const t = def.wallThickness;
  const walls = [];
  const doors = [];

  // Outer boundary of the building.
  walls.push({ x: 0, y: 0, w: def.width, h: t });
  walls.push({ x: 0, y: def.height - t, w: def.width, h: t });
  walls.push({ x: 0, y: 0, w: t, h: def.height });
  walls.push({ x: def.width - t, y: 0, w: t, h: def.height });

  for (const room of def.rooms) {
    const built = buildRoomWalls(room, t);
    walls.push(...built.walls);
    doors.push(...built.doorRects);
  }

  const desks = (def.desks ?? []).map((d) => {
    const w = d.w ?? DESK_W;
    const h = d.h ?? DESK_H;
    return { ...d, w, h, seat: { x: d.x + w / 2, y: d.y + h + SEAT_OFFSET } };
  });

  // Desks are interactable too (desk tasks), with type 'desk'.
  const interactables = [
    ...(def.interactables ?? []).map((o) => ({ ...o })),
    ...desks.map((d) => ({ id: d.id, type: 'desk', label: 'Desk', x: d.x, y: d.y, w: d.w, h: d.h, solid: true, room: d.room })),
  ];

  const colliders = [
    ...walls,
    ...interactables.filter((o) => o.solid),
    ...(def.decor ?? []).filter((o) => o.solid),
  ];

  const byId = new Map(interactables.map((o) => [o.id, o]));
  const desksById = new Map(desks.map((d) => [d.id, d]));

  function roomAt(x, y) {
    for (const r of def.rooms) if (pointInRect(x, y, r)) return r;
    return null;
  }

  return {
    width: def.width,
    height: def.height,
    wallThickness: t,
    rooms: def.rooms,
    decor: def.decor ?? [],
    meetingSeats: def.meetingSeats ?? [],
    spawnPoints: def.spawnPoints ?? [],
    walls,
    doors,
    desks,
    desksById,
    interactables,
    colliders,

    getInteractable: (id) => byId.get(id) || null,
    roomAt,
    roomName: (x, y) => roomAt(x, y)?.name ?? 'Hallway',

    /** All interactables within INTERACT range of a point, nearest first. */
    interactablesNear(x, y, range) {
      return interactables
        .map((o) => ({ o, d: distPointRect(x, y, o) }))
        .filter((e) => e.d <= range)
        .sort((a, b) => a.d - b.d)
        .map((e) => e.o);
    },
  };
}
