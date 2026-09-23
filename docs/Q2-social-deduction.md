# Q2 · Social deduction on mobile has a people problem, not a fun problem

**Genre:** social deduction (the Mafia/Werewolf lineage), mobile free-to-play.

**Claim:** the fun is proven at huge scale, yet both big hits kept only 3-4% of their peak-month Steam audience. The clearest 2026 mobile success, GGD China, has a publisher that pays to police stranger voice. India can't fund that. Its breakout will come from whoever builds for existing groups and fills their empty seats with AI. My design, *Kaun?*, does that with near-free, rule-based AI seats; an LLM per seat would cost ~11% to ~7x an Indian gamer's daily revenue (estimates).

By "cracked" I mean holding a top-grossing spot in a major mobile market for a year; no social deduction game I found has (GGD China: ~nine months).

## Two hits faded; an operated rebuild is holding

| Spike | Peak | Now |
|---|---|---|
| Among Us, 2020 | ~500M MAU, Nov 2020 (SuperData estimate, [PocketGamer.biz](https://www.pocketgamer.biz/among-us-hit-500-million-monthly-active-users-in-november/)) | Steam average 7,625, ~4% of Oct 2020's 176,454 ([SteamCharts](https://steamcharts.com/app/945360)) |
| Goose Goose Duck, 2022-23 | Steam peak 701,898, Jan 2023, after BTS's V streamed it ([SteamCharts](https://steamcharts.com/app/1568590), [GameDiscoverCo](https://newsletter.gamediscover.co/p/how-goose-goose-duck-hit-700k-ccu)) | Steam average 3,545, ~3% of Jan 2023's 121,554 |
| GGD China mobile, 2026 | 5M+ registrations in 24 hours ([Huya IR](https://ir.huya.com/2026-01-08-Huya-Reports-Goose-Goose-Duck-Mobile-Ranking-No-1-on-Apples-Free-App-Chart-in-Chinese-Mainland)) | 2-3M steady DAU ([17173](https://news.17173.com/content/07312026/110507066.shtml)); top 5 iOS grossing games in China, Apr 2026 ([Huya Q1](https://www.prnewswire.com/news-releases/huya-inc-reports-first-quarter-2026-unaudited-financial-results-302769116.html)) |

The version that held, GGD China, is co-published by Huya (streaming) and Kingsoft Shiyou, which rebuilt it for mobile and polices voice with AI review and automatic penalties. Kingsoft's VP Liu Yi blames the earlier PC fade in China on no local publisher or sustained operations ([17173](https://news.17173.com/content/07312026/110507066.shtml)). Confound: heavy IP content (17 *Empresses in the Palace* characters) means I can't yet separate operator from content.

In 2017 an operator wasn't enough: Tencent pushed its voice-Werewolf app across seven streaming platforms and WeChat, yet werewolf apps' 7-day retention generally trailed live-streaming apps', blamed on stranger tables, complex rules and long matches (Cheetah data via [Jiemian](https://www.jiemian.com/article/1636845.html), Chinese). GGD China now tracks whether players form "semi-acquaintance" circles ([17173](https://news.17173.com/content/07312026/110507066.shtml)). My falsifiable read: **retention in this genre tracks whether the product keeps a group together.**

**Why not copy GGD China in India?** Its answer to strangers is paid policing: transcribing a player's daily voice for AI review costs 7-22x India's revenue per gamer-day ([below](#voice-costs-more-than-the-bots)), in many languages. So I'd start where policing is nearly free: people who already know each other.

**Why India?** India was Among Us's largest market in October 2020 (15% of ~74.8M installs, [Sensor Tower](https://sensortower.com/blog/top-mobile-games-worldwide-october-2020-by-downloads)). Ludo King shows how Indian groups play: 1.25B+ downloads ([Sensor Tower](https://sensortower.com/blog/india-mobile-game-insights-2025)), ~51M lockdown DAU ([afaqs](https://www.afaqs.com/news/mktg/ludo-king-vikash-jaiswal-on-how-ludo-became-indias-no-1-lockdown-game)), voice only in Play with Friends ([PR.com](https://www.pr.com/press-release/818211)), and play against the computer ([Google Play](https://play.google.com/store/apps/details?id=com.ludo.king&hl=en_US&gl=US)). I found no social deduction game built for those tables.

## Why it hasn't worked: four structural problems

**1. Seat liquidity.** Classic Mafia wants 7+ players (Town of Salem 2 needs 7-15, [Steam](https://store.steampowered.com/app/2140510/Town_of_Salem_2/)); your friends online at 10pm are three. Short groups get strangers, though Among Us's own [Steam page](https://store.steampowered.com/app/945360/Among_Us/) recommends friends on voice. One Night Ultimate Werewolf plays 3-10 without elimination in ~10 minutes ([Bezier Games](https://beziergames.com/products/one-night-ultimate-werewolf)); my first test includes it.

**2. Someone else owned the group.** The original Among Us still has no native voice, so Discord held the group: players "had to download Discord, manage the lobby, fight off hackers" (Gaggle's CEO, [80.lv](https://80.lv/articles/staying-lean-how-we-built-the-world-s-biggest-social-deduction-game)). Streams brought strangers once: xQc and PewDiePie lifted Among Us ([Wikipedia](https://en.wikipedia.org/wiki/Among_Us)), and GGD's Steam surge was mostly Chinese players, with no local operator ([GameDiscoverCo](https://newsletter.gamediscover.co/p/how-goose-goose-duck-hit-700k-ccu)).

**3. The stranger tax.** Accusing strangers over open voice invites harassment, and each fix costs fun: Among Us made preset Quick Chat mandatory for under-13s in March 2021 ([PC Gamer](https://www.pcgamer.com/among-us-releases-a-slightly-sus-quick-chat-update/)). Phones handle talking (GGD China); typing under a timer is the broken input. Hypothesis: moderation cost scales with the share of stranger matches, since friend tables police themselves.

**4. Pennies per install.** Among Us earned ~$0.27 of IAP per download over ~3 years ($86M on 324M downloads, 63.4% from the US's 12.6% of downloads; App Annie via [PocketGamer.biz](https://www.pocketgamer.biz/news/76710/among-us-has-generated-86-million-on-mobile-in-nearly-three-years/)), and ~$0.04 in the mid-Sep 2020 surge, led by the Mini Crewmate bundle and ad removal ([Sensor Tower](https://sensortower.com/blog/among-us-mobile-surpasses-85-million-downloads)). India earns ~$0.05 of IAP per download (my division: ~$400M over 8.45B downloads, FY2024-25, [Sensor Tower](https://sensortower.com/blog/india-mobile-game-insights-2025)). Counter-evidence: GGD China's top-5 grossing peak coincided with an *Empresses in the Palace* collab sold partly through gacha ([17173](https://news.17173.com/content/07312026/110507066.shtml)).

## What the near-misses teach

| Game | Got right | Where it stands |
|---|---|---|
| Town of Salem 2 (2023) | Chat tags for players, roles and keywords ([Wikipedia](https://en.wikipedia.org/wiki/Town_of_Salem)) | ~3,755 early-access peak (SteamDB via [win.gg](https://win.gg/news/town-of-salem-2-player-count-reaches-all-time-high-for-franchise/)); ~159 average now ([SteamCharts](https://steamcharts.com/app/2140510)) |
| Wolvesville | Mobile-native; up to 16 players | Text-first niche: 10M+ Play downloads ([Google Play](https://play.google.com/store/apps/details?id=com.werewolfapps.online&hl=en_US&gl=US)) |
| Project Winter mobile (2022) | Survival-traitor depth | Too heavy for most phones; shut within 9 months ([Wikipedia](https://en.wikipedia.org/wiki/Project_Winter)) |
| LOCKDOWN Protocol (2024) | 86% positive reviews ([Steam](https://store.steampowered.com/app/2780980/LOCKDOWN_Protocol/)) | Steam peak 9,318; ~271 average now ([SteamCharts](https://steamcharts.com/app/2780980)) |

Heavy games die on phones, text-first games stay niche, good reviews don't fix structure, and voice needs paid policing (GGD China). I found no game combining group ownership, light input and cheap seats.

## What it would take: *Kaun?*

Working title **Kaun?** ("Who?"): a 7-seat family wedding where one guest is stealing gift envelopes. Non-violent, so cousins can play with parents (assumption: a murder theme narrows family play).

**One match:** three ~2-minute rounds, ~6 minutes (timings assumed).

| Phase | What happens |
|---|---|
| **Act** (~30s) | Each guest secretly picks a room (Mandap, Kitchen, Gift Table, Dance Floor, Parking) and sees who shared it. If the thief visited the Gift Table, everyone learns an envelope is gone. |
| **Claim** (~60s) | Three-tap cards go into the *shagun* register (the envelope-gift notebook): *I was in [Kitchen] with [Priya]*, *I vouch for [Arjun]*, *[Rohan] lied about [round 2]*. A lie shows up as two incompatible claims about one room. |
| **Vote** (~30s) | Each vote cites a claim. The top-voted guest joins the Ghost Jury. |

Guests win by voting out the thief. The thief wins by stealing in 2 of 3 rounds and surviving the last vote: steal at a crowded Gift Table and admit being there, so a co-visitor looks as guilty, or steal alone and claim an empty room nobody can contradict or vouch for. Bots see only what their seat sees, and the game says so.

| Pillar | What I'd build | Why |
|---|---|---|
| **Own the group** | A persistent *table* from a family WhatsApp link, keeping members, history and titles ("Most trusted liar"). Match your table first, then its friends; strangers opt-in. | Gaggle's CEO: friends bring players back; up to 50 content updates a year mattered less ([80.lv](https://80.lv/articles/staying-lean-how-we-built-the-world-s-biggest-social-deduction-game)) |
| **Labelled AI guests** | Any 3 humans can start; badged bots fill the rest. Bots can be the thief (published odds: a human 2 times in 3 at friend tables, assumption); their votes count half, so 3 humans outvote 4 bots. Friends who log in take a bot's seat next round; bots take over dropped humans' seats and roles. | [Human or Not](https://www.prnewswire.com/news-releases/ai21-labs-human-or-not-the-largest-turing-test-to-date-finds-that-32-of-people-cant-tell-the-difference-between-a-human-and-ai-301838505.html) guesses: 68% right (60% facing bots); India lowest among top countries (63.5%). Hypothesis: hidden bots would fool Indians more, so I label them |
| **On the record, in your language** | Claim cards are testimony, rendered in each reader's language (Hinglish included). Voice is banter, never translated. Only cards feed the register, bots, Ghost Jury and the Aunty, a role that sees which claims conflict. | Beats typing; bots can't hear a call, and a finite card set makes them cheap. 98% of 886M Indian internet users access Indic content ([IAMAI-Kantar](https://www.iamai.in/sites/default/files/research/Kantar_%20IAMAI%20report_2024_.pdf)) |
| **No dead seats** | The eliminated join the *Ghost Jury*, a private poll scored by beating the living to the thief, revealed at the end. Ghosts are muted in-app; on a WhatsApp call, silence is an honour rule (leaking shrinks a ghost's lead). Post-match "Why Meera voted Arjun" cards show a bot's evidence. | Keeps watchers invested without leaking information; answers "the bots ganged up on me" at zero inference cost |
| **Fair money** | Table-wide cosmetics one player buys; no gacha. A host's rewarded ad earns the table a premium venue that follows the calendar (wedding season, Diwali). Never roles or information. | India rewarded eCPM $2.43 vs US $15.15 (different sources, directional: [Lumikai](https://respawn.outlookindia.com/gaming/gaming-news/lumikai-india-gaming-market-1-5-billion-rmg-ban-2025), [Appodeal via Mistplay](https://business.mistplay.com/resources/mobile-ads-ecpm)) |
| **Safety** | Under-18s: no in-app voice or recordings, contextual ads only, bots adapt only within a match. Rewards scale with human seat share, so bot tables can't be farmed; titles come from human votes; referral rewards pay after the invitee's 3rd match with 2+ humans (assumption). | DPDP Act: verifiable parental consent; no tracking or targeted ads for under-18s ([s.9](https://www.dpdpa.com/dpdpa2023/chapter-2/section9.html), [Rule 10](https://www.dpdpa.com/dpdparules/rule10.html)) |

**Why bots at all, when One Night Ultimate Werewolf already works for three?** I don't know that they beat it, so the first test has a no-bot arm. If they win, it should show as more testimony to cross-check at a small table, a thief who isn't always one of three familiar faces, and a table that absorbs friends seat by seat.

**How tables grow (hypothesis).** A family WhatsApp link opens a first match in the browser; after install, a deferred deep link returns the player to that table. Solo installers get a *Daily Case* (all-bot, date-seeded, one ranked attempt, share grid; the Daily Commission from my Q1 game, [OUTCRAFT](Q1-outcraft-writeup.md)), ending in "Play this with your family."

**Rejected:** live speech translation (~$0.037/min per listening language, [Google](https://ai.google.dev/gemini-api/docs/pricing)); on-device LLMs as the default (Gemma 3n E2B needs ~2GB of memory, [Google](https://developers.googleblog.com/en/introducing-gemma-3n-developer-guide/); assumption: too much for budget phones).

## The unit economics of AI players

Human-vs-AI werewolf games exist; I found none at scale. [Mentiss Werewolf](https://store.steampowered.com/app/4586780/Mentiss_Werewolf_Human_vs_AI/) caps free play at 3 games a day, and Kingsoft's VP calls paying for AI tokens an open problem for AI games ([17173](https://news.17173.com/content/07312026/110507066.shtml)).

**Naive design, all inputs assumed:** 6-minute matches, 3 per human a day, 8 calls per AI seat of ~1,500 input and ~40 output tokens. The cached column bills a shared 1,024-token prefix at 0.1x (OpenAI GPT-5.6+, older models vary; Gemini Flash-Lite); Haiku 4.5 needs 4,096 ([OpenAI](https://developers.openai.com/api/docs/guides/prompt-caching), [Google](https://ai.google.dev/gemini-api/docs/pricing), [Anthropic](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)). Prices: [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing), [Google](https://ai.google.dev/gemini-api/docs/pricing), [OpenAI](https://developers.openai.com/api/docs/pricing).

Cost per human-day (share of India's $0.0074 revenue per gamer-day):

| Model (USD per 1M tokens, in / out) | 4 humans + 3 AI | 3 humans + 4 AI (my default) | 3 + 4, cached prefix |
|---|---|---|---|
| Claude Haiku 4.5 ($1 / $5) | $0.031 (4.1x) | $0.054 (7.4x) | not eligible |
| Gemini 3.1 Flash-Lite ($0.25 / $1.50) | $0.0078 (1.1x) | $0.014 (1.9x) | $0.0066 (89%) |
| GPT-6 Luna ($0.10 / $0.50) | $0.0031 (41%) | $0.0054 (74%) | $0.0025 (34%) |
| GPT-5 nano ($0.05 / $0.40) | $0.0016 (22%) | $0.0029 (39%) | $0.0014 (19%) |

**Benchmarks** (my divisions of sourced totals). India: $1.5B over 555M gamers, excluding real-money games ([Lumikai](https://respawn.outlookindia.com/gaming/gaming-news/lumikai-india-gaming-market-1-5-billion-rmg-ban-2025)), is **$0.0074 per gamer-day** (IAP plus ads). US: $26.7B mobile spend over ~168M players ([ESA/Circana](https://www.prnewswire.com/news-releases/2025-us-consumer-spending-on-video-games-nears-pandemic-level-peak-at-60-7-billion-second-highest-on-record-302684591.html), [ESA](https://www.theesa.com/resources/essential-facts-about-the-us-video-game-industry/2025-data/)) is **$0.43 per player-day** (IAP only), ~59x more. Non-daily gamers bias India's figure low, a weak-grossing genre high; I use it unadjusted, with a 10% AI budget (assumption).

Worst cell: Haiku at 3 + 4, 7.4x India (~13% of US). Best: cached GPT-5 nano at 4 + 3 ($0.0008), still ~11%. Price is one of four problems: an LLM can also make illegal or invented claims, is hard to tune for difficulty, and can't prove a bot knows only its seat's view. The fix:

1. **Decide with a rule-based belief model.** Each bot scores suspicion per seat from its seat's view and carded claims, and plays scripted tells; finite card actions (claim, vouch, accuse, vote) run on a server CPU, no LLM. If playtesters find them robotic: an LLM-proposes, RL-chooses agent ([Xu et al., ICML 2024](https://arxiv.org/abs/2310.18940)) regularised on logged human games ([CICERO](https://www.science.org/doi/10.1126/science.ade9097)); 1-2 ML engineers for a quarter plus compute (assumption).
2. **Speak with templates and a line bank.** Cards are templates, free in any language. An LLM pre-writes flavour lines offline for human review (50,000 lines × 10 languages at ~60 tokens: ~$15 on GPT-6 Luna, estimate), paying the Indic tokenizer penalty (up to 15x longer text, [Petrov et al.](https://arxiv.org/abs/2305.15425)) once.
3. **Add live flavour only where it pays.** Two short lines per AI seat per match (800 input, 30 output tokens; assumption) cost ~3-6% (4 + 3) to ~6-10% (3 + 4) of India revenue per gamer-day, nano to Luna; Luna breaks my default's budget. Levers: one line per seat (~3-5% at 3 + 4) or live lines only at 4+ human tables; all-bot tables use the bank (live: ~25% even on nano). A rewarded ad per human-day (~$0.0024 at $2.43 eCPM, estimate) covers the default's live cost 3-6x.

Catch: in a 2025 Among Us sandbox, RL-trained models deceived far better than they detected deception ([arXiv](https://arxiv.org/abs/2504.04072)), so bot thieves get readable tells, tuned until caught as often as human thieves.

### Voice costs more than the bots

At 18 voice-minutes per human-day (assumption), every managed voice feature costs more than the AI seats as designed above:

| Voice item, per human-day | Cost | vs India |
|---|---|---|
| Managed voice ([Agora](https://docs.agora.io/en/voice-calling/overview/pricing), $0.99 per 1,000 min) | $0.018 | ~2.4x |
| Batch transcription for AI review ([OpenAI](https://developers.openai.com/api/docs/pricing), $0.003/min) | $0.054 | ~7x |
| Live transcription ([Gemini 3.5 Transcribe Live](https://ai.google.dev/gemini-api/docs/pricing), ~$0.009/min) | $0.16 | ~22x |
| AI speech: 2 TTS min per match, 3 humans sharing (assumption; [Gemini 3.1 Flash TTS](https://ai.google.dev/gemini-api/docs/pricing), ~$0.03/min) | $0.06 | ~8x |

So *Kaun?* owns the table (members, history, titles) and rents the pipe; with Among Us, Discord held both. Friend tables talk on a WhatsApp call beside the game: no infrastructure cost or recordings to police (to test on one budget phone). Families in one room, at a wedding or on Diwali, talk face to face, with phones as secret role cards and the register. Stranger tables are claims-only. Any later in-app voice gets report-triggered AI moderation: the phone keeps a rolling 60-second buffer, uploaded only with a report.

## How I'd de-risk it

**First test (2 weeks, no ML; assumption).** A web prototype (claim cards, WhatsApp-call voice, rule-based labelled bots) for 10 Indian friend or family groups of 3-4, in two languages, in three rotating arms: (A) humans plus bots at 7 seats; (B) the same humans alone in a One Night Ultimate Werewolf-style variant (one vote, no elimination); (C) arm A with voice off. I'd watch unprompted second sessions within 48 hours, carded claims per human per round, and whether players explain votes against bots as against people. Ten groups are a qualitative read (4 of 10 has an exact 95% interval of ~12-74%); a ~100-table link-spread beta comes before any percentage.

**Kill or change criteria** (thresholds assumed; directional at n=10):

| If | Then |
|---|---|
| Arm A rates 1+ point lower (of 5) than arm B after two bot iterations | AI seats don't earn their cost; keep bots only for the solo Daily Case |
| Arm A falls below 1 carded claim per human per round while arm C reaches 2+ | Voice swallowed the record and bots are deaf; redesign input first |
| Fewer than 4 of 10 groups return unprompted | The group hook fails |

**Three soft-launch numbers (targets assumed):**

| Metric | Why | Target |
|---|---|---|
| Table D7: share of new tables (2+ humans in first match) playing on day 7 | The group is the retention unit | ≥25% |
| Humans seated per new table's invite link | The growth engine: a table that never seats a second human is a solo player | ≥2 |
| AI cost as % of ARPDAU | The line between a game and a subsidy; above it, drop the runtime LLM | ≤10% |

Guardrail: reports per 100 stranger-table matches. Seat-filling is a bridge, but named AI guests with their own tells (Meera always over-vouches) are content players may keep choosing.

Social deduction is the oldest game about reading people. I'd fill its empty chairs with AI guests who can be read back.

## Sources, assumptions & AI use

**Sources.** Linked inline where used; prices and Steam figures retrieved Sep 23, 2026.

**Assumptions (not measured):** match structure, timings and token counts; 3 matches a day (a 10-match day multiplies AI cost by ~3.3); both table mixes; the cached prefix; the 10% AI budget; line-bank size; voice and TTS minutes; thief odds and half-weight bot votes; RL staffing; the wedding theme's appeal; every threshold and target. Revenue per player-day figures are my divisions of sourced totals with different definitions; no official India-vs-US ARPDAU exists.

**Verification and gaps.** Prices, caching rules, SteamCharts, Sensor Tower, Play listings, the 80.lv interview and the DPDP Act were checked against live pages on Sep 23, 2026; 17173 and Jiemian were read in Chinese; every cost cell was recomputed. SteamDB returned HTTP 403, so the Town of Salem 2 peak comes via win.gg. Not found: Among Us's current mobile MAU, India-specific retention data, any measured match length.

**AI use.** This answer was researched and drafted with Claude (Anthropic) via Claude Code. AI agents gathered research, checked against primary pages where fetchable, and AI reviewer passes (hiring-manager lens, fact-checker, domain expert) critiqued each draft before revision. Some mechanics (Ghost Jury, wedding setting, the Aunty, room-based act phase, shagun register) came from AI drafting or review and stayed because I can defend them. What curation changed:
- A draft said prompt caching couldn't apply. OpenAI's and Google's docs showed it does, so caching is priced in and the case for a policy model rests on more than price.
- Repricing my 3-human default table, not only the favourable 4-human one, pushed live Luna flavour over budget, so the pre-written line bank became the default.
- A reviewer suggested weighting the thief toward humans. A hard rule would make bots certified-innocent witnesses, so the odds are published and bots stay suspects.

Everything not measured or sourced is labelled as a hypothesis.
