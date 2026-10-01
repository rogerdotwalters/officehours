/**
 * Network — WebSocket client with auto-reconnect and a tiny event emitter.
 *
 * The session token issued in WELCOME is kept in sessionStorage per room, so a
 * page refresh or a flaky connection resumes the same player on the server.
 */
import { C2S, S2C, encode, decode } from '../../shared/protocol.js';

// Close codes where retrying would not help.
const FATAL_CLOSE_CODES = new Set([4000, 4001, 4404, 4429]);
const MAX_RETRIES = 6;
const KEEPALIVE_MS = 15_000;

export class Network {
  constructor() {
    this.handlers = new Map();
    this.ws = null;
    this.code = null;
    this.name = '';
    this.retries = 0;
    this.leaving = false;
    this.keepalive = null;
  }

  // ---- Event emitter -------------------------------------------------------
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  emit(type, data) {
    for (const fn of this.handlers.get(type) || []) fn(data);
  }

  // ---- URLs ----------------------------------------------------------------
  get httpBase() {
    const configured = window.OFFICE_HOURS_CONFIG?.serverUrl;
    return (configured || location.origin).replace(/\/$/, '');
  }

  wsUrl(code) {
    const url = new URL(this.httpBase);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws';
    url.search = `?room=${encodeURIComponent(code)}`;
    return url.toString();
  }

  tokenKey(code) {
    return `office-hours:token:${code}`;
  }

  // ---- Lifecycle -----------------------------------------------------------
  async createRoom({ sandbox = false } = {}) {
    const res = await fetch(`${this.httpBase}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sandbox }), // true asks for a test room
    });
    if (!res.ok) {
      const reason = await res.json().catch(() => ({}));
      throw new Error(reason.error || 'The server could not create a room. Try again in a moment.');
    }
    const { code } = await res.json();
    return code;
  }

  connect(code, name) {
    this.code = code;
    this.name = name;
    this.leaving = false;
    this.retries = 0;
    this.open();
  }

  open() {
    const ws = new WebSocket(this.wsUrl(this.code));
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.retries = 0;
      const token = sessionStorage.getItem(this.tokenKey(this.code)) || undefined;
      this.send(C2S.JOIN, { name: this.name, token });
      clearInterval(this.keepalive);
      this.keepalive = setInterval(() => this.send(C2S.PING, { at: Date.now() }), KEEPALIVE_MS);
    });

    ws.addEventListener('message', (event) => {
      const msg = decode(event.data);
      if (!msg) return;
      if (msg.t === S2C.WELCOME) sessionStorage.setItem(this.tokenKey(this.code), msg.token);
      if (msg.t === S2C.ERROR && msg.code === 'in_progress') sessionStorage.removeItem(this.tokenKey(this.code));
      this.emit(msg.t, msg);
    });

    ws.addEventListener('close', (event) => {
      clearInterval(this.keepalive);
      if (this.ws !== ws) return; // an older socket
      this.ws = null;
      if (this.leaving) return;

      if (FATAL_CLOSE_CODES.has(event.code) || this.retries >= MAX_RETRIES) {
        this.emit('disconnected', { code: event.code, reason: event.reason });
        return;
      }
      this.retries++;
      const delay = Math.min(8000, 400 * 2 ** this.retries);
      this.emit('reconnecting', { attempt: this.retries, delay });
      setTimeout(() => !this.leaving && this.open(), delay);
    });
  }

  send(type, data = {}) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(type, data));
  }

  leave() {
    this.leaving = true;
    clearInterval(this.keepalive);
    if (this.code) sessionStorage.removeItem(this.tokenKey(this.code));
    this.ws?.close(1000, 'left');
    this.ws = null;
  }
}
