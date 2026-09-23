# UNREADABLE (v1, archived)

The first prototype for this test, kept as process evidence. A 3-lane rhythm duel: every beat an AI "Oracle" predicts
which lane you will pick (a fixed-share Hedge ensemble of seven habit models, in the spirit of Scott Aaronson's f/d
predictor) and strikes it; every hit is explained honestly with real counts.

Why it was archived: an AI red-team review concluded that "matching pennies stays fun for about two minutes", and the
candidate wanted a crafting game. The AI ideas (interpretable habit experts, honest explanations, significance-gated
habit claims, memory as the day-1 hook) moved into OUTCRAFT.

Play: open `index.html` from this folder (served over http). Tests: `node tools/test.mjs`. Balance sim: `node tools/sim.mjs`.
