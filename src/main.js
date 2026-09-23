// OUTCRAFT — game controller: loop, input, feedback, screens and the day-1 systems.

import { Match } from './match.js';
import { PlayerModel, HABITS, HABIT_IDS } from './model.js';
import { RIVALS, ITEMS, ITEM_BY_ID, RES, COMPONENTS } from './data.js';
import { Renderer, PAL } from './render.js';
import { iconURL } from './icons.js';
import { sfx, unlockAudio, setSound, startMusic, setIntensity, buzz, suspendAudio } from './audio.js';
import { idx } from './world.js';
import { daysBetween } from './rng.js';
import * as store from './storage.js';

// Filled in after publishing, so the in-game "Design doc" link points at the repo.
const REPO_URL = 'https://github.com/bmanoj07112004-eng/OUTCRAFT';
// Filled in at publish time for the About screen.
const ABOUT = { author: 'B Manoj', completed: '23 Sep 2026 · first public build' };
const STEP = 1 / 60;
const params = new URLSearchParams(location.search);
const BLIND = params.get('blind') === '1'; // ablation: the rival's prediction switched off

const $ = (id) => document.getElementById(id);
const SCREENS = ['screen-title', 'screen-rivals', 'screen-how', 'screen-results', 'screen-codex', 'screen-pause', 'screen-about'];

let state = store.load();
if (params.get('glass') === '1') state.settings.glass = true;
setSound(state.settings.sound);
let model = new PlayerModel(state.model);
const R = new Renderer($('game'));

let mode = 'menu'; // menu | play | paused | over
let match = null;
let matchModel = null;
let rivalIndex = 0;
let rivalDef = RIVALS[0];
let dailyCtx = null;
let menuMatch = null;
let acc = 0;
let toast = null;
let caption = null;
let tutorial = false;
let tips = {};
let lastResult = null;
let selectedRival = 0;
let overAt = 0;
let vs = null;
let howThenPlay = false;
let bubbles = {};
let emotes = {};
let idleSince = 0;
let clockOffset = 0;
const clock = () => performance.now() + clockOffset;
let lastTime = clock();

// ------------------------------------------------------------------ helpers
function showScreen(id) {
  for (const s of SCREENS) $(s).hidden = s !== id;
  $('btn-pause').hidden = !(mode === 'play' && !id);
}
function domToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(domToast._t);
  domToast._t = setTimeout(() => (t.hidden = true), 1900);
}
function say(text, color = null, dur = 2600) {
  toast = { text, color, start: clock(), dur };
}
function cap(text, color, dur = 1100, opts = {}) {
  caption = { text, color, start: clock(), dur, pop: true, ...opts };
}
const pct = (x) => `${Math.round(x * 100)}%`;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function quip(kind, dur = 1700) {
  const q = rivalDef.quips && rivalDef.quips[kind];
  if (q) bubbles.rival = { text: pick(q), start: clock(), dur };
}
function emote(who, type, dur = 1800) {
  emotes[who] = { type, start: clock(), dur };
}
function audioOn() {
  unlockAudio();
  startMusic();
}

// Attract mode: on the title screen the island plays itself (a simple bot vs the real rival AI).
function attractBot(m) {
  const p = m.player;
  const need = m.needRemaining('player');
  const total = Object.values(need).reduce((a, b) => a + b, 0);
  if (p.bag.length >= m.bagSize || (p.bag.length && !total)) return { x: 4, y: m.world.hubY };
  const here = idx(p.x, p.y);
  const c = m.world.nodes
    .filter((n) => need[n.type] && !n.reserved && n.readyAt - m.time < 1.5)
    .sort((a, b) => m.world.nodeField[a.id][here] - m.world.nodeField[b.id][here]);
  if (!c.length) return p.bag.length ? { x: 4, y: m.world.hubY } : null;
  return Math.random() < 0.6 || c.length === 1 ? c[0] : c[1];
}
function stepMenu(dt) {
  if (!menuMatch) return;
  const m = menuMatch;
  if (m.phase === 'race' && m.player.state === 'idle' && !m.player.dest) {
    const g = attractBot(m);
    if (g) m.command(g.x, g.y);
  }
  m.step(Math.min(dt, 0.05));
  m.drainEvents();
  if (m.phase === 'end') makeMenuIsland();
}

