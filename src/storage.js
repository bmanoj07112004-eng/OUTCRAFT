// Persistence (localStorage, this device only) and the day-1 systems built on it: the rivals' shared
// memory of you, the rival ladder, the Codex of crafted items, Tells (habits to detect and break) and
// the Daily Commission streak. The 3D edition adds the wallet, hearts, skins and boosters, Adventure
// progress, the daily reward calendar, achievements and more settings (see src/economy.js).
//
// Several tabs (and the classic 2D game) share one save. Every write bumps `rev`, and a tab never
// overwrites a save written after the one it last loaded or saved: save() refuses ('stale') and the
// game reloads instead (watchExternal tells it when another tab wrote).

import { HABIT_IDS } from './model.js';
import { RIVALS, DAILY_TWISTS, ITEMS } from './data.js';
import { LEVELS } from './levels.js';
import { SKIN_BY_ID, DEFAULT_SKIN } from './skins.js';
import { dateKey, daysBetween, hashString, dayNumber } from './rng.js';

const KEY = 'outcraft.v1';
const BACKUP_KEY = 'outcraft.v1.bak';
const PROBE_KEY = 'outcraft.probe';
export const DEX_RULES = { minN: 8, detectLift: 0.25, breakLift: 0.05, relapseLift: 0.3, zCrit: 2.6 };
const DAILY_RESULTS_KEPT = 14;

// A Tell is only named when chance cannot explain it: z-test of the rival's hit rate on that habit vs a uniform guess.
const tellZ = (t) => (t.chance > 0 && t.chance < 1 ? ((t.acc - t.chance) * Math.sqrt(t.n)) / Math.sqrt(t.chance * (1 - t.chance)) : 0);

