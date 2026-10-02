/**
 * Worker entrypoint.
 *
 *   POST /api/rooms          -> { code }   mint a new room (Durable Object)
 *                               body { sandbox: true } mints a test room (SANDBOX)
 *   GET  /api/config         -> { sandbox } which optional features are on
 *   GET  /ws?room=CODE       -> WebSocket  forwarded to that room's Durable Object
 *   anything else            -> static client (served by Workers Static Assets
 *                               before this code runs; see wrangler.toml)
 */
import { GameRoom } from './GameRoom.js';
import { ROOM_CODE_LENGTH, ROOM_CODE_ALPHABET } from '../shared/constants.js';
import { randomCode } from './game/random.js';

export { GameRoom };

const CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/** CORS is only needed if the client is hosted on a different origin (e.g. Pages). */
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes('*') || allowed.includes(origin);
  return ok
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
    : {};
}

/** Reject cross-site WebSocket connections unless the origin is allow-listed. */
function originAllowed(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return true; // non-browser clients (tests, bots) have no Origin
  const self = new URL(request.url).origin;
  if (origin === self) return true;
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim());
  return allowed.includes('*') || allowed.includes(origin);
}

function json(data, status, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    // Optional features the client can ask about via /api/config.
    const features = { sandbox: false };
    features.sandbox = String(env.ENABLE_SANDBOX ?? 'false').toLowerCase() === 'true'; // SANDBOX: test rooms

    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === '/api/config' && request.method === 'GET') {
      return json(features, 200, cors);
    }

    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const sandbox = body?.sandbox === true && features.sandbox;
      if (body?.sandbox === true && !sandbox) return json({ error: 'Test rooms are switched off on this server.' }, 403, cors);
      // Try a few codes in case of a (rare) collision with a live room.
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = randomCode(ROOM_CODE_LENGTH, ROOM_CODE_ALPHABET);
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const res = await stub.fetch('https://room/init', { method: 'POST', body: JSON.stringify({ code, sandbox }) });
        if (res.ok) return json({ code }, 201, cors);
      }
      return json({ error: 'Could not allocate a room. Try again.' }, 503, cors);
    }

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      if (!originAllowed(request, env)) return new Response('Origin not allowed', { status: 403 });
      const code = (url.searchParams.get('room') || '').toUpperCase();
      if (!CODE_PATTERN.test(code)) return new Response('Bad room code', { status: 400 });
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      return stub.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  },
};
