// Menu flows of the 3D edition: maps the save state to view models for src/ui/screens.js and wires every
// button. Title, level map and level popup (boosters, hearts), shop (with the 3D skin preview), daily
// reward, achievements, codex and tells, settings, how to play, about, the Quick Race ladder, both result
// screens (Adventure level result; Quick Race / Daily results with the notebook, tells and share), pause,
// "out of hearts", and the currency top bar with its live heart countdown.
// Every change to the save goes through commit() (app.js); when another tab wrote the save, the open
// screen is rendered again from the reloaded save (refreshAfterReload).

import * as S from '../ui/screens.js';
import { RIVALS, ITEMS, ITEM_BY_ID } from '../data.js';
import { HABITS, HABIT_IDS, PlayerModel } from '../model.js';
import { SKINS, SKIN_BY_ID, RARITY } from '../skins.js';
import { LEVELS, WORLDS, MAX_STARS, levelById } from '../levels.js';
import * as eco from '../economy.js';
import * as store from '../storage.js';
import { daysBetween, dateKey } from '../rng.js';
import { sfx, setSound, setMusic } from '../audio.js';
import { createPlayer, portraitURL, Preview } from '../3d/characters.js';
import { app, REPO_URL, ABOUT, commit, clamp, countdown, longWait, pct, playerPortrait, rivalPortrait, equippedSkin } from './app.js';
import * as play from './play.js';
import * as attract from './attract.js';

const RIVAL_BY_ID = Object.fromEntries(RIVALS.map((r) => [r.id, r]));
const GUARD_MS = 400; // a second tap this soon on PLAY / REMATCH / NEXT or on the same BUY is ignored
const back = { settings: 'title', how: 'title', about: 'title', shop: 'title', codex: 'title', achievements: 'title' };
let howThen = null; // what to do after How to play: 'daily' | 'quick' | null
let shopSel = null; // skin shown in the shop preview
let preview = null;
let previewFailed = false;
let popupLevel = null; // level id whose popup is open
let lastBar = 0;
let lastHearts = -1;
let lastDay = null;
let lastResult = null;
let launchedAt = 0;
let lastBuy = { id: null, t: 0 };

// ------------------------------------------------------------------ small helpers
export function hideForMatch() {
  S.closeAllModals();
  S.showScreen(null);
  S.clearBoosterSelection();
  popupLevel = null;
}

export const confirm = (o) => S.confirmDialog(o);
export const toast = (text, o) => S.toast(text, o);

// Start a match from a button: the second tap of a double tap is ignored (it would skip the VS splash).
function launch(fn) {
  const t = performance.now();
  if (t - launchedAt < GUARD_MS) return;
  launchedAt = t;
  fn();
}

// The same BUY pressed again right away (a double tap) buys once.
function repeatBuy(id) {
  const t = performance.now();
  const again = lastBuy.id === id && t - lastBuy.t < GUARD_MS;
  lastBuy = { id, t };
  return again;
}

// Clock time ('14:32') at which every heart is back, or null when they are full.
function heartsFullAt(h) {
  if (!h.nextInMs) return null;
  const t = new Date(Date.now() + h.nextInMs + (eco.HEARTS_MAX - h.n - 1) * eco.HEART_REGEN_MS);
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}

function ensureAttract() {
  if (!play.active() && !attract.running()) attract.start();
}

function rewardKind(r) {
  if (r.skin) return 'skin';
  if (r.booster) return 'booster';
  if (r.gems) return 'gems';
  return 'coins';
}

function shortReward(r) {
  if (r.skin) return `${SKIN_BY_ID[r.skin]?.name || 'New'} skin`;
  if (r.booster) return `${r.count > 1 ? `${r.count}× ` : ''}${eco.BOOSTERS[r.booster].name}`;
  if (r.gems) return `${r.gems} gems`;
  return `${r.coins} coins`;
}

function rivalVM(def, size = 96) {
  return { name: def.name, title: def.title, color: def.color, portrait: rivalPortrait(def, size) };
}

function notebookVM(summary, rival, mdl) {
  const ps = summary.stats;
  const maxW = Math.max(1e-9, ...HABIT_IDS.map((id) => mdl.w[id]));
  return {
    rivalName: rival.name,
    predicting: rival.experts.length > 0,
    predN: ps.predN,
    acc: ps.predN ? ps.predHits / ps.predN : 0,
    chance: ps.predN ? ps.predChance / ps.predN : 0,
    rows: HABIT_IDS.map((id) => ({ glyph: HABITS[id].glyph, name: HABITS[id].name, weight: Math.round((mdl.w[id] / maxW) * 100), used: rival.experts.includes(id) })),
  };
}

function tellsVM(events) {
  return (events || []).map((e) => ({ type: e.type, glyph: HABITS[e.id].glyph, name: HABITS[e.id].name, blurb: HABITS[e.id].blurb, acc: e.acc, chance: e.chance }));
}

// ------------------------------------------------------------------ top bar (every menu screen)
const topCb = {
  onHearts: () => showShop('hearts', fromScreen()),
  onCoins: () => showShop('hearts', fromScreen()),
  onGems: () => showShop('hearts', fromScreen()),
};

