// UNREADABLE — game controller: timing, input, feedback, screens and the day-1 loop.

import { Oracle, TELLS, EXPERT_IDS } from './oracle.js';
import { Run } from './run.js';
import { ORACLES, oracleForLevel } from './levels.js';
import { Renderer, COLORS } from './render.js';
import { sfx, unlockAudio, setSound } from './audio.js';
import * as store from './storage.js';
import { mulberry32 } from './rng.js';

// Set after publishing so the "Design doc" link and share text point at the right places.
const REPO_URL = '../../';
const DOC_URL = `${REPO_URL}`;
const HIT_STOP_MS = 420; // pause after a READ so the explanation can land
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

const $ = (id) => document.getElementById(id);
const SCREENS = ['screen-title', 'screen-how', 'screen-results', 'screen-tells', 'screen-pause'];

let state = store.load();
setSound(state.settings.sound);
let oracle = new Oracle(state.oracle);
const R = new Renderer($('game'));

let mode = 'menu'; // menu | play | transition | over | paused
let run = null;
let runOracle = null;
let dailyCtx = null;
let beat = null;
let lane = 1;
let hitStopUntil = 0;
let caption = null;
let speech = null;
let note = null;
let eyeState = { spawn: 1, cracks: 0 };
let transition = null;
let overStart = 0;
let pauseStart = 0;
let hurt = 0;
let readsInRow = 0;
let firstRun = false;
let tips = {};
let lastSummary = null;
let clockOffset = 0; // lets automated playtests step time while the tab is hidden
const clock = () => performance.now() + clockOffset;
let lastTime = clock();
const saidOnce = new Set();

// ---------------------------------------------------------------- helpers
const roman = (lvl) => ROMAN[lvl] || '∞';
const pct = (x) => `${Math.round(x * 100)}%`;

function showScreen(id) {
  for (const s of SCREENS) $(s).hidden = s !== id;
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 1800);
}

function mkCaption(text, color, dur, opts = {}) {
  caption = { text, color, start: clock(), dur, ...opts };
}
function say(text, dur = 2600) {
  speech = { text, start: clock(), dur };
}
function sayOnce(key, text, dur) {
  if (saidOnce.has(key)) return;
  saidOnce.add(key);
  say(text, dur);
}
function setNote(text, color = COLORS.text, dur = 2200, bold = false) {
  note = { text, color, start: clock(), dur, bold };
}
function fadeAlpha(o, now) {
  if (!o) return 0;
  const t = (now - o.start) / o.dur;
  if (t >= 1) return 0;
  return Math.min(1, t * 8, (1 - t) * 4);
}

// ---------------------------------------------------------------- runs
function startRun({ daily = false } = {}) {
  unlockAudio();
  let modifier = null;
  let shardRng = null;
  dailyCtx = null;
  if (daily) {
    const d = store.todaysDaily();
    dailyCtx = { ...d, ranked: !state.daily.results[d.key] };
    modifier = d.modifier;
    shardRng = mulberry32(d.seed);
  }
  // Amnesia day: a blank Oracle for this run only; the real memory is untouched.
  runOracle = modifier?.fresh ? new Oracle() : oracle;
  firstRun = state.stats.runs === 0;
  run = new Run({ oracle: runOracle, mode: daily ? 'daily' : 'gauntlet', modifier, shardRng, calibration: firstRun ? 6 : 3 });
  lane = 1;
  R.playerX = null;
  R.barShown = 50;
  beat = null;
  hitStopUntil = clock() + 700;
  eyeState = { spawn: 0, cracks: 0 };
  transition = null;
  readsInRow = 0;
  tips = {};
  saidOnce.clear();
  mode = 'play';
  showScreen(null);
  sfx.intro();
  if (daily) {
    mkCaption(`DAILY #${dailyCtx.number}`, COLORS.shard, 1500, { size: 34, sub: `${modifier.name}: ${modifier.desc}` });
  } else {
    mkCaption('CALIBRATING', COLORS.dim, 1300, { size: 30 });
  }
  if (firstRun) setNote("I'm only watching for now. Tap a lane (or A S D). Grab the gold shards.", COLORS.text, 5200, true);
  else say(runOracle.memorySize > 0 ? `Remembering you... ${runOracle.memorySize} moves on file.` : 'Watching...', 2400);
}

