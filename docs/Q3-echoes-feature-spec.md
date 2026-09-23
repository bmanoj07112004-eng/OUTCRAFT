# ECHOES: Rival Invasions

**Q3 design specification.** One feature for a mobile survivor-like (auto-attack, escalating hordes, build picks mid-run). I assume our game copies Survivor.io's shape: open, linear and enclosed stages; 6 active and 6 passive slots; 5 levels then EVO; paused level-ups; sellable heroes [S1][S3]; generic skills gated by chapter.

> **TL;DR**
> - **Feature:** when your run ends, your build becomes an **Echo**, an AI rival that moves the way you moved. Echoes invade other players' runs between bosses. Beat one in a 60-second duel to **steal** one of its upgrades, sometimes a skill you haven't earned yet.
> - **Why:** another player's decisions inside a solo run with no real-time netcode, and a return hook (the Echo Report) aimed at players about to lapse.
> - **New, stated narrowly:** Survivor.io's Showdown (Dec 2025) lets the *loser* of a live match take meta gear. ECHOES lets the *winner* take one in-run card from an async AI copy.
> - **Fully detailed section:** [§5 The Steal](#5-the-steal-fully-detailed-section).
> - **First test:** a single-player prototype with dev-made Echoes: host win rate, Steal take rate, and whether friends can pick out a friend's Echo.
> - **Kill:** at soft launch, invasions switched off by more than 30% of D7-active players, or no D1 lift after two tuning passes.

I design systems that read players and let players read them back. Here the game reads how you move, sends it into someone else's run, and shows them the tell.

## 1. Rationale

| # | Problem (hypothesis unless sourced) | Evidence | Check |
|---|---|---|---|
| P1 | The middle of a run sags. By minute 7 of 15 the build has mostly taken shape, the next boss is 3 minutes away, and nothing asks for a decision. | Open chapters run 15 min with 3 bosses [S1]. A low-tier Chapter 2 guide notes a scripted surround wave at 7:00 [S2], so the lull may be shorter than I think. | In control runs, touches per second in 6:30–8:30 fall below 3:00–5:00. If the dip is elsewhere, W1 (§4) moves there |
| P2 | Builds converge once recipes are known. | Evolutions are fixed pairs, e.g. Lightning Emitter + Energy Cube = Supercell [S3]. | Distinct top-3 skill sets per 1,000 runs |
| P3 | Other players never appear in normal chapter runs, where I assume most sessions go. | Survivor.io's multiplayer lives in separate modes: Showdown is live, windowed and ticketed [S4]; co-op was local [S5]. | Constraint sourced; desire is a hypothesis |

**Business goals.** (1) D1 and D7 retention, the primary KPI: a new player's Echo works from their first run, and a push says when something happens to it (§6). (2) Social play without liquidity risk: a 2 a.m. player fights someone who played at 9 p.m. (3) Player-made content: every eligible run authors an opponent.

| Rejected | Why not |
|---|---|
| Real-time 1v1 PvP | Habby shipped Showdown with open-hour windows, entry tickets and disconnect-equals-defeat from day one [S4], the constraints live PvP needs on mobile. We would arrive second. |
| Online co-op | Vampire Survivors shipped it in Oct 2025 [S6]. Me-too, and friends must be online together. |
| Async auto-battle arena | Archero 2 has one: you spectate your hero against a saved setup [S7]. Spectating removes the genre's only verb, moving. |

## 2. Feature overview

**One invasion, from the host's thumb.** 6:34 into Chapter 6 the game pauses: ECHO OF RAVI_07 INVADES, orbits clockwise, keeps its distance. The prize is Chain Lightning, a skill I haven't earned yet. I tap READY. It kites me and marks me with lightning; my Orbit Saws can't reach it. Then it glows and dives. I cut across its orbit, the saws connect, and Chain Lightning is mine for the run.

**The rules in one sentence.** When your run ends your build becomes an Echo; Echoes invade other players' runs between bosses; beating one lets you steal one of its upgrades; your Echo keeps fighting while you're away and reports back. The **owner** is the player whose run made the Echo; the **host** is the player whose run it invades.

| Borrowed from | Idea | My change |
|---|---|---|
| NetHack bones [S8], Stay Safe [S9] | Copies of earlier players guard loot or gate progress | Mid-run and optional, in a horde game |
| Phantom Abyss [S10] | Take the whips of failed runs' ghosts as they fall | Closest prior art for taking from an async copy; not a survivor-like |
| Dark Souls NPC invaders [S11] | AI invaders get the player-invasion warning and work offline | Labelled as AI |
| Forza Drivatar [S12][S13] | Models how you drive; earns credits while you're away | Tribute; clamps (§8) |
| Clash of Clans Revenge [S14][S15] | Attack the base that raided you; no revenge of a revenge | Summon, no chains |
| Hades [S16][S17] | Pick 1 of 3; Exchanges replace a slot | The replaced card is lost |

**What already exists.** Survivor Showdown (v4.4.2, 18 Dec 2025 [S18]) has "Steal-on-Loss": after a defeat, the loser swaps one of the winner's Equipment, Parts, Survivor or Synergy pieces into their locked Showdown loadout; the first steal is free, more cost Medals [S4]. Those are launch rules; Habby has since posted adjustments I could not read [S19].

| | Showdown Steal-on-Loss | ECHOES Steal |
|---|---|---|
| What moves | Meta loadout pieces | One in-run card, gone when the run ends |
| Who steals | The loser (catch-up) | The winner (reward) |
| Where | Live 1v1 boss race, open hours | Normal PvE run, any time, works offline |
| Opponent | A live human | An AI that moves like its owner |

From Habby I borrow one idea: the loser gets something, so the owner earns Tribute even when beaten. poncle's SURVIVATON (1–8 players, point stealing, PC and console, 2027) is nearby PvP too [S20]. My claim is narrow: **I found no shipped survivor-like (as of Sept 2026) where an AI copy of another player's build, moving like them, invades your PvE run mid-stage and can be beaten to take one of its in-run upgrades.** Absence claims are medium confidence at best. ECHOES is a working title; Survivor.io's Ender's Echo is a boss damage race [S21], so the fallback name is REVENANTS.

## 3. Echo creation

| Rule | Detail (assumptions) |
|---|---|
| Eligible runs | 5:00+ on an open or linear stage, ending with 2+ active skills at Lv 2+, so throwaway runs can't flood the pool |
| Snapshot | At death or clear: hero, skill levels, evolutions, per-skill damage share, cosmetics, chapter, content version, movement traits (§8). About 2 KB (estimate) |
| Lifetime | One live Echo per owner per chapter band, replaced by the next eligible run unless pinned. Expires after 7 days: long enough for a report, short enough to flush a weekly balance patch |
| Upload check | Server rejects illegal slot counts, levels or recipes, and levels the run's length and chapter can't reach, then re-clamps movement traits |
| Meta power | Gear, talents and pets are display-only (§7) |
| Privacy | Anonymous Echo in Settings, default on for accounts under 18 or of unknown age. My understanding is that India's DPDP Act 2023 requires verifiable parental consent for children's data; counsel must confirm. Only derived movement traits are stored, disclosed on first run |

## 4. Invasion flow

| Stage format [S1][S22] | Arrival window (assumption) | Rule |
|---|---|---|
| Open, 15 min, bosses near 5:00, 10:00, 15:00 (assumption) | W1 6:30–8:30 | First moment in W1 with no scripted wave or elite on screen |
| Linear corridor, 15 min | W1 6:30–8:30 | Enters from the scroll edge; orbit trait off |
| Enclosed, 8 min, 5 bosses | None at launch | Five bosses in 8 min leave no gap |

**Who gets invaded (assumptions).** One invasion per run. None if host HP stays under 50% through W1, on Steamroll, event or daily-challenge runs, or on a chapter the host has failed twice. The wall rule assumes wall pushers are the likeliest to switch invasions off; if the prototype shows no difference, it goes.

**Telegraph.** The game pauses, as level-ups already do, on a card: "ECHO OF RAVI_07 INVADES · AI trained on RAVI_07's movement", its tell ("Orbits clockwise, keeps its distance"), its three skills, the three cards it offers if beaten (§5.3) and a label (Even, Tough, Deadly). The player taps READY; the Echo enters 2 s later (assumption) from an edge marked by an arrow and a haptic tick. Dark Souls gives AI invaders the same warning as human ones [S11]. The pause turns the warning into a decision: fight for that prize, or run out the clock.

![Invasion](wireframes/w1-invasion.svg)

### 4.1 The 60 seconds

Whether ECHOES is fun is decided here. All numbers are assumptions for the prototype to tune.

| Rule | Why |
|---|---|
| Your auto-targeting weapons prefer the Echo whenever it is in their range. | Otherwise the nearest mob soaks every shot. |
| Spawns thin to 50%. Mobs ignore the Echo; its attacks pass through them. | It never clears space or farms XP for you. |
| It fires only the three skills on its banner, each mapped to one of 6 PvP patterns (projectile, orbit, zone, chain, beam, summon) with a 0.4–0.8 s tell. Max 30 Echo projectiles on screen. | Many PvE weapons hit instantly or home in. Undodgeable hits turn a duel into a DPS race. |
| It keeps its owner's preferred range (at most 40% of screen width) and orbit direction. Every ~8 s it commits: glows for 0.5 s, then dives inside your shortest weapon range for ~2 s. | Orbit and aura builds need a window, or they could never touch a kiter. |
| XP banks during the duel; level-ups open after it. | No pause mid-fight, and the prize can't change under you. |

**What wins is reading its orbit and meeting the dive.** Against RAVI_07's clockwise kiter, my Orbit Saw host steps out of each lightning mark before the chain arcs, then moves against the orbit when it glows, so it dives into the saws. Two or three commits kill it inside the 25 s design time (§7). A projectile host chips from range instead. The Echo's build shapes the threat too: a chain Echo kites and chips, an orbit or aura Echo must close and trade blows, and r in §7 prices both.

| Outcome | Target (assumption) | What happens |
|---|---|---|
| Host wins | ~75% | The Steal (§5); host +10 Tribute |
| 60 s runs out | ≤ 15% | The Echo fades. No penalty; running out the clock is a legitimate escape |
| Echo breaks the host | 10–15% | A hit that would take you to 0 sets HP to 10% of max with 2 s of invulnerability, and the Echo escapes with its cards. Mobs still kill as normal |

Echo HP sets the timeout rate and Echo damage the break rate; host wins are the remainder. **The Echo can't kill:** with lethal duels and 25% Echo wins, a player with three invaded runs a day would lose two or more to strangers on about 16% of days (binomial). No paid revive, energy or offer pop-up appears for 60 s after an Echo event.

**On by default, easy to switch off.** The first invasion is a scripted dev-made Echo (d = 0.8) around 6:30 of Chapter 1, so every new player meets the Steal in session one (assumption). An **Echo Beacon** toggle on stage select turns invasions off and stays as set. Elden Ring makes invasions effectively opt-in [S23]; I start opt-out because the Steal is the reward.

## 5. THE STEAL (fully detailed section)

Every number is a starting assumption from the tuning table (§5.6). On screen these are "cards"; in code, "items".

### 5.1 Player-facing rules

1. A beaten Echo drops an **Echo Core**, which homes in on you after 3 s. You are invulnerable from the frame the Echo dies until 1.0 s after the Steal closes.
2. The game pauses and shows up to **3 cards** from the Echo's build, fixed when the invasion began. Three is the genre norm (Survivor.io level-ups [S24], Hades boons [S16]; Vampire Survivors offers 3 or 4 [S25]).
3. Steal one, or **Heal instead** (30% of max HP, capped at full).
4. The stolen card joins your build and your level-up pool for the rest of the run. An active brings its evolution partner into the pool too.
5. A new card needs a free slot of its type, or you discard one. Upgrading a card you own needs no slot.
6. Steal or heal, you earn 10 Tribute for the win, credited at once and kept if the run later fails. The Echo's owner earns 10 for the invasion (§6).

### 5.2 UI flow

![The Steal](wireframes/w2-steal.svg)

| Step | Screen | Input | Result |
|---|---|---|---|
| 1 | Echo HP hits 0: 0.5 s at 0.3× speed, Echo shatters, Core drops, mobs within 3 m pushed back | none | Clear ground around the Core |
| 2 | Core pulses; after 3 s it homes in at 2× your max speed | walk over it, or wait | Game pauses |
| 3 | "STEAL FROM RAVI_07'S ECHO"; its build strip, excluded cards grey; up to 3 equal cards (signature, passive, other), none selected; HEAL INSTEAD below | tap a card, or HEAL INSTEAD | Card enlarges with effect and build change. Heal asks CONFIRM, then step 6 |
| 4 | Enlarged card | tap STEAL | Owned item or free slot: step 6. Slot type full: step 5 |
| 5 | Slot picker: your cards of that type. Tapping one shows DISCARD, plus a warning if it breaks a recipe ("Discarding Frost Orb cancels Blizzard Heart") | tap DISCARD, or BACK | DISCARD: step 6. BACK: step 3 |
| 6 | Card flies into the build bar; toast "Stolen: Chain Lightning Lv 3" or "+30% HP" | none | Queued level-ups open, then the run resumes |

**Card text.** Badges: ★ SIGNATURE, LOCKED FOR YOU, EVO PAIR, UPGRADE. A new card reads "Echo Lv 5 · yours Lv 3 (new)", an owned one "Echo Lv 4 · yours Lv 2 → 3". Recipes read "[Active] + [Passive] → [Evolution]" with owned parts ticked. Android back does nothing in step 3 and acts as BACK in step 5.

**No choice timer.** Level-ups already pause the game, and a timer punishes the player whose phone just buzzed. Every choice takes two taps because the cards are large and mis-taps likely (assumption).

### 5.3 Card generation

**The pool.** A host's level-up pool is every skill their account has earned plus their hero's exclusive (assumption: generic skills are gated by chapter, e.g. Chain Lightning at Chapter 9). A card is **LOCKED FOR YOU** when the host hasn't earned it. Locked cards come from Echoes whose owners are further along, and selection favours them (§7). About 40–60% of offers should carry one for hosts in Chapters 1–10, falling to near zero once every skill is earned (estimate). So locked cards are the early and mid-game hook; for veterans the Steal is about levels and recipes. A stolen locked skill is a free trial of later chapters: if that works, hosts who stole one attempt the next chapter sooner than hosts who didn't.

**When.** The offer is built once, at invasion start, from a snapshot of the host's build and the seed `hash(run_id, invasion_id)`; both go into the run save. Level-ups wait until after the duel, so the Steal screen shows exactly what the banner promised.

```text
function buildStealOffer(echo, snap, seed):        # snap = host build at invasion start
  rng = PCG32(seed); pool = []                     # integer weights and maths only
  for item in sortById(echo.inRunItems()):         # gear-granted weapons are not in-run items
    item = resolve(item, snap.hero)                # evolved -> base form, L_echo = 5;
                                                   # exclusive -> generic (unchanged if same hero,
                                                   # null if no generic); otherwise unchanged
    if item == null: continue
    if snap.level(item) == L_max or snap.hasEvolved(item): continue
    if pool.has(item.id): pool.keepHigherLevel(item); continue    # dedupe after resolve
    w = 4
    if item not in snap.pool:        w += 4        # LOCKED FOR YOU
    if snap.ownsEvoPartner(item):    w += 3        # EVO PAIR
    if snap.owns(item):              w += 2        # UPGRADE
    pool.add(item, w)

  offer = []
  sig = max(pool.actives, by = (echoLevel, damageShare, -id))
  if sig: offer.add(sig); pool.remove(sig)         # shown on the banner
  if pool.passives:
    p = weightedPick(pool.passives, rng); offer.add(p); pool.remove(p)
  while len(offer) < 3 and pool:
    c = weightedPick(pool, rng); offer.add(c); pool.remove(c)
  return offer                                     # 0 to 3 cards; 0 skips the screen
```

The signature is picked after the host's exclusions, so the banner never promises a card the host can't take.

### 5.4 Level transfer

```text
new item:    L_new = clamp( floor(L_echo × 60 / 100), 1, L_cap )                       # τ = 0.6
owned item:  L_new = min( L_max, L_host + max(1, floor((L_echo − L_host) × 60 / 100)) )
L_cap = 3, L_max = 5; an evolved Echo item counts as L_echo = 5
```

| Echo level | Host has | Result |
|---|---|---|
| 5 | nothing | Lv 3 |
| 4 | nothing | Lv 2 |
| 5 | Lv 2 | Lv 3 |
| 3 | Lv 4 | Lv 5 (minimum gain of 1) |

A fresh Lv 3 card equals exactly three level-up picks. The Steal must beat one level-up, since the duel costs up to 60 s and real risk, but must not replace a phase of decisions. L_cap stops steals turning decisive if τ is raised later. Stolen levels don't touch your XP bar or character level.

**Evolutions.** A stolen active is in your pool, so level-ups raise it: at least two more picks from Lv 3, three from Lv 2. At Lv 5 with its partner passive it evolves from the next boss chest, the gate Survivor.io and Vampire Survivors both use [S3][S26].

### 5.5 Edge cases

| Case | Rule | Why |
|---|---|---|
| Slot type full | Slot picker (step 5); any card of that type except the gear-granted starting weapon. The discarded card leaves your pool for the run; no refund | Hades Exchanges keep the replaced boon's level [S17]. I deliberately don't, so the player weighs the levels they lose |
| Owned card | Offered as an upgrade; needs no slot; never two copies in one offer | One item, one slot |
| Host's copy maxed or evolved | Excluded; grey in the build strip | A dead card wastes a third of the offer |
| Echo's item evolved | Base form at L_echo = 5, recipe shown | Handing out evolutions skips the recipe loop |
| Hero-exclusive skill | Generic sibling; excluded if none; unchanged if the host plays that hero | Heroes are sold [S27] |
| Gear-granted weapon | Never offered | In-run cards only; Showdown moves meta gear [S4] |
| Passives | At least one in the offer when one qualifies | "Power now vs recipe later" |
| 1–2 cards qualify | Show them plus HEAL INSTEAD | No filler cards |
| None qualify | Screen skipped: 30% heal, toast "Nothing left to steal", `steal_skipped` logged | No screen with one real option |
| Level-up due in the duel or at pickup | Queued until after the Steal | One pause at a time; the offer stays valid |
| Same frame | Echo death resolves before timeout and host death | The host landed the kill |
| Host dies to mobs mid-duel | Duel ends; counts as an Echo win | The owner's report stays true |
| App backgrounded | Run and duel timer pause (in-game time); same offer on return | The offer is in the run save |
| Force-quit or crash | Steal state saved from the frame Echo HP hits 0; same offer on resume. If the save can't be restored (corrupt, or abandoned at the resume prompt), the report counts the Echo as beaten and no steal is granted | No reroll by restart |
| Offline | Two payloads prefetched at run start: one for W1, one spare if the first fails the content-version check; a dev-made Echo if none are cached. Steals from expired or pre-patch payloads stay valid; owner reports count uploads within 7 days | Nothing mid-run needs a connection |
| Anonymous or dev-made Echo | Header "STEAL FROM AN ECHO" or the archetype ("THE ORBITER"); dev Echoes pay no owner. Names truncate at 12 characters | No blank headers |
| Stealing from a friend | Same rules. The owner's report offers **Summon their Echo**: it takes the owner's next Beacon-on run, ignores the chapter filter, replaces that run's invasion, and expires after 72 h (assumption). Hidden if the friend has no live Echo; no summon of a summon | Clash of Clans blocks revenge of a revenge [S15], which I read as loop prevention |

### 5.6 Tuning table (starting assumptions)

| Parameter | Start | Test range | Moved by |
|---|---|---|---|
| Offer size | 3 | fixed | Genre norm |
| τ, transfer ratio | 0.6 | 0.4–0.8 | Take rate; clear-rate guardrail |
| L_cap for new cards; L_max | 3; 5 | 2–4; fixed | Take rate |
| Weights: base, locked, EVO pair, owned | 4, +4, +3, +2 | 0–8 each | Locked pick rate; signature share |
| Heal instead | 30% of max HP | 20–50% | Take rate when host HP < 30% |
| Core delay, homing speed | 3 s, 2× host | 1–5 s | Time from Echo death to pickup |
| Kill slow-mo; push-back radius | 0.5 s at 0.3×; 3 m | fixed; 2–5 m | Hits taken before pickup |
| Post-steal invulnerability | 1.0 s | 0.5–2 s | Hits taken in the first 2 s after resume |
| Host Tribute per Echo beaten | 10 | 5–20 | Tribute economy (§6) |
| Steals per run | 1 | fixed at launch | One trophy keeps it an event |

Duel and spawn numbers live in §4.1 and §7.

### 5.7 Anti-exploit rules

- **No reroll by restart:** seed and host snapshot live in the run save.
- **Server recomputation:** `steal_offer_shown` carries the seed, snapshot and config version; the server rebuilds the offer with the same PCG32 and integer weights. A mismatch voids only that run's Echo-granted rewards; three flag the account (assumption), so one bug doesn't punish an honest player.
- **Forged Echoes:** uploads are checked for legality (§3), because a signing key shipped in the client proves nothing. Downloads are server-signed so hosts can't edit the Echo they fight. Echoes are filtered by content version; banned accounts' Echoes are purged.
- **Client-trusted duels:** the client reports outcomes. I accept that and keep stakes small: run-only steals, 10 Tribute, one invasion per run.
- **Feeding:** one (owner, host) pair pays once per rolling 24 h and owner Tribute is capped at 100 a day, so alt farming is capped, not prevented. A friend-alt could steer what a main steals; the 30% friend share and one Summon per friend per day bound it.
- **Trading:** impossible; steals never leave the run.

### 5.8 Telemetry

Every event carries `cell` and `config_version`.

| Event | Fields |
|---|---|
| `echo_invasion_start` | run_id, invasion_id, echo_id, owner_hash, is_friend, is_summon, is_dev_echo, chapter, attempt_no, run_time_s, host_hp_pct, host_dps, d, r, label, offer item_ids |
| `echo_invasion_end` | invasion_id, outcome (win / timeout / break / mob_death), duel_s, host_hp_lost_pct, commits_hit |
| `steal_offer_shown` | invasion_id, seed, host_snapshot, per card {item_id, position, level_offered, locked, evo_pair, owned, is_signature}, free slots by type, host_hp_pct |
| `steal_choice` | invasion_id, pick (position or heal), item_id, level_before, level_after, replaced_item_id, replaced_level, back_count, decision_ms (foreground ms, screen shown to final confirm), cards_inspected (distinct cards enlarged) |
| `steal_skipped`, `steal_interrupted` | invasion_id, reason; cause (background / quit / crash), restored |
| `run_end` (extended) | stolen_item_id, stolen_levels_gained_after, stolen_evolved, stolen_dps_share, result |

### 5.9 Success metrics

| Metric | Target (assumption, reason) | If missed |
|---|---|---|
| Steal take rate vs Heal | ≥ 80%; a steal should beat a heal unless HP is low | Raise L_cap to 4, then the locked weight |
| Locked pick rate when offered beside earned cards | ≥ 55%; tests the bet that locked cards are the reason to fight | Cut the locked weight; lean on EVO pairs |
| Signature share of steals | ≤ 60%; above that the 3-card choice is fake | Raise non-signature weights |
| Stolen card levelled again after the steal | ≥ 50%; it became part of the build | Show the build change more clearly |
| Stolen actives that evolve | ≥ 20%; steals should shape builds, not pad stats | Raise the EVO-pair weight |
| Median decision time | 4–12 s; faster means an obvious choice, slower means confusing cards | Rewrite card text |
| Chapter clear rate, all B runs vs all A runs | −2 to +5 pp; steal runs alone would be biased, since those hosts already won a duel | Above: lower τ. Below: lower Echo damage |

**Falsifiable line.** If locked cards drive the fight, hosts offered one run out the clock less often than hosts who aren't.

## 6. Echo Report & Tribute

**The report leads with a story because the count is small.** At 3 runs per DAU with half able to host (assumptions: past 6:30, Beacon on, no wall or Steamroll), hosts supply about 1.5 × DAU invasions a day. An Echo is **on duty** when its owner has been away 18–72 h or the account is under 72 h old: about 0.5 × DAU Echoes if DAU/WAU ≈ 0.4 (estimate), so about 3 invasions per on-duty Echo per day. Owners seen in the last 18 h, or gone over 72 h, are benched (fallback only), because a report matters most to someone likely to return soon.

| Returning player (estimates) | On duty for | Invasions | Example report (illustrative) |
|---|---|---|---|
| New player, back on D1 after ~20 h | ~20 h at ×2 weight | ~5 | "MEERA_22 stole your Chain Lightning. Your Echo invaded 5 runs and beat 1 player. +60 Tribute." |
| Lapser, back after 72 h | 54 h | ~7 | "ANANYA stole your Chain Lightning and cleared Chapter 8 with it. Your Echo invaded 7 runs, beat 1 player. +80 Tribute." (W3) |
| Daily player, back after 24 h | 6 h | 0–1 | A home-screen card, not a full screen |

The D1 hook is one named person taking your card, announced by a push at the hour you usually play, not volume. If the D1 lift appears only for push-enabled players, the push is the feature (§11).

**Story first.** The headline is the best event: a friend's steal, then your signature stolen, then an Echo win. Full screen only after 18 h+ away with at least one event. Being stolen from shows as fame ("Most coveted: Chain Lightning, 3×"). **Push:** at most one a day, at the owner's usual play hour, only for a story event. Permission is asked in context after the first Steal ("Want to know when someone steals from your Echo?"); Android 13+ needs a runtime prompt [S28].

![Echo Report](wireframes/w3-echo-report.svg)

Skill names are hypothetical; Survivor.io's nearest to Chain Lightning is Lightning Emitter [S3].

**Tribute** is Forza's idea ("your Drivatar is earning you credits" [S12]). All values are assumptions.

| Sources | Sinks |
|---|---|
| Owner: 10 per invasion, +10 when the Echo wins | First Echo aura: 140, about 7 days for a daily player |
| Host: 10 per Echo beaten | Pin a favourite Echo past 7 days |
| Owner cap 100 a day, anti-farm only (a busy on-duty Echo earns 30–40) | Level-up reroll token, max 1 per run; gold conversion, weekly cap |

A daily player earns about 20 a day (estimate: under 1 own-Echo invasion at 10, plus 1.5 hosted duels × 75% wins × 10). One rewarded ad doubles a report's Tribute, once a day, with the amount on the button. Never on the Steal screen; Tribute is never sold.

## 7. Echo selection & power normalisation

**Filters (assumptions):** same stage type, chapter within ±2, under 7 days old, same content version, not the host's own, not met in the host's last 10 invasions. **Weights (assumptions):** on-duty owner = 1; account under 72 h old ×2; carries a skill locked for the host ×2; friends any time, max 30% of a host's invasions; benched Echoes only if nothing on duty passes the filters.

**Normalisation.** The Echo keeps its in-run build and drops its meta power. In-run strength counts, damped; the host's total power counts a little.

```text
DPS_x    := single-target DPS from a headless-sim table per skill and level (not observed damage)
r        := clamp( sqrt(inRunDPS_echo / inRunDPS_host), 0.7, 1.4 )   # meta stripped on both sides
TTK      := 25 s × d × r × (DPS_chapter / DPS_host)^0.2             # host's time to kill the Echo
HP_echo  := DPS_host × TTK
DPS_echo := r × maxHP_host / 20 s                                     # if every Echo hit landed
d        := clamp(1 + 0.8 × (w − 0.75), 0.8, 1.2)                    # w = host win rate, last 10 invasions,
                                                                      # timeouts = half a loss; 0.75 until 5
```

All constants are assumptions. A host with twice the chapter's reference DPS kills an even Echo in 25 × 2^−0.2 ≈ 22 s. An Echo with twice the host's in-run DPS (r clamped to 1.4) takes 35 s and hits 1.4× harder. Both d clamps bind: w = 1 gives 1.2, w = 0.5 gives 0.8.

**Trade-off.** Full normalisation would make this the one fight where your build doesn't matter, in a genre built on escalating power. None would let a whale's Echo crush a F2P host. I chose fairness with a visible slope: your in-run build moves the duel by −30% to +40%, your gear by about 13% per doubling of DPS, and gear shows fully in the other 14 minutes. Echo meta never travels and Echo damage scales to the host's max HP, so spend can't crush anyone. Sim-table DPS closes sandbagging and counts only damage that can hit a single moving target.

**Label.** Even, Tough or Deadly from d × r (under 0.95, 0.95–1.15, over 1.15; assumptions). After about 50,000 logged duels (assumption), d gives way to a logistic win-probability model (host DPS, host HP, Echo archetype, weapon families) retrained weekly, and the label shows its odds. Rejected: bracketing by raw power, which splits a thin pool by spend and still leaves walls at bracket edges.

## 8. AI pilot: behaviour cloning, lite

The Echo moves like its owner through three traits players can see, layered on one of four dev-made archetypes (Orbiter, Kiter, Brawler, Collector).

| Option | Verdict |
|---|---|
| Ghost replay of the owner's inputs | Can't react to a different horde or a moving host |
| Learned policy (neural network) | Inference cost on budget Android; opaque; copies exploits I can't clamp |
| **Fitted steering (chosen)** | Seek, flee, orbit, avoid with owner-fitted parameters: cheap, clampable, explainable in one line |

**Traits**, each in 3 crowd-density buckets (my analogue of Drivatar's per-segment model [S29]): **preferred range** (clamped to 40% of screen width), **orbit direction** (share of clockwise circling) and **aggression** (retreat vs strafe when hit). Sampled at 5 Hz, kept as histograms on device, reduced to 9 medians and shares before upload, under 50 bytes (assumptions). Under 3 minutes of samples, the archetype plays unmodified. A leash keeps the Echo within 1.2 screen widths (assumption); off-screen, an edge arrow tracks it. It costs about one elite enemy on the host's device (estimate).

**Clamps (the Forza lesson).** Turn 10 removed player imitation from Forza Motorsport (2023) to "reduce aggressive driving behavior" [S13]. The Echo copies how you move, never what you exploit: stillness capped at 10%, at least 1.5 body widths from the host, no contact damage, no heatmap-found safe corners (assumptions), re-applied on the server. The banner says "AI trained on RAVI_07's movement"; it never poses as a human.

**Read-back, and its test.** The host plays against the tell on the banner; the owner reads it in their report. Before building uploads, the prototype checks that the traits carry information: friends must pick their friend's Echo from three unlabelled ones above chance (33%). If they can't, ship the four archetypes alone.

## 9. Monetisation & growth

ECHOES is a retention feature: its revenue is retention times the existing monetisation, and I don't forecast a direct ARPDAU lift.

- **Never sell power:** no paid steals, offer rerolls, invasion control or Tribute.
- **Cosmetics where hosts look:** Echo auras show on the telegraph portrait, the Core drop and the Steal header. An on-duty Echo appears about 3 times a day to hosts busy dodging, so most views of a skin are the owner's own report. Auras sit in Tribute and a seasonal pass track; I don't sell them on an audience claim.
- **Growth:** a WhatsApp share ("My Echo is coming for you") deep-links an invite, and the invitee's teaching invasion uses the inviter's Echo at d = 0.8. Weekly creator Echoes from Indian gaming YouTubers run as live-ops events. Track the K-factor of Echo links.
- **Revenue guardrails, B vs A across all players:** ARPDAU, payer conversion, ad ARPDAU, and clear rate on the three highest-revenue wall chapters, since steals lower wall pressure and I assume spend concentrates at walls. Energy or revive spend within 10 min of an Echo event counts as harm, not revenue.

## 10. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Read as a copy of Showdown's Steal or Ender's Echo | High (Survivor.io players) | §2 differentiation; fallback name REVENANTS |
| Invasions feel like an interruption | High | Pause-and-choose telegraph, non-lethal breaks, timeout escape, wall runs skipped, persistent Beacon; kill line (§11) |
| Imitation imports bad behaviour, as in Forza | Medium | Clamps, server re-clamp, archetype fallback (§8) |
| Steals cut wall revenue | Medium | Two-sided clear-rate guardrail; wall-chapter tracking (§9) |
| Report too thin to matter | Medium | On-duty pool, story-first report, push (§6) |
| WB's Nemesis patent US 10,926,179 B2 (granted 23 Feb 2021; continuations US 11,660,540 B2, US 12,201,908 B2): its "social vendetta" lets one player's defeat create an adversary others fight [S30][S31] | Unknown | Legal review before production; no non-infringement claim. Monolith closed on 25 Feb 2025; WB still owns the patent [S32] |
| Thin Echo pool in late chapters | Medium | Wider chapter band, benched fallback, dev-made Echoes |
| Offensive names or cosmetics; children's data | Medium | Name filter, reporting, Anonymous default under 18 (§3) |

## 11. Scope, test plan & KPIs

| Phase | Scope and what it measures | Team and time (estimates) |
|---|---|---|
| Prototype, no backend | 20 dev-made Echoes on 4 archetypes, duel rules, 6 attack patterns, the Steal, local telemetry. Measures win, break and timeout rates; take rate; decision time; fight-vs-kite share; the friend-ID test (§8) | 1 designer, 2 client engineers, 1 artist; 4–6 weeks |
| Soft-launch MVP | Player Echoes (plus the 3 traits if friend-ID passes), on-duty selection, sim-table normalisation, report card and push, server checks, Tribute with pin and one aura | + 1 server engineer, 1 QA; about 4 months |
| Later | Summons, Tribute shop and pass track, win-probability model, creator Echoes, second-window and second-steal tests | Live-ops cadence |

Prototype plus MVP is about 25–35 person-months (estimate), driven by attack patterns, sim tooling and live-ops dashboards. Server cost is small: about 2 KB per Echo and a few reads and writes per run (estimate).

**Soft-launch A/B.** A is control; B gets ECHOES with W1. Only B players create Echoes and only B players host, so the on-duty ratio matches a full rollout. A second window (11:30–13:30) and a second steal are separate later tests; bundled, they couldn't say which one moved the numbers. **Sample size:** +2 pp D1 on a 40% baseline (assumption) needs about 9,500 installs per arm (80% power, α = 0.05). I expect about 80% of B installs to meet an Echo on D0 thanks to the session-one tutorial (estimate), so exposed players need about +2.5 pp.

| KPI | Target (assumption, reason) |
|---|---|
| D1 retention, B vs A, split by push permission | +2 pp; the smallest lift that pays for a feature this size |
| D7 retention, B vs A | ≥ +1 pp; the report must outlast its novelty |
| Beacon off, share of D7-active B players | ≤ 15%; the on-duty model absorbs a 15% drop in hosts, not 30% |
| Median events per report on return | ≥ 3; below that the report is a stub |
| Quit or idle rate between bosses 1 and 2, B vs A | −20% relative; if the lull is real, filling it should show |

**Early warnings:** Beacon switched off within 24 h of an Echo event; run-out-the-clock rate; quits during the telegraph or duel; fight share by nth invasion (novelty decay, answered with creator and seasonal Echoes); timeout rate by build archetype; share of installs meeting an Echo on D0; report views followed by a run within 10 min.

**Kill:** Beacon off for more than 30% of D7-active players, or no D1 lift after two tuning passes. **Pivot:** if players love the Steal but hate invasions, use an opt-in **Echo Gate** between bosses, modelled on Hades' Trial of the Gods [S33]: two Echoes show their signature cards; take one and the spurned Echo invades; beat it and you take its card too.

**Open questions.** Do hosts play the tell, or only the prize (fight share by tell type)? Should Echoes prefer hosts on a different hero, to keep locked cards coming after mid-game? Is one invasion per run enough once the on-duty pool is live?

## 12. How I curated AI output

Claude, via Claude Code, drafted this spec from my brief. AI reviewer passes attacked it as a hiring manager, a fact-checker, a writing editor and a survivor-like designer, and the drafts were revised against those critiques under my direction. A research pass found Showdown's Steal-on-Loss, which my original concept missed, so the differentiation moved up.

**Before and after.** Claude's first saved draft of the Steal rules, verbatim except for removed citation tags:

> 1. Beat an Echo and it drops an **Echo Core**. It pulls toward you after 3 s. You are invulnerable until you collect it. 2. The game pauses and shows **3 cards** from the Echo's build. Three is the genre norm (Survivor.io level-ups, Hades boons; Vampire Survivors offers 3 or 4). 3. Steal one card, or take **Shards instead** (30 Echo Shards plus a 30% heal). 4. The stolen card is yours for the rest of this run. Nothing stolen outlives the run. 5. If that slot type is full, you choose which of your cards it replaces. 6. The Echo's owner earns Tribute whether you win or lose.

The shipped version is §5.1. Three edits carry the weight:

| Draft | Now | Why |
|---|---|---|
| "shows 3 cards from the Echo's build" | Offer fixed at invasion start from a host snapshot; level-ups wait until after the duel | The draft never said when the offer was built. The host levels during the duel, so a card the banner promised could max out and vanish |
| "yours for the rest of this run" | Joins your level-up pool, with its evolution partner | As drafted, a locked steal could never be offered again, so it could never reach Lv 5 or evolve; the 20% evolve target failed by construction |
| "Shards instead (30 Echo Shards plus a 30% heal)" | "Heal instead (30% of max HP)"; 10 Tribute for the win either way | Echo Shards were a second currency nothing in the spec spent, and Shards filler cards duplicated the button |

**Rejected along the way:** invasions at 5:00 and 10:00 (my original concept; they land on boss beats), stealing evolved weapons outright, full-level transfer, a choice timer, lethal invasions, and pickup-greed and edge-affinity traits (Echoes can't collect, and open maps have no edge). **Fact-check fixes:** Chain Lightning isn't a Survivor.io skill; Dark Souls player invasions are real-time, so I cite its NPC invaders; Showdown's windows and tickets were there at launch; Hades Exchanges keep the boon's level.

No playtests were run. Every unsourced number is an assumption or an estimate.

## Sources, assumptions & AI use

**AI use.** Drafted with Claude (Anthropic) via Claude Code under my direction, critiqued by AI reviewer passes (hiring-manager lens, fact-checker, domain expert, writing editor) and revised; §12 shows one before-and-after. A research pass fetched the pages below, and a fact-checker pass re-read them against each claim: Showdown's release, rules and hours; Survivor.io's chapter formats, slots, evolutions, Ender's Echo and heroes; Vampire Survivors' co-op and level-ups; SURVIVATON; the Nemesis patents and Monolith's closure; the Forza quotes; Elden Ring, Clash of Clans and Hades mechanics. In the final pass I re-fetched the Phantom Abyss, Stay Safe, Vampire Survivors level-up and Android pages; Fandom wikis blocked automated fetches, so those rest on the earlier pass. * = content not readable. The DPDP point in §3 is unverified and needs counsel. Arithmetic in §4, §6, §7 and §11 was re-checked in the final pass. **Assumptions:** our game copies Survivor.io's shape and gates generic skills by chapter (see the header); the mid-run lull is a hypothesis; every tuning number is mine. I couldn't verify Survivor.io's per-run reroll count, so I copied none. No playtest data exists; player-behaviour claims are hypotheses.

- [S1] Survivor.io wiki, Chapters (open, linear and enclosed formats). https://survivorio.fandom.com/wiki/Category:Chapters
- [S2] Simple Game Guide, Chapter 2 walkthrough (low-tier, single chapter). https://simplegameguide.com/how-to-beat-chapter-2-survivor-io/
- [S3] Survivor.io wiki, Skills. https://survivorio.fandom.com/wiki/Skills
- [S4] Habby, official Survivor Showdown post (Dec 2025). https://www.facebook.com/SurvivorHabby/photos/-survivor-showdown-real-time-boss-race-progression-stealing-welcome-to-survivor-/865585822837787/
- [S5] Pocket Gamer, Survivor.io co-op (current availability unverified). https://www.pocketgamer.com/survivor-io/co-op/
- [S6] Wikipedia, Vampire Survivors. https://en.wikipedia.org/wiki/Vampire_Survivors
- [S7] Theria Games, Archero 2 Arena guide. https://theriagames.com/guide/archero-2-arena-guide/
- [S8] NetHack wiki, Bones. https://nethackwiki.com/wiki/Bones
- [S9] Stay Safe (itch.io). https://lancelol.itch.io/stay-safe
- [S10] Phantom Abyss, Steam store page. https://store.steampowered.com/app/989440/Phantom_Abyss/
- [S11] Dark Souls wiki, Invaders. https://darksouls.fandom.com/wiki/Invaders
- [S12] Xbox Wire, Forza Horizon 2 Drivatars (2014). https://news.xbox.com/en-us/2014/09/30/games-forza-horizon-2-drivatars/
- [S13] Turn 10, Forza Motorsport Drivatars (Jul 2023). https://forza.net/news/forza-motorsport-drivatars-tire-physics
- [S14] Supercell, Clash of Clans release notes (6 Oct 2025). https://supercell.com/en/games/clashofclans/blog/release-notes/get-ready-for-ranked-update/
- [S15] Clash of Clans wiki, Multiplayer Battles (no revenge of a revenge). https://clashofclans.fandom.com/wiki/Multiplayer_Battles
- [S16] Wikipedia, Hades. https://en.wikipedia.org/wiki/Hades_(video_game)
- [S17] Hades wiki, Boons (Exchanges). https://hades.fandom.com/wiki/Boons
- [S18] Survivor.io, App Store listing and version history. https://apps.apple.com/us/app/survivor-io/id1528941310
- [S19]* Habby, "Survivor Showdown: New Season Update & Rule Adjustments". https://www.facebook.com/SurvivorHabby/posts/-survivor-showdown-new-season-update-rule-adjustments-greetings-survivorssurvivo/879393834790319/
- [S20] JUJUTSU KAISEN RUMBLE: SURVIVATON, official site. https://jjkrsurvivaton.shueisha-games.com/en/
- [S21] Survivor.io wiki, Ender's Echo. https://survivorio.fandom.com/wiki/Ender's_Echo
- [S22] Survivor.io wiki, Chapter 3 (8-min enclosed map). https://survivorio.fandom.com/wiki/Chapter_3_-_Basement_Parking
- [S23] Elden Ring wiki, Taunter's Tongue. https://eldenring.wiki.gg/wiki/Taunter's_Tongue
- [S24] PocketGamer.biz / AppQuantum, Survivor.io core loop (Sep 2022). https://www.pocketgamer.biz/how-innovation-and-iteration-has-transformed-survivorio/
- [S25] Vampire Survivors wiki, Level up. https://vampire.survivors.wiki/w/Level_up
- [S26] Vampire Survivors wiki, Evolution. https://vampire.survivors.wiki/w/Evolution
- [S27] Survivor.io wiki, Characters (Survivors cost shards or real money). https://survivorio.fandom.com/wiki/Characters
- [S28] Android Developers, Notification runtime permission (Android 13). https://developer.android.com/develop/ui/views/notifications/notification-permission
- [S29] Game Developer, How Forza's Drivatar actually works (Jun 2021). https://www.gamedeveloper.com/design/how-forza-s-drivatar-actually-works
- [S30] Google Patents, US 10,926,179 B2. https://patents.google.com/patent/US10926179B2/en
- [S31] Google Patents, US 12,201,908 B2. https://patents.google.com/patent/US12201908B2/en
- [S32] Gematsu, Monolith closure (Feb 2025). https://www.gematsu.com/2025/02/warner-bros-games-cancels-wonder-woman-shuts-down-monolith-productions-player-first-games-and-warner-bros-games-san-diego
- [S33] Hades wiki, Trial of the Gods. https://hades.fandom.com/wiki/Trial_of_the_Gods
