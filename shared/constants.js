/**
 * Shared game constants. Imported by BOTH the server (Durable Object) and the
 * browser client, so keep this file free of platform-specific APIs.
 */

// ---- Simulation -----------------------------------------------------------
export const TICK_RATE = 20;                 // server simulation ticks / second
export const TICK_MS = 1000 / TICK_RATE;
export const INTERP_DELAY_MS = 110;          // client renders remote players this far in the past

// ---- Room limits ----------------------------------------------------------
export const MAX_PLAYERS = 10;               // hard cap per room
export const MIN_PLAYERS = 3;                // needed to start (1 Management + 2 workers)
export const ROOM_CODE_LENGTH = 5;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export const RECONNECT_GRACE_MS = 45_000;    // a dropped player keeps their seat this long

// ---- Movement / geometry ---------------------------------------------------
export const PLAYER_RADIUS = 14;
export const PLAYER_SPEED = 190;             // world units per second
export const INTERACT_RANGE = 46;            // max distance from player centre to an object's edge
export const DESK_RANGE = 58;                // within this distance of your seat = "at your desk"

// ---- Roles & rules --------------------------------------------------------
export const TASKS_PER_WORKER = 5;           // 1 desk task + (N-1) tasks around the office
export const GO_HOME_RATIO = 0.5;            // fraction of workers who must clock out for a crew win
export const START_FREEZE_MS = 3500;         // nobody moves while roles are revealed
export const REPORT_RANGE = 260;             // Management must be this close to report someone
export const REPORT_COOLDOWN_MS = 25_000;
export const REPORT_INITIAL_COOLDOWN_MS = 15_000;

// ---- Vision ---------------------------------------------------------------
export const VISION_RADIUS = 460;            // how far you can see; walls block line of sight

// ---- Breaker box / wifi ---------------------------------------------------
export const BREAKER_HOLD_MS = 3000;         // hold time to flip the breaker either way
export const WIFI_OUTAGE_MS = 30_000;        // wifi comes back on its own after this
export const BREAKER_COOLDOWN_MS = 45_000;   // after the wifi comes back, before it can be cut again
export const BREAKER_INITIAL_COOLDOWN_MS = 20_000;
export const SOCIAL_GOAL_PER_WORKER = 1.5;   // outage tasks needed per worker to fill the social meter
export const SOCIAL_GOAL_MIN = 3;

// ---- Meetings -------------------------------------------------------------
export const MEETING_DURATION_MS = 70_000;   // discussion + voting
export const MEETING_RESULT_MS = 6_000;      // how long the result screen shows
export const MEETING_COOLDOWN_MS = 25_000;   // after game start and after each meeting
export const EMERGENCY_CALLS_PER_PLAYER = 1;

// ---- Text limits ----------------------------------------------------------
export const NAME_MAX = 16;
export const CHAT_MAX = 140;
export const CHAT_HISTORY = 40;
export const MAX_MESSAGE_BYTES = 1024;       // server drops anything larger

// ---- Enums ----------------------------------------------------------------
export const PHASE = Object.freeze({
  LOBBY: 'lobby',
  PLAYING: 'playing',
  MEETING: 'meeting',
  ENDED: 'ended',
});

export const STATUS = Object.freeze({
  ACTIVE: 'active',        // in the office
  HOME: 'home',            // clocked out after finishing tasks (safe)
  SENT_HOME: 'sent_home',  // reported by Management or voted out
  LEFT: 'left',            // disconnected for longer than the grace period
});

export const ROLE = Object.freeze({
  WORKER: 'worker',
  MANAGEMENT: 'management',
});

// Ten distinct shirt colours. Index = colour id.
export const COLORS = [
  { name: 'Red',    hex: '#e0473b' },
  { name: 'Blue',   hex: '#3a6fd8' },
  { name: 'Green',  hex: '#2f9e5b' },
  { name: 'Orange', hex: '#f08a24' },
  { name: 'Purple', hex: '#8b5bd6' },
  { name: 'Teal',   hex: '#1fa6a6' },
  { name: 'Pink',   hex: '#e56aa8' },
  { name: 'Yellow', hex: '#e8c21c' },
  { name: 'Brown',  hex: '#8a5a3c' },
  { name: 'Grey',   hex: '#7d8793' },
];
