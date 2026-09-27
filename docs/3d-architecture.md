# OUTCRAFT 3D edition: architecture and module contracts

This is the build contract for turning OUTCRAFT from a 2D tap-to-move prototype into a **3D third-person
crafting race** with a **Candy Crush style level map**, a **shop**, **skins**, **coins, gems and hearts**,
**boosters**, **daily rewards** and **achievements**. The rival AI that learns how you play (the core of
the original design) stays exactly as it is and remains the heart of the game.

The 2D prototype is kept, frozen and playable, in [`classic/`](../classic/).

## Ground rules

- **No build step.** Plain ES modules served as static files (GitHub Pages). Three.js r170 is vendored in
  `vendor/three/three.module.min.js` and loaded through an import map in `index.html`:
  `{"imports": {"three": "./vendor/three/three.module.min.js", "three/addons/": "./vendor/three/addons/"}}`.
  Only `BufferGeometryUtils.js` is vendored under addons; do not import other addons.
- **Pure logic stays pure.** `src/data.js`, `world.js`, `match.js`, `model.js`, `rng.js`, `storage.js`,
  `levels.js`, `economy.js`, `skins.js`, `src/3d/themes.js` and `src/3d/coords.js` must not touch the DOM
  or three.js, so Node tests and simulators (`tools/*.mjs`) run them directly.
- **Everything is procedural.** No image, model or audio files. Meshes are built from three.js primitives;
  UI icons come from `src/icons.js` (`iconURL(kind, id, px)`), sound from `src/audio.js`.
- **Mobile first.** Must run at 30+ fps on a mid-range phone at the "medium" quality level. One thumb
  moves (virtual joystick), the other looks/taps. Desktop: WASD/arrows + mouse.
- **No real money.** The shop sells only for coins and gems earned by playing.
- **Honesty rules of the rival stay.** The rival only knows what a human rival could know; the reasons it
  gives for a snatch are computed from the evidence it actually used (see `match.snatchReason`).

## Files and owners

| Path | What it is |
|---|---|
| `index.html`, `style.css` | App shell: WebGL canvas, HUD overlay, all menu screens and modals |
| `src/main.js` | Game controller: boot, loop, modes, wiring sim, 3D, HUD, screens, saves |
| `src/match.js` | Match simulation (extended: free movement, level options, score, boosters, time limit) |
| `src/levels.js` | Adventure levels: 6 worlds x 10 levels, goals, star thresholds, rewards |
| `src/economy.js` | Coins, gems, hearts, shop catalogue, boosters, daily reward, achievements (pure functions) |
| `src/storage.js` | Save file (extended with the new fields; still `localStorage['outcraft.v1']`) |
| `src/skins.js` | Skin catalogue (data) |
| `src/3d/coords.js` | Sim tile <-> 3D world mapping |
| `src/3d/themes.js` | Colour themes for the 6 worlds (data) |
| `src/3d/engine.js` | WebGLRenderer, scene, sky, fog, lights, shadows, quality levels, resize |
| `src/3d/island.js` | Island meshes built from a sim `world`; node/workshop visuals; pick targets |
| `src/3d/fx.js` | Particles, ground rings, rival route line, ambient particles, confetti, trails |
| `src/3d/characters.js` | Procedural low-poly characters (player skins, 5 rivals, villager), animation, portraits |
| `src/3d/camera.js` | Third-person follow camera, orbit, cinematics, shake |
| `src/3d/input.js` | Virtual joystick, look drag, tap-to-target, keyboard, action buttons |
| `src/ui/hud.js` | In-match HTML HUD |
| `src/ui/screens.js` | Menu screens: title, level map, level popup, shop, daily reward, achievements, settings, results |
| `dev/*.html` | Stand-alone harness pages for each 3D/UI module (screenshots, manual checks) |

## Coordinates (src/3d/coords.js)

Sim: 9 x 13 tiles, `x` east, `y` south, tile centre at integer `(x, y)`. 3D: metres, Y up,
`TILE = 2`, tile `(x, y)` centre = `((x - 4) * 2, 0, (y - 6) * 2)`. North is `-Z`, east is `+X`.
Characters face `+Z` in model space; `rotation.y = Math.atan2(dx, dz)` faces a movement `(dx, dz)`.
Ground top is `Y = 0`, sea surface `Y = -0.55`.

The default camera looks **north** (yaw = PI): the workshop and spawns (south, y = 10) are near the camera,
resources spread out ahead, and screen-right is east, just like the 2D map.

## Simulation changes (src/match.js)