function fromScreen() {
  const s = S.currentScreen();
  return s === 'screen-map' ? 'map' : s === 'screen-shop' ? back.shop : 'title';
}

// Hearts regrow with time alone (heartsNow works them out from the save), so the bar never saves.
export function updateTopBar() {
  const st = app.state;
  const h = eco.heartsNow(st, Date.now());
  lastHearts = h.n;
  S.renderTopBar({ coins: st.wallet.coins, gems: st.wallet.gems, hearts: h.n, heartsMax: eco.HEARTS_MAX, heartsText: h.nextInMs ? countdown(h.nextInMs) : '' }, topCb);
  return h;
}

// Once a second on the menus: the heart countdowns are updated in place (a re-render would swallow the
// tap in progress); screens showing hearts are re-rendered only when a heart comes back. At midnight
// the daily reward calendar and the title badges move on to the new day.
export function tick(dt) {
  const scr = S.currentScreen();
  if (preview && scr === 'screen-shop' && S.shopCurrentTab() === 'skins') preview.update(dt);
  const t = performance.now();
  if (t - lastBar < 1000 || app.mode === 'play') return;
  lastBar = t;
  const before = lastHearts;
  const h = updateTopBar();
  S.updateHeartsCountdown(h.nextInMs ? countdown(h.nextInMs) : '');
  if (before >= 0 && h.n !== before) {
    if (popupLevel && S.isModalOpen('level')) openLevel(popupLevel);
    if (scr === 'screen-shop' && S.shopCurrentTab() === 'hearts') renderShopNow();
    refreshTitle();
  }
  const day = dateKey();
  if (lastDay && day !== lastDay) {
    if (S.isModalOpen('daily')) showDailyReward();
    refreshTitle();
  }
  lastDay = day;
}

// The save was reloaded from storage (another tab wrote it): apply its settings and show it. During a
// match nothing is redrawn (the result is applied to the reloaded save when the match ends).
export function refreshAfterReload(live) {
  const s = app.state.settings;
  setSound(s.sound);
  setMusic(s.music);
  app.input.setOptions({ sensitivity: s.sensitivity, invertY: s.invertY });
  if (app.engine.quality !== s.quality) {
    app.engine.setQuality(s.quality);
    app.redraw = true;
  }
  lastHearts = -1;
  if (live) return;
  if (!play.active()) app.stage.setSkin(equippedSkin());
  shopSel = null;
  switch (S.currentScreen()) {
    case 'screen-title':
      refreshTitle();
      break;
    case 'screen-map':
      S.renderMap(mapVM(), mapCb);
      break;
    case 'screen-shop':
      shopSel = app.state.inventory.equipped;
      renderShopNow();
      showPreview(shopSel);
      break;
    case 'screen-achievements':
      showAchievements();
      break;
    case 'screen-codex':
      showCodex();
      break;
    case 'screen-settings':
      showSettings();
      break;
    case 'screen-rivals':
      showRivals();
      break;
  }
  if (popupLevel && S.isModalOpen('level')) {
    if (popupLevel <= app.state.adventure.unlocked) openLevel(popupLevel);
    else S.closeModal('level');
  }
  if (S.isModalOpen('daily')) showDailyReward();
  updateTopBar();
}

// ------------------------------------------------------------------ title
const titleCb = {
  onPlay: () => {
    const st = app.state;
    // First time: straight to level 1's popup on the map.
    showMap(st.stats.matches === 0 && !st.levels[1] ? 1 : null);
  },
  onDaily: () => {
    const st = app.state;
    if (!st.seenHowTo3d && !st.tutorial3d) return showHow('daily', 'title');
    launch(() => play.startDaily());
  },
  onQuick: () => {
    const st = app.state;
    if (!st.seenHowTo3d && !st.tutorial3d) return showHow('quick', 'title');
    showRivals();
  },
  onShop: () => showShop(null, 'title'),
  onDailyReward: () => showDailyReward(),
  onAchievements: () => showAchievements('title'),
  onCodex: () => showCodex('title'),
  onSettings: () => showSettings('title'),
  onHow: () => showHow(null, 'title'),
  onAbout: () => showAbout('title'),
};

function titleVM() {
  const st = app.state;
  const now = Date.now();
  const lvlId = eco.currentLevel(st);
  const lvl = levelById(lvlId);
  const d = store.todaysDaily();
  const done = st.daily.results[d.key];
  const gap = st.daily.lastKey ? daysBetween(st.daily.lastKey, d.key) : 99;
  const streak = gap <= 1 ? st.daily.streak || 0 : 0;
  // A ranked attempt left before the end (quit, reload) counts as played, and lost.
  const dailyDone = done ? (done.pending ? 'Left early' : `Done ${done.stars.player}–${done.stars.rival}`) : null;
  const r = RIVALS[st.ladder.unlocked];
  let dossier = null;
  if (st.stats.matches > 0) {
    dossier = {
      greet: store.greetingFor(Date.now() - (st.lastPlayed || Date.now()), st.stats.matches),
      lines: app.model.dossier(1).map((l) => l.text),
      notebook: app.model.memorySize,
      nextRival: r.name,
    };
  }
  return {
    level: lvlId,
    levelName: eco.adventureComplete(st) ? `${lvl.name} · Adventure complete!` : lvl.name,
    dailySub: `${dailyDone || `#${d.number} · ${d.twist.name}`}${streak ? ` · streak ${streak}` : ''}`,
    dailyDone: !!done,
    quickSub: `vs ${r.name} · ${r.title}`,
    dailyReward: eco.dailyStatus(st, now).canClaim,
    dailyStreak: eco.dailyStreak(st, now),
    heartsFullAt: heartsFullAt(eco.heartsNow(st, now)),
    achievements: eco.claimableAchievements(st),
    codex: `${store.codexCount(st)}/${ITEMS.length}`,
    dossier,
    docsHref: REPO_URL,
  };
}

