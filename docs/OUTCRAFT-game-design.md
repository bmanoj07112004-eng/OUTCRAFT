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
tells you exactly why, with real counts. Then you get to outsmart it.

**The fantasy:** *out-think something that is watching you.* Cozy crafting on the surface, a mind game underneath.

**One-line hook for a store page:** "Your rival learns your habits. Change them."

## 2. Design pillars

| Pillar | What it means | How the prototype proves it |
|---|---|---|
| **A rival you can read** | The AI's intent is always visible, never a black box | Dotted route + target reticle; "FOX FIRST / YOU FIRST" verdict; `?glass=1` shows its % guess per node |
| **Fair by construction** | The AI only knows what a human rival could know, and never lies about why it won | It never reads your taps, only your past choices and where you walk; habits are claimed only when a statistical test passes; random players are almost never accused (<6%, tested) |
| **60-second races** | Short, dense sessions that fit a phone and a commute | Matches of 45 to 70 s *(simulated)*; first to 3 stars |
| **Cozy craft, sharp competition** | Warm art and satisfying crafting; the tension comes from the rival, not from punishment | Plain-shape diorama, crafting pops, music; losing costs nothing but a star |

## 3. Who it is for

- **Primary:** mobile players aged 16 to 35 who like quick competitive sessions and cosy crafting (fans of Stardew Valley,
  Overcooked, Clash Royale-length matches). *(assumption)*
- **Markets:** India first (large mobile audience, short-session play, low-end Android devices are a design constraint),
  then SEA and global. The prototype has no assets and no network calls, which suits low-end devices and patchy data.
- **Motivations served:** mastery (beat a rival that adapts), self-discovery ("I didn't know I always go left"),
  collection (Codex), and light social (daily share cards).

## 4. The loops

| Loop | Length | What happens |
|---|---|---|
| **Moment** | 1 to 3 s | Pick the next resource, walk, gather. Watch the rival's line. Change course if it is going for yours |
| **Order** | 12 to 20 s | Gather the recipe (bag holds 3), deposit at the Workshop, parts craft themselves, finish first for a star |
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
| Rival | Personality | What it reads | Speed (player = 3.8) |
|---|---|---|---|
| PIP | The Apprentice: "Hi! I'm just here to learn how you do it." | Nothing yet (it only takes notes) | 3.0 |
| WREN | The Early Bird | Beeline, Home Turf, a little heading | 3.45 |
| FOX | The Copycat | + By the Book, Routine; steals what you need | 3.55 |
| RAVEN | The Watcher | + Favourite Side; reads every step | 3.75 |
| MIMIC | The Mirror | Everything; a step faster than you | 4.05 |

All five share one notebook about you ("Pip told me about you"), so the ladder feels like a gang that compares notes.

### 5.5 Tells, Codex and memory
- **Tells:** the five habits (Beeline, Home Turf, By the Book, Routine, Favourite Side). A Tell is *detected* when a rival
  reads it at least 25 points above chance in a match, *broken* when that edge falls to 5 points or less, and can relapse.
- **Codex:** every item you win an order for. Silhouettes until then.
- **Memory:** the notebook persists on the device and fades by 30% per match, so a player who changes can escape their past.
  "Make them forget me" wipes it.

## 6. The AI rival in depth

**Plainly:** each time you set off, the game writes down the choice you faced (which resources you still needed, how far each
was, where on the island it was, what the card listed first, what you took last) and what you picked. Five simple habit
detectors each guess your next pick. The rival listens most to whichever detectors have been right about *you* lately.
Then it walks to where it expects you to go, if it can get there first.

**Precisely:**
- **Lift statistics:** every habit is measured against a player choosing uniformly at random *among the same options*, so
  "you take the nearest one" means "more often than chance would, given what was available". This makes habits portable
  across different islands.
- **Fixed-share Hedge** (multiplicative weights on log-loss, with "sleeping experts" when a detector has no opinion) blends the
  five detectors and adapts when you change your behaviour mid-session.
- **Heading:** the rival also reads the direction you are walking, more strongly for higher rivals.
- **Decision:** every node scores `(needs it + P(you go there) x P(it arrives first) x steal/deny weight) / travel time`;
  the rival re-plans four times a second with hysteresis so it doesn't dither.
