/**
 * THE WAITING ROOM — the small walkable lobby players wander around in before
 * the workday starts. Same format as officeMap.js (see that file for details),
 * plus `spawnPoints`, where joining players appear.
 */
export const LOBBY_ROOM = {
  width: 1000,
  height: 680,
  wallThickness: 12,

  rooms: [
    { id: 'waiting', name: 'Waiting room', x: 0, y: 0, w: 1000, h: 680, floor: 'marble', label: [34, 560] },
  ],
  desks: [],
  interactables: [],
  meetingSeats: [],

  decor: [
    { kind: 'elevator',   x: 110, y: 12,  w: 130, h: 22 },
    { kind: 'elevator',   x: 760, y: 12,  w: 130, h: 22 },
    { kind: 'reception',  x: 390, y: 90,  w: 220, h: 50, solid: true },
    { kind: 'rug',        x: 330, y: 280, w: 340, h: 160 },
    { kind: 'table',      x: 440, y: 330, w: 120, h: 60, solid: true },
    { kind: 'sofa',       x: 110, y: 590, w: 170, h: 50, solid: true },
    { kind: 'sofa',       x: 720, y: 590, w: 170, h: 50, solid: true },
    { kind: 'vending',    x: 920, y: 260, w: 60,  h: 72, solid: true },
    { kind: 'bookshelf',  x: 24,  y: 250, w: 50,  h: 110, solid: true },
    { kind: 'plant',      x: 30,  y: 30,  w: 40,  h: 40, solid: true },
    { kind: 'plant',      x: 930, y: 30,  w: 40,  h: 40, solid: true },
    { kind: 'plant',      x: 470, y: 610, w: 40,  h: 40, solid: true },
    { kind: 'whiteboard', x: 640, y: 12,  w: 90,  h: 18 },
  ],

  spawnPoints: [
    { x: 220, y: 240 }, { x: 360, y: 230 }, { x: 500, y: 225 }, { x: 640, y: 230 }, { x: 780, y: 240 },
    { x: 220, y: 480 }, { x: 360, y: 490 }, { x: 500, y: 495 }, { x: 640, y: 490 }, { x: 780, y: 480 },
  ],
};
