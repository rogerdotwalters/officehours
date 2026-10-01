/**
 * THE OFFICE — pure data. Edit this file to add, move or resize rooms and props.
 *
 * Coordinate system: world units, origin top-left, +y down.
 * Anything not inside a room is hallway floor.
 *
 *  rooms[]         Walled rectangles. Optional label: [x, y] moves the floor label
 *                  (default: bottom-left corner). Walls are generated automatically along each
 *                  edge (inside the rectangle), with gaps wherever `doors` say.
 *                  door: { side: 'n'|'s'|'e'|'w', at: 0..1 (centre along the side), width }
 *  desks[]         One per possible player (need >= MAX_PLAYERS). Solid. The seat is
 *                  generated just south of the desk; "at your desk" means near the seat.
 *  interactables[] Task targets and other usable objects. `type` links them to tasks
 *                  (see tasks.js). Several objects may share a type (e.g. two coolers).
 *  decor[]         Visual-only props. Set solid:true to make them block movement.
 *  meetingSeats[]  Where active players are placed when a meeting is called.
 *
 * Nothing here is trusted from the client: the server builds the same map from this
 * file and validates every movement and interaction against it.
 */

export const OFFICE = {
  width: 2000,
  height: 1400,
  wallThickness: 12,

  rooms: [
    { id: 'open_a',     name: 'Open Office A',     x: 0,    y: 0,    w: 640, h: 460, floor: 'carpet_blue', label: [84, 438],
      doors: [{ side: 's', at: 0.5, width: 110 }] },
    { id: 'conference', name: 'Conference Room',   x: 740,  y: 0,    w: 520, h: 460, floor: 'wood',
      doors: [{ side: 's', at: 0.5, width: 110 }] },
    { id: 'open_b',     name: 'Open Office B',     x: 1360, y: 0,    w: 640, h: 460, floor: 'carpet_green',
      doors: [{ side: 's', at: 0.5, width: 110 }] },
    { id: 'break',      name: 'Break Room',        x: 0,    y: 620,  w: 600, h: 400, floor: 'tile_warm', label: [330, 992],
      doors: [{ side: 'n', at: 0.5, width: 110 }, { side: 'e', at: 0.5, width: 90 }] },
    { id: 'restroom',   name: 'Restrooms',         x: 0,    y: 1020, w: 600, h: 380, floor: 'tile_cool', label: [390, 1250],
      doors: [{ side: 'e', at: 0.35, width: 90 }] },
    { id: 'lobby',      name: 'Lobby',             x: 720,  y: 620,  w: 560, h: 780, floor: 'marble',
      doors: [{ side: 'n', at: 0.5, width: 160 }, { side: 'w', at: 0.3, width: 90 }, { side: 'e', at: 0.3, width: 90 }] },
    { id: 'office_1',   name: 'Corner Office',     x: 1400, y: 620,  w: 300, h: 400, floor: 'carpet_red', label: [1422, 668],
      doors: [{ side: 'n', at: 0.5, width: 90 }] },
    { id: 'office_2',   name: "Director's Office", x: 1700, y: 620,  w: 300, h: 400, floor: 'carpet_red', label: [1722, 668],
      doors: [{ side: 'n', at: 0.5, width: 90 }] },
    { id: 'mailroom',   name: 'Mail & Copy Room',  x: 1400, y: 1020, w: 600, h: 380, floor: 'linoleum', label: [1600, 1250],
      doors: [{ side: 'w', at: 0.4, width: 90 }] },
  ],

  // w/h default to 90x46 (see mapBuilder).
  desks: [
    { id: 'desk_1',  room: 'open_a',   x: 110,  y: 110 },
    { id: 'desk_2',  room: 'open_a',   x: 400,  y: 110 },
    { id: 'desk_3',  room: 'open_a',   x: 110,  y: 290 },
    { id: 'desk_4',  room: 'open_a',   x: 400,  y: 290 },
    { id: 'desk_5',  room: 'open_b',   x: 1470, y: 110 },
    { id: 'desk_6',  room: 'open_b',   x: 1760, y: 110 },
    { id: 'desk_7',  room: 'open_b',   x: 1470, y: 290 },
    { id: 'desk_8',  room: 'open_b',   x: 1760, y: 290 },
    { id: 'desk_9',  room: 'office_1', x: 1505, y: 720 },
    { id: 'desk_10', room: 'office_2', x: 1805, y: 720 },
  ],

  interactables: [
    // Hallway nooks
    { id: 'cooler_west', type: 'water_cooler',   label: 'Water cooler',     x: 668,  y: 24,   w: 44,  h: 44,  solid: true },
    { id: 'cooler_east', type: 'water_cooler',   label: 'Water cooler',     x: 1288, y: 24,   w: 44,  h: 44,  solid: true },
    // Break room
    { id: 'coffee',      type: 'coffee_machine', label: 'Coffee machine',   x: 24,   y: 640,  w: 60,  h: 44,  solid: true },
    { id: 'microwave',   type: 'microwave',      label: 'Microwave',        x: 110,  y: 640,  w: 56,  h: 40,  solid: true },
    { id: 'fridge',      type: 'fridge',         label: 'Fridge',           x: 500,  y: 640,  w: 60,  h: 70,  solid: true },
    { id: 'lunch_table', type: 'lunch_table',    label: 'Lunch table',      x: 200,  y: 800,  w: 200, h: 90,  solid: true },
    // Restrooms
    { id: 'toilet_1',    type: 'toilet',         label: 'Toilet',           x: 40,   y: 1330, w: 44,  h: 44,  solid: true },
    { id: 'toilet_2',    type: 'toilet',         label: 'Toilet',           x: 156,  y: 1330, w: 44,  h: 44,  solid: true },
    { id: 'toilet_3',    type: 'toilet',         label: 'Toilet',           x: 272,  y: 1330, w: 44,  h: 44,  solid: true },
    { id: 'sinks',       type: 'sink',           label: 'Sinks',            x: 420,  y: 1036, w: 140, h: 40,  solid: true },
    // Lobby
    { id: 'plant',       type: 'plant',          label: 'Lobby ficus',      x: 744,  y: 644,  w: 40,  h: 40,  solid: true },
    { id: 'time_clock',  type: 'time_clock',     label: 'Time clock',       x: 900,  y: 1336, w: 50,  h: 40,  solid: true },
    // East hallway dead end: cutting the power kills the office wifi
    { id: 'breaker',     type: 'breaker',        label: 'Breaker box',      x: 1310, y: 1352, w: 60,  h: 32,  solid: true },
    // Conference room — the emergency meeting bell sits on the table edge
    { id: 'bell',        type: 'meeting_bell',   label: 'All-hands bell',   x: 985,  y: 286,  w: 30,  h: 24,  solid: false },
    // Mail & copy room
    { id: 'printer',     type: 'printer',        label: 'Printer',          x: 1440, y: 1044, w: 80,  h: 56,  solid: true },
    { id: 'mailboxes',   type: 'mailbox',        label: 'Mailboxes',        x: 1660, y: 1036, w: 180, h: 34,  solid: true },
    { id: 'supplies',    type: 'supplies',       label: 'Supply cabinet',   x: 1440, y: 1316, w: 90,  h: 60,  solid: true },
    { id: 'shredder',    type: 'shredder',       label: 'Shredder',         x: 1920, y: 1300, w: 50,  h: 70,  solid: true },
  ],

  decor: [
    { kind: 'counter',    x: 16,   y: 634,  w: 230, h: 56 },
    { kind: 'vending',    x: 20,   y: 925,  w: 60,  h: 72, solid: true },
    { kind: 'partition',  x: 120,  y: 1290, w: 6,   h: 98, solid: true },
    { kind: 'partition',  x: 236,  y: 1290, w: 6,   h: 98, solid: true },
    { kind: 'partition',  x: 352,  y: 1290, w: 6,   h: 98, solid: true },
    { kind: 'reception',  x: 890,  y: 760,  w: 220, h: 50, solid: true },
    { kind: 'sofa',       x: 760,  y: 1120, w: 140, h: 50, solid: true },
    { kind: 'sofa',       x: 1100, y: 1120, w: 140, h: 50, solid: true },
    { kind: 'exit',       x: 980,  y: 1370, w: 120, h: 18 },
    { kind: 'table',      x: 840,  y: 150,  w: 320, h: 160, solid: true },
    { kind: 'whiteboard', x: 880,  y: 14,   w: 240, h: 18 },
    { kind: 'bookshelf',  x: 1420, y: 900,  w: 50,  h: 100, solid: true },
    { kind: 'bookshelf',  x: 1930, y: 900,  w: 50,  h: 100, solid: true },
    { kind: 'plant',      x: 1640, y: 950,  w: 34,  h: 34, solid: true },
    { kind: 'plant',      x: 1720, y: 950,  w: 34,  h: 34, solid: true },
    { kind: 'plant',      x: 590,  y: 400,  w: 34,  h: 34, solid: true },
    { kind: 'plant',      x: 1942, y: 400,  w: 34,  h: 34, solid: true },
    { kind: 'copier',     x: 1550, y: 1044, w: 70,  h: 56, solid: true },
  ],

  meetingSeats: [
    { x: 880, y: 120 }, { x: 940, y: 120 }, { x: 1000, y: 120 }, { x: 1060, y: 120 }, { x: 1120, y: 120 },
    { x: 880, y: 345 }, { x: 940, y: 345 }, { x: 1000, y: 345 }, { x: 1060, y: 345 }, { x: 1120, y: 345 },
  ],
};
