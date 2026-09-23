# OUTCRAFT

**A pocket-island crafting race against an AI rival that learns how you move.**

**Play:** [https://bmanoj07112004-eng.github.io/OUTCRAFT/](https://bmanoj07112004-eng.github.io/OUTCRAFT/) · **Rival with its reads off:** [https://bmanoj07112004-eng.github.io/OUTCRAFT/?blind=1](https://bmanoj07112004-eng.github.io/OUTCRAFT/?blind=1) · **Code:** [https://github.com/bmanoj07112004-eng/OUTCRAFT](https://github.com/bmanoj07112004-eng/OUTCRAFT)

> **TL;DR**
> - A villager orders a Lantern; you and an AI rival race across a 9×13 island for the same scarce nodes. First to 3 crafted orders wins, in about a minute.
> - The rival learns your route habits with five small, readable models and only goes out of its way to take a node on an informed read of you. Its target is on screen, every snatch is explained, and habit claims must pass a significance test.
> - Built D1 hooks: a notebook that greets you with your habits, a Daily with streak and share grid, a Codex, a rival ladder, Tells.
> - In bot simulations the rival reads a habitual bot at 90-91% (chance ~49%) and a random bot not at all. Weak spot, found by an AI reviewer's control arm: the reads change where it fights you, not yet who wins.
> - First test: can players tell the reading rival from one with its reads off, which bots beat about as often?

I design systems that read players and let players read them back. OUTCRAFT is the smallest playable version of that idea I could build.

## 1. The pitch

**What it is.** A one-thumb, portrait crafting race. The order card shows the recipe tree: Lantern = Glass (Sand + Wood) + Iron (Ore + Wood). You tap nodes to gather, carry three at a time to your Workshop, and parts craft themselves. Your rival needs the same Sand, and the island has two. The fantasy is outsmarting a rival that studies you: its route is a dotted line that turns red when it heads for your node and will get there first, so you can take the other Sand, beat it there, or fake it out.

**Who it's for** (assumptions). Primary: "beat the machine" players on budget Android in India, arriving through a friend's Daily share on WhatsApp. The build is about 186 KB of HTML, CSS and JS (measured 23 Sep 2026), with no image or audio files and no network calls: it loads on patchy data and costs nothing to serve, which matters at about $0.0074 revenue per Indian gamer-day (§4). Secondary: daily-puzzle players (the Wordle habit). Not the target: cozy crafters, since the core verb is a rival taking your materials (§6 tests whether that reads as punishment).

**Why play it.** Crafting games are mostly solitaire; game AIs are mostly scripted or rubber-banded. This rival reads you and shows its working (though today its edge comes mostly from speed, §5a). My falsifiable bet: being read feels flattering when the read is shown as counts and can be beaten. If testers call it creepy or punishing more often than fun, the pitch is wrong.

## 2. Core loop and first session

```
ORDER    villager posts "LANTERN"; the card shows the recipe tree
PLAN     read the rival's dotted line: which node is it going for?
GATHER   tap a node, walk, gather (0.45 s); bag holds 3
           rival gets there first     -> "SNATCHED!" + reason + tip; you re-pick
           you reach its target first -> "BEAT IT!"
           it bet on a node you skip  -> "FAKED OUT!"
DEPOSIT  Workshop: parts auto-craft; finished item = +1 star
REPEAT   first to 3 stars (max 5 orders); leftovers carry over
RESULTS  Codex, Tells, what the rival learned -> next rival or the Daily
```

Nodes hold one unit and regrow in 6.5-12 s, so every unit the rival takes is one you wait for.

**Pure randomness loses, and so does fooling the rival for its own sake.** In simulation the random bot wins least against every rival (18% vs MIMIC; human-like bot 39%) because wandering wastes steps, though it fakes MIMIC out most (1.1 times a match; always-nearest bot 0.6). The skill is being efficient and unpredictable at once. Untested threat: between two equidistant nodes randomising is free, and if that blinds the rival, COUNTER (§3) becomes a necessity.

**The first five minutes, as built** (times estimated from simulated match lengths):

| Time | Beat | Player learns |
|---|---|---|
| 0:00 | Title over a self-playing island; HOW TO PLAY in 4 lines | the rules |
| 0:20 | Match 1 vs PIP, the apprentice; a bouncing hand points at a gold-ringed node | gather, deposit, craft |
| ~0:40 | "Red line! PIP will get there first. Tap a different one!" | the line is information |
| ~1:10 | A 3–0 or 3–1 win (the human-like bot beats PIP 100% in sim); "You usually walk to the nearest one: 100% of trips, when chance says 28%." | it was watching |
| 1:45 | WREN: "Pip told me about you. You like the nearest thing, right?" | the rivals share notes |
| 3:00+ | "WREN predicted you. You walk to the nearest one, 9 of 10 trips. Try a farther one. Tap another one!" (counts illustrative) | break the habit |

**The second door is worse.** Arrivals from a friend's Daily result may tap DAILY first: HOW TO PLAY, then FOX instead of PIP, with no tutorial tips and sometimes a twist that makes FOX faster than you. Fix before any test: a first Daily with tips and no hard twist.

**What brings them back tomorrow.** Rewards are built: the greeting quotes your tested habits, and a new Daily, streak, Codex silhouettes and unbroken Tells wait. The only built trigger is a friend's share. Planned: ladder pacing (§3), a Daily-reset notification, one real finding held back a day. Honesty costs hook strength: a varied player hears "No clear habits yet", so fall back to a true stat ("You beat WREN to 4 nodes yesterday").

## 3. Progression and metagame

### Built D1 hooks

| Hook | What is built |
|---|---|
| **Rivals remember you** | A shared, persistent notebook. The title greets you by time away ("Welcome back. 14 hours, and we have not stopped talking about your routes."; after days away, "We kept your notebook.") and quotes 1-2 tested habits. |
| **Daily Commission** | Date-seeded island, orders and twist vs a memoryless FOX, so results compare. Only your first attempt counts (replays say so; no server leaderboard); the streak counts days played, not wins; spoiler-free share grid. |
| **Codex** | 12 items, tiers 1-5, silhouettes until won. |
| **Ladder** | PIP, WREN, FOX, RAVEN, MIMIC; beat one to face the next. |
| **Tells** | Five habits. Named only when, over ≥ 8 choices in a match, the rival's hit rate beats a uniform guess by ≥ 25 points at z ≥ 2.6; broken at ≤ 5 points; can relapse. |

**Built content is thin.** At the human-like bot's win rates (100/90/66/59/39%), the ladder takes about 8 matches, roughly 10 minutes (estimate: sum of 1/win rate, 48-70 s a match, plus menus): a keen player finishes on day 0. Cheap fixes: pace the ladder as appointments ("RAVEN arrives tomorrow"), and add Codex stamps (0 snatches, vs MIMIC, in a Daily), turning 12 items into 48 goals.

### The months-long plan (not built)

| Layer | What it adds | Why it holds people |
|---|---|---|
| **COUNTER, RHYTHM** (first) | COUNTER predicts your over-correction after you break a habit (people trying to be random alternate too often, [Wagenaar 1972](https://doi.org/10.1037/h0032060); for routes, a hypothesis). RHYTHM reads timing | Your fix becomes your next tell; systemic, not handmade |
| **Seasons** | A biome, new resources, a Codex set | Collection, fresh habits |
| **Pass-and-play** | Two players, one phone, one rival reading both | Groups without matchmaking |
| **Shadows** | Your notebook races friends via a shareable code, no server (inspired by my Q3 loop, ECHOES); adults only here, since this rival models habits | Social play without real-time liquidity |

Cut: real-time co-op (my Q2 liquidity problem) and a crowd-built weekly rival (needs a backend).

### Memory must not become a loyalty tax

In most games, time invested makes you stronger. Here it makes your opponent stronger. The built guards: evidence decays ×0.7 per match (old choices weigh 17% after 5 matches, 3% after 10); model weights relax 40% toward equal between matches; the Daily rival starts blank; "Make them forget me" wipes it all. Planned: leaderboards use the Daily only, verified by replaying uploaded inputs (matches are deterministic; tested).

## 4. Money

**Principle: never sell advantage against an AI whose whole promise is fairness.** If a "hide your route" potion were for sale, every snatch would read as a sales pitch.

**The economy (not built; nothing is earned or spent today).** One soft currency per order won buys outfits and decor; Codex items become placeable decor. A share card (via Web Share) shows your outfit, so cosmetics get an audience with zero servers.

| Would sell | Won't sell |
|---|---|
| Outfits, decor, trails | speed, bigger bags, route hiding, peeks at the model |
| Supporter pack: no ads, a Daily Archive (rebuilt free from date seeds), one outfit | anything in the counted Daily |
| Rewarded ads between matches that double coins | ads mid-race or after a snatch-decided loss |

Streak freezes will be earned, never sold (1 per 7-day streak, max 2; not built). Prices (assumptions): ₹10 per colourway, Google Play's India minimum since 2015 ([Android Police](https://www.androidpolice.com/2015/07/31/google-play-reduces-the-minimum-app-and-in-app-purchase-price-in-india-from-rs-50-to-rs-10-0-156/)); Supporter pack ₹99-149, $2.99 in the US.

**The envelope (estimate).** Revenue per Indian gamer-day is about $0.0074 ($1.5B non-RMG revenue / 555M gamers / 365, [Lumikai](https://respawn.outlookindia.com/gaming/gaming-news/lumikai-india-gaming-market-1-5-billion-rmg-ban-2025)). At the §6 targets (D1 30%, D7 7%), a power-law retention curve gives about 2.8 active days in a player's first 30: $0.02 per player, $0.06 if real ARPDAU is 3× that. Paid installs above a few cents can't pay back, so India is organic and share-driven; monetisation is tested in a Tier-1 market.

**The firewall.** The player model never touches pricing, offers or ad targeting. Any script on the game's origin can read localStorage, so shop and ad code will run in a sandboxed cross-origin iframe, with no third-party SDK in the origin. Store page line: "It reads your routes, never your wallet."

## 5. AI

### 5a. The AI inside the game

**How it reads you.** When you set off, the rival notes your options and your pick. Five habit models (Beeline, Home Turf, By the Book, Routine, Favourite Side) each guess your next pick, scoring you against a uniformly random player facing the same options, (observed + 1) / (expected + 1), so habits transfer across islands. Fixed-share Hedge on log-loss (η 0.6, 4% share; predictions smoothed 3% toward uniform, log-loss floored at 2%) trusts whichever has been right lately; your walking direction adds live evidence. It never uses your tap target to decide where to go (by code inspection); after a snatch it logs the node you were heading for as one of your choices. `?glass=1` shows its % guess on every node you might go for next.

**It only contests what it has read.** Each node scores [need + informed × P(it arrives first) × steal or deny weight] / (travel + wait + 0.8 s), with informed = max(0, (p − 1/n) / (1 − 1/n)): p is its belief that you want the node, n your number of options. A uniform belief gives zero, so a rival that knows nothing about you never goes out of its way to take your node. Every contest is an informed read.

**Honesty rules.** (1) Each snatch names its evidence from the exact choice context the rival committed on: a habit with counts (Beeline and By the Book only in the direction the evidence points), your heading, or luck ("FOX only gave that node 22%"); habit and heading reads add a counter-tip. The counts are decay-weighted, so the copy should say "recent trips". (2) A title-screen habit needs a ≥ 15-point effect and a z-score above a bar raised for repeated looks and for the number of statistics searched (2.9 to 3.6). (3) Tells have their own gate (§3). Checked after each of 15 matches vs FOX, 300 random choosers ([sim-audit.txt](data/sim-audit.txt)): 3.3% ever get a false habit claim (10% before the bars rose; earlier run, not archived) and 8.3% a false NEW TELL card (60.7% before gating; earlier run, not archived). 8.3% is still one in twelve: the next bar to raise.

**Evidence (bot simulations).** *Greedy* takes the nearest node; *human* takes its first pick (nearest, mild left bias) 72% of the time; *random* picks uniformly; *reader* avoids the rival's target when the rival would arrive first. No bot has a deliberate Turf, Book or Routine habit; greedy, human and reader start from nearest (the human's left bias is a weak Side habit), so mostly Beeline is exercised. The human bot in learning.mjs has no left bias. 150 matches per cell: about ±8 points at 95%.

Player win rate ([sim-balance.txt](data/sim-balance.txt)):

| Rival | greedy | human | random | reader |
|---|---|---|---|---|
| PIP | 99% | 100% | 93% | 99% |
| WREN | 91% | 90% | 69% | 92% |
| FOX | 85% | 66% | 47% | 81% |
| RAVEN | 61% | 59% | 37% | 68% |
| MIMIC | 47% | 39% | 18% | 43% |

Matches last 47-70 s; snatches rise with rival strength (greedy bot 1.5 → 4.7 a match). The reader beats the always-nearest bot only at WREN and RAVEN, within noise: dodging the red line is not yet a proven skill.

**What the AI adds.** *Blind* (`?blind=1`) switches the reads off. With informed-only contesting it never contests either, so the audit's contest-only arm (contesting kept, uniform belief) now nearly matches blind: same win rate in 11 of 12 cells (MIMIC vs greedy: 40% vs 41%), snatches within 0.1 per match ([sim-audit.txt](data/sim-audit.txt)). Player win rate and snatches per match, full/blind, same islands ([sim-ablation.txt](data/sim-ablation.txt)):

| Rival | greedy | human | reader |
|---|---|---|---|
| WREN | 92/94% · 2.2/2.0 | 88/89% · 2.0/1.9 | 91/93% · 1.4/1.2 |
| FOX | 81/77% · 3.2/2.5 | 75/71% · 2.4/2.3 | 77/79% · 2.0/1.4 |
| RAVEN | 57/62% · 3.8/3.1 | 57/57% · 3.2/2.8 | 60/59% · 2.5/1.9 |
| MIMIC | 44/41% · 4.8/3.5 | 36/35% · 3.6/3.0 | 44/49% · 3.2/2.1 |

The two tables use different island sets (sim.mjs seeds 1000-1149, tune.mjs 9000-9149), so the same cell can differ by up to 9 points (FOX vs human-like: 66% above, 75% here). That is the ±8-point noise.

**The honest finding: the learned model changes where the rival fights you, not yet who wins.** Reads on, it makes 4-52% more snatches (greedy bot: +10% vs WREN, +37% vs MIMIC), yet the player's win rate moves −5 to +4 points (the rival's −4 to +5), inside the noise. A snatch costs about a second of re-routing (estimate): it stings but rarely decides an order. Difficulty comes from speed, scarcity and shorter think pauses: rivals run at 3.0 (PIP), 3.5, 3.75, 3.9 and 4.15 tiles/s (MIMIC) to your 3.8, and pause 0.55 s (PIP) down to 0.05 s (MIMIC) before each decision. An AI review agent's control arm found this; I report it, not hide it. Next design step: make a correct read decisive (one key ingredient per order that only one crafter can take, or claims that lock a node for a few seconds), then re-run the same ablation.

**Does it learn?** RAVEN's top-guess accuracy on your next node, 50 players × 6 matches, against uniform chance of 46-51% (about 49% from match 2) ([sim-learning.txt](data/sim-learning.txt)): a beeliner goes from 82% in match 1 to 90-91%; the human-like bot from 65% to 73-77%, close to the 72% at which it follows its habit. The random bot, the control, stays at 48-51%, level with chance: it cannot read a random player, so it is not cheating.

**Earlier builds** (runs not archived) got their difficulty from speed, then mostly from contesting nodes the rival had not read; informed-only contesting removed the latter.

**Why no LLM at runtime.** *Cost:* 13 node choices a match (10-14 in sim) × 800 input / 20 output tokens (assumption) on Claude Haiku 4.5 at $1 / $5 per million ([Anthropic](https://platform.claude.com/docs/en/about-claude/pricing)) is $0.035 per player-day at 3 matches (assumption), ~4.7× revenue per Indian gamer-day; caching doesn't help, since Haiku 4.5 only caches prefixes of 4,096+ tokens. *Fit:* the counts model already predicts the human-like bot about as well as its habit allows. *Latency:* a trip lasts 1-2 s (estimate), so the guess must be ready at set-off. *Checkability:* every claim is k of n from counts, and deterministic matches (tested) keep the Daily fair.

**Where an LLM would fit.** At build time (dialogue, flavour, recipes, reviewed by me), and as narration behind a fact validator: it sees only verified facts (habit, k, n, chance) and writes one line in the rival's voice, else the template stands. One call per match (400 in, 60 out, assumption) is $0.0007, 28% of revenue per Indian gamer-day at 3 matches: Tier-1 first, or on-device.

**Ethics and privacy.** The notebook stays on the device as tallies; one button wipes it. **Minors:** India's DPDP Act 2023 defines a child as under 18 ([s.2(f)](https://indiankanoon.org/doc/20425670/)) and, from 14 May 2027 ([DPDP Rules timeline](https://www.amsshardul.com/insight/enforcement-of-the-dpdp-act-and-notification-of-the-dpdp-rules/)), bars "tracking or behavioural monitoring of children" ([s.9](https://indiankanoon.org/doc/98869575/)); the UK Children's Code wants profiling off by default ([ICO](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/12-profiling/)). A habit-modelling rival may fall under that. I'm not a lawyer. Pending advice: an age gate, and no cross-match memory for under-18s, measured as a separate cohort.

### 5b. How AI was used to build it

I started with the idea of creating a small world-crafting game where the player receives an item to build, explores the island to find the required resources, and crafts it before an AI rival can do the same.

I explained the core gameplay, mechanics, progression, visual direction, and the overall experience I wanted to create. I then worked with AI to turn those ideas into the game's systems, recipes, resource mechanics, rival-learning system, progression, challenges, simulations, and supporting code.

I kept refining the game by testing the mechanics, adjusting the balance, improving the gameplay flow, and changing things based on what worked and what didn't. I also used AI to help review the code, identify problems, suggest improvements, and build different parts of the prototype faster.

The result is OUTCRAFT — a game built around exploration, resource gathering, crafting, and competing against a rival that learns from the way you play.

Everything was designed to keep the experience simple, fast, and replayable, while making every crafting decision feel like a race against your opponent.

No accounts. No trackers. No unnecessary network features. The game's core experience runs locally on the device.

## 6. Shipping

**Stages** (sizes are assumptions): (0) a lab test, 100 players; (1) an unlisted web cohort of ~500 via WhatsApp and college groups, opt-in telemetry, for D1, D7, the ladder funnel and players per share; (2) an India soft launch as a web app wrapped for Google Play (a Trusted Web Activity); (3) a small Tier-1 cohort for monetisation.

**Test first: a rival Turing test.** The control is already built: bots beat `?blind=1` FOX about as often as full FOX (human-like 71% vs 75%), so players can't spot "the one that read me" by who beat them, only by where it fought them. Each player plays 3 matches per arm (same islands, counterbalanced, labelled A/B), then says which read them and which was more fun; after each snatch, "did it predict you?" (scored against the rival's logged evidence) and "fair / cheap". With 100 players, 60 correct beats a coin flip (one-sided p ≈ 0.03) and catches a true 70% detection rate 99% of the time.

| Signal | Line (assumption) | Then |
|---|---|---|
| Telling full from blind | < 60 of 100 | Make a correct read decisive (§5a), retest once; still failing: drop the AI pitch, keep the race |
| Fun and tone | Majority prefer blind, or "creepy" or "punishing" beats "fun" | Lower steal weights, softer copy: a show-off, not a thief |
| Snatch fairness | > 30% "cheap" | Longer telegraph; cap snatches per order |
| Legal read on minors | Habit modelling of under-18s needs consent or is barred | Session-only rival for minors, or launch 18+ or Tier-1 first |

**Numbers to watch** (Stages 1-2; targets are assumptions):

| Metric | Target | Why |
|---|---|---|
| D1, split by habit claimed in session 1 (yes/no) and by share-link arrival | ≥ 30% | [GameAnalytics 2026](https://www.gameanalytics.com/reports/2026-mobile-pc-gaming-benchmarks): median ~22%, top quartile just above 30%. The splits test whether the notebook causes returns |
| D7 / D30 | ≥ 7% / ≥ 2% | Top quartile 6-7% / 1.6-1.8%, so the D30 target is above top quartile (the power-law curve from D1 30% / D7 7% gives ~2.4%); the West leads, so India may run lower |
| New players per Daily share | set after Stage 1 | The India acquisition engine; no benchmark |
| Quit within 10 s of a snatch-decided loss | ≤ 1.2× other losses | Does the rival feel fair? |

**Known risk: the notebook can vanish.** Safari deletes script-writable storage after seven days of Safari use without user interaction on the site; home-screen web apps keep their own day counter, so regular players keep their data ([WebKit, 2020](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)); in-app browsers and shared family phones add risk (assumptions). Fixes: `navigator.storage.persist()`, the installable app, profiles, notebook export.

## 7. Reference games

| Game | Pulled apart | Borrowed | Did differently |
|---|---|---|---|
| [Overcooked](https://en.wikipedia.org/wiki/Overcooked) (2016) | Movement between stations is the cost | Orders; routes as skill | Competitive, on shared scarce nodes |
| [Hay Day](https://en.wikipedia.org/wiki/Hay_Day) (2012) | Production chains feeding truck orders | Orders as the F2P session unit | Every order is contested |
| [Little Alchemy](https://www.criticalhit.net/gaming/little-alchemy-2-and-the-games-built-on-combining-elements) (2010), [Infinite Craft](https://en.wikipedia.org/wiki/Infinite_Craft) (2024) | Discovery by combining; Infinite Craft uses Meta's Llama 2 and 3.1 | The Codex | Recipes up front, so both racers plan on one tree |
| [MGSV](https://en.wikipedia.org/wiki/Metal_Gear_Solid_V:_The_Phantom_Pain) (2015), [Shadow of Mordor](https://en.wikipedia.org/wiki/Middle-earth:_Shadow_of_Mordor) (2014) | Guards adapt (headshots bring helmets); Nemesis enemies remember you | Counter-play; being remembered | Mine names the habit, shows its target and can be beaten mid-match |
| [Aaronson's Oracle](https://github.com/elsehow/aaronson-oracle); [NYT "Rock-Paper-Scissors: You vs. the Computer"](https://flowingdata.com/2011/03/07/test-your-rock-paper-scissors-strategy-against-the-machine/) (2011) | A 5-gram predictor right ~70% of the time; a view of its thinking | Prediction as antagonist; visible reasoning | Randomness costs steps |
| [Wordle](https://x.com/powerlanguish/status/1471493886031773707); [Duolingo](https://blog.duolingo.com/improving-the-streak) | Spoiler-free share grid (Dec 2021, per [Slate](https://slate.com/culture/2022/01/wordle-game-creator-wardle-twitter-scores-strategy-stats.html)); A/B-tuned streaks | Daily, grid, streak | The grid records orders vs a named rival; freezes earned, never sold (planned) |

**Patent flag.** WB's Nemesis patent (US 10,926,179, active until 2036 per [Google Patents](https://patents.google.com/patent/US10926179B2/en)) claims NPC-to-NPC parameter changes shown to the player; "Pip told me about you" needs a legal read, with per-rival notebooks as the fallback.

## 8. What I'd do with two more weeks

- Make a correct read decisive, then re-run the full-vs-blind ablation.
- Raise the Tell bar toward the dossier's 3.3% false-claim rate; say "recent trips" in snatch copy.
- A first Daily with tips for share-link arrivals.
- The 100-player full-vs-blind test, with opt-in telemetry.
- Efficient-random, feint and per-habit bots; a COUNTER prototype.
- `navigator.storage.persist()`, a manifest, notebook export; a colour-vision pass.

## 9. Sources, assumptions & AI use

**Internal evidence.** [`data/`](data/): sim-balance (`node tools/sim.mjs 150`), sim-ablation (`tune.mjs 150`), sim-learning (`learning.mjs 50 6`), sim-audit (`audit.mjs 150 300 15`). `node tools/test.mjs` on 23 Sep 2026: 11 tests passed. Parameters are read from `src/`. Decay percentages, ladder length, snatch ratios, build size, LLM costs, the retention envelope and binomial figures are my arithmetic.

**External sources** are linked inline, retrieved 23 Sep 2026 and checked against the primary pages by a fact-check pass.

**Assumptions (not measured):** segments; prices; stage sizes, kill lines and targets; tokens per call; 3 matches a day; latency, trip length and the one-second cost of a snatch; first-session timings; storage-loss causes other than Safari's.

**Not evidence:** every win rate and accuracy figure comes from bots. The only human play is mine, and none of it is reported as data. Whether the rival feels fair, fun or creepy is a hypothesis until the §6 test runs.

**AI use.** Credits are in §5b. This writeup was drafted with Claude, critiqued by multiple AI reviewer passes (hiring-manager lens, fact-checker, domain expert) and revised; numbers were checked against the data files and code.