const portraitCache = new Map();
function portrait(color, look, size = 84) {
  const key = `${color}|${look}|${size}`;
  if (portraitCache.has(key)) return portraitCache.get(key);
  const c = document.createElement('canvas');
  c.width = size * 2;
  c.height = size * 2;
  const g = c.getContext('2d');
  g.scale(2, 2);
  const saved = R.g;
  R.g = g;
  try {
    R.drawAvatar(size / 2, size * 0.56, size * 0.3, color, look, -1, 0);
  } finally {
    R.g = saved;
  }
  const url = c.toDataURL();
  portraitCache.set(key, url);
  return url;
}

function makeMenuIsland() {
  const seed = Math.floor(Math.random() * 1e9);
  menuMatch = new Match({ seed, rival: RIVALS[Math.min(state.ladder.unlocked, 4)], model: new PlayerModel() });
}

// ------------------------------------------------------------------ match lifecycle
function startMatch({ daily = false, index = null } = {}) {
  audioOn();
  dailyCtx = null;
  let seed = Math.floor(Math.random() * 1e9);
  let twist = null;
  if (daily) {
    const d = store.todaysDaily();
    dailyCtx = { ...d, ranked: !state.daily.results[d.key] };
    seed = d.seed;
    twist = d.twist;
    rivalIndex = d.rivalIndex;
  } else rivalIndex = index ?? Math.min(state.ladder.unlocked, RIVALS.length - 1);
  rivalDef = RIVALS[rivalIndex];
  if (BLIND) rivalDef = { ...rivalDef, experts: [], heading: 0, steal: 0, deny: 0 };
  // The Daily rival never uses your saved memory, so everyone's daily result is comparable.
  matchModel = daily ? new PlayerModel() : model;
  match = new Match({ seed, rival: rivalDef, model: matchModel, twist });
  tutorial = !state.tutorialDone && !daily;
  bubbles = {};
  emotes = {};
  idleSince = clock();
  const mem = matchModel.memorySize;
  vs = {
    start: clock(),
    dur: 2300,
    rival: rivalDef,
    sub: daily ? `DAILY #${dailyCtx.number} · ${twist.name.toUpperCase()} · it has never seen you play` : mem > 0 ? `${mem} of your moves in its notebook` : 'It has never seen you play. Yet.',
  };
  setIntensity(1);
  tips = {};
  acc = 0;
  toast = null;
  caption = null;
  mode = 'play';
  showScreen(null);
  R.staticKey = null;
  if (daily) say(`Daily #${dailyCtx.number}: ${twist.name}. ${twist.desc}`, null, 3600);
}

function finishMatch() {
  const summary = match.summary();
  summary.blind = BLIND;
  if (matchModel === model) state.model = model.toJSON();
  if (!dailyCtx) state.tutorialDone = true;
  const rec = store.recordMatch(state, summary, { rivalIndex: dailyCtx ? null : rivalIndex, daily: dailyCtx && dailyCtx.ranked ? dailyCtx : null });
  store.save(state);
  lastResult = { summary, rec, daily: dailyCtx, rival: rivalDef, rivalIndex, model: matchModel };
  mode = 'over';
  suspendAudio(false);
  setIntensity(0);
  rec.win ? sfx.win() : sfx.lose();
  if (rec.win) {
    const cols = ['#ffc83d', '#3d7bff', '#ff6f9f', '#2fbf71', '#ffffff'];
    for (let i = 0; i < 6; i++) setTimeout(() => R.burst(R.W * (0.15 + 0.14 * i), R.H * 0.12, cols[i % cols.length], 26, 360, 1.6, 4.5), i * 110);
  }
  renderResults(lastResult);
  showScreen('screen-results');
}

function quitMatch() {
  if (match && (match.phase === 'end' || Math.max(match.stars.player, match.stars.rival) >= 3)) {
    let guard = 0;
    while (match.phase !== 'end' && guard++ < 2000) match.step(STEP);
    match.drainEvents();
    overAt = 0;
    mode = 'play';
    return finishMatch();
  }
  if (matchModel === model) {
    model.endMatch();
    state.model = model.toJSON();
    store.save(state);
  }
  match = null;
  mode = 'menu';
  setIntensity(0);
  renderTitle();
  showScreen('screen-title');
}

function pause() {
  if (mode !== 'play') return;
  mode = 'paused';
  suspendAudio(true);
  $('chk-glass').checked = !!state.settings.glass;
  showScreen('screen-pause');
}
function resume() {
  if (mode !== 'paused') return;
  mode = 'play';
  suspendAudio(false);
  lastTime = clock();
  showScreen(null);
}

