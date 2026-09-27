// Player input for the 3D edition. Touch: a floating virtual joystick where the left thumb lands (left
// 45% of the screen), look drag with the other thumb, two-finger pinch zoom, quick tap = tap-to-target.
// Mouse: drag to orbit, click to tap, wheel to zoom. Keyboard: WASD / arrows as an analog-ish stick,
// E interact, Space / H home, P / Escape pause. Pointers are tracked by pointerId, so one thumb can steer
// while the other looks or taps.
//
// Read every frame: `stick` (x right, y forward, mag 0..1), `consumeLook()` (orbit radians since the last
// call, ready for camera.orbit), `consumeZoom()` (log zoom since the last call, > 0 = out, ready for
// camera.zoom). Callbacks fire from the event handlers. Pointer listening starts on the canvas only, so
// HTML HUD buttons above it keep working; keys are read on window (ignored while typing in a field).

const STICK_ZONE = 0.45; // left fraction of the canvas where a touch starts the joystick
const STICK_R = 56; // px the knob can travel from the base centre (the base follows beyond it)
const BASE = 132; // base diameter (px)
const KNOB = 58; // knob diameter (px)
const DEAD = 0.14; // dead zone, fraction of STICK_R
const TAP_MS = 300; // a touch tap is released within this time...
const TAP_MS_MOUSE = 700;
const SLOP_TOUCH = 12; // ...having moved less than this (px)
const SLOP_MOUSE = 5;
const PINCH_WINDOW = 160; // a second finger this soon after a still first one makes a pinch (ms)
const LOOK_PER_PX = 0.0055; // radians of orbit per px of drag at sensitivity 1
const WHEEL_ZOOM = 0.0012; // log zoom per wheel pixel
const KEY_RATE = 14; // keyboard stick easing (1/s)

const MOVE_KEYS = {
  KeyW: [0, 1], ArrowUp: [0, 1],
  KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};