export function showTitle() {
  S.closeAllModals();
  popupLevel = null;
  ensureAttract();
  S.renderTitle(titleVM(), titleCb);
  S.showScreen('title');
  updateTopBar();
}

function refreshTitle() {
  if (S.currentScreen() === 'screen-title') S.renderTitle(titleVM(), titleCb);
}

// ------------------------------------------------------------------ level map and level popup
// The pin sits on the first level not cleared yet; cleared levels always show their stars (level 60
// included), and once all are cleared the map opens on the first one short of 3 stars.
function mapVM() {
  const st = app.state;
  const cur = eco.currentLevel(st);
  const top = st.adventure.unlocked;
  const skin = equippedSkin();
  return {
    worlds: WORLDS.map((w) => ({
      name: w.name,
      themeId: w.id,
      stars: LEVELS.filter((l) => l.world === w.index).reduce((s, l) => s + (st.levels[l.id]?.stars || 0), 0),
      maxStars: (w.last - w.first + 1) * 3,
    })),
    levels: LEVELS.map((l) => {
      const r = RIVAL_BY_ID[l.rival];
      const stars = st.levels[l.id]?.stars || 0;
      return {
        id: l.id,
        world: l.world,
        stars,
        boss: l.boss,
        state: l.id > top ? 'locked' : l.id === cur && !stars ? 'current' : 'done',
        rivalPortrait: l.boss ? rivalPortrait(r, 96) : null,
        rivalColor: r.color,
        rivalName: r.name,
      };
    }),
    current: cur,
    playerPortrait: playerPortrait(96),
    playerColor: skin.colors.body,
    stars: eco.totalStars(st),
    maxStars: MAX_STARS,
  };
}

const mapCb = { onLevel: (id) => openLevel(id), onBack: () => showTitle() };

export function showMap(openId = null) {
  S.closeAllModals();
  popupLevel = null;
  ensureAttract();
  S.renderMap(mapVM(), mapCb);
  S.showScreen('map');
  updateTopBar();
  if (openId) {
    S.scrollToLevel(openId, false);
    openLevel(openId);
  }
}

function popupVM(level) {
  const st = app.state;
  const rival = RIVAL_BY_ID[level.rival];
  const rec = eco.levelRecord(st, level.id);
  const h = eco.heartsNow(st, Date.now());
  const skin = equippedSkin();
  const w = WORLDS[level.world];
  return {
    id: level.id,
    name: level.name,
    worldName: w.name,
    themeId: w.id,
    boss: level.boss,
    hard: level.hard,
    rival: rivalVM(rival, 128),
    player: { portrait: playerPortrait(128), color: skin.colors.body },
    goal: level.goal.text,
    twist: level.twist ? { name: level.twist.name, desc: level.twist.desc } : null,
    note: level.note,
    timeLimit: level.options.timeLimit || null,
    thresholds: level.thresholds,
    stars: rec.stars,
    best: rec.best,
    boosters: eco.BOOSTER_IDS.map((id) => {
      const b = eco.BOOSTERS[id];
      return { id, name: b.name, desc: b.desc, icon: id, count: eco.boosterCount(st, id), price: b.price, canAfford: eco.canAfford(st, b.price) };
    }),
    selected: [],
    hearts: h.n,
    heartsText: h.nextInMs ? countdown(h.nextInMs) : '',
    heartsFullAt: heartsFullAt(h),
  };
}

export function openLevel(id) {
  const level = levelById(id);
  if (!level || id > app.state.adventure.unlocked) return;
  popupLevel = id;
  S.renderLevelPopup(popupVM(level), {
    onPlay: (ids) =>
      launch(() => {
        if (play.startLevel(level.id, ids)) popupLevel = null;
      }),
    onClose: () => {
      popupLevel = null;
    },
    onBuyBooster: async (bid) => {
      if (repeatBuy(bid)) return;
      const b = eco.BOOSTERS[bid];
      const ok = await S.confirmDialog({ title: `Buy ${b.name}?`, text: `${b.desc} It costs ${S.fmt(b.price.coins)} coins (you have ${S.fmt(app.state.wallet.coins)}).`, ok: 'BUY' });
      if (!ok) return;
      const r = commit((st) => eco.buy(st, bid, Date.now()));
      if (!r.ok) {
        sfx.error();
        S.toast(eco.REASONS[r.reason] || 'You cannot buy that yet.', { kind: 'bad' });
        return;
      }
      sfx.buy();
      updateTopBar();
      S.toast(`${b.name} bought and ready!`, { kind: 'good' });
      if (popupLevel !== level.id || !S.isModalOpen('level')) return;
      S.selectBooster(bid);
      openLevel(level.id);
    },
    onNoHearts: () => noHearts(level),
  });
}