function startBeat(now) {
  const b = run.beginBeat();
  beat = {
    ...b,
    start: now,
    progress: 0,
    confidence: b.decision ? b.decision.confidence : 0,
    double: !!(b.decision && b.decision.strike.length > 1),
    shardTaken: false,
  };
  sfx.tick(!b.calibration);
  if (beat.double) sayOnce('double', 'Two pupils. I am sure enough to strike twice.', 2400);
  else if (!b.calibration && beat.confidence > 0.72 && !speech && Math.random() < 0.35) {
    say(['I see you.', 'I know this one.', 'Go on then.', 'Obvious.'][Math.floor(Math.random() * 4)], 1400);
  }
}

function lockBeat(now) {
  const res = run.resolveBeat(lane);
  const lv = oracleForLevel(res.beat.level);
  const px = R.laneCenter(lane);
  const py = R.L.rowY;
  const barX = R.L.colX + 26 + ((R.L.colW - 52) * run.bar) / 100;

  if (res.outcome === 'calib') {
    if (res.shard) {
      sfx.shard();
      R.burst(px, py, COLORS.shard, 18, 260);
      R.floater('+25', px, py - 30, COLORS.shard, 15);
      beat.shardTaken = true;
    }
    if (run.calibLeft === 0) {
      mkCaption('NOW I STRIKE', lv.color, 1200, { pop: true, size: 34 });
      say(lv.intro, 3000);
      sfx.intro();
      if (firstRun) setNote('Be where it does NOT strike. It learns from every move you make.', COLORS.text, 3600, true);
    }
  } else {
    for (const l of res.strike) R.beam(l, lv.color, l === lane && res.outcome === 'read');
    if (res.outcome === 'read') {
      sfx.read();
      R.doShake(12);
      R.doFlash(COLORS.read, 0.6);
      R.burst(px, py, COLORS.read, 26, 340);
      R.floater(`${Math.round(res.barDelta)}`, barX, R.L.barY - 4, COLORS.read, 14, 0.8, 18);
      hurt = 0.35;
      hitStopUntil = now + HIT_STOP_MS;
      readsInRow++;
      mkCaption('READ', COLORS.read, 700, { pop: true });
      const ex = res.explanation;
      const prefix = firstRun && !tips.read ? 'It predicted you. ' : '';
      tips.read = true;
      setNote(prefix + (ex ? ex.text : ''), ex && ex.lucky ? COLORS.dim : '#ffb3c0', 2600);
      if (readsInRow === 3) say('Predictable.', 1600);
      else if (readsInRow === 5) say("You're on autopilot.", 1800);
    } else {
      readsInRow = 0;
      sfx.dodge(res.streak);
      R.burst(px, py, COLORS.glow, 10, 200, 0.4);
      R.floater(`+${Math.round(res.barDelta)}`, barX, R.L.barY - 4, COLORS.dodge, 14, 0.8, 18);
      if (res.shard) {
        sfx.shard();
        R.burst(px, py, COLORS.shard, 22, 300);
        R.floater(`SHARD ×${res.multiplier}`, px, py - 34, COLORS.shard, 15);
        beat.shardTaken = true;
      }
      if (firstRun && !tips.dodge && !note) {
        tips.dodge = true;
        setNote('Dodged. Every dodge pushes the Mind Bar toward CRACK ▶', COLORS.dodge, 2400);
      }
      if (res.streak === 6) say('Stop that.', 1400);
      else if (res.streak === 10) say('Who taught you this?', 1800);
      else if (res.streak === 15) say('...', 1400);
    }
  }

  eyeState.cracks = Math.max(0, (run.bar - 60) / 40);
  beat = null;
  if (res.cracked) startCrack(now, res);
  else if (res.solved) startOver(now, lv);
}

function startCrack(now, res) {
  mode = 'transition';
  const old = oracleForLevel(res.beat.level);
  transition = { phase: 'crack', start: now, oldLevel: res.beat.level };
  eyeState = { cracks: 1, dead: true, deadT: 1 };
  sfx.crack();
  R.doFlash('#ffffff', 0.8);
  R.doShake(16);
  R.burst(R.W / 2, R.L.eyeY, old.color, 70, 560, 1.2);
  R.burst(R.W / 2, R.L.eyeY, '#ffffff', 30, 420, 0.9);
  mkCaption('CRACKED', COLORS.dodge, 1600, { pop: true, sub: `${old.name}: “${old.cracked}”` });
}