// ------------------------------------------------------------------ events -> feedback
function handleEvents() {
  for (const e of match.drainEvents()) {
    const T = R.L.T;
    if (e.type === 'order') {
      sfx.order();
    } else if (e.type === 'go') {
      sfx.go();
      cap('GO!', '#ffffff', 700, { size: 56 });
      if (e.index > 0 && Math.random() < 0.5) quip(match.stars.rival > match.stars.player ? 'winOrder' : 'loseOrder', 1400);
      if (tutorial && e.index === 0) say('Tap a resource with a gold ring to gather it. Your bag holds 3.', null, 4200);
      if (tutorial && e.index === 1) say(`That dotted line is ${rivalDef.name}'s route. The spinning ring is what it wants next.`, null, 4200);
    } else if (e.type === 'gather') {
      const c = R.tileCenter(e.node.x, e.node.y);
      R.burst(c.x, c.y - T * 0.1, RES[e.res].color, 12, 170, 0.5, 3.5);
      R.pulse(`node${e.node.id}`);
      if (e.who === 'player') {
        sfx.gather(e.res);
        buzz(12);
        idleSince = clock();
        const i = match.player.bag.length - 1;
        const to = R.bagSlotPos(i);
        R.fly('res', e.res, { x: c.x, y: c.y - T * 0.2 }, to, { size: 30, onDone: () => R.pulse(`bag${i}`) });
        if (tutorial && !tips.gather) {
          tips.gather = true;
          say('Nice! Gather what the card needs, then tap the Workshop to craft.', null, 3600);
        }
      } else sfx.rivalGather();
    } else if (e.type === 'deposit' && e.who === 'player') {
      sfx.deposit();
      idleSince = clock();
      R.pulse('workshop');
      const from = R.tileCenter(match.player.fx, match.player.fy);
      e.items.forEach((r, i) => {
        const tgt = R.cardSlots?.find((s) => !s.center) || { x: R.L.card.x + 150, y: R.L.card.y + 50 };
        R.fly('res', r, from, { x: tgt.x + i * 10, y: tgt.y }, { size: 24, delay: i * 0.08, dur: 0.5 });
      });
    } else if (e.type === 'craft') {
      const wx = R.tileCenter(e.who === 'player' ? 3 : 5, match.world.hubY);
      setTimeout(() => R.pop('comp', e.part, wx.x, wx.y - R.L.T * 0.9, { size: e.who === 'player' ? 28 : 22 }), e.who === 'player' ? 450 : 0);
      if (e.who === 'player') {
        setTimeout(() => {
          sfx.craft();
          R.pulse(`part${e.index}`);
          R.pulse('card');
          const s = R.cardSlots?.find((k) => k.center && k.part === e.index);
          if (s) {
            R.burst(s.x, s.y, PAL.good, 14, 150, 0.5, 3);
            R.floater(`+${COMPONENTS[e.part].name}`, s.x, s.y - 10, PAL.good, 14);
          }
        }, 450);
        if (tutorial && !tips.craft) {
          tips.craft = true;
          setTimeout(() => say('Parts craft themselves once their materials arrive.', null, 3000), 600);
        }
      }
    } else if (e.type === 'complete') {
      const wc = R.tileCenter(4, match.world.hubY);
      const who = e.who;
      const starI = e.stars[who] - 1;
      R.pop('item', e.item.id, wc.x, wc.y - R.L.T * 0.8, { size: 44, life: 1.3 });
      R.fly('item', e.item.id, { x: wc.x, y: wc.y - R.L.T * 1.8 }, R.starPos(who, starI), { delay: 0.9, size: 30, dur: 0.6 });
      emote(who, 'hop', 2200);
      emote(who === 'player' ? 'rival' : 'player', 'sad', 2200);
      quip(who === 'player' ? 'loseOrder' : 'winOrder', 2000);
      if (e.who === 'player') {
        buzz([20, 40, 60]);
        setTimeout(() => {
          sfx.complete();
          cap('CRAFTED!', PAL.gold, 1600, { sub: `${e.item.name} delivered. +1 star`, size: 50 });
          R.burst(R.W / 2, R.H * 0.45, PAL.gold, 40, 320, 1, 5);
          R.burst(R.W / 2, R.H * 0.45, '#ffffff', 20, 260, 0.8, 4);
          R.pulse(`star-YOU-${e.stars.player - 1}`);
        }, 500);
      } else {
        sfx.rivalComplete();
        R.doShake(8);
        cap(`${rivalDef.name} GOT IT`, rivalDef.color, 1600, { sub: `${e.item.name} goes to your rival`, size: 40 });
        R.pulse(`star-${rivalDef.name}-${e.stars.rival - 1}`);
      }
    } else if (e.type === 'snatch') {
      const c = R.tileCenter(e.node.x, e.node.y);
      sfx.snatch();
      buzz([40, 50, 40]);
      quip('snatch');
      R.doShake(5);
      R.floater('SNATCHED!', c.x, c.y - T * 0.6, PAL.bad, 24, 1.4);
      R.burst(c.x, c.y - T * 0.1, PAL.bad, 14, 170, 0.5, 3.5);
      say(`${e.text.text} Tap another one!`, 'rgba(200,40,70,0.94)', 4600);
      state.tips = state.tips || {};
      if (!tutorial && !state.tips.glass && rivalIndex > 0) {
        state.tips.glass = true;
        store.save(state);
        setTimeout(() => say("Curious how it reads you? Pause (II) and switch on 'Show the rival's thoughts'.", null, 4500), 4000);
      }
      if (!tips.snatch && !tips.line && tutorial) {
        tips.snatch = true;
        setTimeout(() => say('Watch its dotted line. When it turns red, it is going for YOUR target. Change course!', null, 4200), 3900);
      }
    } else if (e.type === 'outread') {
      const c = R.tileCenter(e.node.x, e.node.y);
      sfx.outread();
      buzz(20);
      quip('beaten', 1400);
      R.floater('BEAT IT!', c.x, c.y - T * 0.6, PAL.gold, 24, 1.4);
      R.burst(c.x, c.y - T * 0.2, PAL.gold, 18, 200, 0.6, 3.5);
      R.pulse(`node${e.node.id}`);
      say(`You beat ${rivalDef.name} to it. It was heading there too.`, 'rgba(30,150,90,0.94)', 2600);
    } else if (e.type === 'fooled') {
      const c = R.tileCenter(e.node.x, e.node.y);
      sfx.outread();
      buzz([15, 30, 15]);
      quip('fooled', 1600);
      cap('FAKED OUT!', PAL.good, 1000, { size: 36, y: R.H * 0.3 });
      R.burst(c.x, c.y - R.L.T * 0.3, PAL.good, 16, 200, 0.6, 3.5);
      say(`${rivalDef.name} bet ${pct(e.p)} you'd take that ${RES[e.node.type].name}. You went elsewhere.`, 'rgba(30,150,90,0.94)', 3000);
    } else if (e.type === 'bagFull') {
      say('Bag full! Drop it at the Workshop first.', null, 2200);
    } else if (e.type === 'matchEnd') {
      overAt = clock() + 1000;
      if (e.winner === 'player') cap('YOU WIN!', PAL.gold, 1500, { size: 50, sub: `You out-crafted ${rivalDef.name}` });
      else cap(`${rivalDef.name} WINS`, rivalDef.color, 1500, { size: 44, sub: 'It read you this time' });
    }
  }
}