// PLAY with no hearts: refill for gems, or wait for the countdown.
export async function noHearts(level) {
  const st = app.state;
  const h = eco.heartsNow(st, Date.now());
  if (h.n > 0) return;
  const ok = await S.confirmDialog({
    title: 'Out of hearts',
    text: `Next heart in ${countdown(h.nextInMs)}. Refill all ${eco.HEARTS_MAX} hearts now for ${eco.HEART_REFILL_GEMS} gems? You have ${st.wallet.gems}.`,
    ok: 'REFILL',
    cancel: 'WAIT',
  });
  if (!ok) return;
  const r = commit((s) => eco.refillHearts(s, Date.now()));
  if (!r.ok) {
    sfx.error();
    S.toast(r.reason === 'gems' ? `Not enough gems (${eco.HEART_REFILL_GEMS} needed). Win levels and claim rewards to earn more.` : eco.REASONS[r.reason], { kind: 'bad', dur: 3200 });
    return;
  }
  sfx.buy();
  updateTopBar();
  S.toast('Hearts refilled! Go get them.', { kind: 'good' });
  if (level && popupLevel === level.id && S.isModalOpen('level')) openLevel(level.id);
}

// ------------------------------------------------------------------ shop
function shopVM(tab) {
  const st = app.state;
  const h = eco.heartsNow(st, Date.now());
  const src = (s) => (s.source === 'daily' ? 'Day 7 daily reward' : s.source.startsWith('achievement') ? 'Beat MIMIC in the Adventure' : 'Not sold');
  return {
    tab: tab || undefined,
    selectedSkin: shopSel,
    previewLive: ensurePreview(),
    skins: SKINS.map((s) => ({
      id: s.id,
      name: s.name,
      desc: s.desc,
      rarity: s.rarity,
      rarityName: RARITY[s.rarity].name,
      rarityColor: RARITY[s.rarity].color,
      portrait: portraitURL('player', s, 112),
      price: s.price,
      sourceText: src(s),
      owned: eco.ownsSkin(st, s.id),
      equipped: st.inventory.equipped === s.id,
      canAfford: eco.canAfford(st, s.price),
    })),
    boosters: eco.SHOP.filter((e) => e.kind === 'booster').map((e) => ({ id: e.id, name: e.name, desc: e.desc, icon: e.booster, count: eco.boosterCount(st, e.booster), price: e.price, pack: e.count, canAfford: eco.canAfford(st, e.price) })),
    hearts: { n: h.n, max: eco.HEARTS_MAX, nextText: h.nextInMs ? countdown(h.nextInMs) : '', refillGems: eco.HEART_REFILL_GEMS, canRefill: st.wallet.gems >= eco.HEART_REFILL_GEMS },
    exchange: eco.SHOP.filter((e) => e.kind === 'coins').map((e) => ({ id: e.id, gems: e.price.gems, coins: e.coins, canAfford: eco.canAfford(st, e.price), label: e.name.replace(' of Coins', '') })),
  };
}

function ensurePreview() {
  if (preview) return true;
  if (previewFailed) return false;
  try {
    preview = new Preview(S.shopPreviewCanvas(), { pedestal: false, feet: 0.17 });
  } catch (err) {
    console.warn('shop preview unavailable', err);
    previewFailed = true;
  }
  return !!preview;
}

function showPreview(id) {
  if (ensurePreview()) preview.show(createPlayer(SKIN_BY_ID[id]));
}