function updateTransition(now) {
  const t = now - transition.start;
  if (transition.phase === 'crack') {
    eyeState.deadT = 1 - t / 900;
    if (t > 1700) {
      transition = { phase: 'intro', start: now };
      eyeState = { spawn: 0, cracks: 0 };
      const o = oracleForLevel(run.level);
      sfx.intro();
      mkCaption(`${roman(run.level)} · ${o.name}`, o.color, 1800, { size: 36 });
      say(o.intro, 3400);
    }
  } else {
    eyeState.spawn = t / 700;
    if (t > 1800) {
      transition = null;
      mode = 'play';
      hitStopUntil = now + 200;
    }
  }
}

function startOver(now, lv) {
  mode = 'over';
  overStart = now;
  sfx.over();
  R.doFlash(COLORS.read, 0.9);
  R.doShake(20);
  mkCaption('SOLVED', lv.color, 1800, { pop: true, sub: `${lv.name} read you.` });
}

function finishRun() {
  const summary = run.summary();
  runOracle.endRun();
  if (runOracle === oracle) state.oracle = oracle.toJSON();
  const rec = store.recordRun(state, summary, { daily: dailyCtx && dailyCtx.ranked ? dailyCtx : null });
  store.save(state);
  lastSummary = { summary, rec, daily: dailyCtx };
  mode = 'menu';
  run = null;
  renderResults(lastSummary);
  showScreen('screen-results');
}

function pause() {
  if (mode !== 'play') return;
  mode = 'paused';
  pauseStart = clock();
  showScreen('screen-pause');
}

function resume() {
  if (mode !== 'paused') return;
  const d = clock() - pauseStart;
  if (beat) beat.start += d;
  hitStopUntil += d;
  mode = 'play';
  showScreen(null);
}

function quitRun() {
  // Quitting still teaches the Oracle, but the run does not count toward stats or the daily.
  if (runOracle === oracle) {
    runOracle.endRun();
    state.oracle = oracle.toJSON();
    store.save(state);
  }
  run = null;
  mode = 'menu';
  renderTitle();
  showScreen('screen-title');
}

// ---------------------------------------------------------------- frame loop
function tick() {
  const now = clock();
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  hurt = Math.max(0, hurt - dt);

  if (mode === 'play') {
    if (eyeState.spawn != null && eyeState.spawn < 1) eyeState.spawn = Math.min(1, eyeState.spawn + dt * 1.6);
    if (!beat && now >= hitStopUntil) startBeat(now);
    if (beat) {
      beat.progress = (now - beat.start) / beat.duration;
      if (beat.progress >= 1) lockBeat(now);
    }
  } else if (mode === 'transition') {
    updateTransition(now);
  } else if (mode === 'over' && now - overStart > 1700) {
    finishRun();
  }

  if (caption && now - caption.start > caption.dur) caption = null;
  if (speech && now - speech.start > speech.dur) speech = null;
  if (note && now - note.start > note.dur) note = null;

  R.draw(buildView(now), dt);
}

function frame() {
  tick();
  requestAnimationFrame(frame);
}

function buildView(now) {
  const inRun = !!run && mode !== 'menu';
  let lvl;
  if (inRun) lvl = transition && transition.phase === 'crack' ? transition.oldLevel : run.level;
  else lvl = Math.min(state.stats.bestLevel, ORACLES.length - 1);
  const o = oracleForLevel(lvl);
  const view = {
    now,
    playing: inRun,
    oracle: { name: o.name, color: o.color, level: lvl },
    bar: inRun ? (transition && transition.phase === 'crack' ? 100 : run.bar) : 50,
    lane,
    beat: inRun && beat ? beat : null,
    score: inRun ? run.score : 0,
    streak: inRun ? run.streak : 0,
    multiplier: inRun && run.streak ? 1 + Math.min(4, Math.floor(run.streak / 4)) : 1,
    eyeState,
    hurt,
    mode: inRun ? run.mode : null,
    speech: speech ? { text: speech.text, alpha: fadeAlpha(speech, now) } : null,
    note: note ? { text: note.text, color: note.color, bold: note.bold, alpha: fadeAlpha(note, now) } : null,
    caption: null,
  };
  if (caption) {
    const t = (now - caption.start) / caption.dur;
    view.caption = { ...caption, t, alpha: t < 0.75 ? 1 : (1 - t) / 0.25 };
  }
  return view;
}

