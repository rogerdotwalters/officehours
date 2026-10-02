/**
 * GameRoom — one Durable Object instance per room code.
 *
 * Responsibilities (transport only; rules live in game/Game.js):
 *   - accept WebSockets, bind each socket to a player after a JOIN message
 *   - size-check, parse and rate-limit every incoming frame
 *   - route intents to Game, fan Game's outgoing messages to sockets
 *   - run the fixed-rate simulation tick while anyone is connected
 *   - clean up storage when the room has been empty for a while
 */
import { Game } from './game/Game.js';
import { handleDevCommand } from './dev/Sandbox.js'; // SANDBOX
import { RateLimiter } from './net/RateLimiter.js';
import { C2S, S2C, encode, decode } from '../shared/protocol.js';
import { TICK_MS, MAX_MESSAGE_BYTES } from '../shared/constants.js';

const CHAT_CHANNELS = new Set(['all', 'team', 'crew']);

const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000;
const MAX_FLOOD_STRIKES = 20;

export class GameRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.game = null;           // created lazily once we know the room code
    this.sockets = new Map();   // playerId -> WebSocket
    this.interval = null;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Internal: called by the Worker when a room code is minted.
    if (url.pathname === '/init' && request.method === 'POST') {
      if (await this.ctx.storage.get('code')) return new Response('exists', { status: 409 });
      const { code, sandbox } = await request.json();
      await this.ctx.storage.put('code', code);
      if (sandbox) await this.ctx.storage.put('sandbox', true); // SANDBOX
      await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_TTL_MS);
      return new Response('ok');
    }

    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const code = await this.ctx.storage.get('code');
    if (!code) {
      // Accept then close with a reason so the browser can show a useful message.
      server.send(encode(S2C.ERROR, { code: 'not_found', message: 'No room with that code.' }));
      server.close(4404, 'Room not found');
      return new Response(null, { status: 101, webSocket: client });
    }

    if (!this.game) this.game = this.createGame(code);
    if (await this.ctx.storage.get('sandbox')) this.game.sandbox = true; // SANDBOX: test room flag
    this.attach(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  createGame(code) {
    return new Game({
      code,
      send: (playerId, type, data) => this.sendTo(playerId, encode(type, data)),
      broadcast: (type, data) => {
        const frame = encode(type, data);
        for (const id of this.sockets.keys()) this.sendTo(id, frame);
      },
    });
  }

  sendTo(playerId, frame) {
    const ws = this.sockets.get(playerId);
    if (!ws) return;
    try {
      ws.send(frame);
    } catch {
      // Socket already closing; the close handler will clean up.
    }
  }

  /** Wire up one socket. It must send JOIN before anything else is accepted. */
  attach(ws) {
    const conn = { playerId: null, limiter: new RateLimiter(), strikes: 0 };

    ws.addEventListener('message', (event) => {
      const now = Date.now();
      const raw = typeof event.data === 'string' ? event.data : '';
      if (!raw || raw.length > MAX_MESSAGE_BYTES) return;
      const msg = decode(raw);
      if (!msg) return;

      const verdict = conn.limiter.check(msg.t, now);
      if (verdict === 'flood' && ++conn.strikes > MAX_FLOOD_STRIKES) {
        ws.close(4429, 'Too many messages');
        return;
      }
      if (verdict !== 'ok') return;

      if (!conn.playerId) {
        if (msg.t === C2S.JOIN) this.handleJoin(ws, conn, msg, now);
        return;
      }

      const player = this.game.players.get(conn.playerId);
      if (!player || this.sockets.get(player.id) !== ws) return; // superseded by a newer tab
      this.dispatch(player, msg, now);
    });

    const onClose = () => {
      if (!conn.playerId) return;
      // Only mark disconnected if this socket is still the player's current one.
      if (this.sockets.get(conn.playerId) === ws) {
        this.sockets.delete(conn.playerId);
        this.game.onDisconnect(conn.playerId, Date.now());
      }
      if (this.sockets.size === 0) this.stopTicking();
    };
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', onClose);
  }

  handleJoin(ws, conn, msg, now) {
    const result = this.game.join(msg.name, msg.token, now);
    if (result.error) {
      ws.send(encode(S2C.ERROR, result.error));
      ws.close(4000, result.error.code);
      return;
    }
    const { player } = result;

    // Same player opened a second tab / reconnected: retire the old socket.
    const old = this.sockets.get(player.id);
    if (old && old !== ws) {
      try { old.close(4001, 'Replaced by a newer connection'); } catch { /* already closed */ }
    }

    conn.playerId = player.id;
    this.sockets.set(player.id, ws);
    ws.send(encode(S2C.WELCOME, { playerId: player.id, token: player.token, code: this.game.code }));
    this.game.sendFullState(player, now);
    this.game.broadcastRoom();
    this.startTicking();
  }

  /** Route a validated-shape message to the game. Game re-validates the content. */
  dispatch(player, msg, now) {
    const g = this.game;
    switch (msg.t) {
      case C2S.READY:           return g.handleReady(player, msg.ready);
      case C2S.START:           return g.handleStart(player, now);
      case C2S.INPUT:           return g.handleInput(player, msg.dx, msg.dy);
      case C2S.INTERACT:        return g.handleInteract(player, msg.objectId, now);
      case C2S.CANCEL:          return g.handleCancel(player);
      case C2S.VOTE:            return g.handleVote(player, msg.targetId, now);
      case C2S.CHAT:            return g.handleChat(player, msg.text, CHAT_CHANNELS.has(msg.channel) ? msg.channel : 'all', now);
      case C2S.SETTINGS:        return g.handleSettings(player, msg.settings);
      case C2S.MINIGAME:        return g.handleMinigame(player, msg.answer, now);
      case C2S.HR_REPORT:       return g.handleHrReport(player, msg.targetId, now);
      case C2S.EMOTE:           return g.handleEmote(player, msg.emote);
      case C2S.WB_INK:          return g.handleWhiteboardInk(player, msg.ink, now);
      case C2S.DEV:             return g.sandbox && handleDevCommand(g, player, msg, now); // SANDBOX
      case C2S.RETURN_TO_LOBBY: return g.handleReturnToLobby(player);
      case C2S.PING:            return this.sendTo(player.id, encode(S2C.PONG, { at: Number(msg.at) || 0 }));
      default:                  return; // unknown types are ignored
    }
  }

  startTicking() {
    if (this.interval) return;
    this.interval = setInterval(() => {
      try {
        this.game.tick(Date.now());
      } catch (err) {
        console.error('tick failed', err);
      }
    }, TICK_MS);
  }

  stopTicking() {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = null;
    // Refresh the cleanup alarm now that the room is empty.
    this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_TTL_MS);
  }

  /** Room has been idle: forget it so the code can be reused. */
  async alarm() {
    if (this.sockets.size > 0) {
      await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_TTL_MS);
      return;
    }
    await this.ctx.storage.deleteAll();
    this.game = null;
  }
}
