# Q2 · Social deduction on mobile has a people problem, not a fun problem

**Genre:** social deduction (the Mafia/Werewolf lineage), mobile free-to-play.

**Claim:** the fun is proven at huge scale, yet both big hits kept only 3-4% of their peak-month Steam audience. The clearest 2026 mobile success, GGD China, has a publisher that pays to police stranger voice. India can't fund that. Its breakout will come from whoever builds for existing groups and fills their empty seats with AI.

"Cracked" means a top-grossing spot in a major mobile market held for a year. I found no social deduction game that has; GGD China is closest, about nine months in.

## TL;DR

1. Among Us (2020) and Goose Goose Duck (2022-23) exploded, then fell to 3-4% of peak-month Steam averages (a PC proxy).
2. The causes are structural: ~7 seats when 3 friends are online, groups living in Discord, costly stranger voice, ~$0.27 of IAP per Among Us download.
3. GGD China (2-3M DAU) is a rebuilt game whose publisher pays for AI voice review. In India, transcription alone would cost ~7x a player's daily revenue (estimate).
4. My design, *Kaun?*: existing groups, labelled AI guests in empty seats, claim cards as the only on-the-record channel, a job for the eliminated.
5. An LLM in every AI seat costs ~11% to ~7x an Indian gamer's daily revenue (estimates). A rule-based belief model, templates and a pre-written line bank cut that to near zero; optional live flavour adds ~3-10%.

## The fun is proven; the structure isn't

