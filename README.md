# Office Hours

An office-themed social deduction game for 3 to 10 players, in the spirit of Among Us. Everyone is an office worker trying to get through the day's tasks and clock out. One of them is secretly **Management**, prowling the floor, calling surprise desk checks and sending home anyone caught away from their desk, helped by secret **snitches** who listen in on the workers' chat. You can't see around corners, nobody can talk out on the floor (only emote), and the breaker box can knock the whole office offline.

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

## Test rooms

Test rooms let you try every feature without gathering a full game. On the menu, press **Open a test room** (or, on a server where they're locked, type the code in the **Test code** box and press **Test room**). Inside one, a striped **Test tools** tab on the left edge opens a drawer with:

- **Invite someone:** the room code and an invite link (copy or share). Anyone with the link can join, even mid-match; they get a free desk and the tasks handed out so far.
- **Your role:** pick Worker, Management or Snitch before starting, or switch live during the match. There's only ever one Management; whoever had it becomes a worker.
- **Match:** start immediately (alone is fine, nobody needs to be ready), go back to the waiting room, or end the match with either side winning. Wins only happen when you ask, unless you switch **Real win rules** on.
- **Try a task:** give yourself any task from the list (puzzle tasks included), then teleport to it.
- **Workday:** hand out the next task now, hand out every task, finish your tasks, start the next break, or jump to 4:50 PM.
- **Management and meetings:** reset all cooldowns, start a desk check, call or end a meeting.
- **Move me:** teleport to any room (outside too), your desk, the fridge, the bell or the time clock; send yourself home or come back; **See everyone** ignores the sight range.
- **Dummies:** add stand-in players (they wander unless you switch that off, and don't vote) and make one post in any terminal channel or the meeting chat, so you can test reports, desk checks and chats on a single device. Open your own terminal to see their terminal posts.
- **Quick settings:** walking speed, sight range, report range and desk-check warning, adjustable mid-match.

A caution-tape stripe along the top of the screen tells you you're in a test room. Normal rooms are unaffected: the server ignores test-tool commands outside test rooms.

**On, off, or behind a code.** `ENABLE_SANDBOX` in `wrangler.toml` is `"false"` by default, so a deployed server doesn't offer test rooms to the public.
- **Locally:** `.dev.vars` (git-ignored) holds `ENABLE_SANDBOX=true`, so `npm run dev` shows the **Open a test room** button. Create the file if you cloned fresh.
- **In production, behind a code:** run `npx wrangler secret put SANDBOX_CODE` and enter a long, hard-to-guess code. The menu then shows a **Test code** box under the room code (phones included); typing the code there and pressing **Test room** opens a test room. Without the right code the server refuses. The code is only ever checked on the server.
- **For everyone:** set `ENABLE_SANDBOX = "true"` and redeploy.

**Removing it completely.** Delete `server/dev/`, `client/js/dev/` and `tests/sandbox.test.mjs`, then delete every line tagged `SANDBOX`:

```bash
grep -rn SANDBOX server client shared wrangler.toml
```

Each tagged line is self-contained (a hook, a flag or an import), so deleting them leaves the normal game intact. Run `npm test` afterwards.

## Game rules

**The waiting room.** Everyone joins a small lobby room they can walk around in. The folder panel has three tabs: People (who's here and ready), House rules (the settings) and Chat. The host adjusts the house rules with the minus and plus buttons; everyone else sees them update live.

**The office.** A two-row building with four offices where the desks are (Open Office A, Open Office B, the Design Studio and Accounting), a Conference Room with the all-hands bell, the Manager's Office, a Break Room, Restrooms, the Lobby with the time clock, and a Mail & Copy Room. The front doors lead out from the Lobby to the patio and lawn; a back door opens onto the parking lot. Tasks happen in all of them, outside included.

**Roles.** When the host starts, one player is secretly **Management**, a number of others (set in house rules) are secretly **snitches**, and everyone else is a **worker**. Each player gets a desk with their nameplate. Roles are revealed privately in an HR memo; Management and snitches are told who each other are and see a red badge over each other's heads.

**The workday.** The day runs from 9:00 to 5:00 on the punch clock at the top of the screen. Its length and the number of tasks are house rules, and the day is split into equal sections, one per task: at the start of each section everyone is handed one new task, picked at random according to each task's chance. The clock pauses during all-hands meetings. Walk up to the right object and hold the interaction to do a task; walking away cancels it.

**Breaks.** The day has up to three scheduled breaks (a house rule): a coffee break at 10:30, lunch at noon and an afternoon break at 3:00. They show as green bands on the punch clock. During a break:
- anyone in the Break Room or anywhere outside is safe from reports, and those areas glow green on the map
- Management can't call a desk check (or start one that would still be running when a break begins)
- break tasks, like eating lunch in the break room or on the patio, can be done. Before a break they wait; if the day has no breaks left, they can be done any time.

**Task windows.** Some tasks open a little puzzle instead of a hold-to-finish bar. The first one is the fridge: your lunchbox and smoothie have to fit into a fridge already packed with your coworkers' food. Pick an item, rotate it (button, R or right-click) and place it; the marked square lands where you click or tap. Close the door when everything fits. The server generates each puzzle and checks your answer (any packing that fits counts). Walking away, or pressing Esc, cancels the task.

**Workers** finish their tasks and, once the last one of the day is done, clock out at the **time clock in the Lobby**. Clocked-out workers are safe.

**Management** has a fake "cover story" to-do list so the screen looks the same as everyone else's, and two ways to send people home:
- **Report:** catch someone within report range who is **not at their own desk**. Has a cooldown.
- **Desk check:** announces a countdown to everyone. When it hits zero, anyone (worker or snitch) who isn't at their own desk is sent home. Has its own cooldown, and the countdown length is a house rule.

**Snitches** work exactly like workers (they get tasks and must survive desk checks), but they're on Management's side, can't clock out, and win when Management wins.

**Talking.** Out on the floor nobody talks. You can only **emote** (keys 1 to 8, or the emote bar): wave, yes, no, look, what?, watch out, shh, ha. Only people who can see you notice.

To actually talk, sit at your own desk and open your **desk terminal** (T). It needs wifi, closes when you get up, and has channels:
- *#general:* everyone, Management included.
- *Water cooler:* workers and snitches. Management can't see it.
- *Back office:* Management and snitches (B opens the terminal straight on it).

Lines arrive live only on open terminals; when you sit down and open yours you get the recent history of every channel you can read. Snitches read and post in both private channels, so they can spy on the workers and report back.

Face to face, everyone can talk in the waiting room, at all-hands meetings and after the game.

**Sight.** You can only see other players within the sight range (a house rule) **and** in your line of sight: walls block vision, so you can't see around corners or into a room until you're looking through its door. Desks and furniture are low enough to look over, and outdoors there are no walls. Everything else is in fog. The server doesn't even send positions you can't see, so the fog can't be hacked away. Management also needs a clear line of sight to report someone. Players who are out of the office can watch anyone.

**Breaker box and wifi.** The breaker box sits at the dead end of the west hallway, between the Restrooms and the Lobby. Anyone can hold it for 3 s to cut the power, which kills the wifi for 30 s:
- nobody can be reported, and desk checks can't be called (one already counting down is called off), so everyone can leave their desk safely
- every desk terminal goes offline
- anyone can hold the breaker again to restore the power early: that's Management's counter, at the risk of being seen doing it

Once the wifi is back the breaker is stuck for 45 s (and for the first 20 s of the day). Calling a meeting resets it.

**Social meter.** Every away-from-desk task a real worker finishes while the wifi is down fills the team's shared social meter (desk tasks and Management's and snitches' tasks don't count). The goal is 1.5 tasks per real worker (minimum 3). A full meter wins the game for the workers.

**Emergency meetings.** Any player in the office can ring the bell on the conference table (once per game each, with a cooldown). Everyone is pulled into the Conference Room to talk and vote. The player with the most votes is ejected and their role is revealed; a tie or a skip majority ejects nobody. Everyone then returns to their desk.

**Winning.**
- **Workers win** when at least half of the real workers (rounded up) have clocked out, when the social meter fills up, or when Management is voted out or leaves.
- **Management (and the snitches) win** when it becomes impossible for enough workers to clock out, or when 5:00 arrives first.

### House rules

| Setting | Range | Default |
| --- | --- | --- |
| Tasks per person | 3 to 10 | 6 |
| Workday length | 3 to 15 min | 6 min |
| Breaks | none, lunch, lunch and afternoon, or all three | all three |
| Walking speed | 0.6x to 1.5x | 1.0x |
| Sight range | 4 to 18 m | 9 m |
| Snitches | 0 to 3 (always leaves at least 2 real workers) | 1 |
| Report range | 2 to 8 m | 4 m |
| Report cooldown | 10 to 60 s | 25 s |
| Desk check warning | 8 to 40 s | 15 s |
| Desk check cooldown | 30 to 240 s | 90 s |

All of these live in `shared/settings.js`, with labels, ranges and help text; the server clamps every value.

## Controls

| Action | Keyboard / mouse | Phone / tablet |
| --- | --- | --- |
| Move | WASD or arrow keys | Joystick, bottom left |
| Use / interact | E or Space, or click the object | Use button, bottom right |
| Stop a task | Esc or Q, or walk away | Walk away |
| Report (Management) | R, or click the player | Report button |
| Desk check (Management) | F | Desk check button |
| Desk terminal (at your own desk) | T, Esc to close | Terminal button |
| Desk terminal, back office channel (Management, snitches) | B | Terminal button, then the Back office tab |
| Emote | 1 to 8 | Emote bar, bottom middle |
| Watch someone else (when out) | E | Watch button |
| Rotate an item (task window) | R or right-click | Rotate button |
| Leave a task window | Esc | Walk away button |

On phones, the lobby folder becomes a bottom sheet (portrait) or a side panel (landscape), and the to-do note starts collapsed: tap it to open.

## Architecture

```
office-hours/
├── client/                   Static client (copied to dist/)
│   ├── index.html            Screens: menu, lobby, game; overlays: role, meeting, game over
│   ├── styles.css
│   ├── config.js             serverUrl for split hosting (Option B)
│   └── js/
│       ├── main.js           Glue: wires Network, ClientGame, Input, Renderer, UI; game loop
│       ├── minigames/        Task window and each puzzle's UI (fridge.js)
│       ├── dev/              Test tools drawer and its stylesheet (removable)
│       ├── net/Network.js    WebSocket client, reconnect, ping, message dispatch
│       ├── game/ClientGame.js  Client-side state, local prediction + reconciliation, interpolation
│       ├── input/Input.js    Keyboard, mouse click-to-interact, touch joystick
│       ├── render/Renderer.js  Canvas camera, players, highlights, desk zones
│       ├── render/officeArt.js Floors, walls, labels, furniture drawers
│       ├── render/Minimap.js
│       └── ui/UI.js          DOM UI: lobby, task list, role reveal, meeting, win/lose
├── server/
│   ├── worker.js             HTTP entry: POST /api/rooms, GET /api/config, GET /ws?room=CODE, CORS/origin checks
│   ├── dev/Sandbox.js        Test rooms and test-tool commands (removable)
│   ├── GameRoom.js           Durable Object: sockets, sessions, rate limiting, tick loop, cleanup
│   ├── net/RateLimiter.js    Token buckets per message type + global flood control
│   └── game/                 Pure game logic (no Cloudflare APIs, unit-testable in Node)
│       ├── Game.js           Phases, lobby room, workday clock, desk checks, breaker/wifi, terminal channels, emotes, sight, win checks
│       ├── Player.js
│       ├── TaskSystem.js     Weighted task draws, timed holds, completion validation
│       ├── RoleSystem.js     Management, snitches, desks, report validation
│       ├── MeetingSystem.js  Emergency meetings and votes
│       └── random.js         crypto-based randomness (codes, tokens, shuffles)
├── shared/                   Imported by BOTH server and client
│   ├── constants.js          Tunables and enums
│   ├── protocol.js           Message types and encoding
│   ├── settings.js           House rules: ranges, defaults, labels, validation
│   ├── officeMap.js          The office as pure data
│   ├── lobbyMap.js           The walkable waiting room
│   ├── mapBuilder.js         Turns the data into walls, colliders, seats, lookups
│   ├── physics.js            Deterministic movement + collision
│   ├── tasks.js              Task catalogue with chance weights
│   ├── breaks.js             Break schedule and helpers
│   ├── vision.js             Line of sight and the fog-of-war visibility polygon
│   ├── emotes.js             The in-person emote list
│   └── minigames/            Task-window puzzles: generate, check (shared by server and client)
├── scripts/build.mjs         client/ → dist/, shared/ → dist/shared/
├── tests/game.test.mjs
└── wrangler.toml
```

**Authority.** Clients only send intents: a movement direction, "interact with object X", "report player Y", a vote, a chat line. The server runs the simulation at 20 ticks per second using the same `shared/physics.js` and map the client uses, validates everything, and broadcasts results. Roles, task lists and cooldowns are sent only to the player they belong to. Each player's snapshot contains only the players within their sight range and line of sight, carrying just position and two public flags (busy, at desk); emotes follow the same rule. Terminal lines are only ever sent to open terminals of players allowed to read that channel.

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
| `chat` | `text, channel` | `all` (lobby, meetings, after the game); `general`, `crew` (water cooler), `team` (back office) need your desk terminal open |
| `term` | `open` | Open/close your desk terminal. Server checks you're at your desk and the wifi is up |
| `emote` | `id` | In-person reaction (shared/emotes.js); sent only to players who can see you |
| `settings` | `settings` | Host only, lobby only; clamped by the server |
| `deskcheck` | | Management only; cooldown and break rules checked |
| `minigame` | `answer` | Solution for your open task window; checked by the server |
| `dev` | `cmd, ...` | Test tools; ignored outside test rooms |
| `lobby` | | Host only, return to lobby after game over |
| `ping` | `at` | Latency |

| Server → client | Contents |
| --- | --- |
| `welcome` | Your player id, session token, room code |
| `room` | Public roster, phase, house rules, workday clock, desk check countdown, wifi state, social meter |
| `start` | Game started, freeze duration |
| `snap` | Positions and public flags for the players you can see (20/s) |
| `self` | Private: role, teammates (Management/snitches only), desk, tasks, cooldowns |
| `event` | Feed items (sent home, clocked out, meeting, desk check, breaks, your new task) |
| `meeting` | Meeting state; who has voted is public, the tally only at the end |
| `term` | Your desk terminal opened (backlogs follow as `chat`) or closed, with a reason |
| `emote` | Someone you can see emoted |
| `chat`, `toast`, `error`, `pong` | |
| `over` | Winner, reason, who Management and the snitches were |

### Security measures

- Server decides roles, task lists, task completion (timed on the server; the player must stay in range), report validity, votes and win conditions.
- Movement is simulated on the server from direction inputs only, so speed hacks and wall clipping are impossible; positions are never accepted from clients.
- Per-socket token-bucket rate limits per message type, with a global flood limit that disconnects abusers. Oversized messages are dropped. Reports and meetings have server-side cooldowns.
- Anonymous sessions: the server issues a random token on join, stored in the tab's `sessionStorage`, used to reconnect to the same seat (45 s grace in a game). A second connection with the same token replaces the first.
- Names and chat are length-limited and rendered as text, never HTML.
- WebSocket origin check and opt-in CORS for split hosting.

## Extending the office

**Add or rearrange rooms.** Everything lives in `shared/officeMap.js`. Add a rectangle to `rooms` with `doors` on any side; walls and door gaps are generated automatically. Outdoor areas use `open: true` (no walls); the building's outer walls and front/back doors are the `hall` room. Floor styles are named in `client/js/render/officeArt.js`. Run `npm test`: one test flood-fills the map to make sure every desk and interactable is still reachable.

**Add a task.** Tasks live in `shared/tasks.js`. Each one has a `chance`, a relative weight: a task with chance 10 comes up five times as often as one with chance 2, and chance 0 switches it off. Players never get the same task twice in a match while the list lasts.
1. If it needs a new object, add it to `interactables` in `shared/officeMap.js` with a new `type`, e.g. `{ id: 'vending_1', type: 'vending', label: 'Vending machine', x, y, w, h, solid: true }`.
2. Add the task: `{ id: 'snack', label: 'Buy a snack', target: 'vending', duration: 3000, chance: 5 }`, and a `TARGET_HINT` entry saying where it is.
3. Optionally add a drawer for `vending` in `client/js/render/officeArt.js`; unknown types fall back to a labelled box.

The server picks it up automatically. Tasks with chance 2 or less are tagged "rare" in the to-do list, 3 to 4 "uncommon".

**Add a task window (mini-game).**
1. Add `shared/minigames/<name>.js` with `generate(rand)` (may include the answer), `publicView(puzzle)` (what the client sees) and `check(puzzle, answer)`, and register it in `shared/minigames/index.js`.
2. Add `client/js/minigames/<name>.js` exporting a `mount(root, puzzle, { submit, isTouch })` function, and register it in `UIS` in `client/js/minigames/TaskWindow.js`.
3. Give a task `minigame: '<name>'` in `shared/tasks.js`.

**Breaks.** Times live in `shared/breaks.js`; which rooms count as safe is the `breakArea` flag on rooms in `shared/officeMap.js`.

**Add a house rule.** Add an entry to `SETTINGS_SPEC` in `shared/settings.js` (label, group, min, max, step, default, format). It appears in the lobby automatically; read it on the server from `game.match`.

**Change the waiting room.** It's `shared/lobbyMap.js`, same format as the office plus `spawnPoints`.

**Tuning.** Room size, freeze times, meeting length, the clock-out ratio, breaker/wifi timings and the social meter goal are in `shared/constants.js`.

**Ideas for later.** WebSocket hibernation for idle rooms, sabotage events (printer jam, fire drill), sprite art, sound.