// ---------------------------------------------------------------- screens
function renderTitle() {
  const runs = state.stats.runs;
  const box = $('dossier');
  if (runs > 0) {
    const greet = store.greetingFor(Date.now() - (state.lastPlayed || Date.now()), runs);
    const lines = oracle.dossier(2);
    const goal = store.nextTellToBreak(state);
    let html = `<div class="dz-head">THE ORACLE REMEMBERS YOU</div><p class="dz-greet">“${greet}”</p>`;
    html += lines.map((l) => `<p class="dz-line">“${l.text}”</p>`).join('');
    html += `<div class="dz-meta">Memory: <b>${oracle.memorySize}</b> of your moves`;
    if (goal) html += ` · Goal: break your <b>${goal.name}</b> tell`;
    else if (state.stats.bestLevel < ORACLES.length) html += ` · Deepest: <b>${ORACLES[Math.min(state.stats.bestLevel, 4)].name}</b>`;
    html += '</div>';
    box.innerHTML = html;
    box.hidden = false;
  } else {
    box.hidden = true;
  }
  document.querySelector('.tag').hidden = runs > 0;

  const d = store.todaysDaily();
  const done = state.daily.results[d.key];
  $('daily-num').textContent = `#${d.number}`;
  const streak = state.daily.streak && state.daily.lastKey ? state.daily.streak : 0;
  $('daily-sub').textContent = done
    ? `Done today · ${pct(done.readRate)} read · streak ${streak} · new Oracle tomorrow`
    : `${d.modifier.name}: ${d.modifier.desc}${streak ? ` · streak ${streak}` : ''}`;

  const c = store.dexCounts(state);
  $('tells-count').textContent = `${c.detected + c.broken}/${EXPERT_IDS.length}`;
  $('btn-sound').textContent = `Sound: ${state.settings.sound ? 'on' : 'off'}`;
  $('link-doc').href = DOC_URL;
}

function renderResults({ summary, rec, daily }) {
  const deep = summary.cracked >= ORACLES.length;
  $('res-title').textContent = deep ? 'UNREADABLE' : 'SOLVED';
  $('res-title').style.color = deep ? COLORS.dodge : oracleForLevel(summary.level).color;
  $('res-sub').textContent = deep
    ? `You cracked all five Oracles. ${summary.solvedBy} finally read you.`
    : `${summary.solvedBy} figured you out.`;
  $('res-score').textContent = summary.score.toLocaleString();
  $('res-best').hidden = !rec.newBest || state.stats.runs === 1;

  const pips = [];
  for (let i = 0; i < Math.max(ORACLES.length, summary.level + 1); i++) {
    const o = oracleForLevel(i);
    const cls = i < summary.cracked ? 'pip done' : i === summary.level ? 'pip fell' : 'pip';
    const style = i < summary.cracked ? `background:${o.color}` : i === summary.level ? `color:${o.color};border-color:${o.color}` : '';
    pips.push(`<span class="${cls}" style="${style}">${o.name}${i < summary.cracked ? ' ✓' : ''}</span>`);
  }
  $('res-pips').innerHTML = pips.join('');

  const rr = summary.readRate;
  const verdict = rr <= 0.36 ? 'Basically unreadable.' : rr <= 0.42 ? 'Hard to read.' : rr <= 0.5 ? 'Readable.' : 'An open book.';
  $('res-read').innerHTML = `The Oracle read you <b style="color:${rr > 0.42 ? COLORS.read : COLORS.dodge}">${pct(rr)}</b> of the time. Pure chance is 33%.<br><span class="fine">${verdict}</span>`;
  $('res-stats').innerHTML = `<span>best streak <b>${summary.bestStreak}</b></span><span>shards <b>${summary.shards}</b></span><span>beats <b>${summary.beats}</b></span>`;

  const verbose = rec.events.length <= 2;
  const ev = rec.events.map((e) => {
    const t = TELLS[e.id];
    if (e.type === 'broken') {
      return `<div class="tell-event broken"><span class="glyph">${t.glyph}</span><div><span class="tag2" style="color:${COLORS.dodge}">TELL BROKEN</span> <b>${t.name}</b>: down to ${pct(e.acc)}.${verbose ? " It can't read that anymore." : ''}</div></div>`;
    }
    const label = e.type === 'relapsed' ? 'RELAPSED' : 'NEW TELL';
    return `<div class="tell-event detected"><span class="glyph">${t.glyph}</span><div><span class="tag2" style="color:${COLORS.read}">${label}</span> <b>${t.name}</b>: read at ${pct(e.acc)}.${verbose ? ` ${t.blurb}` : ''}</div></div>`;
  });
  $('res-tells').innerHTML = ev.length ? ev.join('') : '<p class="fine" style="text-align:center">No new tells this run. The Oracle is still studying you.</p>';

  const top = (daily && daily.modifier.fresh ? null : oracle.dossier(1)[0]) || null;
  $('res-quote').innerHTML = top
    ? `“${top.text}”<small>I'll remember this. ${oracle.memorySize} of your moves on file.</small>`
    : `“Interesting. Come back and show me more.”<small>${daily && daily.modifier.fresh ? 'Amnesia day: this run was not remembered.' : 'I remember everything.'}</small>`;

  const dEl = $('res-daily');
  if (daily) {
    dEl.hidden = false;
    dEl.textContent = rec.dailyInfo
      ? `Daily #${daily.number} complete · streak ${rec.dailyInfo.streak} · a new Oracle arrives tomorrow`
      : `Practice run · your ranked Daily #${daily.number} is already in`;
  } else dEl.hidden = true;
  $('btn-share').textContent = daily ? 'SHARE DAILY' : 'SHARE';
}