const shopCb = {
  onSelectSkin: (id) => {
    shopSel = id;
    showPreview(id);
  },
  onBuy: async (id) => {
    const e = eco.SHOP_BY_ID[id];
    if (!e || repeatBuy(id)) return;
    // Gems are scarce and a trade cannot be undone: always ask.
    if (e.price && e.price.gems) {
      const gems = app.state.wallet.gems;
      const trade = e.kind === 'coins';
      const ok = await S.confirmDialog({
        title: trade ? 'Trade gems for coins?' : `Buy ${e.name}?`,
        text: trade ? `${e.price.gems} gems for ${S.fmt(e.coins)} coins. You have ${gems} gems.` : `It costs ${e.price.gems} gems. You have ${gems}.`,
        ok: trade ? 'TRADE' : 'BUY',
      });
      if (!ok) return;
    }
    const r = commit((st) => eco.buy(st, id, Date.now()));
    if (!r.ok) {
      sfx.error();
      S.toast(eco.REASONS[r.reason] || 'You cannot buy that yet.', { kind: 'bad' });
      return;
    }
    sfx.buy();
    updateTopBar();
    if (e.kind === 'skin') S.toast(`${e.name} is yours! Tap EQUIP to wear it.`, { kind: 'good' });
    else if (e.kind === 'booster') S.toast(`+${e.count} ${eco.BOOSTERS[e.booster].name}`, { kind: 'good' });
    else if (e.kind === 'coins') S.toast(`+${e.coins} coins`, { kind: 'good' });
    else S.toast('Hearts refilled!', { kind: 'good' });
    renderShopNow();
  },
  onEquip: (id) => {
    if (!commit((st) => eco.equipSkin(st, id))) return;
    sfx.pop();
    app.stage.setSkin(SKIN_BY_ID[id]);
    S.toast(`Now wearing ${SKIN_BY_ID[id].name}.`, { kind: 'good' });
    renderShopNow();
  },
  onRefill: async () => {
    if (repeatBuy('hearts')) return;
    const ok = await S.confirmDialog({ title: 'Refill your hearts?', text: `All ${eco.HEARTS_MAX} hearts now for ${eco.HEART_REFILL_GEMS} gems. You have ${app.state.wallet.gems} gems.`, ok: 'REFILL' });
    if (!ok) return;
    const r = commit((st) => eco.refillHearts(st, Date.now()));
    if (!r.ok) {
      sfx.error();
      S.toast(eco.REASONS[r.reason], { kind: 'bad' });
      return;
    }
    sfx.buy();
    updateTopBar();
    S.toast('Hearts refilled!', { kind: 'good' });
    renderShopNow();
  },
  onBack: () => (back.shop === 'map' ? showMap() : showTitle()),
};

function renderShopNow(tab = null) {
  S.renderShop(shopVM(tab), shopCb);
}

export function showShop(tab = null, from = null) {
  if (from && S.currentScreen() !== 'screen-shop') back.shop = from;
  S.closeAllModals();
  popupLevel = null;
  if (!shopSel) shopSel = app.state.inventory.equipped;
  renderShopNow(tab);
  S.showScreen('shop');
  updateTopBar();
  showPreview(shopSel);
}

// ------------------------------------------------------------------ daily reward
export function showDailyReward() {
  const st = app.state;
  const ds = eco.dailyStatus(st, Date.now());
  S.renderDailyReward(
    {
      day: ds.day,
      canClaim: ds.canClaim,
      rewards: ds.rewards.map((r) => ({ day: r.day, label: shortReward(r), kind: rewardKind(r), icon: r.booster || null, claimed: r.status === 'claimed', today: r.status === 'today' })),
      nextText: longWait(ds.nextInMs),
    },
    {
      onClaim: () => {
        const got = commit((st) => eco.claimDaily(st, Date.now()));
        if (!got) return;
        sfx.buy();
        updateTopBar();
        S.toast(got.skin ? `Day ${got.day}: the ${SKIN_BY_ID[got.skin].name} skin! Equip it in the shop.` : `Day ${got.day}: ${got.label}!`, { kind: 'good', dur: 2800 });
        showDailyReward();
        refreshTitle();
      },
      onClose: refreshTitle,
    },
  );
}

// ------------------------------------------------------------------ achievements
export function showAchievements(from = null) {
  if (from) back.achievements = from;
  S.renderAchievements(
    {
      list: eco.achievementStatus(app.state).map((a) => ({ id: a.id, name: a.name, desc: a.desc, icon: a.icon, cur: a.cur, target: a.target, done: a.done, claimed: a.claimed, reward: { label: a.label, kind: rewardKind(a.reward) } })),
    },
    {
      onClaim: (id) => {
        const got = commit((st) => eco.claimAchievement(st, id));
        if (!got) return;
        sfx.buy();
        updateTopBar();
        S.toast(got.skin ? `The ${SKIN_BY_ID[got.skin].name} skin is yours! Equip it in the shop.` : `+${got.label}`, { kind: 'good' });
        showAchievements();
      },
      onBack: showTitle,
    },
  );
  S.showScreen('achievements');
  updateTopBar();
}

// ------------------------------------------------------------------ codex and tells
function codexVM() {
  const st = app.state;
  return {
    items: ITEMS.map((it) => {
      const c = st.codex[it.id];
      return { id: it.id, name: it.name, tier: it.tier, got: !!(c && c.count), count: (c && c.count) || 0, flavor: it.flavor };
    }),
    tells: HABIT_IDS.map((id) => {
      const e = st.dex[id] || { status: 'locked' };
      const h = HABITS[id];
      const statusText = e.status === 'broken' ? `BROKEN · ${e.brokenDate}. It can come back.` : e.status === 'detected' ? `ACTIVE · read ${pct(e.acc)} vs ${pct(e.chance)} chance${e.relapsed ? ' · RELAPSED' : ''}` : '';
      return { glyph: h.glyph, name: h.name, blurb: h.blurb, status: e.status, statusText };
    }),
    meta: { matches: st.stats.matches, wins: st.stats.wins, snatched: st.stats.snatched, outread: st.stats.outread, notebook: app.model.memorySize },
  };
}

