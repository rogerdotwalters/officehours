# Office Hours

An office-themed social deduction game for 3 to 10 players, in the spirit of Among Us. Everyone is an office worker trying to finish their to-do list and clock out. One of them is secretly **Management**, prowling the floor and writing up anyone caught away from their desk.

Pure HTML, CSS and vanilla JavaScript on the client (HTML5 Canvas, native ES modules, no bundler). The server is a Cloudflare Worker with one Durable Object per room, talking to clients over WebSockets. The server is fully authoritative.

---

## Run it locally

Requirements: Node.js 18+ (20+ recommended).

```bash
npm install          # installs wrangler (the only dependency)
npm run dev          # builds dist/ and starts wrangler dev on http://localhost:8787
```

Open **three browser tabs** (the minimum player count is 3). In the first tab choose a name and press *Create room*; in the others enter the 5-letter room code and press *Join*. You can also share a link like `http://localhost:8787/?room=ABCDE`. Non-host players press *I'm ready*, then the host starts the workday.

Tip: normal tabs in the same browser work fine, since each tab keeps its own session in `sessionStorage`.

Run the server-side test suite (no Cloudflare needed, it drives the game logic directly):

```bash
npm test
```

## Deploy to Cloudflare

### Option A: one Worker (recommended)

The Worker serves the static client through Workers Static Assets and handles `/api/rooms` and `/ws` itself, so everything lives on one origin.

```bash
npx wrangler login
npm run deploy
```

That's it. Wrangler creates the `GameRoom` Durable Object class (SQLite-backed, which is available on the free plan) using the migration in `wrangler.toml`, and prints your `*.workers.dev` URL.

### Option A2: auto-deploy from GitHub (Workers Builds)

Push this repo to GitHub, then in the Cloudflare dashboard go to **Workers & Pages → Create → Import a repository**, pick the repo and use:

- **Build command:** `npm run build`
- **Deploy command:** `npx wrangler deploy`
- **Root directory:** `/` (leave default)

The Worker name in the dashboard must match `name` in `wrangler.toml` (`office-hours`). Every push to `main` then rebuilds and redeploys. `dist/` is git-ignored on purpose; the build command recreates it.

### Option B: client on Cloudflare Pages, server on a Worker

If you prefer to host the static client on Pages:

1. Deploy the Worker as in Option A and note its URL, e.g. `https://office-hours.you.workers.dev`.
2. Edit `client/config.js` and set `serverUrl` to that URL.
3. In `wrangler.toml` set `ALLOWED_ORIGINS` to your Pages origin (e.g. `"https://office-hours.pages.dev"`) and redeploy the Worker (`npm run deploy`). This enables CORS for room creation and lets the Worker accept WebSocket connections from that origin.
4. Publish the client: `npm run deploy:pages` (uploads `dist/` to a Pages project called `office-hours`), or connect the repo in the Pages dashboard with build command `npm run build` and output directory `dist`.

## Game rules

**Setup.** When the host starts, one player is secretly chosen as Management; everyone else is a worker. Each player gets a colour, a name tag and a personal desk (marked with their nameplate). Roles are revealed privately in an HR memo. Nobody can move for the first few seconds.

**Workers** get a to-do list of 5 tasks: one at their own desk (answer emails, file a TPS report) and four around the office (water cooler, coffee machine, microwave, lunch table, fridge, toilet, sink, the lobby ficus, printer, mailbox, supply cabinet, shredder). Walk up to the object and hold the interaction; if you walk away the task is cancelled. When the list is done, go to the **time clock in the Lobby** and clock out. Clocked-out workers are safe and leave the floor.

**Management** gets a fake "cover story" to-do list so the screen looks the same as everyone else's, and a **Report** button. Management can report any worker who is within reporting range and **not at their own desk**. The reported worker is sent home (eliminated). Reports have a cooldown, so Management has to pick moments carefully. Being at your desk is always safe, and everyone can see whose desk is occupied.

