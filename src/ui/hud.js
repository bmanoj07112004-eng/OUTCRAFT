// In-match HUD of the 3D edition: plain HTML over the WebGL canvas (crisp text, cheap to update).
//
// The DOM is built once in the constructor. Call the set*/update* methods every frame with the current
// values: each one remembers what it last wrote and only touches the DOM when something changed.
// Floating labels projected from 3D (pills, speech bubbles, glass %) use an immediate-mode pool:
// beginLabels(), label(...) for each visible label, endLabels() hides the ones not refreshed.
// One-shot effects (score floaters, captions, flying icons) use the Web Animations API.
// Layout layer: the screen rects of the HUD panels are cached, and labels, floaters, the edge arrow and
// the toast slot are placed clear of them (isOverPanel() exposes the same test for taps).

import { RES, COMPONENTS, ITEM_BY_ID } from '../data.js';
import { svgIcon, artURL, ensureIcons, esc, fmt } from './screens.js';

const W_TILES = 9;
const H_TILES = 13;
const MM_COLORS = { wood: '#3fbf4f', stone: '#b8c0cc', ore: '#ff8a3d', sand: '#ffd86b', fiber: '#b6f06a', crystal: '#4fe3ff' };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TOAST_PRI = { low: 0, normal: 1, high: 2 };
const TOAST_STALE = [1500, 5000, 12000]; // a queued toast older than this (per priority) is dropped
const TAP_GUARD_MS = 400; // the VS splash ignores taps this long after it opens (double-click carry-over)
const POP_STACK_MS = 300;

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

// Two lines for a long caption: at ' · ' when there is one, otherwise at the space nearest the middle.
function splitCaption(t) {
  const dot = t.indexOf(' · ');
  if (dot > 0) return [t.slice(0, dot), t.slice(dot + 3)];
  let best = -1;
  for (let i = t.indexOf(' '); i > 0; i = t.indexOf(' ', i + 1)) if (best < 0 || Math.abs(i - t.length / 2) < Math.abs(best - t.length / 2)) best = i;
  return best > 0 ? [t.slice(0, best), t.slice(best + 1)] : null;
}

function avatarInner(p) {
  return p && p.portrait ? `<img alt="" src="${esc(p.portrait)}">` : `<i>${esc(((p && p.name) || '?').slice(0, 1))}</i>`;
}