// ------------------------------------------------------------------ loop
function hintText() {
  if (!match || match.phase !== 'race') return '';
  const p = match.player;
  if (p.bag.length >= match.bagSize) return 'Bag full: head to the Workshop';
  const need = match.needRemaining('player');
  const parts = Object.entries(need).map(([r, n]) => `${RES[r].name}${n > 1 ? ` ×${n}` : ''}`);
  if (!parts.length) return p.bag.length ? 'All gathered: take it to the Workshop!' : '';
  return `Still need: ${parts.join(', ')}`;
}

// First match only: a bouncing hand shows exactly what to tap next.
function tutorialPointer(now) {
  if (!tutorial || !match || match.phase !== 'race' || vs) return null;
  const p = match.player;
  const need = match.needRemaining('player');
  const total = Object.values(need).reduce((a, b) => a + b, 0);
  if (match.stats.trips === 0 && p.bag.length && (p.bag.length >= match.bagSize || !total) && !(p.dest && p.dest.kind === 'hub')) {
    const hb = R.homeButton();
    return { x: hb.x + hb.w / 2, y: hb.y + 8, label: 'CRAFT' };
  }
  const stuck = match.orderIndex === 0 && now - idleSince > 4500 && p.state === 'idle';
  if ((match.stats.gathers === 0 || stuck) && total && p.state !== 'walk' && p.state !== 'gather') {
    const here = idx(p.x, p.y);
    const n = match.world.nodes
      .filter((k) => need[k.type] && match.nodeReady(k))
      .sort((a, b) => match.world.nodeField[a.id][here] - match.world.nodeField[b.id][here])[0];
    if (n) {
      const c = R.tileCenter(n.x, n.y);
      return { x: c.x, y: c.y - R.L.T * 0.2, label: 'TAP' };
    }
  }
  return null;
}

