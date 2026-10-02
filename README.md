# Office Hours

An office shenanigans social deduction game for 3 to 10 players, in the spirit of Among Us. Nobody here is being productive: everyone is sneaking through a day of microwaving fish, photocopying nonsense and doodling on the conference whiteboard, then clocking out. One of them is secretly **Management**, prowling the floor, calling surprise stand-up meetings and **firing** anyone caught slacking away from their desk, helped by secret **snitches** who listen in on the workers' chat. Suspect a snitch? Take it to HR, but if you're wrong, HR fires you.

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

Test rooms let you try every feature without gathering a full game. On the menu, press **Open a test room**. Inside one, a striped **Test tools** tab on the left edge opens a drawer with:

- **Invite someone:** the room code and an invite link (copy or share). Anyone with the link can join, even mid-match; they get a free desk and the tasks handed out so far.
- **Your role:** pick Worker, Management or Snitch before starting, or switch live during the match. There's only ever one Management; whoever had it becomes a worker.
- **Match:** start immediately (alone is fine, nobody needs to be ready), go back to the waiting room, or end the match with either side winning. Wins only happen when you ask, unless you switch **Real win rules** on.
- **Try a task:** give yourself any task from the list (puzzle tasks included), then teleport to it.
- **Workday:** hand out the next task now, hand out every task, finish your tasks, start the next break, or jump to 4:50 PM.
- **Management and meetings:** reset all cooldowns, start a stand-up meeting, call or end an all-hands meeting.
- **Move me:** teleport to any room (outside too), your desk, any puzzle task (fridge, microwave, cat bowl, recycling, copier, whiteboard, toilet, coffee machine), the HR box, the bell or the time clock; send yourself home or come back; **See everyone** ignores the sight range.
- **Dummies:** add stand-in players, handy for testing firing, stand-ups and HR complaints (they wander unless you switch that off, and don't vote) and make one post in any chat, so you can test reports, desk checks and chats on a single device.
- **Quick settings:** walking speed, sight range, report range and desk-check warning, adjustable mid-match.

A caution-tape stripe along the top of the screen tells you you're in a test room. Normal rooms are unaffected: the server ignores test-tool commands outside test rooms.

**Switching it off.** Set `ENABLE_SANDBOX = "false"` in `wrangler.toml` and redeploy. The menu button disappears and the server refuses to create test rooms. You may want this before a public launch.

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
- nobody in the Break Room or anywhere outside can be fired, and those areas glow green on the map
- Management can't call a stand-up meeting (or start one that would still be running when a break begins)
- break tasks, like eating lunch in the break room or on the patio, can be done. Before a break they wait; if the day has no breaks left, they can be done any time.

**Task windows.** Some tasks open a little game instead of a hold-to-finish bar. The server generates each one and checks the answer, and refuses answers that come back impossibly fast. Walking away, or pressing Esc, cancels the task.

- **Squeeze your lunch into the fridge.** The fridge is already full of coworkers' food (pictures from the item table). Drag their food around (slide it together, tuck things into each other's gaps, stack them) until your lunchbox and smoothie fit, then close the door. Collision follows each picture's solid pixels, not its rectangle: the outline you see while dragging is the traced shape, green where it fits and red where it doesn't, and dropped items settle down onto a shelf or onto other food.
- **Reheat fish in the microwave.** Drag the food into the microwave, type the time from its sticky note on the keypad, press Start.
- **Delete the chain emails** (at your desk). Three to five pieces of office nonsense: open each one, read it, delete it.
- **Photocopy something ridiculous.** Drag each document from the stack onto the copier glass and press Copy: a petition to replace the stairs with a slide, Gary's fourth self-nomination for Employee of the Month, and so on. The copier always jams once (PC LOAD LETTER).
- **Clog the toilet (on purpose).** Drag everything you found around the office into the bowl (a rubber duck, Gary's stapler, a whole pineapple, a rubber chicken, the World's Okayest Boss mug...), then flush. Then leave very quickly.
- **Make dangerously strong coffee.** Scoop grounds from the canister into the filter, exactly as many times as the sticky-note recipe says (Gary's calls for six), then press Brew.
- **Doodle on the conference whiteboard.** Trace a dotted drawing with the marker: Bob from Accounting as a potato, the Q3 strategy (line go up), our new CEO (a cat in a tie), an org chart where every box is Gary, the coffee machine's feelings, or the fire evacuation plan (snacks first). It counts when most of the outline is traced, every part of it at least mostly, without scribbling all over the board. The server re-scores your drawing with the same rules.
- **Feed the office cat.** Dip the spoon into the can to scoop, tip it into Mittens' bowl, repeat until the bowl is full.
- **Take out the recycling.** Drag everything from the box into the blue bin.

**Workers** finish their tasks and, once the last one of the day is done, clock out at the **time clock in the Lobby**. Clocked-out workers are safe.

**Management** has a fake "cover story" to-do list so the screen looks the same as everyone else's, and two ways to fire people:
- **Fire:** catch someone within range who is **not at their own desk**. Has a cooldown.
- **Stand-up meeting:** Management calls a meeting and everyone has to attend it from their own desk. A countdown starts for everyone; when it hits zero, anyone (worker or snitch) who isn't at their desk is fired. Has its own cooldown, and the countdown length is a house rule.

**HR complaints.** There's an HR complaint box in the Lobby. Any employee (not Management) can file one complaint per game, naming the coworker they think is a snitch. If they're right, the snitch is fired. If they're wrong, HR fires the person who complained, and everyone hears about it.

**Emotes.** Hold the emote button and a ring of emote bubbles pops up around it; drag onto one and let go. (A quick tap opens the ring for tapping instead; on a keyboard, press G.) The emote appears over your head for anyone who can see you, in the waiting room and during the workday.

**Snitches** work exactly like workers (they get tasks and must survive stand-ups), but they're on Management's side, can't clock out, and win when Management wins.

**Chats.**
- *Everyone:* the lobby, all-hands meetings, and after the game.
- *Water cooler:* workers and snitches, any time during the day. Management can't see it.
- *Back office:* Management and snitches, any time during the day.

Snitches read and post in both private chats, so they can spy on the workers and report back. Anyone who's been fired or clocked out can still read their chats but can't post.

**Sight.** You can only see other players within the sight range (a house rule) **and in line of sight**: walls block vision, doorways and the outdoors don't. The darkness on screen follows the walls, so you see into a room through its door and the light spills out into the hallway. The server doesn't even send you players you can't see, so the darkness can't be hacked away, and Management can't fire anyone through a wall. Furniture is low enough to see over. Players who are out of the office can watch anyone.

**Emergency meetings.** Any player in the office can ring the bell on the conference table (once per game each, with a cooldown). Everyone is pulled into the Conference Room to talk and vote. The player with the most votes is ejected and their role is revealed; a tie or a skip majority ejects nobody. Everyone then returns to their desk.

**Winning.**
- **Workers win** when at least half of the real workers (rounded up) have clocked out, or when Management is voted out or leaves.
- **Management (and the snitches) win** when too many workers have been fired for enough of them to clock out, or when 5:00 arrives first.

### House rules

| Setting | Range | Default |
| --- | --- | --- |
| Tasks per person | 3 to 10 | 6 |
| Workday length | 3 to 15 min | 6 min |
| Breaks | none, lunch, lunch and afternoon, or all three | all three |
| Walking speed | 0.6x to 1.5x | 1.0x |
| Sight range | 4 to 18 m | 9 m |
| Snitches | 0 to 3 (always leaves at least 2 real workers) | 1 |
| Firing range | 2 to 8 m | 4 m |
| Firing cooldown | 10 to 60 s | 25 s |
| Stand-up warning | 8 to 40 s | 15 s |
| Stand-up cooldown | 30 to 240 s | 90 s |

All of these live in `shared/settings.js`, with labels, ranges and help text; the server clamps every value.

## Controls

| Action | Keyboard / mouse | Phone / tablet |
| --- | --- | --- |
| Move | WASD or arrow keys | Joystick, bottom left |
| Use / interact | E or Space, or click the object | Use button, bottom right |
| Stop a task | Esc or Q, or walk away | Walk away |
| Fire someone (Management) | R, or click the player | Fire button |
| Stand-up meeting (Management) | F | Stand-up button |
| Emotes | Hold the emote button and drag, or press G | Hold the emote button and drag |
| HR complaint | E at the HR box in the Lobby | Use at the HR box |
| Water cooler / your private chat | T | Water cooler button |
| Back office (Management, snitches) | B | Back office button |
| Watch someone else (when out) | E | Watch button |
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
│       ├── minigames/        Task window and each game's screen (fridge, microwave, email, catfood, recycling, copier, whiteboard, toilet, coffee)
│   └── assets/items/         Item pictures and items.csv
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
│       ├── Game.js           Phases, lobby room, workday clock, stand-ups, HR, emotes, chats, sight, win checks
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
│   ├── emotes.js             The emote list
│   ├── sight.js              Line of sight: wall blocking, who can see whom, visibility polygon
│   └── minigames/            Task-window games: generate, check (shared by server and client),
│                             pixelMask.js (solid/transparent scan), items.js + items.generated.js
├── scripts/build.mjs         client/ → dist/, shared/ → dist/shared/
├── scripts/build-items.mjs   item table + PNGs → collision shapes
├── tests/game.test.mjs
└── wrangler.toml
```

**Authority.** Clients only send intents: a movement direction, "interact with object X", "report player Y", a vote, a chat line. The server runs the simulation at 20 ticks per second using the same `shared/physics.js` and map the client uses, validates everything, and broadcasts results. Roles, task lists and cooldowns are sent only to the player they belong to. Each player's snapshot contains only the players within their sight range and line of sight, carrying just position and two public flags (busy, at desk). Private chat lines are only ever sent to the players allowed to read them.

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
| `chat` | `text, channel` | `all` (lobby, meetings, after the game), `crew` (water cooler), `team` (back office) |
| `settings` | `settings` | Host only, lobby only; clamped by the server |
| `deskcheck` | | Management only; cooldown and break rules checked |
| `minigame` | `answer` | Solution for your open task window; checked by the server |
| `hr` | `targetId` | HR complaint, at the HR box; once per game |
| `emote` | `emote` | One of shared/emotes.js |
| `dev` | `cmd, ...` | Test tools; ignored outside test rooms |
| `lobby` | | Host only, return to lobby after game over |
| `ping` | `at` | Latency |

| Server → client | Contents |
| --- | --- |
| `welcome` | Your player id, session token, room code |
| `room` | Public roster, phase, house rules, workday clock, stand-up countdown |
| `start` | Game started, freeze duration |
| `emote` | Someone you can see emoted |
| `snap` | Positions and public flags for the players you can see (20/s) |
| `self` | Private: role, teammates (Management/snitches only), desk, tasks, cooldowns |
| `event` | Feed items (fired, clocked out, meetings, stand-ups, HR outcomes, breaks, your new task) |
| `meeting` | Meeting state; who has voted is public, the tally only at the end |
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

**Change or add item pictures.** The pictures used by the fridge, microwave, recycling and toilet games live in `client/assets/items/`, listed in `items.csv` (open it in any spreadsheet app):

| Column | Meaning |
| --- | --- |
| `id` | Short unique name (lowercase letters, digits, `_`) |
| `name` | What players see, e.g. `burrito`. Coworkers' food shows as "Gary's burrito" |
| `file` | The PNG in the same folder. Use a transparent background |
| `width` | Size in fridge units (the fridge is 320 wide; each shelf is 104 tall). Height follows the picture's proportions |
| `uses` | Space-separated: `fridge` (coworkers' food), `yours` (your items to fit in), `microwave` (can be reheated), `recycle`, `toilet` (things to clog the toilet with) |

When you build (`npm run build`, `npm run dev`, `npm test`, or just `npm run items`), `scripts/build-items.mjs` reads every PNG and works out its collision shape: the picture is divided into 4x4-unit cells, and a cell counts as solid when at least a quarter of its pixels are opaque (`shared/minigames/pixelMask.js`; the thresholds are at the top of that file). It also traces the edges between solid and transparent cells for the outline. The result goes into `shared/minigames/items.generated.js`, which the server and the browser both use, so the server can check fridge answers with exactly the shapes players see. If a row is wrong (missing file, bad width, unknown use), the build stops and says which line.

Tips: crop pictures tightly; transparent holes and curves count as free space; keep items shorter than a shelf (about 100 units) or they won't fit at all.

**Add a task window (mini-game).**
1. Add `shared/minigames/<name>.js` with `generate(rand)` (may include the answer), `publicView(puzzle)` (what the client sees) and `check(puzzle, answer)`, and register it in `shared/minigames/index.js`.
2. Add `client/js/minigames/<name>.js` exporting a `mount(root, puzzle, { submit, isTouch })` function, and register it in `UIS` in `client/js/minigames/TaskWindow.js`.
3. Give a task `minigame: '<name>'` in `shared/tasks.js`.

**Emotes.** The list is `shared/emotes.js` (an id, an emoji and a label each); the ring lays out however many there are.

**Whiteboard drawings and copier documents.** Drawings are in `shared/minigames/whiteboard.js`, built from little shape helpers (circles, arcs, lines, rectangles) on a 160 x 100 board, with optional printed labels that don't need tracing. Copier documents and chain emails are plain lists in `copier.js` and `email.js`.

**Breaks.** Times live in `shared/breaks.js`; which rooms count as safe is the `breakArea` flag on rooms in `shared/officeMap.js`.

**Add a house rule.** Add an entry to `SETTINGS_SPEC` in `shared/settings.js` (label, group, min, max, step, default, format). It appears in the lobby automatically; read it on the server from `game.match`.

**Change the waiting room.** It's `shared/lobbyMap.js`, same format as the office plus `spawnPoints`.

**Tuning.** Room size, freeze times, meeting length and the clock-out ratio are in `shared/constants.js`.

**Ideas for later.** WebSocket hibernation for idle rooms, sabotage events (printer jam, fire drill), sprite art, sound.
