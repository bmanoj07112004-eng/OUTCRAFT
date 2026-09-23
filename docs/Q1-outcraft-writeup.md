# OUTCRAFT

**A pocket-island crafting race against an AI rival that learns how you move.**

**Play:** [https://bmanoj07112004-eng.github.io/OUTCRAFT/](https://bmanoj07112004-eng.github.io/OUTCRAFT/) · **Rival with its reading off:** [https://bmanoj07112004-eng.github.io/OUTCRAFT/](https://bmanoj07112004-eng.github.io/OUTCRAFT/)?blind=1 · **Code:** [https://github.com/bmanoj07112004-eng/OUTCRAFT](https://github.com/bmanoj07112004-eng/OUTCRAFT)

> **TL;DR**
> - A villager orders a Lantern; you and an AI rival race across a 9×13 island for the same scarce nodes. First to 3 crafted orders wins, in about a minute.
> - The rival learns your route habits with five small, readable models and heads for the node it predicts you want. Its target is on screen, every snatch is explained, and title-screen habits must pass a significance test.
> - Built D1 hooks: a notebook that greets you with your habits, a Daily with streak and share grid, a Codex, a rival ladder, Tells.
> - Bot sims, not humans: the rival reads a habitual bot at 90-93% (chance 50%) and a random bot not at all. Weak spot: its difficulty comes mostly from contesting nodes, not from learning.
> - First test: with difficulty matched, can players tell the reading rival from a contest-only one?

I design systems that read players and let players read them back. OUTCRAFT is the smallest playable version of that idea I could build.

## 1. The pitch

**What it is.** A one-thumb, portrait crafting race. The order card shows the recipe tree: Lantern = Glass (Sand + Wood) + Iron (Ore + Wood). You tap nodes to gather, carry three at a time to your Workshop, and parts craft themselves. Your rival needs the same Sand, and the island has two. The fantasy is outsmarting a rival that studies you: its route is a dotted line that turns red when it heads for your node, so you can take the other Sand, beat it there, or fake it out.

**Who it's for** (assumptions). Primary: "beat the machine" players on budget Android in India, arriving through a friend's Daily link on WhatsApp. The build is under 200 KB of HTML, CSS and JS (about 185 KB, measured 23 Sep 2026), with no image or audio files and no network calls, so it loads on patchy data and costs nothing to serve, which matters where revenue per player is low (§4). Secondary: daily-puzzle players (the Wordle habit). Not the target: cozy crafters, since the core verb is a rival taking your materials (§6 tests whether that reads as punishment).

**Why play it.** Crafting games are mostly solitaire; game AIs are mostly scripted or rubber-banded. This rival improves only by reading you, and shows its working. My falsifiable bet: being read feels flattering when the read is shown as counts and can be beaten. If testers call it creepy or punishing more often than fun, the pitch is wrong.

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

**Pure randomness loses, and so does fooling the rival for its own sake.** In simulation the random bot wins least against every rival (10% vs MIMIC; human-like bot 31%) because wandering wastes steps, though it fakes MIMIC out most (1.2 times a match; always-nearest bot 0.7). The skill is being efficient and unpredictable at once. Untested threat: between two equidistant nodes randomising is free, and if that blinds the rival, COUNTER (§3) becomes a necessity.

**The first five minutes, as built** (times estimated from simulated match lengths):

| Time | Beat | Player learns |
|---|---|---|
| 0:00 | Title over a self-playing island; HOW TO PLAY in 4 lines | the rules |
| 0:20 | Match 1 vs PIP, the apprentice; a bouncing hand points at a gold-ringed node | gather, deposit, craft |
| ~0:40 | "Red line! PIP will get there first. Tap a different one!" | the line is information |
| ~1:10 | A 3–0 or 3–1 win (the human-like bot beats PIP 100% in sim); "You always walk to the nearest one: 100% of trips, when chance says 28%." | it was watching |
| 1:45 | WREN: "Pip told me about you. You like the nearest thing, right?" | the rivals share notes |
| 3:00+ | "WREN predicted you. You walk to the nearest one, 7 of 9 trips. Try a farther one." | break the habit |

**The second door is worse.** Most India arrivals would tap a shared Daily link: no tutorial tips, FOX instead of PIP, sometimes a twist that makes FOX faster than you. Fix before any test: a first Daily with tips and no hard twist.

**What brings them back tomorrow.** Rewards are built: the greeting quotes your tested habits, and a new Daily, streak, Codex silhouettes and unbroken Tells wait. The only built trigger is a friend's share. Planned: ladder pacing (§3), a notification at the Daily reset, and one real finding held back a day ("RAVEN will tell you tomorrow which habit you don't know you have"). Honesty costs hook strength: a varied player hears "No clear habits yet", so fall back to a true stat ("You beat WREN to 4 nodes yesterday").

## 3. Progression and metagame

### Built D1 hooks

| Hook | What is built |
|---|---|
| **Rivals remember you** | A shared, persistent notebook. The title greets you by time away ("Welcome back. 14 hours, and we have not stopped talking about your routes.") and quotes 1-2 tested habits. |
| **Daily Commission** | Date-seeded island, orders and twist vs a memoryless FOX, so results compare. First attempt counted (no server leaderboard); the streak counts days played, not wins; spoiler-free share grid. |
| **Codex** | 12 items, tiers 1-5, silhouettes until won. |
| **Ladder** | PIP, WREN, FOX, RAVEN, MIMIC; beat one to face the next. |
| **Tells** | Five habits; a Tell appears at ≥ 25 points above chance in a match (n ≥ 5), breaks at ≤ 5, can relapse. |

**Built content is thin.** At the human-like bot's win rates (100/89/69/51/31%), the ladder takes about 9 matches, roughly 10 minutes (estimate: sum of 1/win rate): a keen player finishes on day 0. Cheap fixes: pace the ladder as appointments ("RAVEN arrives tomorrow. PIP is passing it your notes."), and add Codex stamps (0 snatches, vs MIMIC, in a Daily), turning 12 items into 48 goals.

### The months-long plan (not built)

| Layer | What it adds | Why it holds people |
|---|---|---|
| **COUNTER, RHYTHM** (first) | COUNTER predicts your over-correction after you break a habit (people trying to be random alternate too often, [Wagenaar 1972](https://doi.org/10.1037/h0032060); for routes, a hypothesis). RHYTHM reads timing | Your fix becomes your next tell; systemic, not handmade |
| **Seasons** | A biome, new resources, a Codex set | Collection, fresh habits |
| **Pass-and-play** | Two players, one phone, one rival reading both | Groups without matchmaking |
| **Shadows** | Your notebook races friends via a shareable code, no server (my Q3 loop, ECHOES); adults only | Social play without real-time liquidity |

Cut: real-time co-op (my Q2 liquidity problem) and a crowd-built weekly rival (needs a backend).

### Memory must not become a loyalty tax

In most games, time invested makes you stronger. Here it makes your opponent stronger. The built guards: evidence decays ×0.7 per match (old choices weigh 17% after 5 matches, 3% after 10); model weights relax 40% toward equal between matches; the Daily rival starts blank; "Make them forget me" wipes it all. Planned: leaderboards use the Daily only, verified by replaying uploaded inputs (matches are deterministic; tested).

## 4. Money

**Principle: never sell advantage against an AI whose whole promise is fairness.** If a "hide your route" potion were for sale, every snatch would read as a sales pitch.

**The economy (not built; nothing is earned or spent today).** One soft currency per order won buys outfits and decor; Codex items become placeable decor. A share card rendered as an image (via Web Share) shows your outfit, so cosmetics get an audience with zero servers.

| Would sell | Won't sell |
|---|---|
| Outfits, decor, trails | speed, bigger bags, route hiding, peeks at the model |
| Supporter pack: no ads, a Daily Archive (rebuilt free from date seeds), one outfit | anything in the counted Daily |
| Rewarded ads between matches that double coins | ads mid-race or after a snatch-decided loss |

Streak freezes will be earned, never sold (1 per 7-day streak, max 2; not built: today a missed day resets the streak). Prices (assumptions): ₹10 per colourway, Google Play's India minimum since 2015 ([Android Police](https://www.androidpolice.com/2015/07/31/google-play-reduces-the-minimum-app-and-in-app-purchase-price-in-india-from-rs-50-to-rs-10-0-156/)); Supporter pack ₹99-149, $2.99 in the US.

**The envelope (estimate).** Revenue per Indian gamer-day is about $0.0074 ($1.5B non-RMG revenue / 555M gamers / 365, [Lumikai](https://respawn.outlookindia.com/gaming/gaming-news/lumikai-india-gaming-market-1-5-billion-rmg-ban-2025)). At the §6 targets (D1 30%, D7 7%), a power-law retention curve gives about 2.8 active days in a player's first 30: $0.02 per player, $0.06 if real ARPDAU is 3× that. Paid installs above a few cents can't pay back, so India is organic and share-driven; monetisation is tested in a Tier-1 market.

**The firewall.** The player model never touches pricing, offers or ad targeting. Any script on the game's origin can read localStorage, so shop and ad code will run in a sandboxed cross-origin iframe under a Content Security Policy, with no third-party SDK in the origin. Non-personalised ads earn less (amount unknown), and Daily-only players count as acquisition, not ad value. Store page line: "It reads your routes, never your wallet."

## 5. AI

### 5a. The AI inside the game

**How it reads you.** When you set off, the rival notes which nodes you could have walked to and which you picked. Five habit models (Beeline, Home Turf, By the Book, Routine, Favourite Side) each guess your next pick, scoring you against a uniformly random player facing the same options, (observed + 1) / (expected + 1), so habits transfer across islands. Fixed-share Hedge on log-loss (η 0.6, 4% share, 3% floor) trusts whichever has been right lately; your walking direction adds live evidence. Each node scores [need + P(you go there) × P(it arrives first) × steal or deny weight] / (travel + wait + 0.8 s). It sees your position and next step, heading, needs and past choices, never your tap target (by code inspection). `?glass=1` shows its % guess on every node.

**Honesty rules.** (1) Each snatch names the evidence used: a habit with counts, your heading, or luck ("FOX only gave that node 22%"), plus a counter-tip, and claims a habit only in the direction the evidence points. The counts are decay-weighted, so the copy should say "recent trips". (2) A title-screen habit needs a z-test against the uniform expectation to clear a bar that rises with the number of statistics searched (2.6 to 3.4) and a ≥ 15-point effect. In one look, under 6% of 300 random choosers are accused (a unit test); checked after each of 15 matches, 10% are. (3) **Tells break the promise:** they skip the test, and 61% of random choosers get a "NEW TELL" within 15 matches ([sim-audit.txt](data/sim-audit.txt)). First fix in §8.

**Evidence. SIMULATION ONLY: bots, not humans.** *Greedy* takes the nearest node; *human* takes its first pick (nearest, mild left bias) 72% of the time; *random* picks uniformly; *reader* avoids the rival's target when the rival would arrive first. All re-pick after a snatch; all are nearest-node variants, so only Beeline is exercised. 150 matches per cell: about ±8 points at 95%.

Player win rate ([sim-balance.txt](data/sim-balance.txt)):

| Rival | greedy | human | random | reader |
|---|---|---|---|---|
| PIP | 99% | 100% | 93% | 99% |
| WREN | 91% | 89% | 65% | 94% |
| FOX | 77% | 69% | 37% | 78% |
| RAVEN | 57% | 51% | 31% | 69% |
| MIMIC | 35% | 31% | 10% | 42% |

The reader wins most from WREN up: the telegraph is useful, though one reactive rule proves no deep skill ceiling.

**What the AI adds.** *Blind* (`?blind=1`) switches off prediction **and** contesting. *Contest-only* keeps the steal and deny weights but treats every node as equally likely. Player win rate, full/contest-only/blind, same islands ([sim-ablation.txt](data/sim-ablation.txt), [sim-audit.txt](data/sim-audit.txt)):

| Rival | greedy | human | reader |
|---|---|---|---|
| FOX | 73/77/83% | 69/69/71% | 70/73/79% |
| RAVEN | 54/54/65% | 49/46/59% | 53/51/67% |
| MIMIC | 35/43/50% | 34/35/49% | 40/43/53% |

Switching everything off makes RAVEN and MIMIC 10-15 points easier (WREN barely moves), mostly from contesting. The learned model moves win rate −3 to +8 points (the +8 is MIMIC vs greedy), inside the noise, while adding snatches (MIMIC vs greedy: 4.5 → 5.5). Today the reading changes how a match feels more than who wins. Next: make a correct read pay (commit early or pre-position only when confident), then re-run all three arms.

**Does it learn?** RAVEN's top-guess accuracy on your next node, 50 players × 6 matches, against about 50% chance ([sim-learning.txt](data/sim-learning.txt)): a beeliner goes from 82% in match 1 to 90-93%; the human-like bot from 66% to 74-77%, near its ceiling since it takes its first pick only 72% of the time. The random bot, the control, stays at 47-52%: the models find nothing in random play.

**Earlier findings.** (1) In the first build, blind and full rivals landed within about 5 points: speed did the work. (2) A review found a snatch left you stranded at an empty node; fixing it cut the AI's effect, and slower regrowth (1.5×), faster rivals (3.0-4.05 tiles/s; you 3.8) and stronger steal and deny weights restored difficulty. Those builds' runs were not archived.

**Why no LLM at runtime.** *Cost:* 10-13 node choices a match (measured in sim) × 800 input / 20 output tokens (assumption) on Claude Haiku 4.5 at $1 / $5 per million ([Anthropic](https://platform.claude.com/docs/en/about-claude/pricing)) is $0.035 per player-day at 3 matches (assumption), ~4.7× revenue per Indian gamer-day. With 700 input tokens cached ($0.10 per million) it is ~1.4×, and still half of revenue if real ARPDAU is 3× higher. *Fit:* the counts model already predicts the human-like bot near its ceiling. *Latency:* a trip lasts 1-2 s (estimate), so the guess must be ready at set-off. *Checkability:* every claim is k of n from counts, not a story told after the move, and deterministic matches (tested) keep the Daily fair.

**Where an LLM would fit.** At build time (dialogue, Codex flavour, recipes, reviewed by me), and for narration behind a fact validator: the model sees only verified facts (habit, k, n, chance) and writes one line in the rival's voice; anything else falls back to the template. One call per match (400 in, 60 out, assumption) is $0.0007, 28% of revenue per Indian gamer-day at 3 matches (about 9% if ARPDAU is 3× that), so Tier-1 first, or on-device.

**Ethics and privacy.** The notebook stays on the device as tallies, not replays; the game makes no network calls; one button wipes it all. **Minors:** India's DPDP Act 2023 defines a child as under 18 ([s.2(f)](https://indiankanoon.org/doc/20425670/)) and, from 14 May 2027 ([DPDP Rules timeline](https://www.amsshardul.com/insight/enforcement-of-the-dpdp-act-and-notification-of-the-dpdp-rules/)), requires verifiable parental consent and bars "tracking or behavioural monitoring of children" ([s.9](https://indiankanoon.org/doc/98869575/)). The UK Children's Code wants profiling off by default ([ICO](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/12-profiling/)); US COPPA covers under-13s. A habit-modelling rival may fall under that even on-device. I'm not a lawyer. Pending advice: an age gate, and no cross-match memory for under-18s, whose D1 then rests on the Daily, Codex and streak, measured as a separate cohort.

### 5b. How AI was used to build it

I built OUTCRAFT in one extended session with Claude Code (Anthropic's coding agent, model Claude Opus). The AI wrote the code, simulators and tests; I made the design calls and playtested in the browser. The first prototype, UNREADABLE v1, was a rhythm duel against an Aaronson-oracle-style predictor; three AI red-team reviews said "matching pennies stays fun for about two minutes", so I asked for a crafting game, my goal. Later AI reviews found 28 code issues (all fixed) and the contest-only and Tell gaps reported above.

The red team was right structurally: matching pennies has a 50/50 equilibrium, so the best player is a coin flip and the AI stops mattering. OUTCRAFT charges for randomness in wasted steps. What survived: interpretable experts, honest explanations, significance-gated claims, memory as the D1 hook. UNREADABLE v1 is kept in `archive/unreadable-v1/`.

## 6. Shipping

**Stages** (sizes are assumptions): (0) a lab test, 100 players; (1) an unlisted web cohort of ~500 via WhatsApp and college groups, with opt-in anonymous telemetry, for D1, D7, the ladder funnel and players per share (a friendly sample reads high); (2) an India soft launch as an installable web app wrapped for Google Play (a Trusted Web Activity), checked on a budget phone; (3) a small Tier-1 cohort for monetisation.

**Test first: a rival Turing test, difficulty matched.** `?blind=1` is also easier and never contests, so players could spot "the one that read me" by which one beat them. The B arm is contest-only FOX (`?blind=contest`, to build), which the human-like bot beats as often as full FOX (69%). Each player plays 3 matches per arm (same islands, counterbalanced, labelled A/B), then says which read them and which was more fun; after each snatch, "did it predict you?" (scored against the rival's logged evidence) and "fair / cheap". With 100 players, 60 correct beats a coin flip (one-sided p ≈ 0.03) and catches a true 70% detection rate 99% of the time; the 40 I first planned would miss it 4 times in 10.

| Signal | Line (assumption) | Then |
|---|---|---|
| Tell reading from contest-only | < 60 of 100 | Louder reads, retest once; still failing: drop the AI pitch, keep the race |
| Fun and tone | Majority prefer contest-only, or "creepy" or "punishing" beats "fun" | Lower steal weights, softer copy: a show-off, not a thief |
| Snatch fairness | > 30% "cheap" | Longer telegraph; cap snatches per order |
| Legal read on minors | Habit modelling of under-18s needs consent or is barred | Session-only rival for minors, or launch 18+ or Tier-1 first |

**Numbers to watch** (Stages 1-2; targets are assumptions):

| Metric | Target | Why |
|---|---|---|
| D1, split by habit claimed in session 1 (yes/no) and by share-link arrival | ≥ 30% | [GameAnalytics 2026](https://www.gameanalytics.com/reports/2026-mobile-pc-gaming-benchmarks): median ~22%, top quartile just above 30%. The splits test whether the notebook causes returns |
| D7 / D30 | ≥ 7% / ≥ 2% | Top quartile 6-7% / 1.6-1.8%; the West leads, so India may run lower |
| New players per Daily share | set after Stage 1 | The India acquisition engine; no benchmark |
| Quit within 10 s of a snatch-decided loss | ≤ 1.2× other losses | Does the rival feel fair? |

**Known risk: the notebook can vanish.** Safari deletes script-writable storage after seven days of Safari use without a visit, unless the site is on the home screen ([WebKit, 2020](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)); in-app browsers keep separate storage, and families share phones (assumptions). Fixes: `navigator.storage.persist()`, the installable app, "Who's playing?" profiles, notebook export.

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

- Gate Tells with the dossier's test; say "recent trips"; fix the greeting that calls notes "a little faded" (decay is per match, not per day).
- A first Daily with tips for share-link arrivals.
- `?blind=contest` and the 100-player test, with opt-in telemetry.
- Make reads pay; efficient-random, feint and per-habit bots; a COUNTER prototype.
- `navigator.storage.persist()`, a manifest, notebook export; a colour-vision pass.

## 9. Sources, assumptions & AI use

**Internal evidence.** [`data/`](data/): sim-balance (`node tools/sim.mjs 150`), sim-ablation (`tune.mjs 150`), sim-learning (`learning.mjs 50 6`), sim-audit (`audit.mjs 150 300 15`). `node tools/test.mjs` on 23 Sep 2026: 11 tests passed. Parameters read from `src/`. Decay percentages, ladder length, LLM costs, the retention envelope and binomial figures are my arithmetic.

**External sources** are linked inline, retrieved 23 Sep 2026 and checked against the primary pages by a fact-check pass. The X post is login-walled; its ID decodes to 16 Dec 2021, which Slate confirms.

**Assumptions (not measured):** segments; prices; stage sizes, kill lines and targets; tokens per call; 3 matches a day; latency and trip length; first-session timings; storage-loss causes other than Safari's.

**Not evidence:** every win rate and accuracy figure comes from bots. The only human play is mine, and none of it is reported as data. Whether the rival feels fair, fun or creepy is a hypothesis until the §6 test runs.

**AI use.** The build is covered in §5b. This writeup was drafted with Claude, critiqued by multiple AI reviewer passes (hiring-manager lens, fact-checker, domain expert) and revised; numbers were checked against the data files and code.