export function showCodex(from = null) {
  if (from) back.codex = from;
  S.renderCodex(codexVM(), {
    onBack: () => (back.codex === 'results' && lastResult && play.active() ? S.showScreen('results') : showTitle()),
    onForget: async () => {
      const ok = await S.confirmDialog({
        title: 'Make them forget you?',
        text: 'The rivals lose their notebook about you, your Tells are cleared and the Quick Race ladder starts again. Coins, skins, levels and your Codex are kept.',
        ok: 'FORGET ME',
        danger: true,
      });
      if (!ok) return;
      commit((st) => {
        st.model = null;
        st.dex = {};
        st.ladder = { unlocked: 0, beaten: {} };
        st.stats = { matches: 0, wins: 0, snatched: 0, outread: 0, history: [] };
      });
      app.model = new PlayerModel();
      S.toast('Forgotten. The rivals have no idea who you are.', { kind: 'good' });
      showCodex();
    },
  });
  S.showScreen('codex');
}

// ------------------------------------------------------------------ settings
function settingsVM() {
  const s = app.state.settings;
  const e = app.engine;
  return {
    quality: s.quality,
    sound: s.sound,
    music: s.music,
    sensitivity: s.sensitivity,
    invertY: s.invertY,
    autoReturn: s.autoReturn,
    glass: s.glass,
    info: `OUTCRAFT 3D · ${e.level} graphics${s.quality === 'auto' ? ' (auto)' : ''}`,
  };
}

const SETTING = {
  quality: (v) => v,
  sound: (v) => !!v,
  music: (v) => !!v,
  sensitivity: (v) => clamp(+v || 1, 0.3, 2),
  invertY: (v) => !!v,
  autoReturn: (v) => !!v,
  glass: (v) => !!v,
};

function onSetting(key, value) {
  if (!SETTING[key]) return;
  const v = SETTING[key](value);
  commit((st) => (st.settings[key] = v));
  switch (key) {
    case 'quality':
      app.engine.setQuality(v);
      app.redraw = true;
      break;
    case 'sound':
      setSound(v);
      break;
    case 'music':
      setMusic(v);
      break;
    case 'sensitivity':
      app.input.setOptions({ sensitivity: v });
      break;
    case 'invertY':
      app.input.setOptions({ invertY: v });
      break;
    case 'autoReturn': {
      const p = play.current();
      if (p) p.match.options.autoReturn = v;
      break;
    }
  }
}

export function showSettings(from = null) {
  if (from) back.settings = from;
  if (from === 'pause') S.closeModal('pause');
  S.renderSettings(settingsVM(), {
    onChange: onSetting,
    // A match in progress (settings opened from the pause menu) ends first, unrecorded: its result must
    // not land in the fresh save.
    onReset: async () => {
      const ok = await S.confirmDialog({
        title: 'Reset all progress?',
        text: `Your coins, gems, skins, stars, levels and everything the rivals know about you will be erased.${play.active() ? ' The match you are playing ends too.' : ''} This cannot be undone.`,
        ok: 'RESET',
        danger: true,
      });
      if (!ok) return;
      const st = app.state;
      app.state = store.wipe({ settings: st.settings, seenHowTo: true, tutorialDone: !!st.tutorialDone, seenHowTo3d: true, tutorial3d: !!st.tutorial3d });
      app.model = new PlayerModel();
      commit(() => null);
      shopSel = null;
      lastHearts = -1;
      app.stage.setSkin(equippedSkin());
      if (play.active()) play.leave();
      else attract.start();
      updateTopBar();
      S.toast('Progress reset. A fresh start!', { kind: 'good' });
      showSettings();
    },
    onHow: () => showHow(null, 'settings'),
    onAbout: () => showAbout('settings'),
    onBack: () => {
      if (back.settings === 'pause' && app.mode === 'paused' && play.current()) {
        S.showScreen(null);
        showPause(play.current());
      } else showTitle();
    },
  });
  S.showScreen('settings');
}

// ------------------------------------------------------------------ how to play, about
export function showHow(then = null, from = null) {
  howThen = then;
  if (from) back.how = from;
  S.renderHow({ okText: then ? "LET'S GO!" : 'GOT IT' }, {
    onOk: () => {
      commit((st) => (st.seenHowTo3d = true));
      const t = howThen;
      howThen = null;
      if (t === 'daily') launch(() => play.startDaily());
      else if (t === 'quick') showRivals();
      else if (back.how === 'settings') showSettings();
      else showTitle();
    },
  });
  S.showScreen('how');
}

export function showAbout(from = null) {
  if (from) back.about = from;
  S.renderAbout({ completed: ABOUT.completed, author: ABOUT.author, docsHref: REPO_URL }, { onBack: () => (back.about === 'settings' ? showSettings() : showTitle()) });
  S.showScreen('about');
}

// ------------------------------------------------------------------ quick race ladder
export function showRivals() {
  const st = app.state;
  S.renderRivals(
    {
      rivals: RIVALS.map((r, i) => ({ ...rivalVM(r), blurb: r.blurb, locked: i > st.ladder.unlocked, beaten: !!st.ladder.beaten[r.id], next: i === st.ladder.unlocked })),
      selected: st.ladder.unlocked,
    },
    { onRace: (i) => launch(() => play.startQuick(i)), onBack: showTitle },
  );
  S.showScreen('rivals');
}

