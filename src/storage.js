// Persistence (localStorage, this device only) and the day-1 systems built on it: the rivals' shared
// memory of you, the rival ladder, the Codex of crafted items, Tells (habits to detect and break) and
// the Daily Commission streak.

import { HABIT_IDS } from './model.js';
import { RIVALS, DAILY_TWISTS, ITEMS } from './data.js';
import { dateKey, daysBetween, hashString, dayNumber } from './rng.js';

const KEY = 'outcraft.v1';
export const DEX_RULES = { minN: 8, detectLift: 0.25, breakLift: 0.05, relapseLift: 0.3, zCrit: 2.6 };

// A Tell is only named when chance cannot explain it: z-test of the rival's hit rate on that habit vs a uniform guess.
const tellZ = (t) => (t.chance > 0 && t.chance < 1 ? ((t.acc - t.chance) * Math.sqrt(t.n)) / Math.sqrt(t.chance * (1 - t.chance)) : 0);

function fresh() {
  return {
    model: null,
    ladder: { unlocked: 0, beaten: {} },
    codex: {},
    dex: {},
    stats: { matches: 0, wins: 0, snatched: 0, outread: 0, history: [] },
    daily: { lastKey: null, streak: 0, best: 0, results: {} },
    settings: { sound: true, glass: false },
    seenHowTo: false,
    lastPlayed: null,
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const s = JSON.parse(raw);
    const f = fresh();
    return { ...f, ...s, ladder: { ...f.ladder, ...s.ladder }, settings: { ...f.settings, ...s.settings }, stats: { ...f.stats, ...s.stats }, daily: { ...f.daily, ...s.daily } };
  } catch {
    return fresh();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}

export function wipe(keep = {}) {
  try {
    localStorage.removeItem(KEY);
  } catch {}
  return { ...fresh(), ...keep };
}

export function todaysDaily(key = dateKey()) {
  const h = hashString(`outcraft:${key}`);
  return { key, number: dayNumber(key), twist: DAILY_TWISTS[h % DAILY_TWISTS.length], seed: h, rivalIndex: 2 };
}

// Fold a finished match into saved state. Returns what changed, for the results screen.
export function recordMatch(state, summary, { rivalIndex, daily = null, now = Date.now() } = {}) {
  const today = dateKey(new Date(now));
  const events = [];

  for (const id of HABIT_IDS) {
    const t = summary.tells[id];
    if (!t || t.n < DEX_RULES.minN) continue;
    const lift = t.acc - t.chance;
    const e = state.dex[id] || { status: 'locked' };
    if (e.status === 'locked' && lift >= DEX_RULES.detectLift && tellZ(t) >= DEX_RULES.zCrit) {
      Object.assign(e, { status: 'detected', acc: t.acc, chance: t.chance, date: today });
      events.push({ id, type: 'detected', ...t });
    } else if (e.status === 'detected') {
      Object.assign(e, { acc: t.acc, chance: t.chance });
      if (lift <= DEX_RULES.breakLift) {
        Object.assign(e, { status: 'broken', brokenDate: today });
        events.push({ id, type: 'broken', ...t });
      }
    } else if (e.status === 'broken' && lift >= DEX_RULES.relapseLift && tellZ(t) >= DEX_RULES.zCrit) {
      Object.assign(e, { status: 'detected', acc: t.acc, chance: t.chance, relapsed: true, date: today });
      events.push({ id, type: 'relapsed', ...t });
    }
    state.dex[id] = e;
  }

  const newItems = [];
  for (const id of summary.crafted) {
    const c = state.codex[id] || { count: 0, first: today };
    if (!c.count) newItems.push(id);
    c.count += 1;
    state.codex[id] = c;
  }

  const win = summary.winner === 'player';
  let unlocked = null;
  if (!daily && rivalIndex != null && !summary.blind) {
    if (win) state.ladder.beaten[RIVALS[rivalIndex].id] = true;
    if (win && rivalIndex === state.ladder.unlocked && state.ladder.unlocked < RIVALS.length - 1) {
      state.ladder.unlocked += 1;
      unlocked = RIVALS[state.ladder.unlocked];
    }
  }

  const st = state.stats;
  st.matches += 1;
  st.wins += win ? 1 : 0;
  st.snatched += summary.stats.snatched;
  st.outread += summary.stats.outread;
  st.history.push({ t: now, win, rival: summary.rival, snatched: summary.stats.snatched, outread: summary.stats.outread, gathers: summary.stats.gathers });
  if (st.history.length > 40) st.history.shift();

  let dailyInfo = null;
  if (daily && !state.daily.results[daily.key]) {
    const d = state.daily;
    const gap = d.lastKey ? daysBetween(d.lastKey, daily.key) : null;
    d.streak = gap === 1 ? d.streak + 1 : gap === 0 ? d.streak : 1;
    d.best = Math.max(d.best, d.streak);
    d.lastKey = daily.key;
    d.results[daily.key] = { win, stars: summary.stars, results: summary.results, twist: daily.twist.id, number: daily.number, snatched: summary.stats.snatched, outread: summary.stats.outread };
    const keys = Object.keys(d.results).sort();
    while (keys.length > 14) delete d.results[keys.shift()];
    dailyInfo = { ranked: true, streak: d.streak };
  }

  state.lastPlayed = now;
  return { events, newItems, unlocked, dailyInfo, win };
}

export function codexCount(state) {
  return ITEMS.filter((i) => state.codex[i.id]?.count).length;
}

export function dexCounts(state) {
  const c = { detected: 0, broken: 0 };
  for (const id of HABIT_IDS) {
    const s = state.dex[id]?.status;
    if (s === 'detected') c.detected++;
    if (s === 'broken') c.broken++;
  }
  return c;
}

export function greetingFor(msAway, matches) {
  if (!matches) return null;
  const h = msAway / 3600000;
  if (h < 1) return 'Back already? We were still comparing notes on you.';
  if (h < 20) return `Welcome back. ${Math.max(1, Math.round(h))} hours, and we have not stopped talking about your routes.`;
  const days = Math.round(h / 24);
  if (days <= 1) return 'You came back. Predictable. We like predictable.';
  return `${days} days away. We kept your notebook.`;
}

const SQ = { player: '🟦', rival: '🟧' };
export function shareText({ summary, daily, rivalName, url }) {
  const head = daily ? `OUTCRAFT · Daily #${daily.number} (${daily.twist.name})` : 'OUTCRAFT';
  const verdict = summary.winner === 'player' ? `Out-crafted ${rivalName}` : `${rivalName} out-crafted me`;
  const line = `${verdict} ${summary.stars.player}–${summary.stars.rival} · snatched ${summary.stats.snatched}× · I beat it to ${summary.stats.outread}`;
  const grid = summary.results.map((r) => SQ[r.winner]).join('');
  return [head, line, grid, url].filter(Boolean).join('\n');
}