export class HUD {
  /**
   * @param {HTMLElement} root   the #hud element from index.html
   * @param {object} [cb]
   * @param {() => void} [cb.onInteract]  Interact button
   * @param {() => void} [cb.onHome]      Home button
   * @param {() => void} [cb.onPause]     pause button
   * @param {() => void} [cb.onSkipVs]    the VS splash was tapped (the vs() promise resolves too)
   */
  constructor(root, cb = {}) {
    ensureIcons();
    this.root = root;
    this.cb = cb;
    this.last = {};
    this.cfg = { starsToWin: 3, thresholds: null, timeLimit: null, bagSize: 3, rival: { name: 'RIVAL', color: '#ff7b2e' }, player: { color: '#3d7bff' } };
    this.frame = 0;
    this.labActive = [];
    this.labByKey = new Map();
    this.labFree = [];
    this.popFree = [];
    this.flyFree = [];
    this.timers = new Set();
    this.anims = new Set();
    this.mm = { world: null, base: null, lastDraw: 0, colors: null };
    this.score = { target: 0, shown: 0, raf: 0 };
    this.vsState = null;
    this.vsAt = 0;
    this.bagLast = [];
    this.madeLast = [];
    this.ptrLast = { x: NaN, y: NaN, text: null, off: null, ang: NaN };
    this.edgeLast = { x: NaN, y: NaN, ang: NaN, color: null, icon: null };
    this.toastCur = null; // { text, kind, dur, pri, at, shownAt, min, leaving }
    this.toastQ = [];
    this.toastT = 0;
    this.popRecent = [];
    this.rectCache = null;
    this.rectAt = 0;
    this.chrome = true;
    this._tick = () => this._tickScore();
    this._build();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  // ---------------------------------------------------------------- DOM
  _build() {
    const r = this.root;
    r.classList.add('hud');
    r.innerHTML = '';
    const top = el('div', 'hud-top');
    this.you = el('div', 'hud-side hud-you', `<div class="hud-av-wrap"><span class="av hud-av"></span><b class="hud-tag">YOU</b></div><div class="hud-stars"></div>`);
    this.mid = el('div', 'hud-mid');
    this.card = el('div', 'order-card', `<div class="oc-head"><span class="oc-icon-wrap"><img class="oc-icon" alt=""></span><div class="oc-title"><small>ORDER <span class="oc-num"></span></small><b class="oc-name"></b></div></div><div class="oc-parts"></div>`);
    this.meter = el('div', 'hud-meter', `<div class="hm-bar"><i class="hm-fill"></i></div><b class="hm-score">0</b>`);
    this.hmFill = this.meter.querySelector('.hm-fill');
    this.hmScore = this.meter.querySelector('.hm-score');
    this.timer = el('div', 'hud-timer', `${svgIcon('clock', 'ht-ic')}<b>0:00</b>`);
    this.mid.append(this.card, this.meter, this.timer);
    this.riv = el('div', 'hud-side hud-riv', `<div class="hud-av-wrap"><span class="av hud-av"></span><b class="hud-tag"></b></div><div class="hud-stars"></div>`);
    top.append(this.you, this.mid, this.riv);

    this.pauseBtn = el('button', 'hud-btn hud-pause', svgIcon('pause'));
    this.pauseBtn.setAttribute('aria-label', 'Pause');
    this.mmCanvas = el('canvas', 'hud-minimap');
    this.mmCanvas.setAttribute('aria-hidden', 'true');
    this.mmWrap = el('div', 'hud-mm-wrap');
    this.mmWrap.append(this.mmCanvas);
    this.riv.append(this.mmWrap);
    this.you.append(this.pauseBtn);

    this.labels = el('div', 'hud-labels');
    this.cap = el('div', 'hud-caption', '<b class="cap-main"></b><span class="cap-sub"></span>');
    this.toastEl = el('div', 'hud-toast');
    this.bottom = el('div', 'hud-bottom', '<div class="hud-hint"></div><div class="hud-bag"></div>');
    this.hint = this.bottom.firstChild;
    this.bag = this.bottom.lastChild;
    this.actions = el('div', 'hud-actions');
    this.homeBtn = el('button', 'hud-btn hud-home', `${svgIcon('home', 'hb-ic')}<b>HOME</b>`);
    this.homeBtn.setAttribute('aria-label', 'Go to the Workshop');
    this.interBtn = el('button', 'hud-btn hud-interact off', `<span class="hi-art">${svgIcon('hand', 'hi-hand')}<img class="hi-res" alt="" hidden></span><b>GRAB</b>`);
    this.interBtn.setAttribute('aria-label', 'Interact');
    this.actions.append(this.homeBtn, this.interBtn);
    this.ptr = el('div', 'hud-pointer', `<span class="hp-hand">${svgIcon('hand', 'hp-ic')}</span><span class="hp-arrow">${svgIcon('back', 'hp-ic')}</span><b class="hp-lbl"></b>`);
    this.ptr.hidden = true;
    this.edge = el('div', 'hud-edge', `<span class="he-rot"><i class="he-tip"></i>${svgIcon('back', 'he-chev')}</span><span class="he-disc"></span>`);
    this.edge.hidden = true;
    this.vsEl = el('div', 'hud-vs');
    this.vsEl.hidden = true;
    // Labels sit under the panels: a label that still overlaps one is covered, never painted over it.
    r.append(this.labels, top, this.bottom, this.actions, this.edge, this.toastEl, this.cap, this.ptr, this.vsEl);
    this.cap.hidden = true;
    this.toastEl.hidden = true;

    // Panels take the pointer so a tap on them never reaches the 3D view (tap-to-target) behind.
    const block = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    for (const p of [this.card, this.meter, this.timer, this.mmWrap, this.bottom, ...this.root.querySelectorAll('.hud-av-wrap, .hud-stars')]) {
      p.classList.add('hud-panel');
      p.addEventListener('pointerdown', block);
    }
    // The order card expands (bigger icons, part names) while tapped; it closes by itself.
    this.card.addEventListener('pointerdown', () => this._toggleCard());

    const press = (btn, fn) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add('down');
        if (fn) fn();
      });
      const up = () => btn.classList.remove('down');
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointerleave', up);
      btn.addEventListener('pointercancel', up);
      // Keyboard activation only (pointer presses were handled on pointerdown).
      btn.addEventListener('click', (e) => e.detail === 0 && fn && fn());
    };
    press(this.pauseBtn, () => this.cb.onPause && this.cb.onPause());
    press(this.homeBtn, () => this.cb.onHome && this.cb.onHome());
    press(this.interBtn, () => this.cb.onInteract && this.cb.onInteract());
    this.vsEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      // The second click of a double-click on PLAY / REMATCH must not skip the splash it opened.
      if (performance.now() - this.vsAt < TAP_GUARD_MS) return;
      this.hideVs(true);
    });
  }

  // ---------------------------------------------------------------- lifecycle

  /** Show or hide the whole HUD. Hiding it also brings the controls back (see setChrome). */
  show(on = true) {
    this.root.hidden = !on;
    if (on) this.resize();
    else this.setChrome(true);
  }

  get visible() {
    return !this.root.hidden;
  }

  /**
   * Show or hide the controls: HOME, GRAB, the bag, the hint line and the resting joystick (e.g. during
   * the VS splash, the fly-in and the victory orbit). Stars, order card, meter and pause stay.
   * @param {boolean} on
   */
  setChrome(on = true) {
    on = !!on;
    if (on === this.chrome) return;
    this.chrome = on;
    this.root.classList.toggle('chrome-off', !on);
    document.body.classList.toggle('hud-chrome-off', !on);
    this.rectCache = null;
  }

  /** Clear transient things (labels, floaters, captions, toasts, pointer, edge arrow, flying icons). */
  reset() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const a of this.anims) a.cancel();
    this.anims.clear();
    this.beginLabels();
    this.endLabels();
    this.cap.hidden = true;
    this.cap.style.top = '';
    this.toastEl.hidden = true;
    this.toastCur = null;
    this.toastQ.length = 0;
    this.toastT = 0;
    this.popRecent.length = 0;
    this.pointer(null);
    this.edgeArrow(null);
    this._toggleCard(false);
    // A pending vs() promise resolves here; the overlay is removed at once (it takes pointer events).
    this.hideVs(false);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.vsEl.hidden = true;
    this.last = {};
    this.bagLast.length = 0;
    this.madeLast.length = 0;
    this.rectCache = null;
  }

  _later(ms, fn) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
    return t;
  }

  _anim(node, frames, opts, done) {
    if (!node.animate) {
      const fake = { cancel: () => clearTimeout(fake.t) };
      fake.t = this._later(opts.duration || 0, () => done && done(fake));
      return fake;
    }
    const a = node.animate(frames, opts);
    this.anims.add(a);
    // finish/cancel events arrive asynchronously; done(a) lets callers ignore a superseded animation.
    a.onfinish = a.oncancel = () => {
      this.anims.delete(a);
      if (done) done(a);
    };
    return a;
  }

  /**
   * Configure the HUD for a new match (call before the VS splash). Also calls reset().
   * @param {object} m
   * @param {{name: string, color: string, portrait?: string, title?: string}} m.rival
   * @param {{portrait?: string, color?: string}} [m.player]
   * @param {number} [m.starsToWin=3]
   * @param {number[]|null} [m.thresholds]  [0, twoStar, threeStar]: shows the score meter (Adventure);
   *                                         null hides it (Quick Race, Daily)
   * @param {number|null} [m.timeLimit]     seconds; null hides the timer
   * @param {number} [m.bagSize=3]
   */
  setup(m) {
    this.reset();
    this.cfg = {
      starsToWin: m.starsToWin || 3,
      thresholds: m.thresholds || null,
      timeLimit: m.timeLimit || null,
      bagSize: m.bagSize || 3,
      rival: m.rival || this.cfg.rival,
      player: { color: '#3d7bff', ...(m.player || {}) },
    };
    const c = this.cfg;
    const yav = this.you.querySelector('.hud-av');
    yav.style.setProperty('--c', c.player.color);
    yav.innerHTML = avatarInner({ ...c.player, name: 'You' });
    const rav = this.riv.querySelector('.hud-av');
    rav.style.setProperty('--c', c.rival.color);
    rav.innerHTML = avatarInner(c.rival);
    const tag = this.riv.querySelector('.hud-tag');
    tag.textContent = c.rival.name;
    tag.style.setProperty('--c', c.rival.color);
    this.riv.style.setProperty('--rc', c.rival.color);
    for (const side of [this.you, this.riv]) {
      side.querySelector('.hud-stars').innerHTML = Array.from({ length: c.starsToWin }, () => `<span class="hs">${svgIcon('star-empty', 'hs-e')}${svgIcon('star', 'hs-f')}</span>`).join('');
    }
    // Score meter: star markers at each threshold; a 0 threshold (star 1 = win the match) sits at the start.
    this.meter.hidden = !c.thresholds;
    if (c.thresholds) {
      const t = c.thresholds;
      this.meterMax = Math.max(1, (t[t.length - 1] || 1) * 1.15);
      const bar = this.meter.querySelector('.hm-bar');
      bar.querySelectorAll('.hm-mark').forEach((n) => n.remove());
      t.forEach((v, i) => {
        const k = v > 0 ? v / this.meterMax : 0.06;
        const mk = el('span', 'hm-mark', `${svgIcon('star-empty', 'hm-e')}${svgIcon('star', 'hm-f')}`);
        mk.style.left = `${(k * 100).toFixed(1)}%`;
        mk.dataset.t = String(v);
        bar.append(mk);
      });
      this.marks = [...bar.querySelectorAll('.hm-mark')];
    } else this.marks = [];
    this.timer.hidden = !c.timeLimit;
    this.root.classList.toggle('has-meter', !!c.thresholds);
    this.root.classList.toggle('has-timer', !!c.timeLimit);
    if (this.score.raf) cancelAnimationFrame(this.score.raf);
    this.score = { target: 0, shown: 0, raf: 0, won: false };
    this.hmFill.style.transform = 'scaleX(0)';
    this.hmScore.textContent = '0';
    this.setStars(0, 0);
    this.setBag([], c.bagSize);
    this.setHint('');
    this.setInteract(null);
    this.setHome('normal');
    this.card.hidden = true;
  }

  // ---------------------------------------------------------------- order card

  /**
   * Current order. Parts come from the item recipe; `made[i]` ticks part i once it is crafted.
   * @param {{item: string, index: number, total: number, made?: boolean[]}|null} o
   *        item = item id (src/data.js ITEMS); index is 0-based; null hides the card
   */
  setOrder(o) {
    if (!o || !ITEM_BY_ID[o.item]) {
      if (this.last.orderItem !== null) {
        this.card.hidden = true;
        this.rectCache = null;
      }
      this.last.orderItem = null;
      return;
    }
    const it = ITEM_BY_ID[o.item];
    const L = this.last;
    if (L.orderItem !== o.item || L.orderIndex !== o.index || L.orderTotal !== o.total) {
      L.orderItem = o.item;
      L.orderIndex = o.index;
      L.orderTotal = o.total;
      this.madeLast.length = 0;
      this.card.hidden = false;
      this.card.querySelector('.oc-icon').src = artURL('item', it.id, 96);
      this.card.querySelector('.oc-name').textContent = it.name;
      this.card.querySelector('.oc-num').textContent = `${o.index + 1}/${o.total}`;
      this.card.querySelector('.oc-parts').innerHTML = it.parts
        .map((p) => {
          const needs = COMPONENTS[p].needs.map((r) => `<img alt="${esc(RES[r].name)}" src="${artURL('res', r, 48)}">`).join('');
          return `<div class="oc-part" title="${esc(COMPONENTS[p].name)}"><img class="op-comp" alt="" src="${artURL('comp', p, 64)}"><b class="op-name">${esc(COMPONENTS[p].name)}</b><span class="op-res">${needs}</span><i class="op-tick">${svgIcon('check')}</i></div>`;
        })
        .join('');
      this.parts = this.card.querySelectorAll('.oc-part');
      this.rectCache = null;
      this._anim(this.card, [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1.06)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' }, () => (this.rectCache = null));
    }
    const made = o.made;
    const n = this.parts.length;
    for (let i = 0; i < n; i++) {
      const on = !!(made && made[i]);
      if (this.madeLast[i] === on) continue;
      const pe = this.parts[i];
      if (on && this.madeLast[i] === false) this._pop(pe);
      pe.classList.toggle('done', on);
      this.madeLast[i] = on;
    }
  }

  // ---------------------------------------------------------------- stars, score, timer

  /** Orders won by each side (fills the star slots; new stars pop). */
  setStars(player, rival) {
    this._starsOf(this.you, player | 0, 'sp');
    this._starsOf(this.riv, rival | 0, 'sr');
  }

  _starsOf(side, n, key) {
    if (this.last[key] === n) return;
    const prev = this.last[key] ?? 0;
    this.last[key] = n;
    const stars = side.querySelectorAll('.hs');
    for (let i = 0; i < stars.length; i++) {
      const on = i < n;
      stars[i].classList.toggle('on', on);
      if (on && i >= prev) this._pop(stars[i], 1.6);
    }
  }

  /** Adventure score (the meter fills toward the 3-star mark; the number counts up smoothly).
   * @param {number} score
   * @param {boolean} [won]  lights the "win" star marker (threshold 0) */
  setScore(score, won = false) {
    if (!this.cfg.thresholds) return;
    score = Math.max(0, Math.round(+score || 0));
    won = !!won;
    const sc = this.score;
    if (score === sc.target && won === sc.won) return;
    if (score !== sc.target) {
      sc.target = score;
      if (!sc.raf) sc.raf = requestAnimationFrame(this._tick);
      this.hmFill.style.transform = `scaleX(${clamp(score / this.meterMax, 0, 1).toFixed(4)})`;
    }
    sc.won = won;
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i];
      const t = +m.dataset.t;
      const on = t > 0 ? score >= t : won;
      if (on === m.classList.contains('on')) continue;
      if (on) this._pop(m, 1.8);
      m.classList.toggle('on', on);
    }
  }

  _tickScore() {
    const s = this.score;
    const d = s.target - s.shown;
    s.shown = Math.abs(d) < 1.5 ? s.target : s.shown + d * 0.18;
    this.hmScore.textContent = fmt(s.shown);
    s.raf = s.shown !== s.target ? requestAnimationFrame(this._tick) : 0;
  }

  /** Seconds of race time left (null hides the timer). Turns red and pulses under 10 s. */
  setTimer(secondsLeft) {
    if (secondsLeft == null || !Number.isFinite(secondsLeft)) {
      if (!this.timer.hidden) {
        this.timer.hidden = true;
        this.rectCache = null;
      }
      this.last.timer = null;
      return;
    }
    const s = Math.max(0, Math.ceil(secondsLeft));
    if (this.last.timer === s) return;
    this.last.timer = s;
    if (this.timer.hidden) {
      this.timer.hidden = false;
      this.rectCache = null;
    }
    this.timer.lastChild.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.timer.classList.toggle('low', s <= 10);
  }

  // ---------------------------------------------------------------- bag, hint, buttons

  /** Bag contents (resource types) and size (3 or 4). A newly added item pops. */
  setBag(items, size = this.cfg.bagSize) {
    const last = this.bagLast;
    let same = this.bag.childElementCount === size && last.length === items.length;
    for (let i = 0; same && i < items.length; i++) same = last[i] === items[i];
    if (same) return;
    const prevLen = last.length;
    if (this.bag.childElementCount !== size) {
      this.bag.innerHTML = Array.from({ length: size }, () => '<span class="bag-slot"><img alt="" hidden></span>').join('');
    }
    const slots = this.bag.children;
    for (let i = 0; i < size; i++) {
      const img = slots[i].firstChild;
      const r = items[i];
      if (r && RES[r]) {
        const src = artURL('res', r, 64);
        if (img.getAttribute('src') !== src) img.src = src;
        img.hidden = false;
        slots[i].classList.add('full');
        if (i >= prevLen) this._pop(slots[i], 1.3);
      } else {
        img.hidden = true;
        slots[i].classList.remove('full');
      }
    }
    this.bag.classList.toggle('is-full', items.length >= size);
    last.length = 0;
    for (let i = 0; i < items.length; i++) last.push(items[i]);
    this.last.bagLen = items.length;
  }

  /** The hint line above the bag ('' hides it). */
  setHint(text) {
    text = text || '';
    if (text === this.last.hint) return;
    if (!text !== !this.last.hint) this.rectCache = null;
    this.last.hint = text;
    this.hint.textContent = text;
    this.hint.hidden = !text;
  }

  /**
   * What the Interact button would do right now.
   * @param {'gather'|'deposit'|null} kind
   * @param {string} [res]  resource type in reach (kind 'gather')
   */
  setInteract(kind, res) {
    const key = `${kind}|${res || ''}`;
    if (key === this.last.inter) return;
    this.last.inter = key;
    const b = this.interBtn;
    const img = b.querySelector('.hi-res');
    const hand = b.querySelector('.hi-hand');
    b.classList.toggle('off', !kind);
    b.classList.toggle('deposit', kind === 'deposit');
    if (kind === 'gather' && res && RES[res]) {
      img.src = artURL('res', res, 96);
      img.hidden = false;
      hand.style.display = 'none';
      b.lastChild.textContent = RES[res].name.toUpperCase();
    } else {
      img.hidden = true;
      hand.style.display = '';
      b.lastChild.textContent = kind === 'deposit' ? 'DROP' : 'GRAB';
    }
    if (kind) this._pop(b, 1.12);
  }

  /** Home button look: 'normal' | 'glow' (bag full or tutorial: pulse) | 'off' (dimmed). */
  setHome(state = 'normal') {
    if (state === this.last.home) return;
    this.last.home = state;
    this.homeBtn.classList.toggle('glow', state === 'glow');
    this.homeBtn.classList.toggle('off', state === 'off');
  }

  // ---------------------------------------------------------------- minimap

  /**
   * Draw the static island once per match.
   * @param {{land: boolean[], walkable?: boolean[], workshop?: number[], obstacles?: {x, y}[]}} world  sim world
   * @param {{sea?: string, land?: string, beach?: string, block?: string}} [colors]  theme colours
   */
  setMinimapWorld(world, colors = {}) {
    this.mm.world = world;
    this.mm.colors = { sea: '#2f9fd8', land: '#8fd672', beach: '#f1d9a0', block: '#4f7d3c', hub: '#b5773f', ...colors };
    this._mmSize();
    this._mmBase();
    this.mm.lastDraw = 0;
  }

  _mmSize() {
    const c = this.mmCanvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round((c.clientWidth || 66) * dpr));
    const h = Math.max(1, Math.round((c.clientHeight || 95) * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    this.mm.dpr = dpr;
  }

  _mmBase() {
    const wd = this.mm.world;
    if (!wd) return;
    const c = this.mmCanvas;
    const base = this.mm.base || document.createElement('canvas');
    base.width = c.width;
    base.height = c.height;
    const g = base.getContext('2d');
    const col = this.mm.colors;
    const tw = c.width / W_TILES;
    const th = c.height / H_TILES;
    g.fillStyle = col.sea;
    g.fillRect(0, 0, c.width, c.height);
    // Beach first (tiles grown a little), then land on top: a soft sandy outline.
    const pad = Math.max(1, tw * 0.18);
    g.fillStyle = col.beach;
    for (let y = 0; y < H_TILES; y++) for (let x = 0; x < W_TILES; x++) if (wd.land[y * W_TILES + x]) g.fillRect(x * tw - pad, y * th - pad, tw + pad * 2, th + pad * 2);
    g.fillStyle = col.land;
    for (let y = 0; y < H_TILES; y++) for (let x = 0; x < W_TILES; x++) if (wd.land[y * W_TILES + x]) g.fillRect(x * tw, y * th, tw + 0.5, th + 0.5);
    g.fillStyle = col.block;
    for (const o of wd.obstacles || []) {
      g.beginPath();
      g.arc((o.x + 0.5) * tw, (o.y + 0.5) * th, Math.min(tw, th) * 0.28, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = col.hub;
    for (const i of wd.workshop || []) g.fillRect((i % W_TILES) * tw + 1, Math.floor(i / W_TILES) * th + th * 0.15, tw - 2, th * 0.7);
    this.mm.base = base;
  }

  /**
   * Redraw the dynamic minimap layer (throttled to ~11 Hz, so it is fine to call every frame).
   * @param {object} s
   * @param {Array<{id: number, x: number, y: number, type: string, readyAt: number}>} s.nodes  sim nodes
   * @param {number} s.time                sim time (a node is ready when readyAt <= time)
   * @param {{x: number, y: number, heading?: number}} s.player  continuous tile coords; heading in
   *                                       radians as in coords.headingOf (atan2(dx, dy))
   * @param {{x: number, y: number}} s.rival
   * @param {number|null} [s.rivalTarget]  node id the rival is heading for
   * @param {number|null} [s.playerTarget] node id the player is going for
   * @param {Set<string>|null} [s.need]    resource types the order still needs (drawn bigger)
   */
  updateMinimap(s, force = false) {
    if (!this.mm.base || this.root.hidden) return;
    const now = performance.now();
    if (!force && now - this.mm.lastDraw < 90) return;
    this.mm.lastDraw = now;
    const c = this.mmCanvas;
    const g = c.getContext('2d');
    const tw = c.width / W_TILES;
    const th = c.height / H_TILES;
    const u = Math.min(tw, th);
    g.drawImage(this.mm.base, 0, 0);
    const nodes = s.nodes || [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const ready = n.readyAt <= s.time + 0.01;
      const needed = !s.need || s.need.has(n.type);
      g.globalAlpha = ready ? 1 : 0.35;
      g.fillStyle = MM_COLORS[n.type] || '#fff';
      g.beginPath();
      g.arc((n.x + 0.5) * tw, (n.y + 0.5) * th, u * (needed && ready ? 0.34 : 0.24), 0, Math.PI * 2);
      g.fill();
      if (needed && ready) {
        g.lineWidth = Math.max(1, u * 0.09);
        g.strokeStyle = 'rgba(40,30,70,.75)';
        g.stroke();
      }
    }
    g.globalAlpha = 1;
    if (s.playerTarget != null) this._mmRing(g, nodes[s.playerTarget], '#ffffff', 0.55, tw, th, u);
    if (s.rivalTarget != null) this._mmRing(g, nodes[s.rivalTarget], this.cfg.rival.color, 0.62, tw, th, u);
    this._mmDot(g, s.rival, this.cfg.rival.color, 0.3, tw, th, u);
    const p = s.player;
    if (p && Number.isFinite(p.heading)) {
      // Facing wedge: heading = atan2(dx, dy) in tile axes (x east, y south).
      const cx = (p.x + 0.5) * tw;
      const cy = (p.y + 0.5) * th;
      const a = p.heading;
      g.beginPath();
      g.moveTo(cx + Math.sin(a) * u * 0.75, cy + Math.cos(a) * u * 0.75);
      g.lineTo(cx + Math.sin(a + 2.4) * u * 0.34, cy + Math.cos(a + 2.4) * u * 0.34);
      g.lineTo(cx + Math.sin(a - 2.4) * u * 0.34, cy + Math.cos(a - 2.4) * u * 0.34);
      g.closePath();
      g.fillStyle = '#fff';
      g.fill();
    }
    this._mmDot(g, p, this.cfg.player.color || '#3d7bff', 0.32, tw, th, u);
  }

  _mmRing(g, n, color, r, tw, th, u) {
    if (!n) return;
    g.beginPath();
    g.arc((n.x + 0.5) * tw, (n.y + 0.5) * th, u * r, 0, Math.PI * 2);
    g.lineWidth = Math.max(1.5, u * 0.14);
    g.strokeStyle = color;
    g.stroke();
  }

  _mmDot(g, p, color, r, tw, th, u) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    g.beginPath();
    g.arc((p.x + 0.5) * tw, (p.y + 0.5) * th, u * r, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    g.lineWidth = Math.max(1.2, u * 0.1);
    g.strokeStyle = '#fff';
    g.stroke();
  }

  // ---------------------------------------------------------------- floating labels

  /** Start a frame of persistent labels (call before label()/glassLabel()). */
  beginLabels() {
    this.frame++;
  }

  /**
   * A label anchored at screen point (x, y) (CSS px, e.g. engine.worldToScreen of a node top). The label
   * sits centred above the point. Call every frame while it should show; endLabels() hides the rest.
   * @param {string} key    stable id, e.g. 'contest', 'say-rival', 'glass-7'
   * @param {string} text
   * @param {'pill'|'bubble'|'glass'|'tag'} [style]  pill = coloured pill (FOX FIRST / YOU FIRST),
   *        bubble = speech bubble, glass = small % label, tag = small name tag
   * @param {string} [color] pill background / bubble border colour
   */
  label(key, x, y, text, style = 'pill', color = '') {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return; // not refreshed -> hidden by endLabels()
    let r = this.labByKey.get(key);
    if (!r) {
      r = this.labFree.pop();
      if (!r) {
        const e = el('div', 'hl', '<span></span>');
        this.labels.append(e);
        r = { el: e, span: e.firstChild };
      }
      r.key = key;
      r.text = r.style = r.color = null;
      r.x = r.y = NaN;
      r.w = 0;
      r.el.hidden = false;
      this.labByKey.set(key, r);
      this.labActive.push(r);
    }
    r.seen = this.frame;
    let sized = r.w > 0;
    if (r.style !== style) {
      r.el.className = `hl hl-${style}`;
      r.style = style;
      r.down = false;
      sized = false;
    }
    if (r.text !== text) {
      r.span.textContent = text;
      r.text = text;
      sized = false;
    }
    if (r.color !== color) {
      r.el.style.setProperty('--c', color || '');
      r.color = color;
    }
    if (!sized) {
      // One layout read per text change: the label's box (plus its tail) for the panel test.
      r.w = r.span.offsetWidth;
      r.h = r.span.offsetHeight + (style === 'bubble' ? 12 : style === 'pill' ? 10 : 5);
      r.x = r.y = NaN;
    }
    // Clear of the HUD panels: under a top panel the label hangs below it with its tail flipped up.
    const p = this._avoid(x, y, r.w, r.h);
    if (p.down !== r.down) {
      r.el.classList.toggle('hl-down', p.down);
      r.down = p.down;
    }
    if (!(Math.abs(r.x - p.x) < 0.3 && Math.abs(r.y - p.y) < 0.3)) {
      r.el.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0)`;
      r.x = p.x;
      r.y = p.y;
    }
  }

  /** Glass mode: the rival's belief p (0..1) that you want the resource at (x, y). */
  glassLabel(key, x, y, p) {
    const v = Math.round(clamp(p, 0, 1) * 100);
    this.label(key, x, y, `${v}%`, 'glass', v >= 50 ? '#ff4d5e' : v >= 25 ? '#ff9a1f' : '#5a6b8c');
  }

  /** Hide every label that was not refreshed since beginLabels(). */
  endLabels() {
    const act = this.labActive;
    for (let i = act.length - 1; i >= 0; i--) {
      const r = act[i];
      if (r.seen === this.frame) continue;
      r.el.hidden = true;
      this.labByKey.delete(r.key);
      act[i] = act[act.length - 1];
      act.pop();
      this.labFree.push(r);
    }
  }

  /**
   * One-shot floater that rises and fades at (x, y).
   * @param {string} text   '+60', 'SNATCHED!', 'BEAT IT!', 'FAKED OUT!'...
   * @param {'score'|'bad'|'gold'|'good'|'info'} [style]
   */
  pop(text, x, y, style = 'score', dur = 1200) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const big = style !== 'score';
    // Box estimate (no layout read): ~0.6 em per character of the 22-26 px outlined text.
    const w = String(text).length * (big && style !== 'info' ? 16 : 13) + 12;
    const p = this._avoid(x, y, w, 44, true);
    x = p.x;
    y = p.y;
    // Floaters that land in the same spot within a moment stack upward, whatever order they came in.
    const now = performance.now();
    const recent = this.popRecent;
    for (let i = recent.length - 1; i >= 0; i--) if (now - recent[i].t > POP_STACK_MS) recent.splice(i, 1);
    for (let pass = 0; pass < 6; pass++) {
      let moved = false;
      for (const q of recent) {
        if (Math.abs(q.x - x) < (q.w + w) / 2 && Math.abs(q.y - y) < 28) {
          y = q.y - 28;
          moved = true;
        }
      }
      if (!moved) break;
    }
    recent.push({ x, y, w, t: now });
    let e = this.popFree.pop();
    if (!e) {
      e = el('div', 'hl', '<span></span>');
      this.labels.append(e);
    }
    e.className = `hl hl-pop hl-${style}`;
    e.firstChild.textContent = text;
    e.hidden = false;
    const t = (dy, s) => `translate3d(${x.toFixed(1)}px,${(y - dy).toFixed(1)}px,0) scale(${s})`;
    this._anim(
      e,
      [
        { transform: t(0, 0.3), opacity: 0 },
        { transform: t(big ? 22 : 16, big ? 1.25 : 1.15), opacity: 1, offset: 0.15 },
        { transform: t(big ? 30 : 26, 1), opacity: 1, offset: 0.35 },
        { transform: t(big ? 44 : 56, 0.95), opacity: 1, offset: 0.8 },
        { transform: t(big ? 56 : 70, 0.9), opacity: 0 },
      ],
      { duration: dur, easing: 'ease-out' },
      () => {
        e.hidden = true;
        this.popFree.push(e);
      },
    );
  }

  // ---------------------------------------------------------------- captions, toast

  /**
   * Big centred caption ('GO!', 'CRAFTED!', 'YOU WIN!').
   * @param {string} text
   * @param {{sub?: string, color?: string, dur?: number, size?: number}} [o]  size scales the text
   */
  caption(text, { sub = '', color = '#ffc629', dur = 1400, size = 1 } = {}) {
    const c = this.cap;
    const main = c.firstChild;
    text = String(text);
    main.textContent = text;
    c.lastChild.textContent = sub;
    c.lastChild.hidden = !sub;
    c.style.setProperty('--cc', color);
    c.style.setProperty('--cs', String(size));
    c.style.top = '';
    c.hidden = false;
    this._fitCaption(text, size);
    this._clearCaptionOfToast();
    if (this.capAnim) this.capAnim.cancel();
    this.capAnim = this._anim(
      c,
      [
        { transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 },
        { transform: 'translate(-50%,-50%) scale(1.18)', opacity: 1, offset: Math.min(0.3, 180 / dur) },
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: Math.min(0.4, 300 / dur) },
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.86 },
        { transform: 'translate(-50%,-50%) scale(1.06)', opacity: 0 },
      ],
      { duration: dur, easing: 'ease-out' },
      (a) => {
        if (this.capAnim !== a) return;
        c.hidden = true;
        this.capAnim = null;
      },
    );
  }

  // Fit the caption to the screen width: shrink it, and break a long one into two lines first (at ' · '
  // or the space nearest the middle) when shrinking alone would make it small.
  _fitCaption(text, size) {
    const main = this.cap.firstChild;
    const avail = Math.min(window.innerWidth * 0.9, 1100) - 12;
    let w = main.scrollWidth;
    if (w <= avail) return;
    let k = avail / w;
    const lines = k < 0.72 ? splitCaption(text) : null;
    if (lines) {
      main.textContent = '';
      main.append(lines[0], document.createElement('br'), lines[1]);
      w = main.scrollWidth;
      k = avail / w;
    }
    this.cap.style.setProperty('--cs', String(+(size * Math.min(1, k)).toFixed(3)));
  }

  // A caption never covers the toast: it moves down below it (at most to 60% of the height).
  _clearCaptionOfToast() {
    const cur = this.toastCur;
    if (!cur || cur.leaving) return;
    const tb = this.toastEl.getBoundingClientRect();
    const W = window.innerWidth;
    const H = window.innerHeight;
    const w = this.cap.offsetWidth;
    const h = this.cap.offsetHeight;
    const cy = H * 0.4;
    if (cy + h / 2 < tb.top - 6 || cy - h / 2 > tb.bottom + 6 || (W + w) / 2 < tb.left || (W - w) / 2 > tb.right) return;
    this.cap.style.top = `${Math.round(Math.min(H * 0.6, tb.bottom + 10 + h / 2))}px`;
  }

  /**
   * Toast line (e.g. the honest snatch reason), shown one at a time in a slot clear of the player and
   * the thumbs: under the top HUD in portrait, beside the order card on landscape phones.
   * A higher priority replaces the current toast at once. An equal one waits until the current toast
   * had its minimum time on screen (longer texts get longer); a 'normal' one waits behind a 'high' one;
   * a 'low' one is dropped while anything else shows. A repeat of the text on screen or waiting is ignored.
   * @param {string} text
   * @param {{kind?: ''|'bad'|'good'|'info', dur?: number, priority?: 'low'|'normal'|'high'}} [o]
   */
  toast(text, { kind = '', dur = 3000, priority = 'normal' } = {}) {
    if (!text) return;
    text = String(text);
    const now = performance.now();
    const t = { text, kind, dur: Math.max(800, +dur || 3000), pri: TOAST_PRI[priority] ?? 1, at: now };
    const cur = this.toastCur;
    if ((cur && cur.text === text && !cur.leaving) || this.toastQ.some((q) => q.text === text)) return;
    if (!cur) return this._toastShow(t);
    if (!cur.leaving && t.pri > cur.pri) return this._toastShow(t);
    if (!cur.leaving && t.pri === 0) return;
    const q = this.toastQ;
    let i = q.length;
    while (i > 0 && q[i - 1].pri < t.pri) i--;
    q.splice(i, 0, t);
    // At most 3 waiting: drop the oldest of the lowest priority (the queue is sorted by priority).
    if (q.length > 3) q.splice(q.findIndex((k) => k.pri === q[q.length - 1].pri), 1);
    this._toastSchedule();
  }

  /** True while a toast is on screen. */
  get toastActive() {
    return !!this.toastCur;
  }

  _toastShow(t) {
    const node = this.toastEl;
    if (this.toastAnim) this.toastAnim.cancel();
    t.shownAt = performance.now();
    // Minimum time on screen before an equal priority may follow: enough to read it.
    t.min = Math.min(t.dur, Math.max(1500, 900 + t.text.length * 38));
    t.leaving = false;
    this.toastCur = t;
    node.textContent = t.text;
    node.className = `hud-toast ${t.kind}`;
    node.hidden = false;
    this._toastSlot();
    this.toastAnim = this._anim(node, [{ transform: 'translate(-50%, 10px) scale(.9)', opacity: 0 }, { transform: 'translate(-50%, 0) scale(1)', opacity: 1 }], { duration: 200, easing: 'ease-out' });
    this._toastSchedule();
  }

  // (Re)arm the timer that ends the current toast: its full duration, or its minimum time when an
  // equal or higher priority toast is waiting.
  _toastSchedule() {
    const cur = this.toastCur;
    if (!cur || cur.leaving) return;
    const next = this.toastQ[0];
    const end = cur.shownAt + (next && next.pri >= cur.pri ? cur.min : cur.dur);
    if (this.toastT) {
      clearTimeout(this.toastT);
      this.timers.delete(this.toastT);
    }
    this.toastT = this._later(Math.max(0, end - performance.now()), () => {
      this.toastT = 0;
      this._toastLeave();
    });
  }

  _toastLeave() {
    const cur = this.toastCur;
    if (!cur || cur.leaving) return;
    cur.leaving = true;
    if (this.toastAnim) this.toastAnim.cancel();
    this.toastAnim = this._anim(this.toastEl, [{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: 'ease-in', fill: 'forwards' }, (a) => {
      if (this.toastAnim !== a) return;
      this.toastAnim = null;
      this.toastCur = null;
      const now = performance.now();
      let next;
      while ((next = this.toastQ.shift()) && now - next.at > TOAST_STALE[next.pri]);
      if (next) this._toastShow(next);
      else this.toastEl.hidden = true;
      a.cancel(); // drop the faded-out fill
    });
  }

  // Toast slot: below every top panel it would overlap; on landscape phones, in the free column right of
  // the order card instead (the player stands in the middle, the thumbs own the bottom corners).
  _toastSlot() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const R = this._rects();
    let left = W / 2;
    let maxW = Math.min(W * 0.92, 460);
    let top = 8;
    if (H < 560 && W > H * 1.1 && !this.card.hidden) {
      const l = this.card.getBoundingClientRect().right + 10;
      const r = this.riv.getBoundingClientRect().left - 10;
      if (r - l >= 200) {
        left = (l + r) / 2;
        maxW = Math.min(r - l, 360);
      }
    }
    for (const k of R) if (k.top && k.r > left - maxW / 2 && k.l < left + maxW / 2) top = Math.max(top, k.b + 8);
    const s = this.toastEl.style;
    s.left = `${Math.round(left)}px`;
    s.top = `${Math.round(top)}px`;
    s.maxWidth = `${Math.round(maxW)}px`;
  }

  // ---------------------------------------------------------------- VS splash

  /**
   * VS splash at match start. Resolves when it ends or is tapped away (taps in its first 400 ms are
   * ignored, so the second click of a double-click on PLAY does not skip it).
   * @param {object} v
   * @param {{portrait?: string, color?: string}} [v.player]
   * @param {{name: string, color: string, portrait?: string, title?: string}} v.rival
   * @param {string} [v.title]   e.g. 'LEVEL 12 · FROZEN FALLS' or 'QUICK RACE'
   * @param {string} [v.goal]    goal text
   * @param {string} [v.sub]     small line (e.g. '23 of your moves in its notebook')
   * @param {number} [v.dur=2600]
   * @returns {Promise<void>}
   */
  vs(v) {
    this.hideVs(false);
    const p = { color: '#3d7bff', ...(v.player || {}) };
    const r = v.rival || this.cfg.rival;
    this.vsEl.innerHTML = `
      <div class="vs-half vs-l" style="--c:${esc(p.color)}"><div class="vs-who"><span class="av vs-av" style="--c:${esc(p.color)}">${avatarInner({ ...p, name: 'You' })}</span><b>YOU</b></div></div>
      <div class="vs-half vs-r" style="--c:${esc(r.color)}"><div class="vs-who"><span class="av vs-av" style="--c:${esc(r.color)}">${avatarInner(r)}</span><b>${esc(r.name)}</b>${r.title ? `<small>${esc(r.title)}</small>` : ''}</div></div>
      <div class="vs-badge">VS</div>
      <div class="vs-info">${v.title ? `<small>${esc(v.title)}</small>` : ''}${v.goal ? `<p>${esc(v.goal)}</p>` : ''}${v.sub ? `<em>${esc(v.sub)}</em>` : ''}</div>
      <div class="vs-skip">Tap to skip</div>`;
    this.vsEl.hidden = false;
    this.vsEl.classList.remove('out');
    this.vsAt = performance.now();
    return new Promise((resolve) => {
      this.vsState = { resolve, t: this._later(v.dur || 2600, () => this.hideVs(false)) };
    });
  }

  /** Hide the VS splash now (resolves the vs() promise). */
  hideVs(skipped = false) {
    const st = this.vsState;
    if (!st) {
      this.vsEl.hidden = true;
      return;
    }
    this.vsState = null;
    clearTimeout(st.t);
    this.timers.delete(st.t);
    this.vsEl.classList.add('out');
    this._later(260, () => {
      if (!this.vsState) this.vsEl.hidden = true;
    });
    if (skipped && this.cb.onSkipVs) this.cb.onSkipVs();
    st.resolve();
  }

  get vsActive() {
    return !!this.vsState;
  }

  // ---------------------------------------------------------------- tutorial pointer

  /**
   * Tutorial hint: a bouncing hand at a screen point, or at one of the HUD buttons. When the point is
   * off screen (or visible === false) an arrow at the screen edge points toward it instead.
   * @param {{x: number, y: number, label?: string, visible?: boolean}|'home'|'interact'|null} p
   * @param {string} [label]  label for the 'home' / 'interact' forms
   */
  pointer(p, label = '') {
    if (!p) {
      if (!this.ptr.hidden) this.ptr.hidden = true;
      return;
    }
    let x;
    let y;
    let text = label;
    let visible = true;
    if (p === 'home' || p === 'interact') {
      // Button rects are cached (a per-frame layout read would force reflows); resize() clears them.
      this.btnRects = this.btnRects || {};
      const b = this.btnRects[p] || (this.btnRects[p] = (p === 'home' ? this.homeBtn : this.interBtn).getBoundingClientRect());
      x = b.left + b.width / 2;
      y = b.top + 4;
    } else {
      x = p.x;
      y = p.y;
      text = p.label || '';
      visible = p.visible !== false;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      this.pointer(null);
      return;
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    const m = 44;
    const off = !visible || x < m || x > W - m || y < 90 || y > H - 60;
    let ang = 0;
    if (off) {
      // Clamp to the screen edge along the direction from the centre.
      const cx = W / 2;
      const cy = H / 2;
      let dx = x - cx;
      let dy = y - cy;
      if (!visible && dx * dx + dy * dy < 1) dy = 1;
      const k = Math.min((W / 2 - m) / Math.max(1e-3, Math.abs(dx)), (H / 2 - 110) / Math.max(1e-3, Math.abs(dy)));
      x = cx + dx * Math.min(1, k);
      y = cy + dy * Math.min(1, k);
      ang = Math.atan2(dy, dx);
    }
    const pl = this.ptrLast;
    if (!this.ptr.hidden && Math.abs(pl.x - x) < 0.5 && Math.abs(pl.y - y) < 0.5 && pl.text === text && pl.off === off && Math.abs(pl.ang - ang) < 0.01) return;
    pl.x = x;
    pl.y = y;
    pl.text = text;
    pl.off = off;
    pl.ang = ang;
    this.ptr.hidden = false;
    this.ptr.classList.toggle('off', off);
    this.ptr.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
    this.ptr.style.setProperty('--ang', `${ang + Math.PI}rad`);
    const lbl = this.ptr.querySelector('.hp-lbl');
    if (lbl.textContent !== text) lbl.textContent = text;
    lbl.hidden = !text;
  }

  // ---------------------------------------------------------------- edge arrow, layout layer

  /**
   * Arrow at the screen edge pointing at an off-screen target (e.g. the Workshop when the bag is ready).
   * Call every frame with the target's screen point (engine.worldToScreen); hidden while the point is on
   * screen. Placed clear of the HUD panels.
   * @param {{x: number, y: number, color?: string, icon?: string, visible?: boolean, behind?: boolean}|null} t
   *        visible === false forces the arrow (e.g. worldToScreen said not visible); behind: the point is
   *        behind the camera (its projection is mirrored), so the arrow points the other way; icon: a
   *        sprite icon name shown in the disc (e.g. 'home')
   */
  edgeArrow(t) {
    const node = this.edge;
    if (!t || !Number.isFinite(t.x) || !Number.isFinite(t.y) || this.root.hidden) {
      if (!node.hidden) node.hidden = true;
      return;
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    const onScreen = t.visible !== false && !t.behind && t.x >= 0 && t.x <= W && t.y >= 0 && t.y <= H;
    if (onScreen) {
      if (!node.hidden) node.hidden = true;
      return;
    }
    const cx = W / 2;
    const cy = H / 2;
    let dx = t.x - cx;
    let dy = t.y - cy;
    if (t.behind) {
      dx = -dx;
      dy = -dy;
    }
    if (dx * dx + dy * dy < 1) dy = 1;
    const m = 34;
    const k = Math.min((W / 2 - m) / Math.max(1e-3, Math.abs(dx)), (H / 2 - m) / Math.max(1e-3, Math.abs(dy)));
    let x = cx + dx * k;
    let y = cy + dy * k;
    // Slide in toward the centre until the disc is clear of every panel.
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    for (let i = 0; i < 80 && this._hitsPanel(x, y, 28); i++) {
      x -= ux * 8;
      y -= uy * 8;
    }
    const ang = Math.atan2(uy, ux);
    const color = t.color || '#ffc629';
    const icon = t.icon || '';
    const L = this.edgeLast;
    if (!node.hidden && Math.abs(L.x - x) < 0.5 && Math.abs(L.y - y) < 0.5 && Math.abs(L.ang - ang) < 0.01 && L.color === color && L.icon === icon) return;
    if (L.color !== color) node.style.setProperty('--c', color);
    if (L.icon !== icon) {
      node.lastChild.innerHTML = icon ? svgIcon(icon, 'he-ic') : '';
      node.classList.toggle('has-ic', !!icon);
    }
    Object.assign(L, { x, y, ang, color, icon });
    node.hidden = false;
    node.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
    node.firstChild.style.transform = `rotate(${ang.toFixed(3)}rad)`;
  }

  /** True when the screen point is over a HUD panel (order card, meter, timer, minimap, avatars and
   * stars, bag and hint, buttons): a tap there is meant for the HUD, not the island behind it. */
  isOverPanel(clientX, clientY) {
    return this._hitsPanel(clientX, clientY, 0);
  }

  _hitsPanel(x, y, pad) {
    if (this.root.hidden) return false;
    const R = this._rects();
    for (let i = 0; i < R.length; i++) {
      const r = R[i];
      if (x + pad >= r.l && x - pad <= r.r && y + pad >= r.t && y - pad <= r.b) return true;
    }
    return false;
  }

  // Viewport rects of the visible panels, cached (re-measured after a change, or once a second).
  // Top panels are measured from layout (offsets), so entrance and pulse animations do not skew them.
  _rects() {
    const now = performance.now();
    if (this.rectCache && now - this.rectAt < 1000) return this.rectCache;
    this.rectAt = now;
    const out = (this.rectCache = []);
    if (this.root.hidden) return out;
    const H = window.innerHeight;
    if (!this.topPanels) {
      this.topPanels = [this.card, this.meter, this.timer, this.mmWrap, this.pauseBtn, ...this.root.querySelectorAll('.hud-av-wrap, .hud-stars')];
      this.bottomPanels = [this.hint, this.bag, this.homeBtn, this.interBtn];
    }
    for (const n of this.topPanels) {
      if (n.hidden || !n.offsetWidth) continue;
      let l = 0;
      let t = 0;
      for (let p = n; p; p = p.offsetParent) {
        l += p.offsetLeft;
        t += p.offsetTop;
      }
      out.push({ l, t, r: l + n.offsetWidth, b: t + n.offsetHeight, top: true });
    }
    if (this.chrome) {
      for (const n of this.bottomPanels) {
        if (n.hidden) continue;
        const b = n.getBoundingClientRect();
        if (b.width > 0) out.push({ l: b.left, t: b.top, r: b.right, b: b.bottom, top: b.top + b.bottom < H });
      }
    }
    return out;
  }

  // Move a box (w x h, bottom-centre anchor x, y) out of the panels. A top panel pushes it below: a label
  // then hangs under its anchor (down = true), a floater (rise) keeps rising from below the panel. A
  // bottom panel pushes it above.
  _avoid(x, y, w, h, rise = false) {
    const o = this._avoidOut || (this._avoidOut = { x: 0, y: 0, down: false });
    o.x = x;
    o.y = y;
    o.down = false;
    const R = this._rects();
    const hw = w / 2 + 3;
    for (let pass = 0; pass < 4; pass++) {
      const top = o.down ? o.y : o.y - h;
      const bot = o.down ? o.y + h : o.y;
      let hit = null;
      for (let i = 0; i < R.length; i++) {
        const r = R[i];
        if (x + hw > r.l && x - hw < r.r && bot > r.t - 3 && top < r.b + 3) {
          hit = r;
          break;
        }
      }
      if (!hit) break;
      if (!hit.top) {
        o.y = hit.t - 4;
        o.down = false;
      } else if (rise) o.y = hit.b + 4 + h;
      else {
        o.y = hit.b + 4;
        o.down = true;
      }
    }
    return o;
  }

  // Tap-to-expand order card (bigger recipe with part names); closes by itself after a few seconds.
  _toggleCard(open = !this.card.classList.contains('oc-open')) {
    if (this.cardT) {
      clearTimeout(this.cardT);
      this.timers.delete(this.cardT);
      this.cardT = 0;
    }
    this.card.classList.toggle('oc-open', open);
    if (open) this.cardT = this._later(4000, () => this._toggleCard(false));
  }

  // ---------------------------------------------------------------- flying icons and pulses

  _targetRect(target) {
    let node = null;
    if (target === 'bag') {
      const slots = this.bag.children;
      const i = clamp(this.last.bagLen ?? 0, 0, slots.length - 1);
      node = slots[i] || this.bag;
    } else if (target === 'order') node = this.card.querySelector('.oc-icon-wrap');
    else if (target === 'star-player' || target === 'star-rival') {
      const side = target === 'star-player' ? this.you : this.riv;
      const n = target === 'star-player' ? this.last.sp || 0 : this.last.sr || 0;
      const stars = side.querySelectorAll('.hs');
      node = stars[clamp(n, 0, stars.length - 1)] || side;
    } else if (target === 'interact') node = this.interBtn;
    else if (target === 'home') node = this.homeBtn;
    return node ? node.getBoundingClientRect() : null;
  }

  /**
   * Fly an icon from a screen point into a HUD element.
   * @param {'res'|'comp'|'item'} kind  icon kind (src/icons.js)
   * @param {string} id
   * @param {number} x
   * @param {number} y
   * @param {'bag'|'order'|'star-player'|'star-rival'|'home'} target  'bag' flies to the next free slot
   *        (call before setBag adds it) and 'star-*' to the next empty star (call before setStars)
   */
  fly(kind, id, x, y, target = 'bag', dur = 550) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const r = this._targetRect(target);
    if (!r) return;
    let img = this.flyFree.pop();
    if (!img) {
      img = el('img', 'hud-fly');
      img.alt = '';
      this.root.append(img);
    }
    img.src = artURL(kind, id, 64);
    img.hidden = false;
    const tx = r.left + r.width / 2;
    const ty = r.top + r.height / 2;
    const mx = (x + tx) / 2;
    const my = Math.min(y, ty) - 70;
    const f = (px, py, s) => `translate3d(${(px - 18).toFixed(1)}px,${(py - 18).toFixed(1)}px,0) scale(${s})`;
    this._anim(
      img,
      [
        { transform: f(x, y, 0.6), opacity: 0.2 },
        { transform: f((x + mx) / 2, (y + my) / 2 - 10, 1.2), opacity: 1, offset: 0.3 },
        { transform: f(mx, my, 1.1), opacity: 1, offset: 0.55 },
        { transform: f(tx, ty, 0.8), opacity: 1 },
      ],
      { duration: dur, easing: 'cubic-bezier(.4,0,.6,1)' },
      () => {
        img.hidden = true;
        this.flyFree.push(img);
      },
    );
  }

  /** Bounce a HUD element: 'order' | 'bag' | 'stars-player' | 'stars-rival' | 'home' | 'interact' |
   * 'score' | 'timer'. */
  pulse(what) {
    const map = {
      order: this.card,
      bag: this.bag,
      'stars-player': this.you.querySelector('.hud-stars'),
      'stars-rival': this.riv.querySelector('.hud-stars'),
      home: this.homeBtn,
      interact: this.interBtn,
      score: this.meter,
      timer: this.timer,
    };
    if (map[what]) this._pop(map[what], 1.15);
  }

  _pop(node, s = 1.25) {
    this._anim(node, [{ transform: 'scale(1)' }, { transform: `scale(${s})`, offset: 0.35 }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' });
  }

  // ---------------------------------------------------------------- misc

  /** Re-measure after a layout change (window resize is handled automatically). */
  resize() {
    this.btnRects = null;
    this.rectCache = null;
    if (this.toastCur && !this.toastCur.leaving) this._toastSlot();
    if (!this.mm.world) return;
    const w = this.mmCanvas.width;
    const h = this.mmCanvas.height;
    this._mmSize();
    if (w !== this.mmCanvas.width || h !== this.mmCanvas.height || !this.mm.base) this._mmBase();
    this.mm.lastDraw = 0;
  }

  dispose() {
    this.reset();
    if (this.score.raf) cancelAnimationFrame(this.score.raf);
    this.score.raf = 0;
    window.removeEventListener('resize', this._onResize);
    this.root.innerHTML = '';
    this.mm = { world: null, base: null, lastDraw: 0, colors: null };
  }
}
