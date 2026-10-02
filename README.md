# Office Hours

An office social deduction game for 3 to 10 players, in the spirit of Among Us. Most of the office are **productive employees**, getting through the day's tasks properly. A secret few are **slackers**, doing the shenanigan version of the very same tasks: microwaving fish for twenty minutes, writing BOSS SUCKS on the conference whiteboard, clogging the toilet on purpose. Every shenanigan leaves a mess and a clue. Follow the fish smell, notice who was near the restroom when it flooded, and vote the slackers out before the week is over. Every round is a day in a work week: at 5 PM there's an end-of-day report, and if the day went badly, management insists the group fires one of its own.

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
- **Your role:** pick Productive or Slacker before starting, or switch live during the match, to try both versions of every task.
- **Match:** start immediately (alone is fine, nobody needs to be ready), go back to the waiting room, or end the match with either side winning. Wins only happen when you ask, unless you switch **Real win rules** on.
- **Try a task:** give yourself any task from the list (puzzle tasks included), then teleport to it.
- **Workday:** hand out the next task now, hand out every task, finish your tasks, start the next break, jump to 4:50 PM, or end the day right now to see the 5 PM report.
- **Meetings and HR:** call or end an all-hands meeting; reset everyone's meeting bell, HR complaint and shenanigan cooldown.
- **Move me:** teleport to any room (outside too), your desk, any puzzle task (fridge, both microwaves, water cooler, cat bowl, recycling, copier, whiteboard, toilet, coffee machine), a coworker's desk (for the computer prank), the HR box, the bell or the time clock; send yourself home or come back; **See everyone** ignores the sight range.
- **Dummies:** add stand-in players, handy for testing meetings, HR complaints and chats (they wander unless you switch that off, and don't vote) and make one post in any chat, so you can test meetings, HR and chats on a single device.
- **Quick settings:** walking speed and sight range, adjustable mid-match.

A caution-tape stripe along the top of the screen tells you you're in a test room. Normal rooms are unaffected: the server ignores test-tool commands outside test rooms.

**Switching it off.** Set `ENABLE_SANDBOX = "false"` in `wrangler.toml` and redeploy. The menu button disappears and the server refuses to create test rooms. You may want this before a public launch.

**Removing it completely.** Delete `server/dev/`, `client/js/dev/` and `tests/sandbox.test.mjs`, then delete every line tagged `SANDBOX`:

```bash
grep -rn SANDBOX server client shared wrangler.toml
```

Each tagged line is self-contained (a hook, a flag or an import), so deleting them leaves the normal game intact. Run `npm test` afterwards.

## Game rules

**The waiting room.** Everyone joins a small lobby room they can walk around in. The folder panel has three tabs: People (who's here and ready), House rules (the settings) and Chat. The host adjusts the house rules with the minus and plus buttons; everyone else sees them update live.

**The view.** The office is drawn at an angle, so you see the back wall of every room, with posters, clocks and the conference whiteboard on it. Walls and furniture stand up, and people are drawn in front of or behind them depending on where they stand. Front walls are cut down to a low ledge so they don't hide the room. If someone you can see is hidden behind a wall or a tall piece of furniture, a see-through outline of them shows through; if *you* walk behind something, it fades so you can still see yourself.

**The office.** A two-row building with four offices where the desks are (Open Office A, Open Office B, the Design Studio and Accounting), a Conference Room with the all-hands bell and the whiteboard, the Manager's Office, a Break Room, Restrooms, the Lobby with the HR box, and a Mail & Copy Room. The front doors lead out to the patio and lawn; a back door opens onto the parking lot. Tasks happen in all of them, outside included.

**Roles.** When the host starts, a few players (a house rule, always fewer than everyone else) secretly become **slackers**; everyone else is a **productive employee**. Roles are revealed privately in an HR memo. Slackers are told who the other slackers are and see a red badge over each other's heads. **Productive employees get a to-do list** that fills up through the day. **Slackers get no tasks and don't wait for anything:** their sticky note is a menu of shenanigans they can pull off at any object, any time, with a short cooldown between them (a house rule).

**Two versions of every task.** Productive employees get tasks, one at a time, and do the normal version. Slackers do the shenanigan version of the same objects whenever they like. The task names on your screen match your own role, so nobody can tell from the outside what you're up to.

| Task | Productive version | Slacker version | The mess it leaves |
| --- | --- | --- | --- |
| Microwave (there are two) | Put your lunch in for 15 to 45 seconds, wait for the ding, open it | Start the fish and walk away | When it dings, fish fumes fill the Break Room and the microwave stays blocked until someone takes the fish out |
| Water cooler | Work the tap and fill a cup to the lines, then drink | Tip laxatives into the tank | The next person to drink goes home sick until tomorrow |
| A coworker's computer | (not a task) | Set a "questionable" wallpaper (censored, PG) | IT finds it at 5 PM and fires the owner |
| Whiteboard | Trace the quarterly chart or an inspirational TEAMWORK | Trace BOSS SUCKS, the boss as a potato, NAP TIME... | It stays on the conference whiteboard in red marker |
| Fridge | Fit your lunch into the packed fridge | Find a named coworker's lunch and eat it | A furious WHO ATE MY LUNCH note on the fridge |
| Coffee | Brew a fresh pot by the recipe | Pour the last cup, put the empty pot back on the heat | The empty pot smokes |
| Toilet | Restock the toilet paper | Drag ridiculous things into the bowl and flush | The restroom floods |
| Copier | Copy the quarterly report | Photocopy nonsense | Copies all over the copy room floor |
| Printer | Print the meeting agenda | Print 400 pages of memes | A meme pile by the printer |
| Recycling | Into the blue bin | Straight onto the parking lot | Litter around the dumpster |
| Cat | Feed the office cat | Overfeed the office cat | A noticeably rounder cat |
| Email (at your desk) | Reply to work email | Forward chain emails to All Staff | Everyone hears which room it came from |

...plus about fifteen hold-to-finish tasks with two versions each ("File your TPS report" or "Look busy at your desk", "Refill your water bottle" or "Spread a rumor at the water cooler", and so on).

**Evidence.** A mess appears the moment a slacker finishes, so anyone who walks past (or is standing nearby) sees it. A few seconds later the whole office hears about it in the feed ("A horrible fish smell is drifting out of the Break Room"), which gives the slacker a head start to get away. When a productive employee does their version of a task at the same spot, they clean the mess up. Fish fumes, burning coffee and chain emails also fade on their own.

**The two meters.** Every productive task done fills **Productivity** for today. Each shenanigan adds 8 points of **Chaos**, and every mess still standing at 5 PM adds 4 more. Both are public, at the top of the screen, along with today's score (productivity minus chaos) and the target.

**The workday.** The day runs from 9:00 to 5:00 on the punch clock. Its length and the number of tasks are house rules, and the day is split into equal sections, one per task: at the start of each section every productive employee is handed one new task, picked at random by each task's chance. The clock pauses during meetings. Walk up to the right object to do a task; some finish by holding still, the rest open a task window (below). You can't use anything through a wall.

**The week and the end-of-day meeting.** A game is a work week (a house rule, 1 to 5 days, default 3). At 5 PM everyone is pulled into the Conference Room for the **end-of-day meeting**, where management reads out the report: productivity, chaos, the day's score against the target, and anything IT found on people's computers. If the score is **at or above the target**, management is satisfied and everyone goes home. If it's **below**, management insists the group fire one of its own: everyone votes, **no skipping**, and a tie is settled at random among the front-runners. This is where employees argue about who the slacker is. Then the next day starts: new tasks, the messes cleaned overnight, and anyone who went home sick is back.

**Breaks.** Up to three scheduled breaks (a house rule): coffee at 10:30, lunch at noon, the afternoon break at 3:00. They show as green bands on the punch clock. Lunch tasks can only be done on a break (or any time once the day has no breaks left).

**Catching slackers.**
- **All-hands meetings.** Anyone in the office can ring the bell on the conference table (once per game each, with a cooldown). Everyone is pulled into the Conference Room to talk and vote. The player with the most votes is fired and their role is revealed; a tie or a skip majority fires nobody.
- **The end-of-day vote** (above), when the day misses its target.
- **HR complaints.** At the HR box in the Lobby, anyone can file one complaint per game naming a suspected slacker. Right, and the slacker is fired. Wrong, and HR fires the person who complained.

**Chats.**
- *Everyone:* the lobby, all-hands meetings, and after the game.
- *Water cooler:* everyone, any time during the day. Slackers read it too.
- *Slacker group chat:* slackers only, any time during the day (when there's more than one slacker).

Anyone who's been fired can keep reading but can't post.

**Sight.** You can only see other players within the sight range (a house rule) **and in line of sight**: walls block vision, doorways and the outdoors don't. The darkness on screen follows the walls, so you see into a room through its door and the light spills out into the hallway. Wall faces, and anything hanging on them, are only lit when you're in front of them with a clear line to them: you see the back wall of the room you're in, not the far side of a wall you're behind. The server doesn't even send you players you can't see, so the darkness can't be hacked away. Furniture is low enough to see over. Fired players can watch anyone.

**Emotes.** Hold the emote button and a ring of emote bubbles pops up around it; drag onto one and let go. (A quick tap opens the ring for tapping instead; on a keyboard, press G.) The emote appears over your head for anyone who can see you.

**Winning.**
- **Productive employees win** when every slacker has been fired.
- **Slackers win** when there are as many slackers as productive employees left, or when they're still on the payroll after the last day.

**Task windows.** Puzzle tasks open a little game instead of a hold-to-finish bar. The server makes each one (for your role's version) and checks the answer, and refuses answers that come back impossibly fast. Walking away, or pressing Esc, cancels the task.
- **Fridge.** Productive: the fridge is packed with coworkers' food (pictures from the item table); drag things around, tuck them into each other's gaps or stack them until your lunchbox and smoothie fit, then close the door. Collision follows each picture's solid pixels, not its rectangle, and the outline you see while dragging is that traced shape. Slacker: every item has its owner's name on it; find the one you're after and drag it into your mouth.
- **Microwave.** Drag the food in, type the time from its sticky note (15 to 45 seconds for productive employees), press Start. **The microwave really runs**: everyone can see its glow and countdown, and nobody else can use that one (the other microwave is free). When it dings, walk back and open it to finish the task. Slackers put fish in and just leave it: when it dings, the fumes start, and it stays blocked until a productive employee opens it and takes the fish out.
- **Water cooler.** Productive: hold the tap to fill a paper cup to the dotted lines without spilling, then drink. Slacker: pull the lid off the tank, tip the laxatives in, put the lid back. The next person to drink from that cooler sprints for the restroom and **goes home sick until the next day**. Sick players still count as employees and are back at tomorrow's start.
- **Computer prank.** Slackers only, at a coworker's desk, once a day. Wake the computer, open the browser, pick something unprofessional (everything is censored and PG, shown as a [FILTERED] bar) and set it as the wallpaper. The owner's monitor shows it for anyone who walks past, and unless someone notices and cleans it up, IT finds it at 5 PM and fires the owner.
- **Email.** Three to five messages: open each one, then Reply (productive) or Forward to All Staff (slacker).
- **Copier.** Drag each document from the stack onto the glass and press Copy; it always jams once (PC LOAD LETTER). Productive: real reports. Slacker: petitions for a slide instead of stairs, Gary's fourth self-nomination for Employee of the Month.
- **Whiteboard.** Trace a dotted drawing with the marker. The whiteboard hangs on the Conference Room's back wall, and anyone who can see it watches your drawing appear stroke by stroke (the server only streams it to people with a clear view of the board). When you finish, your actual drawing stays up for everyone until someone draws over it. It counts when most of the outline is traced, every part at least mostly, without scribbling all over the board; the server re-scores your drawing with the same rules.
- **Toilet.** Productive: drag fresh rolls onto the holder. Slacker: drag a rubber duck, Gary's stapler, a whole pineapple and friends into the bowl, then flush.
- **Coffee.** Productive: scoop grounds into the filter as the sticky-note recipe says, then Brew. Slacker: pour the last cup into your mug and put the empty pot back on the hot plate.
- **Recycling.** Drag everything out of the box: into the blue bin, or onto the parking lot.
- **Cat food.** Scoop from the can into Mittens' bowl: a sensible amount, or eight to ten scoops.

### House rules

| Setting | Range | Default |
| --- | --- | --- |
| Tasks per person | 3 to 10 | 6 |
| Days in the week | 1 to 5 | 3 |
| Daily target | 30% to 90% | 60% |
| Workday length | 3 to 15 min | 5 min |
| Breaks | none, lunch, lunch and afternoon, or all three | all three |
| Walking speed | 0.6x to 1.5x | 1.0x |
| Sight range | 4 to 18 m | 9 m |
| Slackers | 1 to 3 (always fewer than productive employees) | 1 |
| Shenanigan cooldown | 10 to 90 s | 30 s |

All of these live in `shared/settings.js`, with labels, ranges and help text; the server clamps every value.

## Controls

| Action | Keyboard / mouse | Phone / tablet |
| --- | --- | --- |
| Move | WASD or arrow keys | Joystick, bottom left |
| Use / interact | E or Space, or click the object | Use button, bottom right |
| Stop a task | Esc or Q, or walk away | Walk away |
| Emotes | Hold the emote button and drag, or press G | Hold the emote button and drag |
| Report a slacker to HR | E at the HR box in the Lobby | Use at the HR box |
| Water cooler chat | T | Water cooler button |
| Slacker group chat (slackers) | B | Slacker chat button |
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
│       ├── render/Renderer.js  Camera, the layered angled view, players, see-through outlines, fog
│       ├── render/scene.js     Wall and furniture heights, wall pieces, wall-mounted things
│       ├── render/boxArt.js    Appliances and cabinets drawn as real boxes (front face, top, details)
│       ├── render/evidenceArt.js  Fish fumes, floods, doodles and the other messes
│       ├── render/officeArt.js Floors, walls, labels, furniture drawers
│       ├── render/Minimap.js
│       └── ui/UI.js          DOM UI: lobby, task list, role reveal, meeting, win/lose
├── server/
│   ├── worker.js             HTTP entry: POST /api/rooms, GET /api/config, GET /ws?room=CODE, CORS/origin checks
│   ├── dev/Sandbox.js        Test rooms and test-tool commands (removable)
│   ├── GameRoom.js           Durable Object: sockets, sessions, rate limiting, tick loop, cleanup
│   ├── net/RateLimiter.js    Token buckets per message type + global flood control
│   └── game/                 Pure game logic (no Cloudflare APIs, unit-testable in Node)
│       ├── Game.js           Phases, lobby room, workday clock, meters, evidence, HR, emotes, chats, sight, win checks
│       ├── Player.js
│       ├── TaskSystem.js     Weighted task draws, timed holds, completion validation
│       ├── RoleSystem.js     Productive employees and slackers, desks
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
│   ├── tasks.js              Task catalogue: chance weights, productive and slacker versions
│   ├── breaks.js             Break schedule and helpers
│   ├── emotes.js             The emote list
│   ├── evidence.js           The messes slackers leave: how long they last, what the office hears
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
| `vote` | `targetId` or `"skip"` | During meetings |
| `chat` | `text, channel` | `all` (lobby, meetings, after the game), `crew` (water cooler), `team` (slacker group chat) |
| `settings` | `settings` | Host only, lobby only; clamped by the server |
| `minigame` | `answer` | Solution for your open task window; checked by the server |
| `hr` | `targetId` | HR complaint about a suspected slacker, at the HR box; once per game |
| `wbink` | `ink` | Your whiteboard drawing so far, while the whiteboard task is open |
| `emote` | `emote` | One of shared/emotes.js |
| `dev` | `cmd, ...` | Test tools; ignored outside test rooms |
| `lobby` | | Host only, return to lobby after game over |
| `ping` | `at` | Latency |

| Server → client | Contents |
| --- | --- |
| `welcome` | Your player id, session token, room code |
| `room` | Public roster, phase, house rules, workday clock, both meters, evidence, the whiteboard |
| `start` | Game started, freeze duration |
| `emote` | Someone you can see emoted |
| `board` | `live`: someone drawing on the whiteboard (only if you can see it); `final`: what's on it now |
| `snap` | Positions and public flags for the players you can see (20/s) |
| `self` | Private: role, fellow slackers (slackers only), desk, tasks, active task window |
| `event` | Feed items (fired, meetings, evidence news, clean-ups, HR outcomes, breaks, your new task) |
| `meeting` | Meeting state; who has voted is public, the tally only at the end |
| `chat`, `toast`, `error`, `pong` | |
| `over` | Winner, reason, who the slackers were, final meters |

### Security measures

- Server decides roles, task lists, task completion (timed on the server; the player must stay in range), report validity, votes and win conditions.
- Movement is simulated on the server from direction inputs only, so speed hacks and wall clipping are impossible; positions are never accepted from clients.
- Per-socket token-bucket rate limits per message type, with a global flood limit that disconnects abusers. Oversized messages are dropped. Reports and meetings have server-side cooldowns.
- Anonymous sessions: the server issues a random token on join, stored in the tab's `sessionStorage`, used to reconnect to the same seat (45 s grace in a game). A second connection with the same token replaces the first.
- Names and chat are length-limited and rendered as text, never HTML.
- WebSocket origin check and opt-in CORS for split hosting.

## Extending the office

**Things on furniture.** A microwave on the counter or the bell on the conference table is lifted by the height of whatever it sits on and drawn after it (`ON_TOP` in `scene.js`), so furniture never covers what's resting on it. Appliances and cabinets have a hand-drawn front face (doors, drawers, a microwave window) in `BOX` in `boxArt.js`; kinds without an entry fall back to their top-down sprite over a shaded front.

**Heights and wall art.** How tall each kind of wall, furniture and prop is drawn lives in `HEIGHT` at the top of `client/js/render/scene.js` (anything missing is flat on the floor). To hang something on a wall, give a decor item `wall: true` and the y of the wall's bottom edge; posters, clocks and elevator doors are drawn by `WALL_ART` in `client/js/render/officeArt.js`.

**Add or rearrange rooms.** Everything lives in `shared/officeMap.js`. Add a rectangle to `rooms` with `doors` on any side; walls and door gaps are generated automatically. Outdoor areas use `open: true` (no walls); the building's outer walls and front/back doors are the `hall` room. Floor styles are named in `client/js/render/officeArt.js`. Run `npm test`: one test flood-fills the map to make sure every desk and interactable is still reachable.

**Add a task.** Tasks live in `shared/tasks.js`. Each has a `chance` (a relative weight: chance 10 comes up five times as often as chance 2; 0 switches it off) and two versions, `productive` and `slacker`, each with its own label and either a `duration` (hold to finish) or a `minigame`. A slacker version can name an `evidence` kind from `shared/evidence.js` (add new kinds there, with art in `client/js/render/evidenceArt.js`). Players never get the same task twice in a match while the list lasts.
1. If it needs a new object, add it to `interactables` in `shared/officeMap.js` with a new `type`, e.g. `{ id: 'vending_1', type: 'vending', label: 'Vending machine', x, y, w, h, solid: true }`.
2. Add the task with both versions, and a `TARGET_HINT` entry saying where it is:
   ```js
   { id: 'snack', target: 'vending', chance: 5,
     productive: { label: 'Buy a healthy snack', duration: 3000 },
     slacker:    { label: 'Shake the vending machine until it gives up', duration: 5000, evidence: 'memes' } }
   ```
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