// ------------------------------------------------------------------ pause
export function showPause(P) {
  if (!P) return;
  const title = P.kind === 'level' ? `Level ${P.level.id} · ${P.level.name}` : P.kind === 'daily' ? `Daily Commission #${P.daily.number}` : `Quick Race vs ${P.rivalDef.name}`;
  S.renderPause(
    { title, glass: !!app.state.settings.glass, canRestart: true, quitText: 'QUIT' },
    {
      onResume: () => play.resume(),
      onRestart: () => play.restart(),
      onSettings: () => showSettings('pause'),
      onQuit: () => play.quit(),
      onGlass: (on) => commit((st) => (st.settings.glass = !!on)),
    },
  );
}

export function closePause() {
  S.closeModal('pause');
  S.closeModal('confirm');
  if (S.currentScreen()) S.showScreen(null);
}

// ------------------------------------------------------------------ results
export function showMatchResult(r) {
  lastResult = r;
  if (r.kind === 'level') showLevelResult(r);
  else showQuickResult(r);
}

function failReason(level, summary, rival) {
  const s = summary.stars;
  if (summary.winner !== 'player') return summary.timeUp ? `Time ran out at ${s.player}–${s.rival}. Ties go to the rival.` : `${rival.name} won ${s.rival}–${s.player}.`;
  const g = level.goal;
  if (g.type === 'win-time') return 'You won, but only after the clock ran out.';
  if (g.type === 'flawless') return `You won, but lost ${s.rival} order${s.rival === 1 ? '' : 's'}. This level needs a flawless win.`;
  if (g.type === 'craft') return `You won, but you did not craft the ${ITEM_BY_ID[g.item].name} yourself.`;
  return `${rival.name} won.`;
}

function failTip(level, summary, rival) {
  const st = summary.stats;
  if (level.goal.type === 'craft' && summary.winner === 'player') return `The ${ITEM_BY_ID[level.goal.item].name} is order ${level.options.starsToWin}. Save your speed for it.`;
  if (st.snatched >= 2) return `When ${rival.name}'s line turns red, it is heading for your target. Switch to another one.`;
  if (summary.timeUp) return 'Fill your bag before heading to the Workshop: fewer trips, faster orders.';
  if (st.gathers && st.trips && st.gathers / st.trips < 2) return 'Carry more per trip: fill your bag before heading home.';
  return 'Take resources the rival is not heading for, and use HOME to run straight to the Workshop.';
}

function showLevelResult(r) {
  const { summary, level, grant, rival, rec } = r;
  const st = app.state;
  const h = eco.heartsNow(st, Date.now());
  // Practice, unlocks, a boss's booster, Codex unlocks, new or broken Tells and goals ready to claim.
  const notes = [];
  if (r.practice) notes.push('Practice (blind rival, ?blind=1): no rewards');
  if (grant.booster) notes.push(`Boss reward: +1 ${eco.BOOSTERS[grant.booster].name}`);
  if (grant.unlocked) {
    const nl = levelById(grant.unlocked);
    notes.push(nl && nl.index === 0 ? `New world unlocked: ${WORLDS[nl.world].name}!` : `Level ${grant.unlocked} unlocked`);
  }
  const fresh = rec.newItems.filter((id) => summary.crafted.includes(id)).map((id) => ITEM_BY_ID[id].name);
  if (fresh.length) notes.push(`New in your Codex: ${fresh.join(', ')}`);
  for (const e of rec.events) notes.push(`${e.type === 'broken' ? 'Tell broken' : e.type === 'relapsed' ? 'Tell relapsed' : 'New Tell'}: ${HABITS[e.id].name}`);
  const ready = eco.claimableAchievements(st);
  if (ready) notes.push(`${ready} goal${ready > 1 ? 's' : ''} ready to claim`);
  S.renderLevelResult(
    {
      passed: grant.passed,
      id: level.id,
      name: level.name,
      stars: grant.stars,
      score: summary.score,
      best: grant.best,
      newBest: grant.passed && r.prev.best > 0 && summary.score > r.prev.best,
      firstClear: grant.firstClear,
      coins: grant.coins,
      gems: grant.gems,
      hasNext: grant.passed && level.id < LEVELS.length,
      rival: rivalVM(rival),
      playerPortrait: playerPortrait(96),
      matchStars: summary.stars,
      quote: grant.passed ? rival.lose : rival.win,
      reason: grant.passed ? null : failReason(level, summary, rival),
      goalMissed: !grant.passed && summary.winner === 'player' ? failReason(level, summary, rival) : null,
      replayCapped: !!grant.replayCapped,
      tip: grant.passed ? null : failTip(level, summary, rival),
      heartLost: !grant.passed,
      hearts: h.n,
      heartsText: h.nextInMs ? countdown(h.nextInMs) : '',
      notebook: notebookVM(summary, rival, r.model),
      notes,
    },
    {
      onNext: () => launch(() => afterLevel(level.id + 1)),
      onReplay: () => launch(() => afterLevel(level.id)),
      onRetry: () => launch(() => afterLevel(level.id)),
      onMap: () => afterLevel(null),
    },
  );
}