function renderTells() {
  const grid = $('tells-grid');
  grid.innerHTML = EXPERT_IDS.map((id) => {
    const e = state.dex[id] || { status: 'locked' };
    const t = TELLS[id];
    if (e.status === 'locked') {
      return `<div class="tell-card locked"><div class="tc-head"><span class="tc-glyph">?</span><span class="tc-name">???</span></div>Not detected yet. Get read enough and the Oracle will name it.</div>`;
    }
    const status =
      e.status === 'broken'
        ? `BROKEN · ${e.brokenDate}. It can come back.`
        : `ACTIVE · read at ${pct(e.acc)}${e.relapsed ? ' · RELAPSED' : ''}. Break it: a run under 36%.`;
    return `<div class="tell-card ${e.status}"><div class="tc-head"><span class="tc-glyph">${t.glyph}</span><span class="tc-name">${t.name}</span></div>${t.blurb}<div class="tc-status">${status}</div></div>`;
  }).join('');

  const hist = state.stats.history.slice(-15);
  if (hist.length >= 2) {
    const W = 320;
    const H = 90;
    const y = (r) => H - 8 - ((Math.min(0.75, Math.max(0.2, r)) - 0.2) / 0.55) * (H - 16);
    const x = (i) => 10 + (i / (hist.length - 1)) * (W - 20);
    const pts = hist.map((h, i) => `${x(i).toFixed(1)},${y(h.readRate).toFixed(1)}`).join(' ');
    const dots = hist.map((h, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(h.readRate).toFixed(1)}" r="3" fill="${h.readRate > 0.42 ? COLORS.read : COLORS.dodge}"/>`).join('');
    $('trend').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${y(1 / 3)}" y2="${y(1 / 3)}" stroke="#46f0a0" stroke-dasharray="4 5" opacity=".5"/><text x="${W - 4}" y="${y(1 / 3) - 4}" fill="#46f0a0" font-size="10" text-anchor="end" opacity=".8">chance 33%</text><polyline points="${pts}" fill="none" stroke="#9d8cff" stroke-width="2"/>${dots}</svg><p class="fine">Read rate for your last ${hist.length} runs. Lower is better.</p>`;
  } else {
    $('trend').innerHTML = '<p class="fine">Play a couple of runs to see how readable you are over time.</p>';
  }
  const deepest = state.stats.runs ? oracleForLevel(state.stats.bestLevel).name : '—';
  $('tells-meta').innerHTML = `Runs <b>${state.stats.runs}</b> · Best <b>${state.stats.best.toLocaleString()}</b> · Deepest <b>${deepest}</b> · Memory <b>${oracle.memorySize}</b> moves.<br>Your data never leaves this device.`;
}

async function share() {
  if (!lastSummary) return;
  const url = location.href.split('#')[0];
  const text = store.shareText({ summary: lastSummary.summary, daily: lastSummary.daily, url });
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ text });
      return;
    }
    await navigator.clipboard.writeText(text);
    toast('Result copied. Paste it anywhere.');
  } catch {
    toast('Could not share. Long-press to copy instead.');
  }
}