function tick() {
  // Re-layout whenever the window size changed, even if no resize event arrived (hidden tabs, webviews).
  if (R.W !== window.innerWidth || R.H !== window.innerHeight) R.resize();
  const now = clock();
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (vs && now - vs.start > vs.dur) vs = null;
  if (mode === 'menu') stepMenu(dt);
  if (mode === 'play' && match && !vs) {
    acc += dt;
    while (acc >= STEP) {
      match.step(STEP);
      acc -= STEP;
      handleEvents();
    }
    if (match.phase === 'end' && overAt && now >= overAt) {
      overAt = 0;
      finishMatch();
    }
  }
  if (tutorial && match && mode === 'play' && !tips.line && match.phase === 'race') {
    const r = match.rival.dest;
    const p = match.player.dest;
    if (r && p && r.kind === 'node' && p.kind === 'node' && r.id === p.id && R.rivalFirst) {
      tips.line = true;
      say(`Red line! ${rivalDef.name} will get there first. Tap a different one!`, 'rgba(200,40,70,0.94)', 4200);
    }
  }
  if (caption && now - caption.start > caption.dur) caption = null;
  if (toast && now - toast.start > toast.dur) toast = null;
  for (const k of Object.keys(bubbles)) if (now - bubbles[k].start > bubbles[k].dur) delete bubbles[k];
  for (const k of Object.keys(emotes)) if (now - emotes[k].start > emotes[k].dur) delete emotes[k];
  const inMatch = match && (mode === 'play' || mode === 'paused' || mode === 'over');
  R.draw(
    {
      match: inMatch ? match : menuMatch,
      menu: !inMatch,
      now,
      rivalDef: inMatch ? rivalDef : RIVALS[Math.min(state.ladder.unlocked, 4)],
      glass: !!state.settings.glass,
      hint: inMatch ? hintText() : '',
      toast: inMatch ? toast : null,
      caption: inMatch ? caption : null,
      vs: inMatch && vs ? { ...vs, t: (now - vs.start) / vs.dur } : null,
      bubbles: inMatch ? bubbles : {},
      emotes: inMatch ? emotes : {},
      pointer: inMatch ? tutorialPointer(now) : null,
    },
    dt,
  );
}
function frame() {
  requestAnimationFrame(frame);
  try {
    tick();
  } catch (err) {
    console.error(err);
  }
}

// ------------------------------------------------------------------ screens
function renderTitle() {
  const box = $('dossier');
  const n = state.stats.matches;
  if (n > 0) {
    const lines = model.dossier(2);
    const greet = store.greetingFor(Date.now() - (state.lastPlayed || Date.now()), n);
    let html = `<div class="dz-head">YOUR RIVALS REMEMBER YOU</div><p class="dz-line">“${greet}”</p>`;
    html += lines.map((l) => `<p class="dz-line">“${l.text}”</p>`).join('');
    if (!lines.length) html += '<p class="dz-line">“No clear habits yet. We are still watching.”</p>';
    html += `<div class="dz-meta">Notebook: <b>${model.memorySize}</b> of your choices · Next rival: <b>${RIVALS[state.ladder.unlocked].name}</b></div>`;
    box.innerHTML = html;
    box.hidden = false;
  } else box.hidden = true;
  const r = RIVALS[state.ladder.unlocked];
  $('play-sub').textContent = `vs ${r.name} · ${r.title}`;
  const d = store.todaysDaily();
  const done = state.daily.results[d.key];
  $('daily-num').textContent = `#${d.number}`;
  const gap = state.daily.lastKey ? daysBetween(state.daily.lastKey, d.key) : 99;
  const streak = gap <= 1 ? state.daily.streak || 0 : 0;
  $('daily-sub').textContent = done
    ? `Done today (${done.stars.player}–${done.stars.rival}) · streak ${streak} · new commission tomorrow`
    : `${d.twist.name}: ${d.twist.desc}${streak ? ` · streak ${streak}` : ''}`;
  $('codex-count').textContent = `${store.codexCount(state)}/${ITEMS.length}`;
  $('btn-sound').textContent = `Sound: ${state.settings.sound ? 'on' : 'off'}`;
  $('link-doc').href = REPO_URL;
  $('link-doc').hidden = false;
}