**Line of sight.** You only see colleagues who are in your line of sight and within view distance. Walls block vision (desks and furniture don't), so you can't see around corners or into a room until you're looking through its door. Everything outside your view is covered by fog. This is enforced on the server: you never receive the position of anyone you can't see. Management also needs a clear line of sight to report someone. Spectators (clocked out or sent home) see the whole floor.

**Breaker box and wifi.** The breaker box sits at the dead end of the east hallway, next to the Mail & Copy Room. Anyone can hold the interaction for 3 s to cut the power, which kills the office wifi for 30 s. While the wifi is down, Management can't file reports, so everyone can leave their desk safely. Anyone can also hold the breaker again to restore the power early. That is Management's counter, at the risk of being seen doing it. Once the wifi is back, the breaker is stuck for 45 s, and also for the first 20 s of the day. Calling a meeting resets the breaker.

**Social meter.** Every away-from-desk task a worker finishes while the wifi is down fills the team's shared social meter (desk tasks and Management's cover-story tasks don't count). The goal is 1.5 tasks per worker (minimum 3). A full meter wins the game for the workers.

**Desk terminal.** Outside meetings, the only way to talk is the terminal on your own desk. Sit at your desk and press T (or the *Open terminal* button) to join the office chat room. The terminal needs wifi, closes when you get up, and only receives messages live while it's open; you get the recent backlog when you sit back down. Management has a desk and terminal too.

**Emergency meetings.** Any active player can ring the bell on the conference table (once per game each, with a cooldown after the start and after every meeting). Everyone is pulled into the Conference Room to chat and vote. The player with the most votes is ejected and their role is revealed; a tie or a skip majority ejects nobody. Afterwards everyone is returned to their desks.

**Winning.**
- **Workers win** when at least half of the workers (rounded up) have clocked out, when the social meter fills up, or when Management is voted out or leaves.
- **Management wins** when it becomes impossible for enough workers to clock out, i.e. too many have been sent home or ejected.

## Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Move | WASD or arrow keys | On-screen joystick |
| Use / interact | E or Space, or click the object | *Use* button, or tap the object |
| Stop a task | Esc or Q, or just walk away | Walk away |
| Report (Management) | R, or the Report button | Report button |
| Desk terminal (at your desk) | T, or the terminal button; Esc to close | Terminal button |

The minimap in the corner shows you, your desk and where your remaining tasks are.

## Architecture

```
office-hours/
├── client/                   Static client (copied to dist/)
│   ├── index.html            Screens: menu, lobby, game; overlays: role, meeting, game over
│   ├── styles.css
│   ├── config.js             serverUrl for split hosting (Option B)
│   └── js/
│       ├── main.js           Glue: wires Network, ClientGame, Input, Renderer, UI; game loop
│       ├── net/Network.js    WebSocket client, reconnect, ping, message dispatch
│       ├── game/ClientGame.js  Client-side state, local prediction + reconciliation, interpolation
│       ├── input/Input.js    Keyboard, mouse click-to-interact, touch joystick
│       ├── render/Renderer.js  Canvas camera, players, highlights, desk zones
│       ├── render/officeArt.js Floors, walls, labels, furniture drawers
│       ├── render/Minimap.js
│       └── ui/UI.js          DOM UI: lobby, task list, role reveal, meeting, win/lose
├── server/
│   ├── worker.js             HTTP entry: POST /api/rooms, GET /ws?room=CODE, CORS/origin checks
│   ├── GameRoom.js           Durable Object: sockets, sessions, rate limiting, tick loop, cleanup
│   ├── net/RateLimiter.js    Token buckets per message type + global flood control
│   └── game/                 Pure game logic (no Cloudflare APIs, unit-testable in Node)
│       ├── Game.js           Phases, lobby, movement, interactions, reports, win checks, snapshots
│       ├── Player.js
│       ├── TaskSystem.js     Task assignment, timed holds, completion validation
│       ├── RoleSystem.js     Secret role assignment and per-player views
│       ├── MeetingSystem.js  Emergency meetings and votes
│       └── random.js         crypto-based randomness (codes, tokens, shuffles)
├── shared/                   Imported by BOTH server and client
│   ├── constants.js          Tunables and enums
│   ├── protocol.js           Message types and encoding
│   ├── officeMap.js          The office as pure data
│   ├── mapBuilder.js         Turns the data into walls, colliders, seats, lookups
│   ├── physics.js            Deterministic movement + collision
│   ├── tasks.js              Task catalogue (+ timed actions like the breaker)
│   └── vision.js             Line of sight and the fog-of-war visibility polygon
├── scripts/build.mjs         client/ → dist/, shared/ → dist/shared/
├── tests/game.test.mjs
└── wrangler.toml
```

**Authority.** Clients only send intents: a movement direction, "interact with object X", "report player Y", a vote, a chat line. The server runs the simulation at 20 ticks per second using the same `shared/physics.js` and map the client uses, validates everything, and broadcasts results. Roles, task lists and cooldowns are sent only to the player they belong to. Snapshots are built per player and only include colleagues in that player's line of sight, each with just a position and two public flags (busy, at desk).

**Smooth movement.** The local player is predicted immediately with the shared physics and gently corrected toward the server position. Remote players are rendered about 110 ms in the past and interpolated between snapshots.

**Rooms.** Each room code maps to one Durable Object (`idFromName(code)`), so all players in a room hit the same instance. Rooms are created only through `POST /api/rooms`; connecting to an unknown code is rejected. Empty rooms clean up their storage after 30 minutes.

### Protocol

JSON messages of the form `{ "t": type, ...fields }`.

| Client → server | Payload | Notes |
| --- | --- | --- |
| `join` | `name, token?` | Must be the first message. A valid token resumes your seat. |
| `ready` | `ready` | Lobby only |
| `start` | | Host only, all non-hosts ready, 3+ players |
| `input` | `dx, dy` | Each in {-1, 0, 1} |
| `interact` | `objectId` | Server checks range, phase, task list |
| `cancel` | | Stop the current task |
| `report` | `targetId` | Management only; range, desk and cooldown checked |
| `vote` | `targetId` or `"skip"` | During meetings |
| `chat` | `text` | Lobby, meetings and after the game; during play it goes to the desk terminal (must be open) |
| `term` | `open` | Open/close your desk terminal. Server checks you're at your desk and the wifi is up |
| `lobby` | | Host only, return to lobby after game over |
| `ping` | `at` | Latency |

| Server → client | Contents |
| --- | --- |
| `welcome` | Your player id, session token, room code |
| `room` | Public roster, phase, progress (clock-outs, social meter) and wifi state |
| `start` | Game started, freeze duration |
| `snap` | Positions and public flags for the players you can see (20/s) |
| `term` | Desk terminal: `open`, `backlog` on open, new `line`s, or a close `reason` |
| `self` | Private: role, desk, tasks, current task, cooldowns |
| `event` | Feed items (someone was sent home, clocked out, meeting called) |
| `meeting` | Meeting state; who has voted is public, the tally only at the end |
| `chat`, `toast`, `error`, `pong` | |
| `over` | Winner, reason, who Management was |

### Security measures

- Server decides roles, task lists, task completion (timed on the server; the player must stay in range), report validity, votes and win conditions.
- Movement is simulated on the server from direction inputs only, so speed hacks and wall clipping are impossible; positions are never accepted from clients.
- Per-socket token-bucket rate limits per message type, with a global flood limit that disconnects abusers. Oversized messages are dropped. Reports and meetings have server-side cooldowns.
- Anonymous sessions: the server issues a random token on join, stored in the tab's `sessionStorage`, used to reconnect to the same seat (45 s grace in a game). A second connection with the same token replaces the first.
- Names and chat are length-limited and rendered as text, never HTML.
- WebSocket origin check and opt-in CORS for split hosting.

## Extending the office

**Add or rearrange rooms.** Everything lives in `shared/officeMap.js`. Add a rectangle to `rooms` with `doors` on any side; walls and door gaps are generated automatically. Floor styles are named in `client/js/render/officeArt.js`. Run `npm test`: one test flood-fills the map to make sure every desk and interactable is still reachable.

**Add an interactable and a task.**
1. Add the object to `interactables` in `shared/officeMap.js` with a new `type`, e.g. `{ id: 'vending_1', type: 'vending', x, y, w, h }`.
2. Add a task in `shared/tasks.js`: `{ id: 'snack', label: 'Buy a snack', target: 'vending', duration: 3000 }` and a hint for `TARGET_HINT`.
3. Optionally add a drawer for `vending` in `officeArt.js`; unknown types fall back to a labelled box.

The server picks it up automatically for task assignment and validation.

**Tuning.** Player counts, speeds, ranges, vision distance, breaker/wifi timings, the social meter goal, cooldowns, meeting length and the clock-out ratio are all in `shared/constants.js`.

**Ideas for later.** WebSocket hibernation for idle rooms, sabotage events (printer jam, fire drill), sprite art, spectator mode for eliminated players, sound.