function afterLevel(openId) {
  S.closeModal('result');
  play.leave();
  showMap(openId && openId <= app.state.adventure.unlocked ? openId : null);
}

// Coins of a Quick Race / Daily win against today's paid-win allowance (so the cap is never silent).
function coinLine(c) {
  if (!c) return null;
  if (c.practice) return 'Practice (blind rival, ?blind=1): no rewards';
  if (c.coins) return `+${c.coins} coins (${c.paidToday}/${c.cap} paid wins today)`;
  if (c.capped) return `Daily coin limit reached (${c.cap} paid wins): back tomorrow`;
  return null;
}

function showQuickResult(r) {
  const { summary, rec, rival, daily } = r;
  const st = app.state;
  const win = rec.win;
  const s = summary.stats;
  const top = daily ? null : app.model.dossier(1)[0];
  const dailyText = daily ? (rec.dailyInfo ? `Daily #${daily.number} complete · streak ${rec.dailyInfo.streak} · new commission tomorrow` : `Practice run · only your first attempt at Daily #${daily.number} counts`) : null;
  S.renderResults(
    {
      win,
      rival: rivalVM(rival),
      stars: summary.stars,
      playerColor: equippedSkin().colors.body,
      playerPortrait: playerPortrait(96),
      items: summary.results.map((x) => ({ id: x.item, name: ITEM_BY_ID[x.item].name, won: x.winner === 'player', isNew: x.winner === 'player' && rec.newItems.includes(x.item) })),
      stats: { snatched: s.snatched, outread: s.outread, fooled: s.fooled, seconds: summary.seconds },
      tip: win ? null : s.snatched >= 2 ? `when ${rival.name}'s line turns red, switch targets.` : 'fill your bag before heading home.',
      unlocked: rec.unlocked ? { name: rec.unlocked.name, color: rec.unlocked.color, title: rec.unlocked.title } : null,
      tells: tellsVM(rec.events),
      notebook: notebookVM(summary, rival, r.model),
      quote: {
        text: win ? rival.lose : rival.win,
        sub: top ? `What the rivals wrote down: ${top.text}` : daily ? "Today's rival started with no notes on you." : 'No clear habit yet. They are still watching.',
      },
      daily: [dailyText, coinLine(r.coins)].filter(Boolean).join(' · ') || null,
      coins: r.coins ? r.coins.coins : 0,
      canNext: !daily && r.rivalIndex < st.ladder.unlocked,
      isDaily: !!daily,
    },
    {
      onAgain: () => launch(() => (daily ? play.startDaily() : play.startQuick(r.rivalIndex))),
      onNext: () => launch(() => play.startQuick(Math.min(r.rivalIndex + 1, app.state.ladder.unlocked))),
      onShare: share,
      onCodex: () => showCodex('results'),
      onMenu: () => {
        play.leave();
        showTitle();
      },
    },
  );
  S.showScreen('results');
}

async function share() {
  if (!lastResult) return;
  const url = location.href.split('?')[0].split('#')[0];
  const text = store.shareText({ summary: lastResult.summary, daily: lastResult.daily, rivalName: lastResult.rival.name, url });
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ text });
      return;
    }
    await navigator.clipboard.writeText(text);
    S.toast('Result copied. Paste it anywhere.', { kind: 'good' });
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    try {
      await navigator.clipboard.writeText(text);
      S.toast('Result copied. Paste it anywhere.', { kind: 'good' });
    } catch {
      S.toast('Could not share from this browser.', { kind: 'bad' });
    }
  }
}

// ------------------------------------------------------------------ keyboard on menus
// Escape / P resume from pause; Escape closes the top modal or goes back; Enter presses the main button.
// (During the race the Input module handles the keys and marks them handled.)
const PRIMARY = ['play', 'resume', 'claim', 'next', 'retry', 'again', 'race', 'ok'].map((a) => `[data-act="${a}"]`).join(',');

export function onKey(e) {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (app.mode === 'play' || app.mode === 'boot') return;
  const k = e.key;
  if (k === 'Escape' || k === 'p' || k === 'P') {
    if (app.mode === 'paused' && S.topModal() === 'modal-pause') {
      e.preventDefault();
      play.resume();
      return;
    }
    if (k !== 'Escape') return;
    e.preventDefault();
    const top = S.topModal();
    if (top) {
      const b = document.getElementById(top).querySelector('[data-act="close"],[data-act="cancel"]');
      if (b) b.click();
      return;
    }
    const scr = S.currentScreen();
    const b = scr && document.getElementById(scr).querySelector('[data-act="back"]');
    if (b) b.click();
    return;
  }
  if (k === 'Enter') {
    const a = document.activeElement;
    if (a && a !== document.body && /^(BUTTON|A|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(a.tagName)) return;
    const top = S.topModal();
    const host = top ? document.getElementById(top) : S.currentScreen() && document.getElementById(S.currentScreen());
    const b = host && host.querySelector(PRIMARY);
    if (b && !b.disabled) {
      e.preventDefault();
      b.click();
    }
  }
}