- **Honesty rules:** every snatch is explained from the evidence actually used (habit with real counts, heading, or "lucky
  guess" with its real %), plus a counter-tip ("Try a farther one."). Explanations are direction-aware, so a player who avoids
  the nearest node is told exactly that. The dossier only names a habit when a z-test against the uniform-choice expectation
  clears a bar that rises with the number of statistics searched.

**Evidence** *(simulated, see `docs/data/`)*
- Turning prediction off makes the top rivals **10 to 15 points easier** for the same bots, and they snatch about half as often.
- The rival's top guess on a human-like bot rises from **66% in match 1 to 74 to 77%** afterwards (chance about 50%);
  on a random bot it stays at chance. It learns habits; it does not cheat.

**Why no LLM at runtime:** a match gives 20 to 40 decisions, far too few to train a network; a 0.25 s re-plan leaves no room
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
  picking; reduced-motion support; no colour-only signals (verdict pills carry text); works offline once loaded.

## 8. First session (as built)

1. **Title:** the island plays itself behind the menu (attract mode). PLAY.
2. **How to play:** four lines. GOT IT.
3. **VS splash:** "PIP, The Apprentice: 'Hi! I'm Pip. I'm just here to learn how you do it.' It has never seen you play. Yet."
4. **Order 1:** the recipe card (Shovel = Iron + Plank); a bouncing hand says TAP on the nearest needed resource, then CRAFT
   on the Workshop. Tips explain the bag, auto-crafting and the rival's line.
5. **About a minute later:** a 3-0 or 3-1 win; results show NEW items in the Codex, "New rival unlocked: WREN", maybe a first
   Tell, and "What PIP learned about you: PIP was not predicting yet, only taking notes for the others."
6. **Match 2 vs WREN:** "Pip told me about you. You like the nearest thing, right?" The first honest snatch lands, and the
   player learns the real game.

## 9. Retention and metagame

**Built day-1 hooks**
1. **The rivals remember you.** The title greets returning players by time away and quotes 1 to 2 statistically real habits.
   The return itself is new content, because it depends on what you did yesterday.
2. **Daily Commission.** Same island, orders and twist for everyone (Rush Hour, Slow Growth, Big Bags, Masterwork, Nimble
   Rival); the daily rival starts with no memory so results are comparable; one ranked attempt; streak; share card
   (`OUTCRAFT · Daily #4 (Rush Hour) / Out-crafted FOX 3–1 · snatched 2× / 🟦🟦🟧🟦`).
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

**Guarding against a loyalty tax:** memory fades 30% per match, the Daily rival starts blank, and the ladder difficulty comes
from which habits a rival uses, not from punishing loyal players. The metric to watch is the read rate in the first 20 choices
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
- Payer conversion 2 to 3%, ARPPU $4 to $6.
- Example: 80,000 DAU x $0.05 x 30 days ≈ **$120,000 per month** gross. The real number depends on D30 retention and
  the tier-1 share, which is why soft launch measures those first.

### 10.3 The ethical firewall
The player model is used for **one** thing: the rival's next move. It is never used for prices, offer timing, ad targeting
or push notifications. No store prompts appear on a loss screen. Memory stays on the device.

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
| Rival Turing test | Can players tell the real rival from `?blind=1`, and which do they prefer? | ≥ 70% can tell |
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
| The AI is invisible (players think it's just speed) | Glass mode, "What FOX learned about you", the Turing test at soft launch; ablation shows prediction adds 10 to 15 points |
| Memory punishes loyal players | Decay, blank Daily rival, measure the loyalty tax |
| Short content runway | Rival brains are code, not art: one per season; procedural islands |
| Privacy of behavioural data, especially minors | On-device only, counts not recordings, forget-me button, no monetisation use, review against India's DPDP Act before any server-side profile |

## 15. About: how this was made

| | |
|---|---|
| **Started** | 23 September 2026, 1:07 pm IST |
| **First prototype (UNREADABLE)** | built and tested by about 2:05 pm; red-teamed; archived in `archive/unreadable-v1/` |
| **Pivot to OUTCRAFT** | about 2:05 pm, at the designer's request for a crafting game; first playable about 2:30 pm |
| **Reviews, polish and re-balance** | 2:45 pm to 4:00 pm: 28 AI code/UX review findings fixed, AI rebalanced after the snatch fix |
| **Completed** | 23 September 2026 (first public build) |

**Human and AI, honestly:**
- **B Manoj (designer, human):** came up with the core idea (a small-world crafting game where you are handed an item to make,
  find the resources on the island and craft it), chose to make it a race against an AI rival that learns you, set the
  direction and the quality bar ("world-class, top-rated, unique, fun"), made the key calls (dropping the first prototype,
  the premium polish pass, the About section, the public release), and playtested and gave feedback.
- **Claude Code (AI, Anthropic):** turned that direction into detailed systems and code: recipes and resource tuning, the
  rival's learning model and decision rule, the rival ladder, the day-1 hooks, the procedural art and audio, the bot
  simulations and tests, multi-agent research and critique for the written answers, and first drafts of this document;
  it also fixed the findings of its own review agents.
- **What is verified:** 11 automated tests and reproducible simulations. **What is not:** there is no human playtest data yet;
  every retention and revenue number above is an assumption to be tested.