export function fresh() {
  return {
    rev: 0, // bumped by every save (see save())
    model: null,
    ladder: { unlocked: 0, beaten: {} },
    codex: {},
    dex: {},
    stats: { matches: 0, wins: 0, snatched: 0, outread: 0, history: [] },
    daily: { lastKey: null, streak: 0, best: 0, results: {} },
    settings: { sound: true, music: true, glass: false, quality: 'auto', sensitivity: 1, invertY: false, autoReturn: false },
    seenHowTo: false,
    lastPlayed: null,
    tutorial3d: false, // the 3D control tutorial (classic's tutorialDone / seenHowTo are about the 2D controls)
    seenHowTo3d: false,
    wallet: { coins: 300, gems: 15 },
    hearts: { n: 5, since: null }, // since = ms timestamp when regeneration started (null when full)
    activeLevel: null, // { id, at } while an Adventure level is being played (its heart is already spent)
    inventory: { skins: [DEFAULT_SKIN], equipped: DEFAULT_SKIN, boosters: { boots: 1, backpack: 1, headstart: 0, fog: 0 } },
    levels: {}, // [level id]: { stars, best, plays }
    adventure: { unlocked: 1 }, // highest playable level id
    dailyReward: { lastKey: null, day: 0, best: 0 }, // day = consecutive days claimed (1..7 cycle); best = highest day reached
    achievements: { claimed: {} },
    counters: { levelsWon: 0, starsEarned: 0, fakeOuts: 0, outreads: 0, flawless: 0, coinsEarned: 0 },
    quickRace: { key: null, paid: 0 }, // Quick Race / Daily Commission wins paid today (economy.recordQuickRace)
    replays: { key: null, paid: 0 }, // Adventure replays paid today (economy.grantLevelResult)
  };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Old or partial saves get every missing field from the defaults, at any depth. A saved value only
// replaces a default of the same kind, so one corrupt field cannot break the game. Saved keys the
// defaults do not know (per-level records, codex entries, tutorialDone, tips...) are kept.
function merge(def, saved) {
  if (isObj(def)) {
    if (!isObj(saved)) return def;
    const out = { ...saved };
    for (const k of Object.keys(def)) out[k] = merge(def[k], saved[k]);
    return out;
  }
  if (saved === undefined) return def;
  if (Array.isArray(def)) return Array.isArray(saved) ? saved : def;
  if (typeof def === 'number') return Number.isFinite(saved) ? saved : def;
  if (typeof def === 'boolean' || typeof def === 'string') return typeof saved === typeof def ? saved : def;
  return saved; // null defaults (model, lastKey, since, lastPlayed, activeLevel): checked in migrate()
}

const count = (v) => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isKey = (k) => typeof k === 'string' && /^\d{4}-\d\d-\d\d$/.test(k);
const orNull = (v, ok) => (ok(v) ? v : null);
const QUALITY = ['auto', 'low', 'medium', 'high'];
const DEX_STATUS = ['locked', 'detected', 'broken'];
const RIVAL_IDS = RIVALS.map((r) => r.id);

// The rival's notebook (PlayerModel.toJSON): { t: tables of { o, e, v, n } counts, w: weights, matches }.
const isStat = (s) => isObj(s) && ['o', 'e', 'v', 'n'].every((k) => Number.isFinite(s[k]));
const isStats = (a, n) => Array.isArray(a) && a.length === n && a.every(isStat);
function validModel(m) {
  if (!isObj(m) || !isObj(m.t)) return false;
  const t = m.t;
  if (!isStat(t.beeline) || !isStat(t.book) || !isStats(t.turf, 9) || !isStats(t.side, 3) || !isObj(t.routine)) return false;
  if (!Object.values(t.routine).every((row) => isObj(row) && Object.values(row).every(isStat))) return false;
  if (m.w !== undefined && !(isObj(m.w) && Object.values(m.w).every((x) => Number.isFinite(x) && x >= 0))) return false;
  return m.matches === undefined || Number.isFinite(m.matches);
}

const isScore = (s) => isObj(s) && Number.isFinite(s.player) && Number.isFinite(s.rival);

// Upgrade any saved object (a v1 save from the 2D game included) to the current shape, and repair
// anything a hand edit, a bug or a half-written save could have broken, so the game always boots.
export function migrate(saved) {
  const s = merge(fresh(), saved);
  s.rev = count(s.rev);
  if (!validModel(s.model)) s.model = null;
  if (!Number.isFinite(s.lastPlayed)) s.lastPlayed = null;
  if ('tutorialDone' in s) s.tutorialDone = s.tutorialDone === true;
  if ('tips' in s && !isObj(s.tips)) delete s.tips;

  // Day-1 systems (shared with the classic game).
  const lad = s.ladder;
  lad.unlocked = clamp(count(lad.unlocked), 0, RIVALS.length - 1);
  lad.beaten = Object.fromEntries(RIVAL_IDS.filter((id) => lad.beaten[id] === true).map((id) => [id, true]));
  for (const [id, c] of Object.entries(s.codex)) {
    if (isObj(c) && Number.isFinite(c.count)) s.codex[id] = { ...c, count: count(c.count) };
    else delete s.codex[id];
  }
  for (const [id, e] of Object.entries(s.dex)) {
    if (!isObj(e) || !DEX_STATUS.includes(e.status)) delete s.dex[id];
    else for (const k of ['acc', 'chance']) if (k in e && !Number.isFinite(e[k])) e[k] = 0;
  }
  const st = s.stats;
  for (const k of ['matches', 'wins', 'snatched', 'outread']) st[k] = count(st[k]);
  st.history = st.history.filter(isObj);
  const d = s.daily;
  d.lastKey = orNull(d.lastKey, isKey);
  d.streak = count(d.streak);
  d.best = Math.max(count(d.best), d.streak);
  for (const [k, r] of Object.entries(d.results)) {
    if (!isKey(k) || !isObj(r)) delete d.results[k];
    else if (!isScore(r.stars)) r.stars = { player: 0, rival: 0 };
  }

  // 3D edition.
  s.wallet.coins = count(s.wallet.coins);
  s.wallet.gems = count(s.wallet.gems);
  s.hearts.n = count(s.hearts.n);
  if (!Number.isFinite(s.hearts.since)) s.hearts.since = null;
  const a = s.activeLevel;
  if (!(isObj(a) && Number.isInteger(a.id) && a.id >= 1 && a.id <= LEVELS.length && Number.isFinite(a.at))) s.activeLevel = null;
  const inv = s.inventory;
  inv.skins = [...new Set(inv.skins.filter((id) => SKIN_BY_ID[id]))];
  if (!inv.skins.includes(DEFAULT_SKIN)) inv.skins.unshift(DEFAULT_SKIN);
  if (!inv.skins.includes(inv.equipped)) inv.equipped = DEFAULT_SKIN;
  for (const id of Object.keys(inv.boosters)) inv.boosters[id] = count(inv.boosters[id]);
  // Per-level records: keep only well-formed entries keyed by a level number.
  for (const [id, r] of Object.entries(s.levels)) {
    if (!/^\d+$/.test(id) || !isObj(r)) delete s.levels[id];
    else s.levels[id] = { stars: Math.min(3, count(+r.stars || 0)), best: count(+r.best || 0), plays: count(+r.plays || 0) };
  }
  s.adventure.unlocked = clamp(Math.floor(s.adventure.unlocked), 1, LEVELS.length);
  const dr = s.dailyReward;
  dr.lastKey = orNull(dr.lastKey, isKey);
  dr.day = Math.min(7, count(dr.day));
  dr.best = Math.min(7, Math.max(count(dr.best), dr.day));
  if ('skinKey' in dr && !isKey(dr.skinKey)) delete dr.skinKey;
  for (const k of Object.keys(fresh().counters)) s.counters[k] = count(s.counters[k]);
  for (const q of [s.quickRace, s.replays]) {
    q.key = orNull(q.key, isKey);
    q.paid = count(q.paid);
  }
  if (!QUALITY.includes(s.settings.quality)) s.settings.quality = 'auto';
  s.settings.sensitivity = clamp(s.settings.sensitivity, 0.2, 3);
  return s;
}

// ------------------------------------------------------------ reading and writing
let knownRev = null; // rev of the save this tab last loaded or wrote (null: none yet)
let status = { ok: true, reason: null };

const fail = (reason) => {
  status = { ok: false, reason };
  return false;
};
const isQuota = (e) => !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);

