/**
 * THE OFFICE — pure data. Edit this file to add, move or resize rooms and props.
 *
 * Coordinate system: world units, origin top-left, +y down. The world is the
 * building (top) plus the grounds outside it (bottom), all inside a fence.
 *
 *  rooms[]         Rectangles with a name and a floor. Walls are generated along
 *                  each edge (inside the rectangle), with gaps wherever `doors` say.
 *                  door: { side: 'n'|'s'|'e'|'w', at: 0..1 (centre along the side), width }
 *                  Options:
 *                    label: [x, y]     where the floor label goes (default bottom-left);
 *                                      false = no label
 *                    open: true        no walls (outdoor areas)
 *                    hall: true        the building shell: its walls are the outside
 *                                      walls, its floor is the hallway, and it's never
 *                                      reported as "the room you're in"
 *                    breakArea: true   on a break, you're safe from reports here
 *                  When rooms overlap, the smallest one containing a point wins.
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

const BUILDING_H = 1480;

export const OFFICE = {
  width: 2800,
  height: 2080,
  wallThickness: 12,

  rooms: [
    // The building shell: outer walls with the front and back doors.
    { id: 'hall', name: 'Hallway', x: 0, y: 0, w: 2800, h: BUILDING_H, floor: 'hallway', hall: true, label: false,
      doors: [{ side: 's', at: 980 / 2800, width: 160 }, { side: 's', at: 2400 / 2800, width: 130 }] },

    // ---- Top row: offices and the conference room ----
    { id: 'office_a',   name: 'Open Office A',     x: 0,    y: 0,    w: 600, h: 440, floor: 'carpet_blue',
      doors: [{ side: 's', at: 0.5, width: 110 }] },
    { id: 'conference', name: 'Conference Room',   x: 720,  y: 0,    w: 500, h: 440, floor: 'wood',
      doors: [{ side: 's', at: 0.5, width: 110 }] },
    { id: 'office_b',   name: 'Open Office B',     x: 1320, y: 0,    w: 620, h: 440, floor: 'carpet_green',
      doors: [{ side: 's', at: 0.5, width: 110 }] },
    { id: 'studio',     name: 'Design Studio',     x: 2040, y: 0,    w: 760, h: 440, floor: 'concrete',
      doors: [{ side: 's', at: 0.35, width: 110 }] },

    // ---- Middle and bottom rows ----
    { id: 'break',      name: 'Break Room',        x: 0,    y: 600,  w: 600, h: 420, floor: 'tile_warm', label: [330, 992], breakArea: true,
      doors: [{ side: 'n', at: 0.5, width: 110 }, { side: 'e', at: 0.5, width: 90 }] },
    { id: 'restroom',   name: 'Restrooms',         x: 0,    y: 1020, w: 600, h: 460, floor: 'tile_cool', label: [400, 1300],
      doors: [{ side: 'e', at: 0.3, width: 90 }] },
    { id: 'lobby',      name: 'Lobby',             x: 700,  y: 600,  w: 560, h: 880, floor: 'marble', label: [722, 1050],
      doors: [{ side: 'n', at: 0.5, width: 160 }, { side: 'w', at: 0.25, width: 90 }, { side: 'e', at: 0.25, width: 90 },
        { side: 's', at: 0.5, width: 160 }] },
    { id: 'accounting', name: 'Accounting',        x: 1360, y: 600,  w: 580, h: 420, floor: 'carpet_grey',
      doors: [{ side: 'n', at: 0.5, width: 110 }] },
    { id: 'manager',    name: "Manager's Office",  x: 2040, y: 600,  w: 760, h: 420, floor: 'carpet_red', label: [2062, 648],
      doors: [{ side: 'n', at: 0.2, width: 100 }] },
    { id: 'mailroom',   name: 'Mail & Copy Room',  x: 1360, y: 1020, w: 600, h: 460, floor: 'linoleum', label: [1560, 1300],
      doors: [{ side: 'w', at: 0.4, width: 90 }, { side: 'e', at: 0.5, width: 90 }] },

    // ---- Outside (no walls; the fence is the world edge) ----
    { id: 'lawn',       name: 'Lawn',              x: 0,    y: BUILDING_H, w: 1360, h: 600, floor: 'grass', open: true, breakArea: true,
      label: [30, 2050] },
    { id: 'patio',      name: 'Patio',             x: 700,  y: BUILDING_H, w: 660, h: 320, floor: 'pavers', open: true, breakArea: true,
      label: [1200, 1780] },
    { id: 'parking',    name: 'Parking Lot',       x: 1360, y: BUILDING_H, w: 1440, h: 600, floor: 'asphalt', open: true, breakArea: true,
      label: [2600, 2050] },
  ],

  // w/h default to 90x46 (see mapBuilder). 3 + 3 + 2 + 2 across the four offices.
  desks: [
    { id: 'desk_1',  room: 'office_a',   x: 70,   y: 90 },
    { id: 'desk_2',  room: 'office_a',   x: 330,  y: 90 },
    { id: 'desk_3',  room: 'office_a',   x: 70,   y: 270 },
    { id: 'desk_4',  room: 'office_b',   x: 1400, y: 90 },
    { id: 'desk_5',  room: 'office_b',   x: 1670, y: 90 },
    { id: 'desk_6',  room: 'office_b',   x: 1670, y: 270 },
    { id: 'desk_7',  room: 'studio',     x: 2140, y: 90 },
    { id: 'desk_8',  room: 'studio',     x: 2140, y: 270 },
    { id: 'desk_9',  room: 'accounting', x: 1420, y: 690 },
    { id: 'desk_10', room: 'accounting', x: 1640, y: 690 },
  ],

  interactables: [
    // Hallway nooks
    { id: 'cooler_west',  type: 'water_cooler',   label: 'Water cooler',      x: 638,  y: 24,   w: 44,  h: 44,  solid: true },
    { id: 'cooler_mid',   type: 'water_cooler',   label: 'Water cooler',      x: 1248, y: 24,   w: 44,  h: 44,  solid: true },
    { id: 'cooler_east',  type: 'water_cooler',   label: 'Water cooler',      x: 1968, y: 24,   w: 44,  h: 44,  solid: true },
    // Break room
    { id: 'coffee',       type: 'coffee_machine', label: 'Coffee machine',    x: 24,   y: 620,  w: 60,  h: 44,  solid: true },
    { id: 'microwave',    type: 'microwave',      label: 'Microwave',         x: 110,  y: 620,  w: 56,  h: 40,  solid: true },
    { id: 'fridge',       type: 'fridge',         label: 'Fridge',            x: 500,  y: 620,  w: 60,  h: 70,  solid: true },
    { id: 'lunch_table',  type: 'lunch_table',    label: 'Lunch table',       x: 200,  y: 790,  w: 200, h: 90,  solid: true },
    // Restrooms
    { id: 'toilet_1',     type: 'toilet',         label: 'Toilet',            x: 40,   y: 1410, w: 44,  h: 44,  solid: true },
    { id: 'toilet_2',     type: 'toilet',         label: 'Toilet',            x: 156,  y: 1410, w: 44,  h: 44,  solid: true },
    { id: 'toilet_3',     type: 'toilet',         label: 'Toilet',            x: 272,  y: 1410, w: 44,  h: 44,  solid: true },
    { id: 'sinks',        type: 'sink',           label: 'Sinks',             x: 420,  y: 1036, w: 140, h: 40,  solid: true },
    // Lobby
    { id: 'plant',        type: 'plant',          label: 'Lobby ficus',       x: 724,  y: 624,  w: 40,  h: 40,  solid: true },
    { id: 'time_clock',   type: 'time_clock',     label: 'Time clock',        x: 760,  y: 1400, w: 50,  h: 40,  solid: true },
    { id: 'hr_box',       type: 'hr_box',         label: 'HR complaint box',  x: 1120, y: 760,  w: 44,  h: 54,  solid: true },
    // Conference room: the all-hands bell sits on the table edge
    { id: 'bell',         type: 'meeting_bell',   label: 'All-hands bell',    x: 955,  y: 286,  w: 30,  h: 24,  solid: false },
    { id: 'whiteboard',   type: 'whiteboard',     label: 'Whiteboard',        x: 850,  y: 14,   w: 240, h: 18,  solid: false },
    // Design studio
    { id: 'easel',        type: 'easel',          label: 'Easel',             x: 2620, y: 230,  w: 70,  h: 60,  solid: true },
    // Accounting
    { id: 'filing',       type: 'filing_cabinet', label: 'Filing cabinets',   x: 1872, y: 640,  w: 50,  h: 130, solid: true },
    // Manager's office
    { id: 'inbox',        type: 'manager_inbox',  label: "Manager's inbox",   x: 2250, y: 716,  w: 40,  h: 36,  solid: true },
    { id: 'candy',        type: 'candy_bowl',     label: 'Candy bowl',        x: 2385, y: 772,  w: 30,  h: 26,  solid: false },
    // Mail & copy room
    { id: 'printer',      type: 'printer',        label: 'Printer',           x: 1400, y: 1044, w: 80,  h: 56,  solid: true },
    { id: 'copier',       type: 'copier',         label: 'Copier',            x: 1520, y: 1044, w: 70,  h: 56,  solid: true },
    { id: 'mailboxes',    type: 'mailbox',        label: 'Mailboxes',         x: 1640, y: 1036, w: 180, h: 34,  solid: true },
    { id: 'supplies',     type: 'supplies',       label: 'Supply cabinet',    x: 1400, y: 1396, w: 90,  h: 60,  solid: true },
    { id: 'shredder',     type: 'shredder',       label: 'Shredder',          x: 1872, y: 1380, w: 50,  h: 70,  solid: true },
    // Outside
    { id: 'planters',     type: 'planter',        label: 'Planters',          x: 1240, y: 1520, w: 90,  h: 40,  solid: true },
    { id: 'picnic_1',     type: 'picnic_table',   label: 'Picnic table',      x: 800,  y: 1600, w: 140, h: 70,  solid: true },
    { id: 'picnic_2',     type: 'picnic_table',   label: 'Picnic table',      x: 1110, y: 1640, w: 140, h: 70,  solid: true },
    { id: 'cat_bowl',     type: 'cat_bowl',       label: 'Cat bowl',          x: 330,  y: 1560, w: 30,  h: 24,  solid: false },
    { id: 'your_car',     type: 'car',            label: 'Your car',          x: 1750, y: 1660, w: 64,  h: 116, solid: true },
    { id: 'dumpster',     type: 'dumpster',       label: 'Recycling',         x: 2560, y: 1510, w: 130, h: 64,  solid: true },
  ],

  decor: [
    // Office A
    { kind: 'plant',      x: 540,  y: 380, w: 34, h: 34, solid: true },
    { kind: 'bookshelf',  x: 520,  y: 30,  w: 50, h: 100, solid: true },
    // Conference room
    { kind: 'table',      x: 810,  y: 150, w: 320, h: 160, solid: true },
    // Office B
    { kind: 'plant',      x: 1880, y: 380, w: 34, h: 34, solid: true },
    { kind: 'copier',     x: 1360, y: 360, w: 70, h: 56, solid: true },
    // Design studio
    { kind: 'drafting',   x: 2420, y: 90,  w: 120, h: 70, solid: true },
    { kind: 'beanbag',    x: 2460, y: 330, w: 56, h: 56, solid: true },
    { kind: 'beanbag',    x: 2540, y: 350, w: 56, h: 56, solid: true },
    { kind: 'plant',      x: 2740, y: 24,  w: 34, h: 34, solid: true },
    // Break room
    { kind: 'counter',    x: 16,   y: 614, w: 230, h: 56 },
    { kind: 'vending',    x: 20,   y: 925, w: 60,  h: 72, solid: true },
    // Restrooms
    { kind: 'partition',  x: 120,  y: 1370, w: 6, h: 98, solid: true },
    { kind: 'partition',  x: 236,  y: 1370, w: 6, h: 98, solid: true },
    { kind: 'partition',  x: 352,  y: 1370, w: 6, h: 98, solid: true },
    // Lobby
    { kind: 'reception',  x: 870,  y: 760,  w: 220, h: 50, solid: true },
    { kind: 'sofa',       x: 740,  y: 1150, w: 140, h: 50, solid: true },
    { kind: 'sofa',       x: 1080, y: 1150, w: 140, h: 50, solid: true },
    { kind: 'doormat',    x: 910,  y: 1420, w: 140, h: 44 },
    // Accounting
    { kind: 'partition',  x: 1380, y: 840,  w: 220, h: 6, solid: true },
    { kind: 'partition',  x: 1620, y: 840,  w: 220, h: 6, solid: true },
    { kind: 'bookshelf',  x: 1872, y: 860,  w: 50, h: 120, solid: true },
    // Manager's office
    { kind: 'rug',        x: 2160, y: 680,  w: 400, h: 220 },
    { kind: 'exec_desk',  x: 2300, y: 700,  w: 200, h: 72, solid: true },
    { kind: 'sofa',       x: 2600, y: 900,  w: 150, h: 50, solid: true },
    { kind: 'bookshelf',  x: 2740, y: 640,  w: 50, h: 140, solid: true },
    { kind: 'plant',      x: 2070, y: 960,  w: 40, h: 40, solid: true },
    // Mail & copy room
    // Outside: lawn
    { kind: 'tree',       x: 80,   y: 1640, w: 110, h: 110, solid: true },
    { kind: 'tree',       x: 420,  y: 1840, w: 120, h: 120, solid: true },
    { kind: 'tree',       x: 120,  y: 1900, w: 90,  h: 90,  solid: true },
    { kind: 'bench',      x: 240,  y: 1700, w: 120, h: 36, solid: true },
    { kind: 'cat',        x: 372,  y: 1556, w: 36,  h: 30 },
    // Outside: patio
    { kind: 'planter_box', x: 720, y: 1520, w: 90,  h: 40, solid: true },
    { kind: 'path',       x: 900,  y: 1800, w: 160, h: 280 },
    // Outside: parking lot
    { kind: 'parking_lines', x: 1480, y: 1640, w: 1180, h: 140 },
    { kind: 'parking_lines', x: 1480, y: 1880, w: 1180, h: 140 },
    { kind: 'car', x: 1500, y: 1660, w: 64, h: 116, solid: true, color: '#3a6fd8' },
    { kind: 'car', x: 1600, y: 1660, w: 64, h: 116, solid: true, color: '#e8c21c' },
    { kind: 'car', x: 1950, y: 1660, w: 64, h: 116, solid: true, color: '#8a5a3c' },
    { kind: 'car', x: 2250, y: 1660, w: 64, h: 116, solid: true, color: '#2f9e5b' },
    { kind: 'car', x: 2350, y: 1660, w: 64, h: 116, solid: true, color: '#7d8793' },
    { kind: 'car', x: 1650, y: 1900, w: 64, h: 116, solid: true, color: '#e56aa8' },
    { kind: 'car', x: 2050, y: 1900, w: 64, h: 116, solid: true, color: '#1d2742' },
    { kind: 'car', x: 2450, y: 1900, w: 64, h: 116, solid: true, color: '#f08a24' },
    { kind: 'bike_rack',  x: 1400, y: 1510, w: 120, h: 30, solid: true },
  ],

  meetingSeats: [
    { x: 850, y: 120 }, { x: 910, y: 120 }, { x: 970, y: 120 }, { x: 1030, y: 120 }, { x: 1090, y: 120 },
    { x: 850, y: 345 }, { x: 910, y: 345 }, { x: 970, y: 345 }, { x: 1030, y: 345 }, { x: 1090, y: 345 },
  ],
};
