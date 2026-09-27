# OUTCRAFT

OUTCRAFT is a fast-paced 3D crafting race where you explore a small island in third person, collect scarce resources,
and craft target items before your AI rival. The rival learns your movement and gathering habits, predicts your next
move, and adapts its strategy. Outsmart the AI, master crafting, earn stars, and climb through 60 levels across six
worlds.

## ▶ [Play in the browser](https://bmanoj07112004-eng.github.io/OUTCRAFT/): one click, nothing to install, phone or laptop

**by B Manoj** · The original 2D prototype submitted for the Lila Games Game Designer Written Test (Part 1) is kept,
unchanged and playable, at [**/classic/**](https://bmanoj07112004-eng.github.io/OUTCRAFT/classic/).

---

## The 3D edition

| | |
|---|---|
| **Third-person 3D** | Run around a low-poly island with a follow camera: joystick on phones, WASD and mouse on desktop |
| **Adventure** | A Candy Crush style level map: **60 levels** in **6 worlds** (Meadow Isle, Sunny Dunes, Frost Fjord, Ember Peak, Crystal Caverns, Sky Gardens), a boss rival at the end of each world, up to **3 stars** per level from your score |
| **Rivals** | PIP, WREN, FOX, RAVEN and MIMIC, each reading more of your habits; they share one notebook about you |
| **Shop** | **13 skins** (Common to Legendary, with hats, capes, jetpacks, wings and sparkle trails), boosters and hearts, all bought with coins and gems you **earn by playing**. No real money |
| **Boosters** | Speed Boots (run 12% faster), Big Backpack (+1 bag slot), Head Start (the rival waits 2.5 s each order), Fog Cloak (the rival can't read you in the first order) |
| **Hearts** | 5 hearts; you only lose one when you fail or quit a level; one comes back every 20 minutes (or refill with gems) |
| **Every day** | A 7-day login calendar (day 7: the Festival Lights skin), the Daily Commission (same island for everyone), 13 achievements |
| **Still here** | Codex of 12 items, Tells (habits the rivals caught you in), "what the rival learned about you" after every match, share cards |

## How to play

1. The villager posts an **order**. The card at the top shows its recipe (e.g. Lantern = Glass (Sand + Wood) + Iron (Ore + Wood)).
2. **Run into a glowing resource** to gather it. Your bag holds 3.
3. **Run into the Workshop** to drop things off. Parts craft themselves.
4. Finish the item before your rival. **First to 3 orders wins.**

| | Phone | Desktop |
|---|---|---|
| Move | left thumb: joystick (appears where you touch) | WASD / arrow keys |
| Look | drag with the right thumb, pinch to zoom | drag with the mouse, wheel to zoom |
| Auto-run | tap a resource, the Workshop or the ground | click |
| Grab a resource the order doesn't need | GRAB button | E |
| Run home to the Workshop | HOME button | Space or H |
| Pause | pause button | P or Esc |

Your rival races you for the same scarce resources. Its dotted route line shows where it is going; when it heads for
*your* target a pill shows who will get there first (**FOX FIRST** / **YOU FIRST**). Every snatch comes with an honest
reason and a counter-tip: *"WREN predicted you. You walk to the nearest one, 7 of 9 trips. Try a farther one."* Take a
resource it was sure you wanted and you **FAKE IT OUT**.

Extras: add [`?glass=1`](https://bmanoj07112004-eng.github.io/OUTCRAFT/?glass=1) to see the rival's % guess on every
resource (also in Settings), or [`?blind=1`](https://bmanoj07112004-eng.github.io/OUTCRAFT/?blind=1) to race a rival
whose reads are switched off.

## For Lila reviewers: where each requirement is answered

The written answers describe the 2D prototype that was submitted; it lives on unchanged in [`classic/`](classic/). The
3D edition described in the rest of this README was built afterwards on the same simulation and rival AI.

| Lila asked for | Where it is |
|---|---|
| **Q1** a web link we can play in the browser (one click) | [bmanoj07112004-eng.github.io/OUTCRAFT](https://bmanoj07112004-eng.github.io/OUTCRAFT/) |
| **Q1** a GitHub link to the code | this repository ([`src/`](src/)) |
| **Q1** a single core loop that's genuinely fun + a day-1 hook | the game; hooks listed [below](#day-1-hooks-that-are-built) |
| **Q1** the pitch: what, who for, why play | [Q1 writeup §1](docs/Q1-outcraft-writeup.md) |
| **Q1** core loop and first session, what brings them back tomorrow | [Q1 writeup §2](docs/Q1-outcraft-writeup.md) |
| **Q1** progression and metagame (D1 hook built, months-long plan) | [Q1 writeup §3](docs/Q1-outcraft-writeup.md) |
| **Q1** money without a cash grab | [Q1 writeup §4](docs/Q1-outcraft-writeup.md) and [design doc §10](docs/OUTCRAFT-game-design.md#10-revenue-how-outcraft-makes-money-without-a-cash-grab) |
| **Q1** AI: how AI built it, and AI inside the game | [Q1 writeup §5](docs/Q1-outcraft-writeup.md) and [About](#about) |
| **Q1** shipping: first test, kill criteria, soft-launch numbers | [Q1 writeup §6](docs/Q1-outcraft-writeup.md) |
| **Q1** reference games: pulled apart, borrowed, done differently | [Q1 writeup §7](docs/Q1-outcraft-writeup.md) |
| **Q2** a mobile F2P genre nobody has cracked, and what it would take | [docs/Q2-social-deduction.md](docs/Q2-social-deduction.md) |
| **Q3** one innovative survivor-like feature, fully specified, with wireframes | [docs/Q3-echoes-feature-spec.md](docs/Q3-echoes-feature-spec.md) · [wireframes](docs/wireframes/) |
| Sources, assumptions and AI output disclosed | a "Sources, assumptions & AI use" section at the end of every document |
| Complete game design document (all systems, feel, retention, revenue) | [docs/OUTCRAFT-game-design.md](docs/OUTCRAFT-game-design.md) |
| Evidence you can re-run | [docs/data/](docs/data/) (simulations) · `node tools/test.mjs` (27 tests) |

**One thread runs through all three answers:** *design systems that read players, and let players read them back.* In Q1
the rival reads your routes; in Q2 social deduction is a game about reading people; in Q3 your build lives on as an
AI-piloted rival that reads other players.

---

## Why this game

- **The fantasy:** out-think something that is watching you. Cozy crafting on the surface, a mind game underneath.
- **Why it's fresh:** crafting games usually test *what* you know (recipes). OUTCRAFT tests *how predictable you are*. The
  rival studies your habits (do you always take the nearest tree? always follow the card's order? favour one side?) and gets
  there first. Every time it does, it tells you why, with real counts, and how to beat it next time.
- **Why it's fair:** the rival only knows what a human rival could know (your past choices and where you are walking,
  never your taps), its target is always on screen, and it never claims a habit that chance could explain.
- **Why it fits mobile:** one-minute matches, one thumb, tiny download, works offline, low-end Android friendly.

## Day-1 hooks that are built

1. **The rivals remember you.** Come back tomorrow and the title screen greets you by time away and quotes your
   statistically real habits ("You usually walk to the nearest one: 78% of trips, when chance says 41%").
2. **Daily Commission.** Same island and twist for everyone that day, one counted attempt, a streak, a share card:
   `OUTCRAFT · Daily #4 (Rush Hour) / Out-crafted FOX 3–1 · snatched 2× / 🟦🟦🟧🟦`.
3. **Codex** of 12 items, a **rival ladder** of 5, and **Tells** (your habits) to detect and then break.
4. **3D edition:** the next level on the map, stars to improve, a 7-day reward calendar, achievements to claim and hearts
   that refill while you are away.

## How it makes money (short version)

Never sell an advantage against an AI whose promise is fairness. Revenue comes from a **Workshop Pass** season
(₹149 to ₹249 · $4.99), **cosmetics** (₹19 to ₹99 sachets), a one-time **Supporter pack**, **opt-in rewarded ads** (never
mid-race, never after a loss), festival events and, later, creator islands. The rival's knowledge of you is never used for
prices or offers, and there are no real-money mechanics. Full model with illustrative economics:
[design doc §10](docs/OUTCRAFT-game-design.md#10-revenue-how-outcraft-makes-money-without-a-cash-grab).

The 3D edition's shop has no real-money store at all: skins, boosters and heart refills cost only coins and gems earned by
playing, so boosters are something you win, never something you buy.

## The AI, and what the evidence says

Every time you set off, the game records the choice you face (which resources you still need, how far each is, where on
the island it is, what the card lists first, what you took last) and which one you take. Five interpretable habit models
(Beeline, Home Turf, By the Book, Routine, Favourite Side) measure your choices against a player choosing at random among
the same options and are blended with **fixed-share Hedge**. The rival adds the direction you are walking and contests a
resource **only when its belief that you want it is above chance**. Everything runs on the device.

Measured with bot-player simulations (raw output in [docs/data/](docs/data/)):

| Question | Result |
|---|---|
| Does it learn you? | Its top guess on a human-like player rises from **65% to 73 to 77%** after the first match (chance ≈ 48%). |
| Does it cheat? | Against a truly random player it stays at chance (48 to 51%). |
| Is it honest? | Random players get a false habit claim in **3%** of cases and a false Tell in **8%**, even when checked after every one of 15 matches. |
| Is the difficulty curve right? | A human-like player wins **100% / 90% / 66% / 59% / 39%** against PIP / WREN / FOX / RAVEN / MIMIC. |
| Does learning decide who wins? | **Not yet, and I say so.** Informed reads raise snatches by 10 to 60% over a blind rival, but win rates move by less than ±5 points, because a snatch costs about a second of re-routing. Difficulty currently comes from speed and scarcity. The next design step is making a correct read decisive; see the Q1 writeup. |

## Run it locally

No build step, no dependencies to install (three.js r170 is vendored in [`vendor/three/`](vendor/three/), MIT licence):

```
node tools/serve.mjs 8080        # then open http://localhost:8080
node tools/test.mjs              # 27 simulation tests (islands, crafting, free movement, AI honesty, score, saves)
node tools/test-meta.mjs         # 17 tests for levels, economy, hearts, shop, daily rewards, achievements, save migration
node tools/levels.mjs 40         # Adventure calibration: joystick-style bot players through all 60 levels
node tools/sim.mjs 150           # balance: bot players vs every rival
node tools/tune.mjs 150          # ablation: full AI vs the same rival with its reads switched off
node tools/learning.mjs 50 6     # does the rival learn you? accuracy per match vs chance
node tools/audit.mjs 150 300 15  # control arms + honesty over repeated looks
```

Harness pages for each 3D and UI module live in [`dev/`](dev/) (e.g. `http://localhost:8080/dev/island.html?theme=3`).
The module contracts are in [docs/3d-architecture.md](docs/3d-architecture.md).

## Code map

| File | What it does |
|---|---|
| [`src/model.js`](src/model.js) | The player model: 5 habit experts, lift statistics, fixed-share Hedge, honest explanations, significance-gated claims |
| [`src/match.js`](src/match.js) | Pure, fixed-step match simulation: tap and free (joystick) movement, gathering, Workshop crafting, orders, score, the rival's decisions |
| [`src/world.js`](src/world.js) | Seeded island generator and BFS distance fields |
| [`src/data.js`](src/data.js), [`src/levels.js`](src/levels.js) | Resources, recipes, 12 items, 5 rivals, twists, score table; the 60 Adventure levels |
| [`src/economy.js`](src/economy.js), [`src/storage.js`](src/storage.js), [`src/skins.js`](src/skins.js) | Coins, gems, hearts, shop, boosters, daily rewards, achievements; local saves; skin catalogue |
| [`src/3d/`](src/3d/) | three.js engine, island and themes, effects, procedural characters and portraits, third-person camera, touch/keyboard input |
| [`src/ui/`](src/ui/), [`index.html`](index.html), [`style.css`](style.css) | Menus, level map, shop, results and the in-match HUD (HTML over the canvas) |
| [`src/game/`](src/game/), [`src/main.js`](src/main.js) | Game controller: boot and loop, match flow and feedback, menus, title-screen attract mode |
| [`src/audio.js`](src/audio.js), [`src/icons.js`](src/icons.js) | Synthesised sound and music; procedural item icons for the UI |
| [`classic/`](classic/) | The original 2D prototype (Lila Games submission), frozen and playable |
| [`archive/unreadable-v1/`](archive/unreadable-v1/) | The first prototype (a rhythm duel vs a predicting AI), kept as process evidence |

## About

**B Manoj** · started 23 September 2026 · completed 23 September 2026

I started with the idea of creating a small world-crafting game where the player receives an item to build, explores the island to find the required resources, and crafts it before an AI rival can do the same.

I explained the core gameplay, mechanics, progression, visual direction, and the overall experience I wanted to create. I then worked with AI to turn those ideas into the game's systems, recipes, resource mechanics, rival-learning system, progression, challenges, simulations, and supporting code.

I kept refining the game by testing the mechanics, adjusting the balance, improving the gameplay flow, and changing things based on what worked and what didn't. I also used AI to help review the code, identify problems, suggest improvements, and build different parts of the prototype faster.

The result is OUTCRAFT — a game built around exploration, resource gathering, crafting, and competing against a rival that learns from the way you play.

Everything was designed to keep the experience simple, fast, and replayable, while making every crafting decision feel like a race against your opponent.

No accounts. No trackers. No unnecessary network features. The game's core experience runs locally on the device.