Everything existing keeps working bit-for-bit when the new options are not used: `tools/test.mjs`
(including "same seed + same inputs = same match") and every `tools/*.mjs` simulator must still pass and
give the same numbers.

### New constructor options

`new Match({ seed, rival, model, twist, rng, enabledExperts, options })`, where `options` (all optional):

| option | meaning |
|---|---|
| `orders: string[]` | explicit item ids for the orders (overrides `pickOrders`) |
| `starsToWin: number` | stars needed to win (default `STARS_TO_WIN` = 3) |
| `timeLimit: number` | seconds of race time for the whole match; when it runs out the match ends (`summary.timeUp = true`), winner = more stars, a tie goes to the rival |
| `playerSpeedMul` | booster: player speed multiplier |
| `playerBagBonus` | booster: extra bag slots for the player only |
| `rivalDelay` | booster: extra seconds the rival waits at the start of every order |
| `blindOrders` | booster: for the first N orders the rival makes no informed reads (as `?blind=1`) |

Bag size becomes per agent: `match.bagSizeFor('player' | 'rival')`. Keep `match.bagSize` as the rival's
(= shared) size for backwards compatibility.

### Free (analog) movement for third-person control

- `match.setMove(mx, my)`: analog direction in **tile units** (`mx` east, `my` south), magnitude 0..1
  (clamped). A magnitude above 0.12 switches the player into free movement: any tap-path (`dest`,
  `queued`) is cancelled and the player moves continuously at `speed * magnitude`, colliding (circle,
  radius 0.32 tile) against non-walkable tiles and the island edge, sliding along walls. `setMove(0, 0)`
  stops.
- Agents get continuous positions. `player.fx / player.fy` always return the exact continuous position,
  `player.x / player.y` stay the integer tile the player is standing on (always a walkable tile), so the
  model, BFS fields and the rival keep working.
- A later `match.command(x, y)` (tap-to-target, the HOME button) starts pathing from wherever the player
  is, smoothly (first leg goes from the continuous position to the next tile centre).
- **Auto interactions while free-moving or standing:**
  - *Gather*: when the player's centre is within `0.95` tiles of a ready node's centre, the bag has room
    and the order still **needs** that resource, gathering starts (same `startGather`, same events). A
    node that is not needed is gathered only through `match.interact()`.
  - *Deposit*: when within `0.95` tiles of any Workshop tile and the bag is not empty, depositing starts.
  - Standing next to a regrowing node you need waits for it (gathers the moment it is ready).
- `match.interact()`: gather the nearest ready node in reach even if not needed, or deposit if at the
  Workshop. Returns what happened (`'gather' | 'deposit' | null`).
- **Intent for the rival and the UI:** in free mode, `player.dest` is not a path; instead the sim infers
  `player.aim` each step: the needed, ready (or ready within 2 s) node that best matches the walking
  direction (within a 40 degree cone, weighted by distance), or the node the player is standing next to.
  Snatch detection (`startGather` for the rival) treats `player.aim` like a tap destination. `match.playerTarget()`
  returns the node id the player is going for (tap `dest` or free `aim`), or null.
- In free mode there is no automatic walk home when the bag is full; the `autoReturn` event is replaced
  by `{ type: 'bagFull' }` once, and the HUD tells the player to head to the Workshop (the HOME button
  auto-runs there with `command`). Tap mode keeps the old automatic return.

### Score

`match.score` accumulates the player's Adventure score using `SCORE` from `src/data.js`; each change
emits `{ type: 'score', add, total, reason }` where reason is `gather | craft | order | speed | outread |
fooled | matchWin | flawless`. `summary()` gains `score`, `timeUp`, `options`.

## Adventure levels (src/levels.js)

