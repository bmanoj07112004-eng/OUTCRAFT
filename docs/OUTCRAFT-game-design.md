# OUTCRAFT: Game Design Document (v1.0)

**A pocket-island crafting race against an AI rival that learns how you move.**
Play: [https://bmanoj07112004-eng.github.io/OUTCRAFT/](https://bmanoj07112004-eng.github.io/OUTCRAFT/) · Code: [https://github.com/bmanoj07112004-eng/OUTCRAFT](https://github.com/bmanoj07112004-eng/OUTCRAFT) · Q1 writeup: [Q1-outcraft-writeup.md](Q1-outcraft-writeup.md)

This is the complete design reference for the prototype and the product it would grow into. The Q1 writeup answers
Lila's questions directly; this document holds everything else. Numbers marked *(assumption)* are planning inputs,
not measurements. Numbers marked *(simulated)* come from the bot harness in `tools/` and are reproducible.

---

## 1. Vision

A villager needs a Lantern. You and your rival both run for the same sand, wood and ore on a tiny island. Whoever
builds it first wins the star. The twist: **your rival studies how you move**. It notices that you always take the
nearest tree, or always start with what the card lists first, and it gets there before you. Every time it does, it
tells you why, citing the evidence it used. Then you get to outsmart it.

**The fantasy:** *out-think something that is watching you.* Cozy crafting on the surface, a mind game underneath.

**One-line hook for a store page:** "Your rival learns your habits. Change them."

## 2. Design pillars

| Pillar | What it means | How the prototype proves it |
|---|---|---|
| **A rival you can read** | The AI's intent is always visible, never a black box | Dotted route + target reticle; "FOX FIRST / YOU FIRST" verdict; `?glass=1` shows its % guess per node |
| **Fair by construction** | The AI only knows what a human rival could know, and never lies about why it won | It never reads your taps, only your past choices and where you walk; it only contests a node when its read of you beats a blind guess; title-screen habit claims and Tells appear only when a statistical test passes, and snatch explanations report the evidence used; checked after each of 15 matches, 3.3% of random players get a false habit claim and 8.3% a false Tell *(simulated)* |
| **60-second races** | Short, dense sessions that fit a phone and a commute | Matches of 47 to 70 s *(simulated)*; first to 3 stars |
| **Cozy craft, sharp competition** | Warm art and satisfying crafting; the tension comes from the rival, not from punishment | Plain-shape diorama, crafting pops, music; losing costs nothing but a star |

## 3. Who it is for

- **Primary:** mobile players aged 16 to 35 who like quick competitive sessions and cosy crafting (fans of Stardew Valley
  and Overcooked who want one-minute matches). *(assumption)*
- **Markets:** India first (large mobile audience, short-session play, low-end Android devices are a design constraint),
  then SEA and global. The prototype has no assets and no network calls, which suits low-end devices and patchy data.
- **Motivations served:** mastery (beat a rival that adapts), self-discovery ("I didn't know I always go left"),
  collection (Codex), and light social (daily share cards).

## 4. The loops

| Loop | Length | What happens |
|---|---|---|
| **Moment** | 1 to 3 s | Pick the next resource, walk, gather. Watch the rival's line. Change course if it is going for yours |
| **Order** | about 13 to 15 s *(simulated, bots)* | Gather the recipe (bag holds 3), deposit at the Workshop, parts craft themselves, finish first for a star |
| **Match** | about 1 minute | First to 3 stars. VS splash, orders escalate in tier, results with "What the rival learned about you" |
| **Session** | 3 to 5 minutes | 2 to 4 matches: climb the rival ladder, fill the Codex, try to break a Tell |
| **Day** | once | Daily Commission: same island and twist for everyone, one ranked attempt, streak, share card |
| **Season** *(roadmap)* | 4 weeks | A new rival brain, new resources and recipes, a Codex page, cosmetics |

## 5. Systems

### 5.1 The island
- 9 x 13 tiles, procedurally generated per match from a seed (organic coastline, obstacles, a Workshop on the south coast).
- 13 resource nodes: 3 trees, 2 each of stone, ore, sand, fiber and crystal, one per side of the island where possible.
- Each node holds **1 unit** and regrows in 6.5 s (wood) to 12 s (crystal). Scarcity is the point: both crafters need the
  same few nodes, so *who gets there first* decides races.
- Every generated island is tested to be fully reachable (300 seeds in `tools/test.mjs`).

### 5.2 Crafting
- 6 resources → 7 components (Plank, Glass, Iron, Rope, Lens, Block, Cut Gem) → 12 items across 5 tiers
  (Torch and Shovel up to the Clock masterpiece).
- Components craft **automatically** at the Workshop the moment their materials are in stock; the item completes when all
  parts exist. The order card shows the tree and marks every material as missing, in your bag, or in stock.
- Leftover materials stay in your Workshop for the next order (a real hoarding choice); a loser's half-built parts are
  refunded as raw materials.

### 5.3 Orders, stars and matches
- A match serves up to 5 orders whose tiers rise with the rival (PIP starts at tier 1, MIMIC at tier 3 and ends at 5).
- First crafter to finish an order wins its star; first to 3 stars wins the match.

### 5.4 Rivals (the ladder)
| Rival | Personality | What it reads | Speed, tiles/s (you: 3.8) |
|---|---|---|---|
| PIP | The Apprentice: "Hi! I'm Pip. I'm just here to learn how you do it." | Nothing yet (it only takes notes) | 3.0 |
| WREN | The Early Bird | Beeline, Home Turf, a little heading; contests your target when it has a read on you | 3.5 |
| FOX | The Copycat | + By the Book, Routine; contests harder (steal 2.8, deny 1.6) | 3.75 |
| RAVEN | The Watcher | + Favourite Side; reads every step | 3.9 (a touch faster than you) |
| MIMIC | The Mirror | Everything; a step faster than you | 4.15 |

All five share one notebook about you ("Pip told me about you"), so the ladder feels like a gang that compares notes.
The non-read parameters (speed, think time, order tier) plus scarcity (1-unit nodes that regrow in 6.5 to 12 s) are what
make the top of the ladder hard today; section 6 shows that the reads mostly change *where* the rival fights you, not yet
who wins.

### 5.5 Tells, Codex and memory
- **Tells:** the five habits (Beeline, Home Turf, By the Book, Routine, Favourite Side). A Tell is *detected* only when
  chance cannot explain it: at least 8 choices in the match, the notebook's detector for that habit guessing at least 25
  points above a uniform guess (whichever rival you are playing), and z ≥ 2.6 against that guess. It is *broken* when the edge falls to 5 points or less, and *relapses* only at
  30 points or more with the same z bar.
- **Codex:** every item you win an order for. Silhouettes until then.
- **Memory:** the notebook persists on the device and fades by 30% per match, so a player who changes can escape their past.
  "Make them forget me" wipes the notebook, and with it your Codex, Tells, ladder and streak.

## 6. The AI rival in depth

**Plainly:** each time you set off, the game writes down the choice you faced (which resources you still needed, how far each
was, where on the island it was, what the card listed first, what you took last) and what you picked. Five simple habit
detectors each guess your next pick. The rival listens most to whichever detectors have been right about *you* lately.
Then it walks to where it expects you to go, if it can get there first and its read of you is better than a blind guess.

**Precisely:**
- **Lift statistics:** every habit is measured against a player choosing uniformly at random *among the same options*, so
  "you take the nearest one" means "more often than chance would, given what was available". This makes habits portable
  across different islands.
- **Fixed-share Hedge** (multiplicative weights on log-loss, with "sleeping experts" when a detector has no opinion) blends the
  five detectors and adapts when you change your behaviour mid-session.
- **Heading:** the rival also reads the direction you are walking, more strongly up the ladder (PIP 0, WREN 0.5, FOX 0.9,
  RAVEN 1.3 is the strongest, MIMIC 1.2).
- **Decision:** every node scores `(needs it + informed x P(it arrives first) x steal/deny weight) / (travel time + wait + 0.8 s)`;
  the rival re-plans four times a second with hysteresis so it doesn't dither.
- **Informed-only contesting:** `informed = max(0, (p - 1/n) / (1 - 1/n))`, where p is the rival's belief that you want the
  node and n is the number of options you had. A rival with no knowledge of you (a uniform belief) scores effectively zero on
  every node (a floating-point residue only breaks ties between nodes it needs anyway, which is why two MIMIC cells below
  differ slightly), so it never goes out of its way to take a resource from you; it only takes what it needs itself. Every contest is therefore
  an informed read, and a snatch with no read behind it says so ("FOX needed it too and got there first"). One consequence
  for the evidence below: the audit's "contest-only" control (steal and deny weights on, uniform belief) now plays like the
  blind rival (identical in 10 of 12 cells of `sim-audit.txt`, within 1 point in the other two, both MIMIC).
- **Honesty rules:** every snatch is explained from the evidence actually used (habit with counts from its notebook, where
  older matches count for less; heading; or "lucky guess" with its real %). A named habit comes with a counter-tip ("Try a
  farther one."); a heading snatch says "Pick one it can't reach first." The explanation uses the exact choice context the rival
  had when it committed to the node, not a later one. Explanations are direction-aware, so a player who
  avoids the nearest node is told exactly that. The title-screen dossier only names a habit when a z-test against the
  uniform-choice expectation clears a bar set per habit to survive repeated looks (Beeline and By the Book z 2.9, Favourite
  Side 3.1, Home Turf 3.3, Routine 3.6) and the effect is at least 15 points; each claim carries its counts ("You usually walk
  to the nearest one: X% of trips, when chance says Y%."). Tells are gated the same way (section 5.5).

**Evidence** *(simulated with bots, 150 matches per cell unless noted; raw output in [`docs/data/`](data/); no human
playtest data yet)*

The bots: *greedy* always takes the nearest needed node; *human* takes the nearest 72% of the time and otherwise the second
nearest, with a mild left bias; *random* picks uniformly among needed nodes; *reader* avoids the rival's target when the rival
would get there first.

**1. The difficulty curve.** Player win rate by rival ([sim-balance.txt](data/sim-balance.txt)):

| Rival | greedy | human | random | reader |
|---|---|---|---|---|
| PIP | 99% | 100% | 93% | 99% |
| WREN | 91% | 90% | 69% | 92% |
| FOX | 85% | 66% | 47% | 81% |
| RAVEN | 61% | 59% | 37% | 68% |
| MIMIC | 47% | 39% | 18% | 43% |

Matches last 47 to 70 s. Snatches per match rise with rival strength (greedy bot 1.5 at PIP to 4.7 at MIMIC). The random bot
is the one the rival cannot read (next table), yet it wins least against every rival, because wandering wastes steps. The
skill the game asks for is being efficient *and* unpredictable at once.

**2. It learns you, and it does not cheat.** RAVEN's top-guess accuracy on your next node, 50 players x 6 matches
([sim-learning.txt](data/sim-learning.txt)):

| Player | Match 1 | Matches 2 to 6 | Uniform-guess chance |
|---|---|---|---|
| Beeliner | 82% | 90 to 91% | 47 to 49% |
| Human-like | 65% | 73 to 77% | 46 to 49% |
| Random | 48% | 48 to 51% | 48 to 51% |

*Human-like here is the 72%-nearest bot without the left bias (`tools/learning.mjs`).*

It cannot read a random player, so its edge on the other two comes from real habits, not from peeking at inputs.

**3. Learning does not yet decide who wins.** Same rival, same islands for both arms, reads switched off ("blind": no habit models, no
heading, no contesting) ([sim-ablation.txt](data/sim-ablation.txt), [sim-audit.txt](data/sim-audit.txt)):

| Rival | Player win-rate change when blind, points (greedy / human / reader) | Snatches per match, reads on vs off (greedy · human · reader) |
|---|---|---|
| WREN | +2 / +1 / +2 | 2.2 vs 2.0 · 2.0 vs 1.9 · 1.4 vs 1.2 |
| FOX | −4 / −4 / +2 | 3.2 vs 2.5 · 2.4 vs 2.3 · 2.0 vs 1.4 |
| RAVEN | +5 / 0 / −1 | 3.8 vs 3.1 · 3.2 vs 2.8 · 2.5 vs 1.9 |
| MIMIC | −3 / −1 / +5 | 4.8 vs 3.5 · 3.6 vs 3.0 · 3.2 vs 2.1 |

PIP reads nothing, so its two arms are identical. With 150 matches a single win rate is only known to about ±8 points (95%,
my arithmetic); the paired full-vs-blind gap on the same islands is tighter at WREN (about ±1.3 to 3.5 points) and about ±8
to 9.5 at RAVEN and MIMIC. Every win-rate change above (−4 to +5) is inside the noise. The snatch counts mostly are not: in
10 of 12 cells reads add 12% to 50% more snatches (paired z ≥ 2.9 on the same islands). For the human bot at WREN and FOX
(+4%, +6%) the increase is within noise. Greedy bot: +12% at WREN, +29% at FOX, +25% at RAVEN, +38% at MIMIC. (The paired
intervals, paired z and unrounded percentages come from a per-match re-analysis of the same `tools/tune.mjs` runs;
`sim-ablation.txt` shows only the rounded means.)

Tables 1 and 3 use different island sets (`tools/sim.mjs`: islands 1000 to 1149; `tools/tune.mjs` and `audit.mjs`: 9000 to
9149). The same cell can differ by up to 9 points between them (FOX/human 66% vs 75%), which shows the ±8-point noise in
practice.

Plainly: **the learned model changes *where* the rival fights you (more, informed snatches), not yet *who* wins.** A snatch
costs about a second of re-routing in this economy *(estimate, not measured)*, which is not enough to swing an order.
Difficulty currently comes from the non-read parameters (speed, think time, order tier) and scarcity, not from the reads.
This was found by an AI review agent's control arm, and I report it rather than hide it.

**Next design step: make a correct read decisive.** Candidates: one key ingredient per order that only one crafter can take,
or claims that lock a node for a few seconds. Then re-run the same ablation. The change only counts if the paired
full-vs-blind win-rate gap at RAVEN and MIMIC has a 95% interval that excludes 0.

**4. It stays honest over repeated looks.** 300 random choosers x 15 matches vs FOX, checked after every match
([sim-audit.txt](data/sim-audit.txt)):

| False claim about a random player | Ever, over 15 matches | Earlier build (not in docs/data) |
|---|---|---|
| NEW TELL card | 8.3% (0.0% in match 1) | 60.7% (before Tells were z-gated) |
| Title-screen habit claim | 3.3% | 10% (before the per-habit bars were raised) |

In a single look, 0 of 300 synthetic random choosers are accused of a habit (unit test in `tools/test.mjs`, pass threshold
6%).

**Why no LLM at runtime:** a match gives about 10 to 14 route choices *(simulated, `sim-audit.txt`)*, far too few to train a network; a 0.25 s re-plan leaves no room
for a server round trip; and a counts-based model can show its working. LLMs belong in language (a rival voice, localised
Hindi or Hinglish banter) generated at build time or checked against the facts before display.

## 7. Feel, clarity and polish

- **Readability:** gold ring + bobbing chevron on every resource you still need; unneeded nodes dim during races; the rival's
  route has a white outline; a verdict pill shows who will reach a contested node first; YOU vs RIVAL progress bars on the
  order card; a "Still need: Sand, Wood x2" line above the bag.
- **Juice:** VS splash with portraits and a taunt; resources fly into your bag; parts pop out of the Workshop; the finished
  item rises and flies to your star; winners hop and losers droop; confetti on a match win; screen shake on snatches; rival
  speech bubbles ("Mine!", "Called it.", "Foreseen.").
- **Signature moments:** SNATCHED! (with the reason), BEAT IT! (you took its target), FAKED OUT! (it bet on a node and you went
  elsewhere), CRAFTED!
- **Audio:** every sound is synthesised (plucks per resource, craft chimes, fanfare) plus a procedural music loop that adds a
  shaker during races. Phone haptics on key moments.
- **Accessibility and devices:** portrait and landscape layouts chosen by tile size; big tap targets with fat-finger node
  picking; reduced-motion support; no colour-only signals (verdict pills carry text); makes no network calls once the page has loaded
  (no offline install yet).

## 8. First session (as built)

1. **Title:** the island plays itself behind the menu (attract mode). PLAY.
2. **How to play:** four lines. GOT IT.
3. **VS splash:** "PIP, The Apprentice: 'Hi! I'm Pip. I'm just here to learn how you do it.' It has never seen you play. Yet."
4. **Order 1:** a tier-1 recipe card (Shovel = Iron + Plank, or Torch = Plank + Rope); a bouncing hand says TAP on the nearest needed resource, then CRAFT
   on the Workshop. Tips explain the bag, auto-crafting and the rival's line.
5. **About a minute later:** a 3-0 or 3-1 win; results show NEW items in the Codex, "New rival unlocked: WREN", maybe a first
   Tell, and "What PIP learned about you: PIP was not predicting yet, only taking notes for the others."
6. **Match 2 vs WREN:** "Pip told me about you. You like the nearest thing, right?" The first honest snatch lands, and the
   player learns the real game.

## 9. Retention and metagame

**Built day-1 hooks**
1. **The rivals remember you.** The title greets returning players by time away ("Welcome back. 14 hours, and we have not
   stopped talking about your routes."; after days away, "We kept your notebook.") and quotes up to 2 statistically real
   habits, with counts ("You usually walk to the nearest one"), or says "No clear habits yet." The return itself is new content, because it depends on
   what you did yesterday.
2. **Daily Commission.** Same island, orders and twist for everyone (Rush Hour, Slow Growth, Big Bags, Masterwork, Nimble
   Rival); the daily rival starts with no memory so results are comparable; one ranked attempt (replays are labelled
   "Practice run · only your first attempt at Daily #N counts"); streak; share card
   (`OUTCRAFT · Daily #4 (Rush Hour) / Out-crafted FOX 3–1 · snatched 2× · I beat it to 3 / 🟦🟦🟧🟦 / <link>`).
3. **Codex** (12 items), **rival ladder** (5 rivals), **Tells** to detect and break.

**Keeping players for months** *(roadmap)*

| Season | New rival brain | New content | Why it keeps mastery open |
|---|---|---|---|
| 1 | **WIN-STAY:** after a win you repeat your route | Coastal biome, fishing resources | Punishes comfort after success |
| 2 | **RHYTHM:** reads *when* you move (early vs late deciders) | Night island, lanterns event | A new axis the current five ignore |
| 3 | **HERDER:** places its own claims to steer you, then strikes | Volcano biome, forge recipes | The AI becomes an active planner |
| 4 | **COUNTER:** models your *anti*-habits | Crystal caves, Codex page 3 | Once you learn to break tells, breaking becomes the tell |

Plus: **Shadows** (async PvP: other players race a rival trained on *your* notebook; your Shadow keeps playing while you are
away, and the return report is a D1 hook; this is the same idea as the Q3 ECHOES feature), **clubs** with co-op island
decoration, and a weekly **Crowd rival** trained on aggregate, anonymised choices (opt-in, adults only).

**Guarding against a loyalty tax:** memory fades 30% per match, the Daily rival starts blank, and today the ladder's difficulty
comes mostly from the rival's non-read parameters (speed, think time, order tier) and resource scarcity (section 6), not from
punishing loyal players. The metric to watch is the read rate in the first 20 choices
of session N versus session 1.

## 10. Revenue: how OUTCRAFT makes money without a cash grab

**Principle:** the whole promise is a *fair* AI. So we never sell advantage against it: no paid speed, no paid resources, no
paid hints, no pay-to-skip rivals. We sell identity, content and convenience.

### 10.1 Revenue streams
| Stream | What the player buys | Price *(assumption)* | Why it is not a cash grab |
|---|---|---|---|
| **Workshop Pass** (season pass) | 4-week track of cosmetics: crafter skins, rival costumes, island themes, emotes, Workshop decor; a free track exists | ₹149 to ₹249 in India · $4.99 global | Everyone gets the new rival and recipes free; the pass is looks and extras |
| **Cosmetic shop** | Crafter skins, trails, speech-bubble packs, island themes | ₹19 to ₹99 sachets · $0.99 to $4.99 | Visible to others in share cards and Shadows, which is why cosmetics sell |
| **Starter / Supporter pack** | One-time: remove ads + exclusive skin + 2 extra cosmetic slots | ₹99 · $2.99 | Great value once; no repeated pressure |
| **Rewarded ads** (opt-in) | Double cosmetic currency from a Daily, or one extra cosmetic chest per day | none | Never mid-race, never forced, never on a loss screen |
| **Festival events** | Diwali Diya-crafting event, Holi colour island: event cosmetics | pass add-on or free | Culturally local content that also drives installs in India |
| **Brand collaborations** *(later)* | Sponsored island themes and items | B2B | Cosmetic only |
| **Creator islands** *(later)* | Island editor; creators earn a share of cosmetic sales on their islands | revenue share | Grows content without an art team |

**India-specific:** UPI-friendly low-price "sachet" bundles (₹19 to ₹49) sized to impulse purchases; regional-language
store pages; a tiny download size (the prototype is well under 1 MB). **No real-money mechanics of any kind**; India's 2025
online gaming law prohibits online money games, and a skill-race is exactly the format that would tempt such features.

### 10.2 Illustrative economics *(all assumptions, for planning only)*
- Blended ARPDAU of **$0.04 to $0.06** (India-heavy early mix; tier-1 markets much higher).
- Revenue mix about **60% IAP** (pass about 35%, cosmetics about 20%, starter pack about 5%) and **40% rewarded ads**.
- Monthly payer conversion 2 to 3% of MAU, ARPPU $4 to $6 per month, DAU/MAU about 15% (so 80,000 DAU ≈ 530,000 MAU and
  11,000 to 16,000 payers, or $43,000 to $96,000 of IAP a month, which brackets the $72,000 IAP share of the example below).
- Example: 80,000 DAU x $0.05 x 30 days ≈ **$120,000 per month** gross. The real number depends on D30 retention and
  the tier-1 share, which is why soft launch measures those first.

### 10.3 The ethical firewall
The player model is used for **one** thing: the rival's next move. It is never used for prices, offer timing, ad targeting
or push notifications. No store prompts appear on a loss screen. Today, memory stays on the device. Shadows and the Crowd rival (section 9) would
upload notebook counts only with explicit opt-in, after the DPDP review in section 14.

## 11. Live operations

- **Daily:** Daily Commission (twist rotation), streak with freeze tokens earned by play *(roadmap)*.
- **Weekly:** Crowd rival; a featured Codex item with a cosmetic reward.
- **Seasonal (4 weeks):** new rival brain + biome + Codex page + pass.
- **Festivals:** Diwali, Holi, Eid, Christmas, and Lunar New Year for SEA.

## 12. What we measure

| Metric | Why | Target *(assumption)* |
|---|---|---|
| D1 / D7 retention | Does the loop and the memory hook bring people back? | ≥ 35% / ≥ 12% |
| Matches per session | Is "one more race" real? | ≥ 3 |
| Snatch-then-quit rate | Does a snatch feel fair or rage-inducing? | < 5% of snatches followed by a quit within 10 s |
| Rival Turing test | Can players tell the real rival from `?blind=1`, and which do they prefer? In simulation the two win about equally often, so a correct answer means players noticed the reading, not the difficulty | ≥ 70% can tell |
| Read decisiveness (simulated gate) | After the "make a correct read decisive" change (section 6), does the learned model change who wins? | A paired full-vs-blind win-rate difference on the same islands whose 95% interval excludes 0 (about ±8 to 9 points at RAVEN and MIMIC with 150 matches) |
| Explanation trust | "Was that true?" prompts on 1 in 15 snatches in playtests | ≥ 80% yes |
| Share rate | Daily Commission virality | ≥ 5% of Daily completions |
| Loyalty tax | Read rate in session N vs session 1 | ≤ +5 points |

Telemetry events: `order_start`, `gather`, `deposit`, `craft`, `order_end`, `snatch{reason}`, `outread`, `fooled`,
`match_end`, `tell_detected/broken`, `daily_start/end`, `share`, `forget_me`.

## 13. Production

- **Prototype stack:** vanilla JavaScript ES modules, Canvas 2D, WebAudio, localStorage; no build step, no dependencies,
  no assets. Pure logic (`match.js`, `model.js`, `world.js`) is shared by the game, the simulator and the tests.
- **Production path:** port the logic to Unity or Godot for mobile stores (the logic is engine-agnostic and small), keep the
  web build for instant-play marketing links, and add a light backend for Daily leaderboards and Shadows.
- **Team to soft launch** *(assumption)*: about 6 people (design, 2 engineers, art, UI/UX, live-ops/analytics) for 4 to 6 months.

## 14. Risks

| Risk | Mitigation |
|---|---|
| Snatches feel unfair | Visible intent, verdict pills, honest reasons with counter-tips, luck labelled as luck; measure snatch-then-quit |
| The AI is invisible (players think it's just speed) | Partly true today: reads add snatches (up to about 50% more in most cells) but move win rates only within noise; difficulty comes from the non-read parameters (speed, think time, order tier) and scarcity. Fix: make a correct read decisive (one key ingredient per order only one crafter can take, or claims that lock a node for a few seconds) and re-run the ablation. Meanwhile, glass mode, "What FOX learned about you" and the Turing test at soft launch make the reading visible |
| Memory punishes loyal players | Decay, blank Daily rival, measure the loyalty tax |
| Short content runway | Rival brains are code, not art: one per season; procedural islands |
| Privacy of behavioural data, especially minors | On-device only in the prototype; Shadows and the Crowd rival would upload notebook counts only with explicit opt-in; counts not recordings, forget-me button, no monetisation use, review against India's DPDP Act before any server-side profile |

## 15. About

**B Manoj** · started 23 September 2026 · completed 23 September 2026

I started with the idea of creating a small world-crafting game where the player receives an item to build, explores the island to find the required resources, and crafts it before an AI rival can do the same.

I explained the core gameplay, mechanics, progression, visual direction, and the overall experience I wanted to create. I then worked with AI to turn those ideas into the game's systems, recipes, resource mechanics, rival-learning system, progression, challenges, simulations, and supporting code.

I kept refining the game by testing the mechanics, adjusting the balance, improving the gameplay flow, and changing things based on what worked and what didn't. I also used AI to help review the code, identify problems, suggest improvements, and build different parts of the prototype faster.

The result is OUTCRAFT — a game built around exploration, resource gathering, crafting, and competing against a rival that learns from the way you play.

Everything was designed to keep the experience simple, fast, and replayable, while making every crafting decision feel like a race against your opponent.

No accounts. No trackers. No unnecessary network features. The game's core experience runs locally on the device.