function renderRivals() {
  const list = $('rival-list');
  list.innerHTML = RIVALS.map((r, i) => {
    const locked = i > state.ladder.unlocked;
    const beaten = state.ladder.beaten[r.id];
    const status = locked ? '🔒 LOCKED' : beaten ? '✓ BEATEN' : i === state.ladder.unlocked ? 'NEXT' : '';
    return `<div class="rival-card ${locked ? 'locked' : ''} ${i === selectedRival ? 'sel' : ''}" data-i="${i}">
      <img class="rival-img" alt="" src="${portrait(r.color, r.look)}">
      <div><div class="rival-name">${r.name}</div><div class="rival-title">${r.title}</div><div class="rival-blurb">${r.blurb}</div></div>
      <div class="rival-status">${status}</div></div>`;
  }).join('');
  list.querySelectorAll('.rival-card').forEach((el) =>
    el.addEventListener('click', () => {
      const i = +el.dataset.i;
      if (i > state.ladder.unlocked) return;
      sfx.ui();
      selectedRival = i;
      renderRivals();
    }),
  );
  $('btn-race').textContent = `RACE ${RIVALS[selectedRival].name}`;
}

// The AI, made visible: how often the rival's top guess was right, and which habits explain you best.
function renderNotebook(summary, rival, mdl) {
  const ps = summary.stats;
  const acc = ps.predN ? ps.predHits / ps.predN : 0;
  const ch = ps.predN ? ps.predChance / ps.predN : 0;
  const maxW = Math.max(...HABIT_IDS.map((id) => mdl.w[id]));
  const rows = HABIT_IDS.map((id) => {
    const used = rival.experts.includes(id);
    const w = Math.round((mdl.w[id] / maxW) * 100);
    return `<div class="nb-row ${used ? '' : 'off'}"><span class="nm">${HABITS[id].glyph} ${HABITS[id].name}</span><span class="bar"><i style="width:${w}%"></i></span><span class="tag3">${used ? '' : 'not used'}</span></div>`;
  }).join('');
  let line;
  if (!rival.experts.length) line = `${rival.name} was not predicting yet, only taking notes for the others.`;
  else if (ps.predN >= 3) line = `It guessed your next stop <b>${pct(acc)}</b> of the time. A blind guess would get ${pct(ch)}.`;
  else line = 'Not enough choices this match to judge its guesses.';
  $('res-notebook').innerHTML = `<div class="nb-head">WHAT ${rival.name} LEARNED ABOUT YOU</div><div class="nb-line">${line}</div>${rows}<div class="nb-foot">Bars: how much each habit explains your choices (the rival's model weights).</div>`;
}

function renderResults({ summary, rec, daily, rival, rivalIndex: ri, model: mdl }) {
  renderNotebook(summary, rival, mdl);
  const win = rec.win;
  $('res-title').innerHTML = win ? `YOU OUT-CRAFTED<br><span style="color:${rival.color}">${rival.name}</span>` : `<span style="color:${rival.color}">${rival.name}</span> OUT-CRAFTED YOU`;
  $('res-score').innerHTML = `<span style="color:${PAL.player}">${summary.stars.player}</span> – <span style="color:${rival.color}">${summary.stars.rival}</span>`;
  $('res-items').innerHTML = summary.results
    .map((r) => {
      const it = ITEM_BY_ID[r.item];
      const isNew = rec.newItems.includes(r.item) && r.winner === 'player';
      return `<div class="res-item ${r.winner === 'player' ? 'won' : 'lost'}"><img alt="" src="${iconURL('item', r.item, 96)}">${it.name}${isNew ? '<span class="new">NEW</span>' : ''}</div>`;
    })
    .join('');
  const s = summary.stats;
  $('res-stats').innerHTML = `<span><b>${s.snatched}</b> snatched from you</span><span><b>${s.outread}</b> times you got there first</span><span><b>${s.fooled}</b> fake-outs</span><span><b>${Math.round(summary.seconds)}</b>s</span>`;
  if (!rec.win) $('res-stats').innerHTML += `<div class="tip">Tip: ${s.snatched >= 2 ? `when ${rival.name}'s line turns red, switch targets.` : 'fill your bag (3) before heading home.'}</div>`;
  const un = $('res-unlock');
  if (rec.unlocked) {
    un.hidden = false;
    un.innerHTML = `New rival unlocked: <b style="color:${rec.unlocked.color}">${rec.unlocked.name}</b>, ${rec.unlocked.title}`;
  } else un.hidden = true;
  const ev = rec.events.map((e) => {
    const h = HABITS[e.id];
    if (e.type === 'broken') return `<div class="tell-event broken"><span class="g">${h.glyph}</span><div><span class="tag2" style="color:#1f9a58">TELL BROKEN</span> <b>${h.name}</b>: they can't read it anymore.</div></div>`;
    return `<div class="tell-event detected"><span class="g">${h.glyph}</span><div><span class="tag2" style="color:#d9384f">${e.type === 'relapsed' ? 'RELAPSED' : 'NEW TELL'}</span> <b>${h.name}</b>: ${h.blurb} Read ${pct(e.acc)} vs ${pct(e.chance)} by chance.</div></div>`;
  });
  $('res-tells').innerHTML = ev.join('');
  const top = daily ? null : model.dossier(1)[0];
  const line = win ? rival.lose : rival.win;
  $('res-quote').innerHTML = `<img class="q-img" alt="" src="${portrait(rival.color, rival.look, 64)}">“${line}”<small>${top ? `What the rivals wrote down: ${top.text}` : daily ? "Today's rival started with no notes on you." : 'No clear habit yet. They are still watching.'}</small>`;
  const dEl = $('res-daily');
  if (daily) {
    dEl.hidden = false;
    dEl.textContent = rec.dailyInfo ? `Daily #${daily.number} complete · streak ${rec.dailyInfo.streak} · new commission tomorrow` : `Practice run · only your first attempt at Daily #${daily.number} counts`;
  } else dEl.hidden = true;
  const canNext = !daily && ri < state.ladder.unlocked;
  $('btn-next').hidden = !canNext;
  $('btn-again').textContent = daily ? 'PLAY AGAIN' : 'REMATCH';
  $('btn-share').textContent = daily ? 'SHARE DAILY' : 'SHARE';
}

