// In-match HUD of the 3D edition: plain HTML over the WebGL canvas (crisp text, cheap to update).
//
// The DOM is built once in the constructor. Call the set*/update* methods every frame with the current
// values: each one remembers what it last wrote and only touches the DOM when something changed.
// Floating labels projected from 3D (pills, speech bubbles, glass %) use an immediate-mode pool:
// beginLabels(), label(...) for each visible label, endLabels() hides the ones not refreshed.
// One-shot effects (score floaters, captions, flying icons) use the Web Animations API.

import { RES, COMPONENTS, ITEM_BY_ID } from '../data.js';
import { svgIcon, artURL, ensureIcons, esc, fmt } from './screens.js';

const W_TILES = 9;
const H_TILES = 13;
const MM_COLORS = { wood: '#3fbf4f', stone: '#b8c0cc', ore: '#ff8a3d', sand: '#ffd86b', fiber: '#b6f06a', crystal: '#4fe3ff' };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
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
    this.vsEl = el('div', 'hud-vs');
    this.vsEl.hidden = true;
    r.append(top, this.labels, this.bottom, this.actions, this.toastEl, this.cap, this.ptr, this.vsEl);
    this.cap.hidden = true;
    this.toastEl.hidden = true;

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
      this.hideVs(true);
    });
  }

  // ---------------------------------------------------------------- lifecycle

  /** Show or hide the whole HUD. */
  show(on = true) {
    this.root.hidden = !on;
    if (on) this.resize();
  }

  get visible() {
    return !this.root.hidden;
  }

  /** Clear transient things (labels, floaters, captions, toast, pointer, flying icons). */
  reset() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const a of this.anims) a.cancel();
    this.anims.clear();
    this.beginLabels();
    this.endLabels();
    this.cap.hidden = true;
    this.toastEl.hidden = true;
    this.pointer(null);
    this.hideVs(false);
    this.last = {};
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
      if (done) done();
      return null;
    }
    const a = node.animate(frames, opts);
    this.anims.add(a);
    a.onfinish = () => {
      this.anims.delete(a);
      if (done) done();
    };
    a.oncancel = () => {
      this.anims.delete(a);
      if (done) done();
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
    this.score = { target: 0, shown: 0, raf: 0 };
    this.meter.querySelector('.hm-fill').style.transform = 'scaleX(0)';
    this.meter.querySelector('.hm-score').textContent = '0';
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
      if (this.last.order !== null) this.card.hidden = true;
      this.last.order = null;
      return;
    }
    const made = o.made || [];
    const key = `${o.item}|${o.index}|${o.total}`;
    const it = ITEM_BY_ID[o.item];
    if (this.last.order !== key) {
      this.last.order = key;
      this.last.made = '';
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
      this.card.dataset.n = String(it.parts.length);
      this._anim(this.card, [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1.06)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' });
    }
    const mk = made.map((m) => (m ? 1 : 0)).join('');
    if (mk !== this.last.made) {
      const parts = this.card.querySelectorAll('.oc-part');
      parts.forEach((pe, i) => {
        const on = !!made[i];
        if (on && !pe.classList.contains('done')) this._pop(pe);
        pe.classList.toggle('done', on);
      });
      this.last.made = mk;
    }
  }

  // ---------------------------------------------------------------- stars, score, timer

  /** Orders won by each side (fills the star slots; new stars pop). */
  setStars(player, rival) {
    const upd = (side, n, key) => {
      if (this.last[key] === n) return;
      const prev = this.last[key] ?? 0;
      this.last[key] = n;
      side.querySelectorAll('.hs').forEach((s, i) => {
        const on = i < n;
        s.classList.toggle('on', on);
        if (on && i >= prev) this._pop(s, 1.6);
      });
    };
    upd(this.you, player | 0, 'sp');
    upd(this.riv, rival | 0, 'sr');
  }

  /** Adventure score (the meter fills toward the 3-star mark; the number counts up smoothly).
   * @param {number} score
   * @param {boolean} [won]  lights the "win" star marker (threshold 0) */
  setScore(score, won = false) {
    if (!this.cfg.thresholds) return;
    score = Math.max(0, Math.round(+score || 0));
    if (score !== this.score.target) {
      this.score.target = score;
      if (!this.score.raf) this.score.raf = requestAnimationFrame(() => this._tickScore());
      this.meter.querySelector('.hm-fill').style.transform = `scaleX(${clamp(score / this.meterMax, 0, 1).toFixed(4)})`;
    }
    const litKey = `${score >= 0 ? this.marks.map((m) => (+m.dataset.t > 0 ? score >= +m.dataset.t : won) ? 1 : 0).join('') : ''}`;
    if (litKey !== this.last.lit) {
      this.marks.forEach((m, i) => {
        const on = litKey[i] === '1';
        if (on && !m.classList.contains('on')) this._pop(m, 1.8);
        m.classList.toggle('on', on);
      });
      this.last.lit = litKey;
    }
  }

  _tickScore() {
    const s = this.score;
    const d = s.target - s.shown;
    s.shown = Math.abs(d) < 1 ? s.target : s.shown + d * 0.18 + Math.sign(d);
    if ((s.target > s.shown && d < 0) || (s.target < s.shown && d > 0)) s.shown = s.target;
    this.meter.querySelector('.hm-score').textContent = fmt(s.shown);
    s.raf = s.shown !== s.target ? requestAnimationFrame(() => this._tickScore()) : 0;
  }

  /** Seconds of race time left (null hides the timer). Turns red and pulses under 10 s. */
  setTimer(secondsLeft) {
    if (secondsLeft == null || !Number.isFinite(secondsLeft)) {
      if (!this.timer.hidden) this.timer.hidden = true;
      this.last.timer = null;
      return;
    }
    const s = Math.max(0, Math.ceil(secondsLeft));
    if (this.last.timer === s) return;
    this.last.timer = s;
    this.timer.hidden = false;
    this.timer.lastChild.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.timer.classList.toggle('low', s <= 10);
  }

  // ---------------------------------------------------------------- bag, hint, buttons

  /** Bag contents (resource types) and size (3 or 4). A newly added item pops. */
  setBag(items, size = this.cfg.bagSize) {
    const key = `${size}|${items.join(',')}`;
    if (key === this.last.bag) return;
    const prevLen = this.last.bagLen ?? 0;
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
    this.last.bag = key;
    this.last.bagLen = items.length;
  }

  /** The hint line above the bag ('' hides it). */
  setHint(text) {
    text = text || '';
    if (text === this.last.hint) return;
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
    const ring = (id, color, r) => {
      const n = id != null && nodes[id];
      if (!n) return;
      g.beginPath();
      g.arc((n.x + 0.5) * tw, (n.y + 0.5) * th, u * r, 0, Math.PI * 2);
      g.lineWidth = Math.max(1.5, u * 0.14);
      g.strokeStyle = color;
      g.stroke();
    };
    ring(s.playerTarget, '#ffffff', 0.55);
    ring(s.rivalTarget, this.cfg.rival.color, 0.62);
    const dot = (p, color, r) => {
      if (!p) return;
      g.beginPath();
      g.arc((p.x + 0.5) * tw, (p.y + 0.5) * th, u * r, 0, Math.PI * 2);
      g.fillStyle = color;
      g.fill();
      g.lineWidth = Math.max(1.2, u * 0.1);
      g.strokeStyle = '#fff';
      g.stroke();
    };
    dot(s.rival, this.cfg.rival.color, 0.3);
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
    dot(p, this.cfg.player.color || '#3d7bff', 0.32);
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
      r.el.hidden = false;
      this.labByKey.set(key, r);
      this.labActive.push(r);
    }
    r.seen = this.frame;
    if (r.style !== style) {
      r.el.className = `hl hl-${style}`;
      r.style = style;
    }
    if (r.text !== text) {
      r.span.textContent = text;
      r.text = text;
    }
    if (r.color !== color) {
      r.el.style.setProperty('--c', color || '');
      r.color = color;
    }
    if (!(Math.abs(r.x - x) < 0.3 && Math.abs(r.y - y) < 0.3)) {
      r.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
      r.x = x;
      r.y = y;
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
    let e = this.popFree.pop();
    if (!e) {
      e = el('div', 'hl', '<span></span>');
      this.labels.append(e);
    }
    e.className = `hl hl-pop hl-${style}`;
    e.firstChild.textContent = text;
    e.hidden = false;
    const big = style !== 'score';
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
    c.firstChild.textContent = text;
    c.lastChild.textContent = sub;
    c.lastChild.hidden = !sub;
    c.style.setProperty('--cc', color);
    c.style.setProperty('--cs', String(size));
    c.hidden = false;
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
      () => {
        c.hidden = true;
        this.capAnim = null;
      },
    );
  }

  /**
   * Toast line (e.g. the honest snatch reason).
   * @param {string} text
   * @param {{kind?: ''|'bad'|'good'|'info', dur?: number}} [o]
   */
  toast(text, { kind = '', dur = 3000 } = {}) {
    const t = this.toastEl;
    t.textContent = text;
    t.className = `hud-toast ${kind}`;
    t.hidden = false;
    if (this.toastAnim) this.toastAnim.cancel();
    this.toastAnim = this._anim(
      t,
      [
        { transform: 'translate(-50%, 12px) scale(.9)', opacity: 0 },
        { transform: 'translate(-50%, 0) scale(1)', opacity: 1, offset: Math.min(0.2, 200 / dur) },
        { transform: 'translate(-50%, 0) scale(1)', opacity: 1, offset: 0.9 },
        { transform: 'translate(-50%, 0) scale(1)', opacity: 0 },
      ],
      { duration: dur, easing: 'ease-out' },
      () => {
        t.hidden = true;
        this.toastAnim = null;
      },
    );
  }

  // ---------------------------------------------------------------- VS splash

  /**
   * VS splash at match start. Resolves when it ends or is tapped away.
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
      this.last.ptr = null;
      return;
    }
    let x;
    let y;
    let text = label;
    let visible = true;
    if (p === 'home' || p === 'interact') {
      const b = (p === 'home' ? this.homeBtn : this.interBtn).getBoundingClientRect();
      x = b.left + b.width / 2;
      y = b.top + 4;
    } else {
      x = p.x;
      y = p.y;
      text = p.label || '';
      visible = p.visible !== false;
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
    const key = `${Math.round(x)}|${Math.round(y)}|${text}|${off ? 1 : 0}|${ang.toFixed(2)}`;
    if (key === this.last.ptr) return;
    this.last.ptr = key;
    this.ptr.hidden = false;
    this.ptr.classList.toggle('off', off);
    this.ptr.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
    this.ptr.style.setProperty('--ang', `${ang + Math.PI}rad`);
    const lbl = this.ptr.querySelector('.hp-lbl');
    if (lbl.textContent !== text) lbl.textContent = text;
    lbl.hidden = !text;
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
    window.removeEventListener('resize', this._onResize);
    this.root.innerHTML = '';
    this.mm = { world: null, base: null, lastDraw: 0, colors: null };
  }
}
