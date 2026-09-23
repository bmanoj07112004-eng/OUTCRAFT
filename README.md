# OUTCRAFT

OUTCRAFT is a fast-paced crafting race where players explore a small island, collect scarce resources, and craft target
items before their AI rival. The rival learns your movement and gathering habits, predicts your next move, and adapts its
strategy. Outsmart the AI, master crafting, earn stars, and climb through increasingly challenging rivals.

## ▶ [Play in the browser](https://bmanoj07112004-eng.github.io/OUTCRAFT/): one click, nothing to install, phone or laptop

**Submission for the Lila Games Game Designer Written Test (Part 1)** · by **B Manoj**

---

## For Lila reviewers: where each requirement is answered

| Lila asked for | Where it is |
|---|---|
| **Q1** a web link we can play in the browser (one click) | [bmanoj07112004-eng.github.io/OUTCRAFT](https://bmanoj07112004-eng.github.io/OUTCRAFT/) |
| **Q1** a GitHub link to the code | this repository ([`src/`](src/)) |
| **Q1** a single core loop that's genuinely fun + a day-1 hook | the game; hooks listed [below](#day-1-hooks-that-are-built) |
| **Q1** the pitch: what, who for, why play | [Q1 writeup §1](docs/Q1-outcraft-writeup.md) |
| **Q1** core loop and first session, what brings them back tomorrow | [Q1 writeup §2](docs/Q1-outcraft-writeup.md) |
| **Q1** progression and metagame (D1 hook built, months-long plan) | [Q1 writeup §3](docs/Q1-outcraft-writeup.md) |
| **Q1** money without a cash grab | [Q1 writeup §4](docs/Q1-outcraft-writeup.md) and [design doc §10](docs/OUTCRAFT-game-design.md#10-revenue-how-outcraft-makes-money-without-a-cash-grab) |
| **Q1** AI: how AI built it, and AI inside the game | [Q1 writeup §5](docs/Q1-outcraft-writeup.md) and [how it was made](#about-how-this-was-made-human--ai) |
| **Q1** shipping: first test, kill criteria, soft-launch numbers | [Q1 writeup §6](docs/Q1-outcraft-writeup.md) |
| **Q1** reference games: pulled apart, borrowed, done differently | [Q1 writeup §7](docs/Q1-outcraft-writeup.md) |
| **Q2** a mobile F2P genre nobody has cracked, and what it would take | [docs/Q2-social-deduction.md](docs/Q2-social-deduction.md) |
| **Q3** one innovative survivor-like feature, fully specified, with wireframes | [docs/Q3-echoes-feature-spec.md](docs/Q3-echoes-feature-spec.md) · [wireframes](docs/wireframes/) |
| Sources, assumptions and AI output disclosed | a "Sources, assumptions & AI use" section at the end of every document |
| Complete game design document (all systems, feel, retention, revenue) | [docs/OUTCRAFT-game-design.md](docs/OUTCRAFT-game-design.md) |
| Evidence you can re-run | [docs/data/](docs/data/) (simulations) · `node tools/test.mjs` (11 tests) |

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

## How to play

1. The villager posts an **order**. The card at the top shows its recipe (e.g. Lantern = Glass (Sand + Wood) + Iron (Ore + Wood)).
2. **Tap a resource with a gold ring** to walk over and gather it. Your bag holds 3.
3. Tap the **Workshop** (or the ⌂ button) to drop things off. Parts craft themselves.
4. Finish the item before your rival. **First to 3 orders wins.**

Your rival races you for the same scarce resources. Its dotted line shows where it is going; when it heads for *your*
target a pill shows who will get there first (**FOX FIRST** / **YOU FIRST**). Every snatch comes with an honest reason and
a counter-tip: *"WREN predicted you. You walk to the nearest one, 7 of 9 trips. Try a farther one."* Take a resource it was
sure you wanted and you **FAKE IT OUT**. After each match, *"What FOX learned about you"* shows how often it guessed right.

Desktop: click to move · arrows/WASD step · Space = Workshop · P = pause.
Extras: add [`?glass=1`](https://bmanoj07112004-eng.github.io/OUTCRAFT/?glass=1) to see the rival's % guess on every
resource, or [`?blind=1`](https://bmanoj07112004-eng.github.io/OUTCRAFT/?blind=1) to race a rival whose reads are
switched off (used for the "can players tell?" test).

## What's in the game

| System | What it does |
|---|---|
| **Island** | 9×13 procedurally generated island per match; 13 resource nodes (1 unit each, regrow in 6.5 to 12 s) |
| **Crafting** | 6 resources → 7 components → **12 items** in 5 tiers (Torch … Telescope … Clock); parts auto-craft at the Workshop |
| **Match** | up to 5 orders of rising tier; first to 3 stars; about one minute |
| **Rival ladder** | PIP (only takes notes) → WREN → FOX → RAVEN → MIMIC, each reading more of your habits; all share one notebook about you |
| **Feel** | VS splash, living title screen, rival personalities and speech bubbles, crafting pops, music and haptics, confetti |
| **Day-1 hooks** | rivals remember you · Daily Commission + streak + share card · Codex · Tells to detect and break |

### Day-1 hooks that are built

1. **The rivals remember you.** Come back tomorrow and the title screen greets you by time away and quotes your
   statistically real habits ("You usually walk to the nearest one: 78% of trips, when chance says 41%").
2. **Daily Commission.** Same island and twist for everyone that day, one counted attempt, a streak, a share card:
   `OUTCRAFT · Daily #4 (Rush Hour) / Out-crafted FOX 3–1 · snatched 2× / 🟦🟦🟧🟦`.
3. **Codex** of 12 items, a **rival ladder** of 5, and **Tells** (your habits) to detect and then break.

### How it makes money (short version)

Never sell an advantage against an AI whose promise is fairness. Revenue comes from a **Workshop Pass** season
(₹149 to ₹249 · $4.99), **cosmetics** (₹19 to ₹99 sachets), a one-time **Supporter pack**, **opt-in rewarded ads** (never
mid-race, never after a loss), festival events and, later, creator islands. The rival's knowledge of you is never used for
prices or offers, and there are no real-money mechanics. Full model with illustrative economics:
[design doc §10](docs/OUTCRAFT-game-design.md#10-revenue-how-outcraft-makes-money-without-a-cash-grab).

## The AI, and what the evidence says

Every time you set off, the game records the choice you face (which resources you still need, how far each is, where on
the island it is, what the card lists first, what you took last) and which one you take. Five interpretable habit models
(Beeline, Home Turf, By the Book, Routine, Favourite Side) measure your choices against a player choosing at random among
the same options and are blended with **fixed-share Hedge**. The rival adds the direction you are walking and contests a
resource **only when its belief that you want it is above chance**. Everything runs on the device.

Simulated with bot players (raw output in [docs/data/](docs/data/); no human playtest data yet):

| Question | Result |
|---|---|
| Does it learn you? | Its top guess on a human-like player rises from **65% to 74 to 77%** after the first match (chance ≈ 48%). |
| Does it cheat? | Against a truly random player it stays at chance (48 to 51%). |
| Is it honest? | Random players get a false habit claim in **3%** of cases and a false Tell in **8%**, even when checked after every one of 15 matches. |
| Is the difficulty curve right? | A human-like player wins **100% / 90% / 66% / 59% / 39%** against PIP / WREN / FOX / RAVEN / MIMIC. |
| Does learning decide who wins? | **Not yet, and I say so.** Informed reads raise snatches by 10 to 60% over a blind rival, but win rates move by less than ±5 points, because a snatch costs about a second of re-routing. Difficulty currently comes from speed and scarcity. The next design step is making a correct read decisive; see the Q1 writeup. |

## Run it locally

No build step, no dependencies:

```
node tools/serve.mjs 8080        # then open http://localhost:8080
node tools/test.mjs              # 11 invariant tests (islands, deadlocks, crafting, AI honesty, saves)
node tools/sim.mjs 150           # balance: bot players vs every rival
node tools/tune.mjs 150          # ablation: full AI vs the same rival with its reads switched off
node tools/learning.mjs 50 6     # does the rival learn you? accuracy per match vs chance
node tools/audit.mjs 150 300 15  # control arms + honesty over repeated looks
node tools/experiment.mjs        # try economy / rival settings
```

## Code map

| File | What it does |
|---|---|
| [`src/model.js`](src/model.js) | The player model: 5 habit experts, lift statistics, fixed-share Hedge, honest explanations, significance-gated claims |
| [`src/match.js`](src/match.js) | Pure, fixed-step match simulation: movement, gathering, Workshop crafting, orders, the rival's decisions |
| [`src/world.js`](src/world.js) | Seeded island generator and BFS distance fields |
| [`src/data.js`](src/data.js) | Resources, recipes, 12 items, 5 rivals (with personalities), Daily twists |
| [`src/render.js`](src/render.js), [`src/icons.js`](src/icons.js) | Canvas renderer and procedural art (no image files) |
| [`src/main.js`](src/main.js), [`src/storage.js`](src/storage.js), [`src/audio.js`](src/audio.js) | Game flow and UI, local saves and day-1 systems, synthesised sound and music |
| [`archive/unreadable-v1/`](archive/unreadable-v1/) | The first prototype (a rhythm duel vs a predicting AI), kept as process evidence |

## About: how this was made (human × AI)

| | |
|---|---|
| **Started** | 23 September 2026, 1:07 pm IST |
| **First prototype** | UNREADABLE, built, tested and red-teamed by about 2:05 pm, then archived |
| **Pivot to OUTCRAFT** | about 2:05 pm; first playable about 2:30 pm |
| **Reviews, polish, re-balance, docs** | 2:45 pm onward |
| **First public build** | 23 September 2026 |

- **B Manoj (designer):** came up with the core idea (a small-world crafting game: you are handed an item to make, find the
  resources on the island and craft it), chose to make it a race against an AI rival that learns you, set the direction and
  the quality bar, made the key calls (dropping the first prototype, the premium polish pass, the About section, the public
  release), and playtested and gave feedback.
- **Claude Code (AI, Anthropic):** turned that direction into detailed systems and code (recipes and resource tuning, the
  rival's learning model and decision rule, the rival ladder, the day-1 hooks, procedural art and audio), plus the bot
  simulations, tests, research and document drafts, and AI review passes whose findings were fixed.
- **Checked, not assumed:** 11 automated tests and reproducible simulations. Retention and revenue figures are assumptions
  to be tested, and every document labels them that way.

No trackers, no accounts, no network calls: what the rivals learn about you stays on your device
(Codex → "Make them forget me").
