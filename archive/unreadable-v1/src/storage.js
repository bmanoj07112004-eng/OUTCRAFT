// Persistence (localStorage) and the day-1 systems built on it: the Oracle's memory of the player,
// the Tell Dex (habits to discover, then break), stats history and the Daily Oracle streak.
// Everything stays on the player's device.

import { EXPERT_IDS, TELLS } from './oracle.js';
import { dateKey, daysBetween, hashString, dayNumber } from './rng.js';
import { MODIFIERS } from './levels.js';

const KEY = 'unreadable.v1';

export const DEX_RULES = { minN: 12, detect: 0.5, breakN: 15, breakAt: 0.36, relapse: 0.52 };

function fresh() {
  return {
    oracle: null,
    stats: { runs: 0, best: 0, bestLevel: 0, history: [] },
    dex: {},
    daily: { lastKey: null, streak: 0, best: 0, results: {} },
    settings: { sound: true },
    seenHowTo: false,
    lastPlayed: null,
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    return { ...fresh(), ...JSON.parse(raw) };
  } catch {
    return fresh();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private mode or full storage: the game still works, it just forgets.
  }
}

export function wipe() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
  return fresh();
}

export function todaysDaily(key = dateKey()) {
  const h = hashString(`unreadable:${key}`);
  return { key, number: dayNumber(key), modifier: MODIFIERS[h % MODIFIERS.length], seed: h };
}

// Folds one finished run into persistent state. Returns what changed, for the results screen.
export function recordRun(state, summary, { daily = null, now = Date.now() } = {}) {
  const events = [];
  const today = dateKey(new Date(now));

  // Tell Dex: detect a habit when the Oracle reads it well; break it with a run where it fails.
  for (const id of EXPERT_IDS) {
    const { n, acc } = summary.tells[id];
    if (n < DEX_RULES.minN) continue;
    const e = state.dex[id] || { status: 'locked' };
    if (e.status === 'locked' && acc >= DEX_RULES.detect) {
      Object.assign(e, { status: 'detected', acc, date: today });
      events.push({ id, type: 'detected', acc });
    } else if (e.status === 'detected') {
      e.acc = acc;
      if (n >= DEX_RULES.breakN && acc <= DEX_RULES.breakAt) {
        Object.assign(e, { status: 'broken', brokenDate: today });
        events.push({ id, type: 'broken', acc });
      }
    } else if (e.status === 'broken' && acc >= DEX_RULES.relapse) {
      Object.assign(e, { status: 'detected', acc, relapsed: true, date: today });
      events.push({ id, type: 'relapsed', acc });
    }
    state.dex[id] = e;
  }

  const st = state.stats;
  st.runs += 1;
  const newBest = summary.score > st.best;
  st.best = Math.max(st.best, summary.score);
  st.bestLevel = Math.max(st.bestLevel, summary.level);
  st.history.push({ t: now, readRate: summary.readRate, level: summary.level, score: summary.score, mode: summary.mode });
  if (st.history.length > 40) st.history.shift();

  let dailyInfo = null;
  if (daily && !state.daily.results[daily.key]) {
    const d = state.daily;
    const gap = d.lastKey ? daysBetween(d.lastKey, daily.key) : null;
    d.streak = gap === 1 ? d.streak + 1 : gap === 0 ? d.streak : 1;
    d.best = Math.max(d.best, d.streak);
    d.lastKey = daily.key;
    d.results[daily.key] = {
      score: summary.score,
      level: summary.level,
      readRate: summary.readRate,
      grid: summary.grid.slice(0, 30),
      modifier: daily.modifier.id,
      number: daily.number,
    };
    const keys = Object.keys(d.results).sort();
    while (keys.length > 14) delete d.results[keys.shift()];
    dailyInfo = { ranked: true, streak: d.streak };
  }

  state.lastPlayed = now;
  return { events, newBest, dailyInfo };
}

export function dexCounts(state) {
  const c = { detected: 0, broken: 0 };
  for (const id of EXPERT_IDS) {
    const s = state.dex[id]?.status;
    if (s === 'detected') c.detected++;
    if (s === 'broken') c.broken++;
  }
  return c;
}

// The tell the player should try to break next: the Oracle's best-read habit that is still active.
export function nextTellToBreak(state) {
  let best = null;
  for (const id of EXPERT_IDS) {
    const e = state.dex[id];
    if (e?.status === 'detected' && (!best || e.acc > best.acc)) best = { id, acc: e.acc, name: TELLS[id].name };
  }
  return best;
}

export function greetingFor(msAway, runs) {
  if (!runs) return null;
  const h = msAway / 3600000;
  if (h < 1) return 'Back already? Good. I was still thinking about you.';
  if (h < 20) return `Welcome back. It has been ${Math.max(1, Math.round(h))} hours. I kept your file open.`;
  const days = Math.round(h / 24);
  if (days <= 1) return 'You came back. I knew you would. That was predictable too.';
  return `It has been ${days} days. I remember everything.`;
}

const EMOJI = { D: '🟩', S: '🟨', R: '🟥' };

export function shareText({ summary, daily, url }) {
  const head = daily ? `UNREADABLE · Daily #${daily.number} (${daily.modifier.name})` : 'UNREADABLE';
  const line = `Cracked ${summary.cracked} Oracle${summary.cracked === 1 ? '' : 's'} · Read ${Math.round(summary.readRate * 100)}% (random = 33%)`;
  const cells = summary.grid.slice(0, 30).map((g) => EMOJI[g]);
  const rows = [];
  for (let i = 0; i < cells.length; i += 10) rows.push(cells.slice(i, i + 10).join(''));
  return [head, line, ...rows, url].filter(Boolean).join('\n');
}