- `WORLDS`: 6 entries `{ id, name, theme, rivalIds, blurb }` matching `THEMES` order.
- `LEVELS`: 60 entries, `id` 1..60, 10 per world. Each:
  `{ id, world, index, name, seed, rival, twist, options, goal, thresholds: [0, two, three], reward: { coins, gems }, boss }`.
  Levels 10, 20, ... 60 are boss levels (the world's strongest rival, harder twist, double reward).
  The difficulty ramps smoothly: rival ladder PIP -> WREN -> FOX -> RAVEN -> MIMIC, rising order tiers,
  twists introduced one at a time with a short explanation, time limits from world 3.
- `goal` is shown on the level popup: `{ text, type: 'win' | 'win-time' | 'flawless' | 'craft', item? }`.
  All levels require winning the match; some add a condition (e.g. win before the time limit, win without
  losing an order, craft a specific item) that must also hold to pass.
- `levelPassed(level, summary) -> boolean`, `starsFor(level, summary) -> 0..3` (0 = failed, 1 = passed,
  2 and 3 = passed with `summary.score >= thresholds[1|2]`).
- `levelById(id)`, `worldOf(level)`.
- Thresholds are calibrated with bot players (`tools/levels.mjs`): a solid "human" bot should reach
  2 stars on roughly half its wins and 3 stars on roughly one win in five.

## Economy (src/economy.js) and save file (src/storage.js)

Save state additions (defaults for old saves are merged in by `load()`):

```js
wallet: { coins: 300, gems: 15 },
hearts: { n: 5, since: null },          // since = ms timestamp when regen started (null when full)
inventory: { skins: ['explorer'], equipped: 'explorer', boosters: { boots: 1, backpack: 1, headstart: 0, fog: 0 } },
levels: { /* [id]: { stars, best, plays } */ },
adventure: { unlocked: 1 },             // highest playable level id
dailyReward: { lastKey: null, day: 0 }, // day = how many consecutive days claimed (1..7 cycle)
achievements: { claimed: {} },
counters: { levelsWon: 0, starsEarned: 0, fakeOuts: 0, outreads: 0, flawless: 0, coinsEarned: 0 },
settings: { sound: true, music: true, glass: false, quality: 'auto', sensitivity: 1, invertY: false, autoReturn: false },
```

Economy functions (all pure; `now` is a ms timestamp passed in):

| function | does |
|---|---|
| `HEARTS_MAX = 5`, `HEART_REGEN_MS = 20 * 60 * 1000` | |
| `heartsNow(state, now) -> { n, nextInMs }` | applies regeneration (mutates `state.hearts`) |
| `canStartLevel(state, now) -> boolean` | `n > 0` |
| `loseHeart(state, now)` | on a failed or abandoned level |
| `refillHearts(state) -> { ok, reason }` | costs `HEART_REFILL_GEMS` gems |
| `BOOSTERS` | `{ boots, backpack, headstart, fog }` with `name, desc, icon, price: { coins }, options` where `options` is merged into the match options |
| `SHOP` | catalogue entries `{ id, kind: 'skin' | 'booster' | 'hearts' | 'coins', ... price }` |
| `buy(state, id, now) -> { ok, reason }` | skins, booster packs, heart refill, gems -> coins exchange |
| `equipSkin(state, id) -> boolean` | only owned skins |
| `useBoosters(state, ids) -> options` | consumes one of each selected booster, returns merged match options |
| `grantLevelResult(state, level, summary, now) -> { passed, stars, newStars, firstClear, coins, gems, unlocked, best }` | updates `levels`, `adventure.unlocked`, wallet, counters; first clear pays `level.reward`, replays pay a little, each newly earned star pays gems |
| `DAILY_REWARDS` | 7 entries (coins, booster, gems, day 7 = Festival skin or 25 gems if owned) |
| `dailyStatus(state, now) -> { canClaim, day, rewards }`, `claimDaily(state, now) -> reward` | consecutive local days; missing a day restarts at day 1 |
| `ACHIEVEMENTS` | ~12 goals with `progress(state) -> [cur, target]` and a reward (e.g. beat MIMIC awards the Royal skin) |
| `achievementStatus(state) -> [...]`, `claimAchievement(state, id) -> reward` | |
| `recordQuickRace(state, summary)` | small coin reward for Quick Race / Daily Commission wins |

## 3D modules

All 3D modules import `* as THREE from 'three'` and take the shared `Engine` so there is a single
renderer and scene.

### src/3d/engine.js

```js
export class Engine {
  constructor(canvas, { quality = 'auto' } = {})
  scene; camera; renderer;            // THREE objects; camera is a PerspectiveCamera (fov 55)
  setQuality(q)                       // 'low' | 'medium' | 'high' | 'auto'; low = no shadows, pixelRatio 1, no AA
  setTheme(theme)                     // sky gradient dome, fog, sun + hemisphere light colours from THEMES[i]
  resize()                            // match canvas to window
  render()
  worldToScreen(v3) -> { x, y, visible }   // CSS pixels, for HTML labels
  raycast(clientX, clientY, objects) -> intersections
  fps                                 // smoothed frames per second
}
```

### src/3d/island.js

```js
export class Island3D {
  constructor(engine)
  build(world, theme)        // (re)build every mesh for a sim world; disposes the old island
  update(match, dt, now, view)
  // view = { need: Set<resType>, playerTarget: nodeId|null, rivalTarget: nodeId|null,
  //          rivalColor, glass: boolean, pred: Map|null, rivalFirst: boolean, theme }
  // Nodes: ready (full size, gentle bob/sway), being gathered (shake), regrowing (shrunk stump/pile
  // that grows back as readyAt approaches), reserved. Needed + ready nodes get a gold ground ring.
  // The rival's target gets a ring in the rival's colour. glass mode shows the rival's % above nodes
  // (returns label anchors for the HUD instead of drawing text in 3D).
  nodePos(id) -> THREE.Vector3        // top of the node (for particles and labels)
  workshopPos(side?) -> THREE.Vector3 // 'player' bench (x=3), 'rival' bench (x=5) or centre
  villagerPos() -> THREE.Vector3
  pickTargets -> THREE.Object3D[]     // meshes with userData { kind: 'node', id } | { kind: 'hub' } | { kind: 'ground' }
  dispose()
}
```

Look: stylised low-poly diorama, bright and readable. Grass tiles with slight colour variation and
bevelled edges, sandy beach ring, cliff skirt down into an animated sea (water / lava / clouds per theme).
Resource nodes are instantly readable by silhouette and colour: wood = round low-poly tree, stone = grey
boulder pile, ore = dark rock with glowing orange veins, sand = sand dune mound, fiber = tall flax tuft,
crystal = glowing cyan crystal cluster. Obstacles follow the theme (`props`). The Workshop is a small hut
with a roof, chimney smoke, two crafting benches (player's on the west side, rival's on the east) and a
floating display of the current order item. A villager NPC stands by it.

### src/3d/characters.js

```js
export function createPlayer(skin) -> Character        // skin = entry of SKINS
export function createRival(rivalDef) -> Character     // look: sprout | beak | ears | crest | mirror
export function createVillager() -> Character
class Character {
  group                           // THREE.Group, feet at y = 0, faces +Z, about 1.7 m tall
  setSkin(skin)                   // player only
  update(dt, { x, z, heading, moving: 0..1, state, carry, emote })
  // state: 'idle' | 'walk' | 'wait' | 'gather' | 'deposit' | 'think' ; emote: 'hop' | 'sad' | 'cheer' | null
  // carry: array of resource types shown as small items in the backpack/basket
  dispose()
}
export function portraitURL(kind, def, size = 128) -> string  // PNG data URL rendered offscreen; kind 'player' | 'rival'
export class Preview { constructor(canvas); show(character); update(dt); dispose() } // rotating locker preview
```

Chibi proportions (big head, small body), procedural animation (run cycle with arm/leg swing and bob,
gather = chop/scoop swing, deposit = drop into bench, hop, sad slump, cheer with arms up, idle breathing
and blinking). Every hat and pack listed in `skins.js` is modelled. Rivals keep the colours and looks of
the 2D game: PIP (orange, sprout), WREN (pink, beak), FOX (orange, ears and tail), RAVEN (purple,
crest), MIMIC (teal, mirror-chrome face).

### src/3d/camera.js

```js
export class ThirdPersonCamera {
  constructor(camera)
  yaw; pitch; distance
  orbit(dYaw, dPitch)
  follow(x, z, heading, moving)   // target in world metres
  update(dt)                      // smooth follow, pitch clamped, gentle auto-align behind the player while running
  moveFromStick(jx, jy) -> { x, z }   // camera-relative stick (jx right, jy forward) -> world direction
  intro(center, done)             // sweeping fly-in over the island at match start (skippable)
  victory(x, z)                   // slow orbit around the player
  menuOrbit(center)               // slow orbit for the title screen / attract mode
  shake(amount)
}
```

### src/3d/input.js

```js
export class Input {
  constructor(canvas, { onTap(clientX, clientY), onInteract(), onHome(), onPause() }, { sensitivity, invertY })
  stick -> { x, y, mag }          // current move intent, x right, y forward (keyboard or joystick)
  consumeLook() -> { dx, dy }     // accumulated look deltas in radians since the last call
  setEnabled(on); setOptions({ sensitivity, invertY }); dispose()
}
```

Touch: a floating joystick appears where the left thumb lands (left 45% of the screen). Dragging on the
right side orbits the camera; a quick tap anywhere (not a drag) calls `onTap` for tap-to-target. The
Interact and Home buttons are HTML buttons in the HUD wired to the callbacks. Mouse: drag to orbit,
click to tap-to-target. Keyboard: WASD/arrows move, E interact, Space/H home, P/Esc pause.

### src/3d/fx.js

```js
export class FX {
  constructor(engine)
  burst(pos, color, count = 14, speed = 4, life = 0.7)
  ring(pos, color, dur = 0.6)                 // expanding ground ring (tap feedback, deposits)
  setRoute(points, color, danger)             // rival route as a dotted line on the ground; null hides
  confetti(pos)
  setAmbient(kind)                            // theme ambient particles around the island
  trail(pos, color)                           // skin trail puff, called while running
  update(dt, now)
}
```

## HUD (src/ui/hud.js) and screens (src/ui/screens.js)

The HUD is HTML over the canvas (crisp text, cheap to update). Layout on a phone in portrait:

- Top centre: **order card** with the item icon, name and recipe (components with the raw resources
  they need; ticks as components are crafted), and the order number `2/5`.
- Top left: **your stars** and avatar. Top right: **rival stars**, portrait, name. Under them, a
  **score meter** with three star markers (Adventure) and the **timer** when the level has a time limit.
- Right side under the rival: **minimap** (small canvas: island, nodes, you, rival, rival target).
- Bottom centre: **bag slots** (3 or 4), the hint line above them ("Still need: Sand, Ore").
- Bottom left: joystick zone. Bottom right: **Interact** (hand) and **Home** (house) buttons.
- Pause button at the top.
- Floating labels projected from 3D: "FOX FIRST" / "YOU FIRST" pill over a contested node, rival speech
  bubbles, "+60" score floaters, "SNATCHED!", "BEAT IT!", "FAKED OUT!".
- Big captions ("GO!", "CRAFTED!", "YOU WIN!") and toasts (the honest snatch reason).
- VS splash at match start: your portrait vs the rival's, level name, goal.

Screens (HTML sections in `index.html`, rendered by `screens.js` from the save state):

- **Title**: 3D island playing itself behind; logo; top bar (coins, gems, hearts with countdown); big
  PLAY (goes to the level map, shows "Level 12"); DAILY COMMISSION; QUICK RACE (rival ladder); SHOP;
  row of icon buttons: Daily Reward (badge), Achievements (badge), Codex, Settings; footer links: How to
  play, About, Classic 2D, Design docs.
- **Level map** (the Candy Crush screen): a vertical, scrolling, winding path of level bubbles through
  six themed world sections (Meadow Isle at the bottom rising to Sky Gardens at the top), each world with
  its colour band, name and decorations; each bubble shows its number and earned stars; the current level
  pulses with your portrait; locked levels are grey; boss levels (every 10th) are bigger and show the
  rival's portrait. Opens scrolled to the current level.
- **Level popup**: level number and world, rival portrait "vs", goal, twist explanation, the three star
  score targets, booster chips (select up to all four; owned count; buy with coins if none), PLAY
  (needs one heart; hearts are only lost if you fail or quit).
- **Level result**: LEVEL COMPLETE with stars popping in one by one (score counting up), best score,
  coins and gems earned, first-clear badge, NEXT LEVEL / REPLAY / MAP; or LEVEL FAILED with the heart
  lost, a tip from what happened, RETRY / MAP. "What the rival learned about you" stays available.
- **Shop**: tabs Skins | Boosters | Hearts & Gems. Skin cards show rarity colour, a portrait, price, and
  BUY / EQUIP / EQUIPPED; a 3D preview of the selected skin turns on a pedestal. Footer: "Everything
  here is bought with coins and gems you earn by playing. No real money."
- **Daily reward**: 7-day calendar, today highlighted, CLAIM.
- **Achievements**: list with progress bars and CLAIM buttons.
- **Settings**: graphics quality, sound, music, camera sensitivity, invert camera, auto-walk home when the
  bag is full, show the rival's thoughts, reset progress.
- **Quick race** (the original rival ladder), **Codex** and **Tells**, **How to play** (3D controls),
  **About**, **Pause** (resume, restart, settings, quit).

## Game modes

- **Adventure**: the 60 levels. Costs a heart only when you fail or quit.
- **Daily Commission**: unchanged rules (same island, orders and twist for everyone today, FOX with no
  memory of you, one ranked attempt, streak, share card). Free.
- **Quick Race**: the original rival ladder; the rivals share one notebook about you. Free.

## Verification

- `node tools/test.mjs` (existing invariants plus new ones for free movement, options, score, levels,
  economy) must pass.
- `node tools/levels.mjs` prints per-level win and star rates for bot players.
- `dev/*.html` harness pages render each 3D module alone; Playwright screenshots in headless Chromium
  (SwiftShader WebGL) are used to check visuals at phone (390 x 844) and desktop (1280 x 800) sizes.