// Fallback when a (virtual) keyboard reports no `code`.
const KEY_TO_CODE = { w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD', e: 'KeyE', h: 'KeyH', p: 'KeyP', ' ': 'Space' };

const isTyping = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
const codeOf = (e) => e.code || KEY_TO_CODE[(e.key || '').toLowerCase()] || e.key;
// Event time on the performance.now() clock. Using the hardware timestamp keeps tap / pinch timing right
// even when a slow frame delays the handler; browsers reporting epoch times fall back to now().
const stamp = (e) => (e.timeStamp > 0 && e.timeStamp < 1e11 ? e.timeStamp : performance.now());

export class Input {
  constructor(canvas, callbacks = {}, options = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.sensitivity = 1;
    this.invertY = false;
    this.lastDevice = matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse'; // 'touch' | 'mouse' | 'keyboard'
    this._enabled = true;
    this._ghost = !!options.ghost; // faint resting joystick bottom-left as a hint (touch only)
    this.setOptions(options);

    this._ptrs = new Map(); // pointerId -> tracked pointer
    this._stickPtr = null;
    this._pinch = null; // { a, b, d, mx, my }
    this._joy = { x: 0, y: 0, mag: 0, bx: 0, by: 0 };
    this._keys = new Set();
    this._kx = 0; // keyboard target
    this._ky = 0;
    this._sx = 0; // keyboard eased value
    this._sy = 0;
    this._kt = performance.now();
    this._lookX = 0;
    this._lookY = 0;
    this._zoom = 0;
    this._stick = { x: 0, y: 0, mag: 0 };
    this._lookOut = { dx: 0, dy: 0 };
    this._fadeTimer = 0;

    this._buildJoystick();
    canvas.style.touchAction = 'none';

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onMenu = (e) => e.preventDefault();
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onBlur = () => this._clear();
    this._onVisibility = () => document.hidden && this._clear();
    this._onResize = () => this._placeGhost();

    canvas.addEventListener('pointerdown', this._onDown);
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this._onMenu);
    // Moves and ends are read on window (capture phase, so no other handler can swallow them): a pointer
    // that started on the canvas is never lost; pointers that did not start there are simply not tracked.
    window.addEventListener('pointermove', this._onMove, true);
    window.addEventListener('pointerup', this._onUp, true);
    window.addEventListener('pointercancel', this._onUp, true);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('resize', this._onResize);
    document.addEventListener('visibilitychange', this._onVisibility);
    this._placeGhost();
  }

  // Current move intent: x right, y forward, mag 0..1 (joystick while a thumb is on it, else keyboard).
  // Returns the same object every call, refreshed; copy it if you need to keep it.
  get stick() {
    const now = performance.now();
    const dt = Math.min(1, Math.max(0, (now - this._kt) / 1000)); // exponential easing: any dt is stable
    this._kt = now;
    const k = 1 - Math.exp(-KEY_RATE * dt);
    this._sx += (this._kx - this._sx) * k;
    this._sy += (this._ky - this._sy) * k;
    if (this._kx === 0 && this._ky === 0 && Math.hypot(this._sx, this._sy) < 0.03) this._sx = this._sy = 0;

    const out = this._stick;
    if (this._stickPtr) {
      out.x = this._joy.x;
      out.y = this._joy.y;
      out.mag = this._joy.mag;
    } else {
      const m = Math.hypot(this._sx, this._sy);
      const s = m > 1 ? 1 / m : 1;
      out.x = this._sx * s;
      out.y = this._sy * s;
      out.mag = Math.min(1, m);
    }
    return out;
  }

  // Accumulated look deltas in radians since the last call: dx = yaw (drag right turns the view right),
  // dy = pitch (drag down tilts toward top-down; flipped by invertY). Same object every call.
  consumeLook() {
    this._lookOut.dx = this._lookX;
    this._lookOut.dy = this._lookY;
    this._lookX = 0;
    this._lookY = 0;
    return this._lookOut;
  }

  // Accumulated zoom since the last call, logarithmic (camera distance *= e^zoom); > 0 = zoom out.
  consumeZoom() {
    const z = this._zoom;
    this._zoom = 0;
    return z;
  }

  get joystickActive() {
    return !!this._stickPtr;
  }

  // True while a finger or mouse button is dragging the camera.
  get looking() {
    for (const p of this._ptrs.values()) if (p.role !== 'stick' && !p.tapOK) return true;
    return false;
  }

  setEnabled(on) {
    on = !!on;
    if (on === this._enabled) return;
    this._enabled = on;
    if (!on) this._clear();
    this._placeGhost();
  }

  setOptions({ sensitivity, invertY, ghost } = {}) {
    if (Number.isFinite(sensitivity) && sensitivity > 0) this.sensitivity = sensitivity;
    if (typeof invertY === 'boolean') this.invertY = invertY;
    if (typeof ghost === 'boolean' && this._ui) {
      this._ghost = ghost;
      this._placeGhost();
    }
  }

  dispose() {
    if (!this._ui) return;
    this._clear();
    const c = this.canvas;
    c.removeEventListener('pointerdown', this._onDown);
    c.removeEventListener('wheel', this._onWheel, { passive: false });
    c.removeEventListener('contextmenu', this._onMenu);
    window.removeEventListener('pointermove', this._onMove, true);
    window.removeEventListener('pointerup', this._onUp, true);
    window.removeEventListener('pointercancel', this._onUp, true);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    clearTimeout(this._fadeTimer);
    this._ui.root.remove();
    this._ui = null;
    this._enabled = false;
  }

  // ------------------------------------------------------------------ pointers

  _onDown(e) {
    if (!this._enabled) return;
    const mouse = e.pointerType === 'mouse';
    if (mouse && e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    // preventDefault keeps focus where it was; move it off any field / button like a normal click would,
    // otherwise a focused settings input would keep swallowing the movement keys.
    const focused = document.activeElement;
    if (focused && focused !== document.body && focused.blur) focused.blur();
    this.lastDevice = mouse ? 'mouse' : 'touch';
    const stale = this._ptrs.get(e.pointerId);
    if (stale) this._drop(stale); // its pointerup never reached us
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {}
    const now = stamp(e);
    const p = {
      id: e.pointerId, mouse, button: e.button, role: 'look',
      x0: e.clientX, y0: e.clientY, t0: now, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY,
      tapOK: true,
    };

    if (mouse) p.role = 'mouse';
    else {
      const touches = [];
      for (const q of this._ptrs.values()) if (!q.mouse) touches.push(q);
      const r = this.canvas.getBoundingClientRect();
      const inZone = e.clientX < r.left + r.width * STICK_ZONE;
      const first = touches.length === 1 ? touches[0] : null;
      const lookers = touches.filter((q) => q.role === 'look');
      const near = first && Math.hypot(first.x - p.x, first.y - p.y) < Math.min(0.42 * r.width, 240);
      if (this._pinch) p.role = 'extra'; // a third finger during a pinch does nothing
      else if (first && first.tapOK && near && now - first.t0 < PINCH_WINDOW) {
        // Two fingers landing together close by = pinch, even across the joystick zone line (two thumbs
        // landing at once on opposite sides stay joystick + look).
        if (first.role === 'stick') this._endStick();
        this._startPinch(first, p);
      } else if (inZone && !this._stickPtr) {
        p.role = 'stick';
        this._startStick(p);
      } else if (lookers.length === 1) this._startPinch(lookers[0], p);
    }
    this._ptrs.set(p.id, p);
  }

  _onMove(e) {
    const p = this._ptrs.get(e.pointerId);
    if (!p) return;
    if (p.mouse && e.buttons === 0) {
      // The button was released where we could not see it (outside the window): end without a tap.
      this._drop(p);
      return;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    if (p.tapOK) {
      const slop = p.mouse ? SLOP_MOUSE : SLOP_TOUCH;
      const dx = p.x - p.x0;
      const dy = p.y - p.y0;
      if (dx * dx + dy * dy > slop * slop) {
        // Becomes a drag; start the look from here so crossing the slop does not jump the camera.
        p.tapOK = false;
        p.lx = p.x;
        p.ly = p.y;
      }
    }
    if (p.role === 'stick') this._moveStick(p);
    else if (p.role === 'pinch') this._movePinch();
    else if ((p.role === 'look' || p.role === 'mouse') && !p.tapOK) {
      this._addLook(p.x - p.lx, p.y - p.ly);
      p.lx = p.x;
      p.ly = p.y;
    }
  }

  _onUp(e) {
    const p = this._ptrs.get(e.pointerId);
    if (!p) return;
    this._drop(p);
    const quick = stamp(e) - p.t0 <= (p.mouse ? TAP_MS_MOUSE : TAP_MS);
    const tapRole = p.role === 'stick' || p.role === 'look' || (p.role === 'mouse' && p.button === 0);
    if (e.type === 'pointerup' && p.tapOK && quick && tapRole) {
      if (this.callbacks.onTap) this.callbacks.onTap(e.clientX, e.clientY);
    }
  }

  // Stops tracking a pointer (no tap): releases capture, ends its joystick or pinch role.
  _drop(p) {
    this._ptrs.delete(p.id);
    try {
      if (this.canvas.hasPointerCapture(p.id)) this.canvas.releasePointerCapture(p.id);
    } catch {}
    if (p.role === 'stick' && this._stickPtr === p) this._endStick();
    if (p.role === 'pinch') this._endPinch(p);
  }

  _onWheel(e) {
    if (!this._enabled) return;
    e.preventDefault();
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    // ctrl + wheel is a trackpad pinch: much smaller deltas, so boost it.
    this._zoom += Math.max(-120, Math.min(120, px)) * WHEEL_ZOOM * (e.ctrlKey ? 6 : 1);
  }

  _addLook(dxPx, dyPx) {
    const k = LOOK_PER_PX * this.sensitivity;
    this._lookX -= dxPx * k;
    this._lookY += dyPx * k * (this.invertY ? -1 : 1);
  }

  // ------------------------------------------------------------------ joystick

  _startStick(p) {
    this._stickPtr = p;
    const j = this._joy;
    j.bx = p.x;
    j.by = p.y;
    j.x = j.y = j.mag = 0;
    clearTimeout(this._fadeTimer);
    const ui = this._ui;
    ui.base.style.transition = 'opacity 90ms ease-out';
    ui.base.style.opacity = '1';
    ui.base.style.scale = '1';
    this._drawStick(0, 0);
  }

  _moveStick(p) {
    const j = this._joy;
    let dx = p.x - j.bx;
    let dy = p.y - j.by;
    let len = Math.hypot(dx, dy);
    if (len > STICK_R) {
      // The base trails the thumb, so reversing direction is instant and the stick never "runs out".
      const k = (len - STICK_R) / len;
      j.bx += dx * k;
      j.by += dy * k;
      dx = p.x - j.bx;
      dy = p.y - j.by;
      len = STICK_R;
    }
    const n = len / STICK_R;
    const mag = n <= DEAD ? 0 : Math.min(1, (n - DEAD) / (1 - DEAD));
    j.mag = mag;
    j.x = len > 0 ? (dx / len) * mag : 0;
    j.y = len > 0 ? (-dy / len) * mag : 0;
    this._drawStick(dx, dy);
  }

  _endStick() {
    this._stickPtr = null;
    const j = this._joy;
    j.x = j.y = j.mag = 0;
    if (!this._ui) return;
    this._drawStick(0, 0);
    const base = this._ui.base;
    base.style.transition = 'opacity 160ms ease-in, scale 160ms ease-in';
    base.style.opacity = '0';
    base.style.scale = '0.85';
    clearTimeout(this._fadeTimer);
    this._fadeTimer = setTimeout(() => this._placeGhost(), 220);
  }

  _drawStick(dx, dy) {
    const ui = this._ui;
    const j = this._joy;
    ui.base.style.translate = `${j.bx - BASE / 2}px ${j.by - BASE / 2}px`; // `translate`, so `scale` stays centred
    ui.knob.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    ui.arc.style.opacity = j.mag.toFixed(3);
    if (j.mag > 0) ui.arc.style.transform = `rotate(${Math.atan2(dx, -dy)}rad)`;
  }

  // Resting hint: a faint joystick bottom-left while idle (only with options.ghost on touch devices).
  _placeGhost() {
    const ui = this._ui;
    if (!ui || this._stickPtr) return;
    const show = this._enabled && this._ghost && this.lastDevice === 'touch';
    if (show) {
      const j = this._joy;
      const r = this.canvas.getBoundingClientRect();
      j.bx = r.left + 30 + BASE / 2;
      j.by = r.bottom - 150 - BASE / 2;
      this._drawStick(0, 0);
    }
    ui.base.style.transition = show ? 'opacity 400ms ease-out' : 'opacity 120ms ease-in';
    ui.base.style.scale = show ? '0.9' : '0.85';
    ui.base.style.opacity = show ? '0.35' : '0';
  }

  _buildJoystick() {
    const root = document.createElement('div');
    root.className = 'oc-joystick';
    root.setAttribute('aria-hidden', 'true');
    root.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:4;';

    const base = document.createElement('div');
    base.style.cssText = [
      'position:absolute;left:0;top:0;border-radius:50%;opacity:0;scale:0.85;will-change:translate,opacity',
      `width:${BASE}px;height:${BASE}px;box-sizing:border-box`,
      'background:radial-gradient(circle closest-side,rgba(16,40,70,0.08) 0,rgba(16,40,70,0.24) 74%,rgba(255,255,255,0.30) 76%,rgba(255,255,255,0.16) 100%)',
      'border:3px solid rgba(255,255,255,0.85)',
      'box-shadow:0 0 0 1px rgba(20,50,90,0.22),0 6px 20px rgba(10,30,60,0.28),inset 0 2px 10px rgba(10,30,60,0.18)',
    ].join(';');
    // Four chevrons marking the directions.
    const chev = (rot) =>
      `<path transform="rotate(${rot} 50 50)" d="M44 13 L50 7 L56 13" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>`;
    base.innerHTML = `<svg viewBox="0 0 100 100" width="100%" height="100%" style="position:absolute;inset:0;filter:drop-shadow(0 1px 1px rgba(20,50,90,0.35))">${chev(0)}${chev(90)}${chev(180)}${chev(270)}</svg>`;

    // Gold arc on the rim pointing where the stick is pushed; its opacity follows the magnitude.
    const arc = document.createElement('div');
    const ring = 'radial-gradient(circle closest-side,transparent 86%,#000 88%,#000 97%,transparent 99%)';
    arc.style.cssText = [
      'position:absolute;inset:-14px;border-radius:50%;opacity:0',
      'background:conic-gradient(from -60deg,rgba(255,206,61,0) 0deg,rgba(255,206,61,1) 45deg,rgba(255,206,61,1) 75deg,rgba(255,206,61,0) 120deg,transparent 120deg)',
      `-webkit-mask:${ring};mask:${ring}`,
    ].join(';');

    const knob = document.createElement('div');
    knob.style.cssText = [
      'position:absolute;border-radius:50%;box-sizing:border-box;will-change:transform',
      `width:${KNOB}px;height:${KNOB}px;left:${(BASE - 6 - KNOB) / 2}px;top:${(BASE - 6 - KNOB) / 2}px`,
      'background:radial-gradient(circle at 38% 30%,#ffffff 0,#f2f7ff 45%,#c9d9ee 100%)',
      'border:2px solid #ffffff',
      'box-shadow:0 0 0 1px rgba(20,50,90,0.2),0 5px 12px rgba(10,30,60,0.35),inset 0 -4px 0 rgba(40,70,110,0.12)',
    ].join(';');

    base.append(arc, knob);
    root.append(base);
    if (this.canvas.parentNode) this.canvas.after(root);
    else document.body.append(root);
    this._ui = { root, base, knob, arc };
  }

  // ------------------------------------------------------------------ pinch

  _startPinch(a, b) {
    a.role = 'pinch';
    b.role = 'pinch';
    a.tapOK = false;
    b.tapOK = false;
    this._pinch = { a, b, d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  _movePinch() {
    const pi = this._pinch;
    if (!pi) return;
    const { a, b } = pi;
    const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    this._zoom -= Math.log(d / pi.d); // fingers apart = zoom in
    this._addLook(mx - pi.mx, my - pi.my); // two-finger drag also orbits
    pi.d = d;
    pi.mx = mx;
    pi.my = my;
  }

  _endPinch(p) {
    const pi = this._pinch;
    this._pinch = null;
    if (!pi) return;
    // The finger left behind keeps orbiting, but can no longer become a tap.
    const other = pi.a === p ? pi.b : pi.a;
    if (this._ptrs.has(other.id)) {
      other.role = 'look';
      other.tapOK = false;
      other.lx = other.x;
      other.ly = other.y;
    }
  }

  // ------------------------------------------------------------------ keyboard

  _onKeyDown(e) {
    if (!this._enabled || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    const code = codeOf(e);
    if (MOVE_KEYS[code]) {
      e.preventDefault();
      this.lastDevice = 'keyboard';
      if (!this._keys.has(code)) {
        this._keys.add(code);
        this._keyTarget();
      }
      return;
    }
    const cb = this.callbacks;
    let fn = null;
    if (code === 'KeyE') fn = cb.onInteract;
    else if (code === 'Space' || code === 'KeyH') fn = cb.onHome;
    else if (code === 'KeyP' || code === 'Escape') fn = cb.onPause;
    else return;
    e.preventDefault(); // also stops Space from scrolling or re-clicking a focused button
    if (!e.repeat && fn) fn();
  }

  _onKeyUp(e) {
    const code = codeOf(e);
    if (code === 'Space' && this._enabled && !isTyping(e.target)) e.preventDefault();
    if (this._keys.delete(code)) this._keyTarget();
  }

  // Keyboard target direction: sum of held keys, normalised (diagonals are not faster).
  _keyTarget() {
    let x = 0;
    let y = 0;
    for (const c of this._keys) {
      x += MOVE_KEYS[c][0];
      y += MOVE_KEYS[c][1];
    }
    const m = Math.hypot(x, y);
    this._kx = m > 0 ? x / m : 0;
    this._ky = m > 0 ? y / m : 0;
  }

  // Drops every pointer, key and pending delta (disable, blur, hidden tab, dispose).
  _clear() {
    for (const p of this._ptrs.values()) {
      try {
        if (this.canvas.hasPointerCapture(p.id)) this.canvas.releasePointerCapture(p.id);
      } catch {}
    }
    this._ptrs.clear();
    this._pinch = null;
    if (this._stickPtr) this._endStick();
    this._keys.clear();
    this._kx = this._ky = this._sx = this._sy = 0;
    this._lookX = this._lookY = this._zoom = 0;
  }
}