function renderCodex() {
  $('codex-grid').innerHTML = ITEMS.map((it) => {
    const c = state.codex[it.id];
    const got = c && c.count;
    const tier = '★'.repeat(it.tier);
    return `<div class="codex-item ${got ? '' : 'locked'}" title="${got ? it.flavor : 'Win an order for this item to add it'}"><img alt="" src="${iconURL('item', it.id, 96, !got)}"><div>${got ? it.name : '???'}</div><div class="tier">${tier}</div><div class="cnt">${got ? `crafted ×${c.count}` : 'not yet'}</div></div>`;
  }).join('');
  $('tells-grid').innerHTML = HABIT_IDS.map((id) => {
    const e = state.dex[id] || { status: 'locked' };
    const h = HABITS[id];
    if (e.status === 'locked') return `<div class="tell-card"><b>??? </b><br>Not detected yet.</div>`;
    const st = e.status === 'broken' ? `BROKEN · ${e.brokenDate}. It can come back.` : `ACTIVE · read ${pct(e.acc)} vs ${pct(e.chance)} chance${e.relapsed ? ' · RELAPSED' : ''}`;
    return `<div class="tell-card ${e.status}"><b>${h.glyph} ${h.name}</b><br>${h.blurb}<div class="st">${st}</div></div>`;
  }).join('');
  const st = state.stats;
  $('codex-meta').innerHTML = `Matches <b>${st.matches}</b> · Wins <b>${st.wins}</b> · Snatched from you <b>${st.snatched}</b> · You beat them to <b>${st.outread}</b>.<br>Notebook: <b>${model.memorySize}</b> choices. Stored only on this device.`;
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
    domToast('Result copied. Paste it anywhere.');
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    try {
      await navigator.clipboard.writeText(text);
      domToast('Result copied. Paste it anywhere.');
    } catch {
      domToast('Could not share from this browser.');
    }
  }
}

// ------------------------------------------------------------------ input
$('game').addEventListener('pointerdown', (e) => {
  audioOn();
  if (vs && mode === 'play') {
    vs.dur = Math.min(vs.dur, clock() - vs.start + 250);
    return;
  }
  if (mode !== 'play' || !match || match.phase !== 'race') return;
  const hb = R.homeButton();
  let dest = null;
  if (e.clientX >= hb.x && e.clientX <= hb.x + hb.w && e.clientY >= hb.y && e.clientY <= hb.y + hb.h) dest = match.command(4, match.world.hubY);
  else {
    const t = R.pick(match.world, e.clientX, e.clientY);
    if (t) dest = match.command(t.x, t.y);
  }
  if (dest) {
    sfx.tap();
    const p = dest.kind === 'node' ? match.world.nodes[dest.id] : dest.kind === 'hub' ? { x: 4, y: match.world.hubY } : dest;
    const c = R.tileCenter(p.x, p.y);
    R.ripple(c.x, c.y + R.L.T * 0.3, PAL.player);
  }
  e.preventDefault();
});