| Spike | Peak | Now |
|---|---|---|
| Among Us, 2020 | ~500M MAU, Nov 2020 (SuperData estimate, [PocketGamer.biz](https://www.pocketgamer.biz/among-us-hit-500-million-monthly-active-users-in-november/)) | Steam average 7,625, ~4% of Oct 2020's 176,454 ([SteamCharts](https://steamcharts.com/app/945360)) |
| Goose Goose Duck, 2022-23 | Steam peak 701,898, Jan 2023, after BTS's V streamed it ([SteamCharts](https://steamcharts.com/app/1568590), [GameDiscoverCo](https://newsletter.gamediscover.co/p/how-goose-goose-duck-hit-700k-ccu)) | Steam average 3,545, ~3% of Jan 2023's 121,554 |
| GGD China mobile, 2026 | 5M+ registrations in 24 hours ([Huya IR](https://ir.huya.com/2026-01-08-Huya-Reports-Goose-Goose-Duck-Mobile-Ranking-No-1-on-Apples-Free-App-Chart-in-Chinese-Mainland)) | 2-3M steady DAU ([17173](https://news.17173.com/content/07312026/110507066.shtml)); top 5 iOS grossing games in China, Apr 2026 ([Huya Q1](https://www.prnewswire.com/news-releases/huya-inc-reports-first-quarter-2026-unaudited-financial-results-302769116.html)) |

Most hits fade; the question is which version held. GGD China's publishers, Huya (streaming) and Kingsoft Shiyou, rebuilt it for mobile and police voice with AI review and automatic penalties. Kingsoft's VP Liu Yi blames the earlier PC fade in China on no local publisher or sustained operations ([17173](https://news.17173.com/content/07312026/110507066.shtml)). Confound: heavy IP content (17 *Empresses in the Palace* characters) means I can't yet separate operator from content.

In 2017 an operator wasn't enough: Tencent pushed its voice-Werewolf app across seven streaming platforms and WeChat, yet werewolf apps' 7-day retention trailed live-streaming apps', blamed on stranger tables, complex rules and long matches (Cheetah data via [Jiemian](https://www.jiemian.com/article/1636845.html), Chinese). My falsifiable read: **retention in this genre tracks whether the product keeps a group together.**

**Why India?** Indians already played this genre, mostly with strangers, and left: India was Among Us's largest market in October 2020 (15% of ~74.8M installs, [Sensor Tower](https://sensortower.com/blog/top-mobile-games-worldwide-october-2020-by-downloads)). Ludo King shows the alternative: 1.25B+ downloads ([Sensor Tower](https://sensortower.com/blog/india-mobile-game-insights-2025)), ~51M lockdown DAU ([afaqs](https://www.afaqs.com/news/mktg/ludo-king-vikash-jaiswal-on-how-ludo-became-indias-no-1-lockdown-game)), voice only in Play with Friends ([PR.com](https://www.pr.com/press-release/818211)), and play against the computer ([Google Play](https://play.google.com/store/apps/details?id=com.ludo.king&hl=en_US&gl=US)).

## Why it hasn't worked: four structural problems

**1. Seat liquidity.** Classic Mafia wants 7+ players (Town of Salem 2 needs 7-15, [Steam](https://store.steampowered.com/app/2140510/Town_of_Salem_2/)); your friends online at 10pm are three. Short groups get strangers, though Among Us's own [Steam page](https://store.steampowered.com/app/945360/Among_Us/) recommends friends on voice. One Night Ultimate Werewolf plays 3-10 without elimination in ~10 minutes ([Bezier Games](https://beziergames.com/products/one-night-ultimate-werewolf)); my first test includes it.

**2. Someone else owned the group.** The original Among Us still has no native voice (only the separate [Among Us 3D](https://www.innersloth.com/games/among-us-3d/)), so Discord held the group: players "had to download Discord, manage the lobby, fight off hackers" (Gaggle's CEO, [80.lv](https://80.lv/articles/staying-lean-how-we-built-the-world-s-biggest-social-deduction-game)). GGD's Steam surge was mostly Chinese players, with no local operator ([GameDiscoverCo](https://newsletter.gamediscover.co/p/how-goose-goose-duck-hit-700k-ccu)).

**3. The stranger tax.** Accusing strangers over open voice invites harassment, and each fix costs fun: Among Us made preset Quick Chat mandatory for under-13s in March 2021 ([PC Gamer](https://www.pcgamer.com/among-us-releases-a-slightly-sus-quick-chat-update/)). Phones handle talking (GGD China); typing under a timer is the broken input. Hypothesis: moderation cost scales with the share of stranger matches, since friend tables police themselves.

**4. Pennies per install.** Among Us earned ~$0.27 of IAP per download over ~3 years ($86M on 324M downloads, 63.4% from the US's 12.6% of downloads; App Annie via [PocketGamer.biz](https://www.pocketgamer.biz/news/76710/among-us-has-generated-86-million-on-mobile-in-nearly-three-years/)). India earns ~$0.05 of IAP per download (my division: ~$400M over 8.45B downloads, FY2024-25, [Sensor Tower](https://sensortower.com/blog/india-mobile-game-insights-2025)). Counter-evidence: GGD China's top-5 grossing peak coincided with an *Empresses in the Palace* collab sold partly through gacha ([17173](https://news.17173.com/content/07312026/110507066.shtml)).

## What the near-misses teach

| Game | Got right | Where it stands |
|---|---|---|
| Among Us (2018) | Tiny rules; tasks for quiet players; cross-play | Voice outsourced; ~$0.27 IAP per download |
| GGD PC (2021) | Built-in proximity voice; cosmetics-only | ~3% of peak-month average; revived only in China, rebuilt and operated |
| Town of Salem 2 (2023) | Chat tags for players, roles and keywords ([Wikipedia](https://en.wikipedia.org/wiki/Town_of_Salem)) | ~3,755 early-access peak (SteamDB via [win.gg](https://win.gg/news/town-of-salem-2-player-count-reaches-all-time-high-for-franchise/)); ~159 average now ([SteamCharts](https://steamcharts.com/app/2140510)) |
| Wolvesville | Mobile-native; up to 16 players | Durable text-first niche: 10M+ Play downloads ([Google Play](https://play.google.com/store/apps/details?id=com.werewolfapps.online&hl=en_US&gl=US)) |
| Suspects: Mystery Mansion (2021) | Integrated voice; familiar Zooba characters | 50M+ Play downloads ([Google Play](https://play.google.com/store/apps/details?id=com.wildlifestudios.free.online.games.suspects&hl=en_US&gl=US)); no public revenue |
| Project Winter mobile (2022) | Survival-traitor depth | Too heavy for most phones; shut within 9 months ([Wikipedia](https://en.wikipedia.org/wiki/Project_Winter)) |

Heavy games die on mobile hardware, text-first games stay niche, and voice games need someone to pay for policing. None combines group ownership, light input and cheap seats.

## What it would take: *Kaun?*

Working title **Kaun?** ("Who?"): a 7-seat family wedding where one guest is stealing gift envelopes. Non-violent, so cousins can play with parents (assumption: a murder theme narrows family play).

**One match:** three ~2-minute rounds (timings assumed).

| Phase | What happens |
|---|---|
| **Act** (~30s) | Each guest secretly picks a room (Mandap, Kitchen, Gift Table, Dance Floor, Parking) and sees who shared it. If the thief visited the Gift Table, an envelope is gone, and everyone learns it. |
| **Claim** (~60s) | Three-tap cards go into the *shagun* register (the envelope-gift notebook): *I was in [Kitchen] with [Priya]*, *I vouch for [Arjun]*, *[Rohan] lied about [round 2]*. A lie shows up as two claims about one room that can't both be true. |
| **Vote** (~30s) | Each vote cites a claim. The top-voted guest joins the Ghost Jury. |

The thief wins by stealing in 2 of 3 rounds and surviving the last vote: steal at a crowded Gift Table and admit it, or steal alone and claim an empty room nobody can contradict. Bots see only what their seat sees, and the game says so.

| Pillar | What I'd build | Why |
|---|---|---|
| **Own the group** | A persistent *table* from a family WhatsApp link, keeping members, history and titles ("Most trusted liar"); strangers opt-in. | Gaggle's CEO: friends bring players back; up to 50 content updates a year mattered less than expected ([80.lv](https://80.lv/articles/staying-lean-how-we-built-the-world-s-biggest-social-deduction-game)) |
| **Labelled AI guests** | Any 3 humans can start; badged bots fill the rest and can be the thief, though published odds make it a human 2 times in 3 at friend tables (assumption). Bot votes count half: 3 humans outvote 4 bots. Friends who log in take bot seats. | [Human or Not](https://www.prnewswire.com/news-releases/ai21-labs-human-or-not-the-largest-turing-test-to-date-finds-that-32-of-people-cant-tell-the-difference-between-a-human-and-ai-301838505.html): players guessed right 68% of the time, India least accurately of the top countries (63.5%). Hypothesis: hidden bots would fool Indian players more |
| **On the record, in your language** | Claim cards are testimony, rendered in each reader's language (Hinglish included). Voice is banter, never translated. Only cards feed the register, bots and Ghost Jury. | Bots can't hear a call, so no speech-to-text. 98% of 886M Indian internet users access Indic content ([IAMAI-Kantar](https://www.iamai.in/sites/default/files/research/Kantar_%20IAMAI%20report_2024_.pdf)) |
| **No dead seats** | The eliminated join the *Ghost Jury*, a private scored poll revealed at the end. Post-match "Why Meera voted Arjun" cards show a bot's evidence. | Keeps watchers invested without leaking information; answers "the bots ganged up on me" at zero inference cost |
| **Fair money** | Table-wide cosmetics one player buys; no gacha. A host's rewarded ad earns the table a premium venue that follows the calendar (wedding season, Diwali). Never roles or information. | India rewarded eCPM $2.43 vs US $15.15 (different sources, directional: [Lumikai](https://respawn.outlookindia.com/gaming/gaming-news/lumikai-india-gaming-market-1-5-billion-rmg-ban-2025), [Appodeal via Mistplay](https://business.mistplay.com/resources/mobile-ads-ecpm)) |
| **Safety** | Under-18s: no in-app voice, contextual ads only, bots adapt only within a match. Rewards scale with human seat share, so bot tables can't be farmed. | DPDP Act: verifiable parental consent; no tracking or targeted ads for under-18s ([s.9](https://www.dpdpa.com/dpdpa2023/chapter-2/section9.html), [Rule 10](https://www.dpdpa.com/dpdparules/rule10.html)) |

Claim cards beat typing, translate for free, and shrink the AI's problem to a finite action space, which makes AI seats affordable. The register's *contradiction graph* (Priya's claim conflicts with Rohan's) is gated behind a role, the Aunty.

**How tables grow (hypothesis).** A family WhatsApp link opens a first match in the browser; install follows, and a deferred deep link returns the installer to that table. Solo installers get a *Daily Case* (all-bot, date-seeded, one ranked attempt, share grid), the Daily Commission pattern from my Q1 game, OUTCRAFT.

**Rejected:** hidden AI players; open stranger voice at launch; a hard human-thief rule (bots become certified-innocent witnesses); live speech translation (~$0.037/min per listening language, [Google](https://ai.google.dev/gemini-api/docs/pricing)); on-device LLMs (Gemma 3n E2B needs ~2GB of memory, [Google](https://developers.googleblog.com/en/introducing-gemma-3n-developer-guide/); assumption: too much for budget phones).

## The unit economics of AI players

**Naive design, all inputs assumed:** 6-minute matches, 3 per human a day, 8 calls per AI seat of ~1,500 input and ~40 output tokens. Cached column: a shared 1,024-token prefix billed at 0.1x (OpenAI GPT-5.6+, older models vary; Gemini Flash-Lite); Haiku 4.5 needs 4,096 tokens ([OpenAI](https://developers.openai.com/api/docs/guides/prompt-caching), [Google](https://ai.google.dev/gemini-api/docs/pricing), [Anthropic](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)). Prices: [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing), [Google](https://ai.google.dev/gemini-api/docs/pricing), [OpenAI](https://developers.openai.com/api/docs/pricing), retrieved Sep 23, 2026.

Cost per human-day (share of India's $0.0074 revenue per gamer-day):

| Model (USD per 1M tokens, in / out) | 4 humans + 3 AI | 3 humans + 4 AI (my default) | 3 + 4, cached prefix |
|---|---|---|---|
| Claude Haiku 4.5 ($1 / $5) | $0.031 (4.1x) | $0.054 (7.4x) | not eligible |
| Gemini 3.1 Flash-Lite ($0.25 / $1.50) | $0.0078 (1.1x) | $0.014 (1.9x) | $0.0066 (89%) |
| GPT-6 Luna ($0.10 / $0.50) | $0.0031 (41%) | $0.0054 (74%) | $0.0025 (34%) |
| Gemini 2.5 Flash-Lite ($0.10 / $0.40) | $0.0030 (40%) | $0.0053 (72%) | $0.0024 (32%) |
| GPT-5 nano ($0.05 / $0.40) | $0.0016 (22%) | $0.0029 (39%) | $0.0014 (19%) |

**Benchmarks** (my divisions of sourced totals). India: $1.5B over 555M gamers, excluding real-money games ([Lumikai](https://respawn.outlookindia.com/gaming/gaming-news/lumikai-india-gaming-market-1-5-billion-rmg-ban-2025)), is **$0.0074 per gamer-day** (IAP plus ads). US: $26.7B mobile spend ([ESA/Circana](https://www.prnewswire.com/news-releases/2025-us-consumer-spending-on-video-games-nears-pandemic-level-peak-at-60-7-billion-second-highest-on-record-302684591.html)) over ~168M mobile players (205.1M × 82%, [ESA](https://www.theesa.com/resources/essential-facts-about-the-us-video-game-industry/2025-data/)) is **$0.43 per player-day** (IAP only), ~59x more. Non-daily gamers bias the India figure low; a weak-grossing genre biases it high. I use it unadjusted, with a 10% AI budget (assumption).

Worst cell: Haiku at 3 + 4, 7.4x India (~13% of US). Best: cached GPT-5 nano at 4 + 3 ($0.0008), still ~11%. Price is one of four problems: an LLM can also make illegal or invented claims, is hard to tune for difficulty, and can't prove a bot knows only its seat's view. The architecture that fixes all four:

1. **Decide with a rule-based belief model.** Each bot keeps per-seat suspicion scores from its seat's view and carded claims, and plays scripted tells. Finite card actions (claim, vouch, accuse, vote) run on a server CPU, no LLM. If playtesters find bots robotic, upgrade to an LLM-proposes, RL-chooses agent ([Xu et al., ICML 2024](https://arxiv.org/abs/2310.18940)) trained on logged human games with human-regularised RL ([CICERO](https://www.science.org/doi/10.1126/science.ade9097)): 1-2 ML engineers for a quarter (assumption), plus compute.
2. **Speak with templates and a line bank.** Cards render in any language at zero inference. An LLM pre-writes flavour lines offline (50,000 lines × 10 languages at ~60 tokens each is ~$15 on GPT-6 Luna; estimate) for human review and runtime picking, paying the Indic tokenizer penalty (up to 15x longer text, [Petrov et al.](https://arxiv.org/abs/2305.15425)) once.
3. **Add live flavour only where it pays.** Two short lines per AI seat per match (800 input, 30 output tokens; assumption) cost ~3-6% of India revenue per gamer-day at 4 + 3 and ~6-10% at 3 + 4 (nano to Luna), so Luna breaks the budget at my default. Levers: one line per seat (~3-5% at 3 + 4), live lines only at 4+ human tables, bank only at all-bot tables (live there: ~25% even on nano). One rewarded ad per human-day at $2.43 eCPM earns ~$0.0024 (estimate), 3-6x the default table's live cost.

Catch: in a 2025 Among Us sandbox, RL-trained models deceived far better than they detected deception ([arXiv](https://arxiv.org/abs/2504.04072)). Bot thieves therefore get readable tells, tuned until caught about as often as human thieves.

### Voice costs more than the bots

At 18 voice-minutes per human-day (assumption), managed voice costs more than the AI seats:

| Voice item, per human-day | Cost | vs India |
|---|---|---|
| Managed voice ([Agora](https://docs.agora.io/en/voice-calling/overview/pricing), $0.99 per 1,000 min) | $0.018 | ~2.4x |
| Batch transcription for AI review ([OpenAI](https://developers.openai.com/api/docs/pricing), $0.003/min) | $0.054 | ~7x |
| Live transcription ([Gemini 3.5 Transcribe Live](https://ai.google.dev/gemini-api/docs/pricing), ~$0.009/min) | $0.16 | ~22x |
| AI speech: 2 min of TTS per match (assumption; Gemini 3.1 Flash TTS, ~$0.03/min), 3 humans sharing | $0.06 | ~8x |

So *Kaun?* owns the table and rents the pipe. Friend tables talk on a WhatsApp call beside the game: no infrastructure cost, no recordings to police (to test: both on one budget phone). Stranger tables are claims-only. Unlike Among Us with Discord, *Kaun?* keeps the table, members, history and titles; it rents only the audio.

## How I'd de-risk it

**First test (2 weeks, no ML; assumption).** A web prototype (claim cards, WhatsApp-call voice, rule-based labelled bots) for 10 Indian friend or family groups of 3-4, in two languages. Three arms in rotating order: (A) humans plus bots at 7 seats; (B) the same humans alone in a single-vote, no-elimination variant like One Night Ultimate Werewolf; (C) arm A with voice off. I'd watch unprompted second sessions within 48 hours, carded claims per human per round, and whether players explain votes against bots as against people. Ten groups are a qualitative read (4 of 10 has an exact 95% interval of ~12-74%), so a ~100-table beta spread by link comes before any percentage.

**Kill or change criteria** (thresholds assumed; directional at n=10):

| If | Then |
|---|---|
| Arm A rates 1+ point lower (of 5) than arm B after two bot iterations | AI seats don't earn their cost; keep bots only for the solo Daily Case |
| Arm A falls below 1 carded claim per human per round while arm C reaches 2+ | Voice swallowed the record and bots are deaf; redesign input before any AI |
| Fewer than 4 of 10 groups return unprompted | The group hook fails |
| Beta bot thieves are caught 10+ points more often than human thieves | Players are learning "accuse the bot"; retune tells |
| Live flavour pushes AI cost above 10% of India ARPDAU | Remove the runtime LLM; keep policy, templates and line bank |

**Three soft-launch numbers (targets assumed):**

| Metric | Why | Target |
|---|---|---|
| Table D7: share of new tables (2+ humans in first match) playing on day 7 | The group is the retention unit | ≥25% |
| Humans seated per new table's invite link | The growth engine: a table that never seats a second human is a solo player | ≥2 |
| AI cost as % of ARPDAU | The line between a game and a subsidy | ≤10% |

Diagnostics: bot-vs-human thief catch rate, claims per human per round, human seat share. Guardrail: reports per 100 stranger-table matches.

Social deduction is the oldest game about reading people. I'd fill its empty chairs with AI guests who can be read back.

## Sources, assumptions & AI use

**Sources.** Linked inline where used; all prices and Steam figures retrieved Sep 23, 2026.

**Assumptions (not measured):** match structure, timings and token counts; 3 matches a day (a 10-match day multiplies per-day AI cost by ~3.3); both table mixes; the cached prefix; the 10% AI budget; line-bank size; voice and TTS minutes; thief odds and half-weight bot votes; RL staffing; the wedding theme's appeal; every threshold and target. Revenue per player-day figures are my divisions of sourced totals with different definitions (India: IAP plus ads; US: IAP only); no official India-vs-US ARPDAU exists.

**Verification and gaps.** Model prices, caching rules, voice prices, SteamCharts, Sensor Tower, Play listings, the 80.lv interview and the DPDP Act were checked against live pages on Sep 23, 2026; 17173 and Jiemian were read in Chinese; every cost cell was recomputed from its inputs. SteamDB returned HTTP 403, so the Town of Salem 2 peak comes via win.gg. Not found: Among Us's current mobile MAU, Suspects revenue, India-specific retention data, any measured match length.

**AI use.** Drafts were produced with Claude (Anthropic) via Claude Code under my direction; AI agents gathered research, checked against primary pages where fetchable, and multiple AI reviewer passes (hiring-manager lens, fact-checker, domain expert) critiqued the draft before revision. The thesis and design direction are mine. Some mechanics (Ghost Jury, wedding setting, the Aunty, room-based act phase, shagun register) came from AI drafting or review and stayed because I can defend them. What curation changed:
- A draft said prompt caching couldn't apply. OpenAI's and Google's docs showed it does, so caching is priced in and the case for a policy model rests on more than price.
- Repricing my 3-human default table, not just the favourable 4-human one, pushed live Luna flavour over budget, so the pre-written line bank became the default.
- A reviewer suggested weighting the thief toward humans. A hard rule would make bots certified-innocent witnesses, so the odds are published and bots stay suspects.

No playtests, interviews or player data sit behind this doc yet. Everything not measured is a hypothesis.
