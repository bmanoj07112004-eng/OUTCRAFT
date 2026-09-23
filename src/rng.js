// Small deterministic helpers. Seeded RNG keeps the Daily Oracle identical for everyone on a given date.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function randInt(rng, n) {
  return Math.floor(rng() * n);
}

// Local calendar date, so "today" matches the player's clock rather than UTC.
export function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const DAY_ONE = Date.UTC(2026, 8, 20); // Daily #1 = 2026-09-20

export function dayNumber(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) - DAY_ONE) / 86400000) + 1;
}

export function daysBetween(keyA, keyB) {
  const toUTC = (k) => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUTC(keyB) - toUTC(keyA)) / 86400000);
}