const DIRS = { arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1], arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0] };
window.addEventListener('keydown', (e) => {
  audioOn();
  const k = e.key.toLowerCase();
  if (mode === 'play' && match && match.phase === 'race') {
    if (DIRS[k]) {
      const p = match.player;
      match.command((p.to ? p.to.x : p.x) + DIRS[k][0], (p.to ? p.to.y : p.y) + DIRS[k][1]);
      e.preventDefault();
    } else if (k === ' ' || k === 'h' || k === 'e') {
      match.command(4, match.world.hubY);
      e.preventDefault();
    } else if (k === 'p' || k === 'escape') pause();
    return;
  }
  if (mode === 'paused' && (k === 'p' || k === 'escape')) return resume();
  if (k === 'enter') {
    const vis = SCREENS.find((s) => !$(s).hidden);
    const b = vis && $(vis).querySelector('.btn.primary');
    if (b) b.click();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pause();
    suspendAudio(true);
  } else if (mode !== 'paused') suspendAudio(false);
});
window.addEventListener('resize', () => R.resize());

function click(id, fn) {
  $(id).addEventListener('click', (e) => {
    audioOn();
    sfx.ui();
    fn(e);
  });
}
click('btn-play', () => {
  if (!state.seenHowTo) {
    howThenPlay = 'play';
    return showScreen('screen-how');
  }
  if (!state.tutorialDone && state.stats.matches === 0) return startMatch({ index: 0 });
  selectedRival = state.ladder.unlocked;
  renderRivals();
  showScreen('screen-rivals');
});
click('btn-race', () => startMatch({ index: selectedRival }));
click('btn-rivals-back', () => showScreen('screen-title'));
click('btn-how', () => showScreen('screen-how'));
click('btn-how-ok', () => {
  state.seenHowTo = true;
  store.save(state);
  const next = howThenPlay;
  howThenPlay = false;
  if (next === 'play') startMatch({ index: 0 });
  else if (next === 'daily') startMatch({ daily: true });
  else showScreen('screen-title');
});
click('btn-daily', () => {
  if (!state.seenHowTo) {
    howThenPlay = 'daily';
    return showScreen('screen-how');
  }
  startMatch({ daily: true });
});
click('btn-codex', () => {
  renderCodex();
  showScreen('screen-codex');
});
click('btn-res-codex', () => {
  renderCodex();
  showScreen('screen-codex');
});
click('btn-codex-back', () => {
  if (mode === 'over' && match) return showScreen('screen-results');
  renderTitle();
  showScreen('screen-title');
});
click('btn-again', () => (lastResult.daily ? startMatch({ daily: true }) : startMatch({ index: lastResult.rivalIndex })));
click('btn-next', () => startMatch({ index: Math.min(lastResult.rivalIndex + 1, state.ladder.unlocked) }));
click('btn-menu', () => {
  match = null;
  mode = 'menu';
  makeMenuIsland();
  renderTitle();
  showScreen('screen-title');
});
click('btn-share', share);
click('btn-about', () => {
  if (ABOUT.completed) $('about-done').textContent = ABOUT.completed;
  if (ABOUT.author) $('about-author').textContent = ABOUT.author;
  $('about-doc').href = REPO_URL === 'https://github.com/' ? 'README.md' : REPO_URL;
  showScreen('screen-about');
});
click('btn-about-back', () => showScreen('screen-title'));
click('btn-pause', pause);
click('btn-resume', resume);
click('btn-quit', quitMatch);
$('chk-glass').addEventListener('change', (e) => {
  state.settings.glass = e.target.checked;
  store.save(state);
});
click('btn-sound', () => {
  state.settings.sound = !state.settings.sound;
  setSound(state.settings.sound);
  store.save(state);
  renderTitle();
});
click('btn-forget', () => {
  if (!confirm('Erase what the rivals know about you, plus your Codex, Tells, ladder and streak? This cannot be undone.')) return;
  state = store.wipe({ settings: state.settings, seenHowTo: true });
  store.save(state);
  model = new PlayerModel();
  renderCodex();
  domToast('Forgotten. The rivals have no idea who you are.');
});

// ------------------------------------------------------------------ boot
makeMenuIsland();
renderTitle();
showScreen('screen-title');
requestAnimationFrame(frame);

// Hooks for automated playtests (harmless in production).
window.__outcraft = {
  get match() {
    return match;
  },
  get mode() {
    return mode;
  },
  get state() {
    return state;
  },
  advance(ms, step = 16) {
    for (let t = 0; t < ms; t += step) {
      clockOffset += step;
      tick();
    }
  },
};