function revOf(raw) {
  try {
    const s = JSON.parse(raw);
    return isObj(s) ? count(s.rev) : 0;
  } catch {
    return 0;
  }
}

export function load() {
  let raw;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    fail('blocked');
    return fresh();
  }
  if (!raw) {
    knownRev = 0;
    return fresh();
  }
  try {
    const s = migrate(JSON.parse(raw));
    knownRev = s.rev;
    return s;
  } catch {
    // Unreadable: keep a copy of it before the next save replaces it.
    backup(raw);
    knownRev = 0;
    return fresh();
  }
}

// Writes the save and returns true, or returns false (see saveStatus()): storage blocked, full even
// after trimming history, or 'stale': another tab saved after this one last loaded or saved, so this
// tab must reload (load()) rather than overwrite that progress.
export function save(state) {
  let ls;
  let stored;
  try {
    ls = localStorage;
    stored = revOf(ls.getItem(KEY));
  } catch {
    return fail('blocked');
  }
  const base = knownRev ?? count(state.rev);
  if (stored > base) return fail('stale');
  const prev = state.rev;
  state.rev = Math.max(base, stored, count(state.rev)) + 1;
  for (let retry = false; ; retry = true) {
    try {
      ls.setItem(KEY, JSON.stringify(state));
      knownRev = state.rev;
      status = { ok: true, reason: null };
      return true;
    } catch (e) {
      if (!isQuota(e) || retry) {
        state.rev = prev;
        return fail(isQuota(e) ? 'quota' : 'blocked');
      }
      trim(state);
    }
  }
}

// Storage is full: drop the backup and the oldest history, then try once more.
function trim(state) {
  try {
    localStorage.removeItem(BACKUP_KEY);
  } catch {}
  if (Array.isArray(state.stats?.history)) state.stats.history = state.stats.history.slice(-10);
  const r = state.daily?.results;
  if (isObj(r)) for (const k of Object.keys(r).sort().slice(0, -7)) delete r[k];
}

// The outcome of the last save (or of a failed storageAvailable() probe).
export function saveStatus() {
  return { ...status };
}

// Probes whether this browser lets the game save at all (private modes, blocked or full storage).
export function storageAvailable() {
  try {
    localStorage.setItem(PROBE_KEY, '1');
    localStorage.removeItem(PROBE_KEY);
    return true;
  } catch (e) {
    return fail(isQuota(e) ? 'quota' : 'blocked');
  }
}

// Calls cb() whenever another tab (or the classic game) writes the save. Returns the unsubscribe function.
export function watchExternal(cb) {
  if (typeof window === 'undefined' || !window.addEventListener) return () => {};
  const on = (e) => {
    if (e.key !== KEY && e.key !== null) return;
    try {
      if (e.storageArea && e.storageArea !== localStorage) return;
    } catch {}
    cb();
  };
  window.addEventListener('storage', on);
  return () => window.removeEventListener('storage', on);
}

// Copies the raw save (or `raw`) to a backup key, e.g. before starting over from a damaged save.
export function backup(raw) {
  try {
    const v = raw ?? localStorage.getItem(KEY);
    if (!v) return false;
    localStorage.setItem(BACKUP_KEY, v);
    return true;
  } catch {
    return false;
  }
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

// ------------------------------------------------------------ Daily Commission
// Only the first attempt of the day is ranked, and it is used up the moment it starts: a pending
// result (a loss until recordMatch replaces it with the real one) makes every later attempt that day
// practice, so a quit, a restart or a reload cannot re-roll it. Returns true when this attempt is the
// ranked one, false when today's ranked attempt was already used.
export function markDailyAttempt(state, daily) {
  const d = state.daily;
  if (d.results[daily.key]) return false;
  countDailyDay(d, daily.key);
  d.results[daily.key] = { win: false, stars: { player: 0, rival: 0 }, results: [], twist: daily.twist.id, number: daily.number, snatched: 0, outread: 0, pending: true };
  trimDailyResults(d);
  return true;
}

function countDailyDay(d, key) {
  const gap = d.lastKey ? daysBetween(d.lastKey, key) : null;
  d.streak = gap === 1 ? d.streak + 1 : gap === 0 ? d.streak : 1;
  d.best = Math.max(d.best, d.streak);
  d.lastKey = key;
}

function trimDailyResults(d) {
  const keys = Object.keys(d.results).sort();
  while (keys.length > DAILY_RESULTS_KEPT) delete d.results[keys.shift()];
}

// ------------------------------------------------------------ results
// Fold a finished match into saved state. Returns what changed, for the results screen.
// daily = the Daily Commission of a ranked attempt (one with ranked: false is practice and records no
// daily result); its pending entry from markDailyAttempt is replaced by the real result.
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
  const d = state.daily;
  const prev = daily && d.results[daily.key];
  if (daily && daily.ranked !== false && (!prev || prev.pending)) {
    if (!prev) countDailyDay(d, daily.key);
    d.results[daily.key] = { win, stars: summary.stars, results: summary.results, twist: daily.twist.id, number: daily.number, snatched: summary.stats.snatched, outread: summary.stats.outread };
    trimDailyResults(d);
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