// ---------------------------------------------------------------- input
function setLane(l) {
  if (mode !== 'play' || l === lane) return;
  lane = l;
  sfx.move();
}

window.addEventListener('keydown', (e) => {
  unlockAudio();
  const k = e.key.toLowerCase();
  if (mode === 'play') {
    if (k === 'a' || k === 'j' || k === '1') setLane(0);
    else if (k === 's' || k === 'k' || k === '2') setLane(1);
    else if (k === 'd' || k === 'l' || k === '3') setLane(2);
    else if (k === 'arrowleft') setLane(Math.max(0, lane - 1));
    else if (k === 'arrowright') setLane(Math.min(2, lane + 1));
    else if (k === 'p' || k === 'escape') pause();
    else return;
    e.preventDefault();
    return;
  }
  if (mode === 'paused' && (k === 'p' || k === 'escape' || k === 'enter' || k === ' ')) {
    resume();
    e.preventDefault();
    return;
  }
  if (k === 'enter' || k === ' ') {
    const visible = SCREENS.find((s) => !$(s).hidden);
    const primary = visible && $(visible).querySelector('.btn.primary');
    if (primary) {
      primary.click();
      e.preventDefault();
    }
  }
});

$('game').addEventListener('pointerdown', (e) => {
  unlockAudio();
  if (mode === 'play') {
    setLane(R.laneAt(e.clientX));
    e.preventDefault();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});
window.addEventListener('blur', () => pause());
window.addEventListener('resize', () => R.resize());

function click(id, fn) {
  $(id).addEventListener('click', (e) => {
    unlockAudio();
    sfx.ui();
    fn(e);
  });
}

click('btn-play', () => {
  if (!state.seenHowTo) {
    showScreen('screen-how');
    return;
  }
  startRun();
});
click('btn-how', () => showScreen('screen-how'));
click('btn-how-ok', () => {
  const first = !state.seenHowTo;
  state.seenHowTo = true;
  store.save(state);
  if (first) startRun();
  else showScreen('screen-title');
});
click('btn-daily', () => {
  if (!state.seenHowTo) {
    state.seenHowTo = true;
    store.save(state);
  }
  startRun({ daily: true });
});
click('btn-tells', () => {
  renderTells();
  showScreen('screen-tells');
});
click('btn-res-tells', () => {
  renderTells();
  showScreen('screen-tells');
});
click('btn-tells-back', () => {
  renderTitle();
  showScreen('screen-title');
});
click('btn-again', () => startRun({ daily: false }));
click('btn-menu', () => {
  renderTitle();
  showScreen('screen-title');
});
click('btn-share', share);
click('btn-resume', resume);
click('btn-quit', quitRun);
click('btn-sound', () => {
  state.settings.sound = !state.settings.sound;
  setSound(state.settings.sound);
  store.save(state);
  renderTitle();
});
click('btn-forget', () => {
  if (!confirm('Wipe the Oracle\'s memory of you, your tells, stats and streak? This cannot be undone.')) return;
  const sound = state.settings.sound;
  state = store.wipe();
  state.settings.sound = sound;
  state.seenHowTo = true;
  store.save(state);
  oracle = new Oracle();
  renderTells();
  toast('Forgotten. The Oracle has no idea who you are.');
});

// ---------------------------------------------------------------- boot
renderTitle();
showScreen('screen-title');
requestAnimationFrame(frame);

// Debug hook for automated playtests (harmless in production).
window.__unreadable = {
  get state() {
    return state;
  },
  get mode() {
    return mode;
  },
  get run() {
    return run;
  },
  setLane,
  advance(ms, step = 16) {
    for (let t = 0; t < ms; t += step) {
      clockOffset += step;
      tick();
    }
  },
};
