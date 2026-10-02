/**
 * WebSocket protocol. Every message is a JSON object with a `t` (type) field.
 *
 *   Client -> Server (C2S): intents only. The server decides what happens.
 *   Server -> Client (S2C): authoritative state and events.
 *
 * See README.md for the full message table.
 */

export const C2S = Object.freeze({
  JOIN: 'join',            // { name, token? }  first message on every socket
  READY: 'ready',          // { ready: bool }
  START: 'start',          // {}  host only
  INPUT: 'input',          // { dx, dy }  each in {-1,0,1}
  INTERACT: 'interact',    // { objectId }
  CANCEL: 'cancel',        // {}  stop current task
  REPORT: 'report',        // { targetId }  Management only
  VOTE: 'vote',            // { targetId }  a player id or 'skip'
  CHAT: 'chat',            // { text, channel?: 'all' | 'team' | 'crew' }
  SETTINGS: 'settings',    // { settings: {...partial} }  host only, lobby only
  DESK_CHECK: 'deskcheck', // {}  Management only
  MINIGAME: 'minigame',    // { answer }  solution for the task window you have open
  DEV: 'dev',              // { cmd, ... }  test rooms only (server/dev/Sandbox.js)  SANDBOX
  RETURN_TO_LOBBY: 'lobby',// {}  host only, after game over
  PING: 'ping',            // { at }
});

export const S2C = Object.freeze({
  WELCOME: 'welcome',      // { playerId, token, code }
  ERROR: 'error',          // { code, message }
  ROOM: 'room',            // roster + phase (public info only)
  GAME_START: 'start',     // { freezeMs }
  SNAPSHOT: 'snap',        // { p: [[id, x, y, flags], ...] }  only players you can see
  SELF: 'self',            // private: role, desk, tasks, cooldowns
  EVENT: 'event',          // { kind, ... } feed items
  MEETING: 'meeting',      // meeting state (who voted is public, for whom is not until the end)
  CHAT: 'chat',            // { line } or { backlog }, each with channel 'all' | 'team' | 'crew'
  GAME_OVER: 'over',       // { winner, reason, managementId }
  TOAST: 'toast',          // { text }  private feedback ("Nothing to do here")
  PONG: 'pong',            // { at }
});

// Bit flags packed into snapshot entries.
export const PFLAG = Object.freeze({
  BUSY: 1,     // doing a task
  AT_DESK: 2,  // within DESK_RANGE of own seat (public: everyone can see desks)
});

export function encode(type, data = {}) {
  return JSON.stringify({ t: type, ...data });
}

/** Parse a raw frame. Returns null for anything malformed. */
export function decode(raw) {
  if (typeof raw !== 'string') return null;
  try {
    const msg = JSON.parse(raw);
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') return null;
    return msg;
  } catch {
    return null;
  }
}
