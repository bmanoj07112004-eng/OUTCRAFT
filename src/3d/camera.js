// Third-person camera for the 3D edition: a spring-smoothed follow rig (yaw / pitch / distance around a
// shoulder-height pivot) with orbit, zoom, target framing, a lift over buildings, cinematic modes (intro
// fly-in, victory orbit, title-screen orbit) and a decaying screen shake.
//
// Angles follow src/3d/coords.js. `yaw` is the ground direction the camera looks along, in the same
// convention as character headings: forward = (sin yaw, cos yaw) in world (x, z). So yaw = PI looks north
// (-Z) with +X (east) on the right of the screen, and "behind a player with heading h" is simply yaw = h.
// `pitch` is the camera's elevation above the pivot (0 = level, bigger = more top-down).
//
// The public yaw / pitch / distance are the follow-mode goals (what the player controls). Each mode drives
// a rig pose (pivot, yaw, pitch, distance, look-ahead); a mode change eases the rendered pose from where
// the camera was into the new rig over a short blend, so nothing ever cuts or whips.
//
// Follow framing: the default pitch, distance and lens depend on the viewport (a tall phone gets a wider
// lens and a higher, farther camera; a short landscape screen comes closer); a resize re-frames and keeps
// the player's own zoom and tilt. While the stick drives the player the yaw never turns by itself, and the
// stick keeps the yaw it was pushed with, so a held stick always runs straight. Instead of turning, the
// pivot leans toward the current target (setFocus) as far as the player stays well in view, and the
// camera rises when the target is behind the player. Only auto-runs (tap / HOME paths) gently turn the
// view toward where they go.

import * as THREE from 'three';
import { GROUND_Y } from './coords.js';

const TAU = Math.PI * 2;
const SHOULDER = 1.4; // follow pivot height above the ground (m)
const MIN_CAM_Y = GROUND_Y + 0.45; // the camera never dips below this
const FOLLOW_OMEGA = 9; // pivot spring stiffness (critically damped)
const SNAP_DIST = 14; // target jumps farther than this snap instead of gliding
const ANGLE_RATE = 16; // follow easing of yaw / pitch toward the goals (1/s)
const DIST_RATE = 10; // follow easing of the distance (1/s)
const ALIGN_DELAY = 1.6; // seconds after a manual orbit before auto-align resumes
const ALIGN_GAIN = 1.4; // auto-run align turn speed per radian of misalignment (1/s)
const ALIGN_MAX = 1.0; // ...capped at this many rad/s
const ALIGN_MIN_DIST = 3; // an auto-run aligns toward its target while it is at least this far (m)
const STICK_ON = 0.12; // stick magnitude that moves the player (the sim's dead zone)
const LATCH_OFF = 0.2; // below this magnitude the stick lets go of its latched yaw
const LATCH_TURN = 0.52; // the stick turning more than this (rad) re-latches to the current view
const LEAN = 0.5; // pivot lean toward the focus, as a fraction of the player -> focus distance...
const LEAN_MAX = 8; // ...capped (m)
const LEAN_RATE = 3; // lean easing (1/s)
const BEHIND_M = 8; // a focus this far behind the player (along the view) counts as fully behind
const BACK_RATE = 2.5; // easing of the rise for a focus behind (1/s)
// While leaning, the player's feet and head stay inside this part of the screen (NDC), clear of the HUD.
const SAFE_X = 0.72;
const SAFE_BOTTOM = -0.56;
const SAFE_TOP = 0.5;
const LIFT_RATE = 0.8; // max pitch rate of the lift over buildings (rad/s)
const SHAKE_DECAY = 1.7; // trauma lost per second
const SHAKE_MOVE = 0.32; // max positional shake (m) at full trauma
const SHAKE_ROLL = 0.035; // max roll (rad) at full trauma

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (a) => a - TAU * Math.floor((a + Math.PI) / TAU); // -> [-PI, PI)
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);
const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const aspectOf = (cam) => (Number.isFinite(cam.aspect) && cam.aspect > 0 ? cam.aspect : 1);
const pose = () => ({ px: 0, py: SHOULDER, pz: 0, y: Math.PI, p: 0.55, d: 10, lead: 0 });
const copyPose = (to, from) => Object.assign(to, from);

// Default follow framing for a viewport (CSS px). 0 = portrait .. 1 = landscape; short landscape screens
// (phones on their side) come closer so the characters are not tiny.
function framing(aspect, height, out) {
  const t = smoothstep(0.6, 1.25, aspect);
  const short = t * (1 - smoothstep(430, 700, height));
  out.fov = lerp(60, 55, t);
  out.pitch = lerp(0.8, 0.7, t);
  out.distance = lerp(14, 11, t) - 2 * short;
  out.backPitch = lerp(1.0, 0.95, t); // pitch when the focus is behind the player...
  out.backDist = lerp(0.11, 0.18, t); // ...and the extra distance, as a fraction
  return out;
}

export class ThirdPersonCamera {
  constructor(camera) {
    this.camera = camera;
    this.viewHeight = (typeof window !== 'undefined' && window.innerHeight) || 800; // CSS px, for framing
    this._frame = framing(aspectOf(camera), this.viewHeight, {});
    this._frameKey = 0;
    // Follow goals (player controlled; safe to set directly).
    this.yaw = Math.PI;
    this.pitch = this._frame.pitch;
    this.distance = this._frame.distance;
    this.minPitch = 0.2;
    this.maxPitch = 1.2;
    this.minDistance = this._frame.distance * 0.6;
    this.maxDistance = this._frame.distance * 1.5;
    this.autoAlign = true; // auto-runs (not the stick) turn the view gently toward where they go
    this.lookAhead = 0.22; // aim point ahead of the player, as a fraction of the distance
    this.lift = 0; // extra pitch (rad) on top of the follow goal, e.g. to look over a building in the way
    this._liftNow = 0; // eased lift

    this._mode = 'follow';
    this._time = 0;
    this._lastOrbit = -1e9;
    this._trauma = 0;

    // Follow target (world metres) and the player's heading / speed fraction.
    this._tx = 0;
    this._tz = 0;
    this._heading = Math.PI;
    this._moving = 0;
    // Focus (what the player goes for next), the eased pivot lean toward it and the eased rise (0..1)
    // for a focus behind the player.
    this._focus = { on: false, x: 0, z: 0 };
    this._leanX = 0;
    this._leanZ = 0;
    this._back = 0;
    // Stick: when it last moved the player, and the yaw it is latched to while held.
    this._stickT = -1e9;
    this._latch = { on: false, yaw: 0, ang: 0 };

    // Poses: the current mode's rig, the rendered output, and the start of a blend between them.
    this._rig = pose();
    this._out = pose();
    this._from = pose();
    this._sx = 0; // follow pivot spring position (before the lean) and velocity
    this._sz = 0;
    this._vx = 0;
    this._vz = 0;
    this._blendT = 0;
    this._blendDur = 0; // 0 = not blending
    this._rebase = false; // align the blend's start yaw with the new rig on the next render

    // Cinematic state.
    this._intro = null; // { t, dur, cx, cy, cz, y0, p0, d0, done }
    this._orbit = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0.6, dist: 30, speed: 0.06 };

    this._pos = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._ndc = { x: 0, y: 0 };
    this.snap();
  }

  get mode() {
    return this._mode; // 'follow' | 'intro' | 'victory' | 'menu'
  }

  // Manual orbit (look drag). Radians; positive dPitch raises the camera (more top-down).
  orbit(dYaw, dPitch) {
    if (this._mode !== 'follow') return;
    if (!Number.isFinite(dYaw) || !Number.isFinite(dPitch) || (dYaw === 0 && dPitch === 0)) return;
    this.yaw += dYaw;
    this.pitch = clamp(this.pitch + dPitch, this.minPitch, this.maxPitch);
    // A deliberate turn keeps a held stick camera-relative.
    if (this._latch.on) this._latch.yaw += dYaw;
    this._lastOrbit = this._time;
  }

  // Pinch / wheel zoom. delta is logarithmic: distance *= e^delta (delta > 0 zooms out).
  zoom(delta) {
    if (!Number.isFinite(delta) || delta === 0) return;
    this.distance = clamp(this.distance * Math.exp(delta), this.minDistance, this.maxDistance);
  }

  // Target to follow: world metres, heading in rotation.y convention, moving = speed fraction 0..1.
  follow(x, z, heading, moving = 0) {
    if (Number.isFinite(x) && Number.isFinite(z)) {
      this._tx = x;
      this._tz = z;
    }
    if (Number.isFinite(heading)) this._heading = heading;
    this._moving = Number.isFinite(moving) ? clamp(moving, 0, 1) : 0;
  }

  // What the player goes for next (world metres), or setFocus(null). In follow mode the view leans toward
  // it, rises when it is behind the player, and auto-runs turn toward it. Any cinematic clears it.
  setFocus(x, z) {
    const f = this._focus;
    f.on = x !== null && x !== undefined && Number.isFinite(x) && Number.isFinite(z);
    if (f.on) {
      f.x = x;
      f.z = z;
    }
  }

  // Back to follow mode behind (x, z) looking along yaw (default north): snapped, or with snap = false
  // a smooth glide from wherever the camera is (e.g. out of the victory orbit).
  reset(x, z, yaw = Math.PI, snap = true) {
    yaw = Number.isFinite(yaw) ? yaw : Math.PI;
    if (!snap) this._beginBlend(0.9);
    this._mode = 'follow';
    this._intro = null;
    this._clearFocus();
    this.follow(x, z, yaw, 0);
    this.yaw = this._out.y + wrap(yaw - this._out.y);
    this._lastOrbit = -1e9;
    this._sanitize();
    this._snapRig();
    if (snap) this._blendDur = 0;
    this._apply();
  }

  // Jump straight to the current mode's pose (no easing, no blend), e.g. after a teleport.
  snap() {
    this._snapRig();
    this._blendDur = 0;
    this._apply();
  }

  // Camera-relative stick (jx right, jy forward) -> world ground direction { x, z } (x east, z south).
  // Pure rotation by the view's yaw goal, so the length is the stick magnitude (a unit vector at full
  // tilt, clamped to 1). While the stick is held it keeps the yaw it was pushed with (manual orbits turn
  // it along; it re-latches when the stick turns more than ~30 degrees or is let go), so nothing the
  // camera does by itself bends the run. Pass `out` to avoid allocating.
  moveFromStick(jx, jy, out = { x: 0, z: 0 }) {
    jx = Number.isFinite(jx) ? jx : 0;
    jy = Number.isFinite(jy) ? jy : 0;
    const mag = Math.hypot(jx, jy);
    const L = this._latch;
    if (mag >= STICK_ON) this._stickT = this._time;
    let yaw = this.yaw;
    if (mag < LATCH_OFF) L.on = false;
    else {
      const ang = Math.atan2(jx, jy);
      if (!L.on || Math.abs(wrap(ang - L.ang)) > LATCH_TURN) {
        L.on = true;
        L.yaw = this.yaw;
        L.ang = ang;
      }
      yaw = L.yaw;
    }
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    let x = -c * jx + s * jy;
    let z = s * jx + c * jy;
    const m = Math.hypot(x, z);
    if (m > 1) {
      x /= m;
      z /= m;
    }
    out.x = x;
    out.z = z;
    return out;
  }

  // World position the follow camera is heading for (current pivot, goal angles, no building lift) with
  // `extraPitch` added: for occlusion tests. `out` is any { x, y, z } (e.g. a THREE.Vector3).
  eye(out, extraPitch = 0) {
    const r = this._rig;
    const p = clamp(this._goalPitch() + extraPitch, this.minPitch, 1.45);
    const d = this._goalDistance();
    const cp = Math.cos(p);
    out.x = r.px - Math.sin(this.yaw) * cp * d;
    out.y = r.py + Math.sin(p) * d;
    out.z = r.pz - Math.cos(this.yaw) * cp * d;
    return out;
  }

  // Sweeping fly-in: starts high over `center` ({ x, z }, e.g. the island centre), circles in and lands
  // behind the follow target looking along `yaw` (default north). done() fires once when it ends or is
  // skipped. Call follow() first so the camera knows where the player is.
  intro(center, done, { duration = 3.4, yaw = Math.PI } = {}) {
    const aspect = aspectOf(this.camera);
    this._beginBlend(0.5); // eases out of whatever the camera was showing
    this._mode = 'intro';
    this._clearFocus();
    this.yaw = Number.isFinite(yaw) ? yaw : Math.PI;
    this._lastOrbit = -1e9;
    this._sanitize();
    this._intro = {
      t: 0,
      dur: Number.isFinite(duration) ? Math.max(0.1, duration) : 3.4,
      cx: (center && center.x) || 0,
      cy: (center && center.y) || 0,
      cz: (center && center.z) || 0,
      y0: this.yaw + 2.3,
      p0: 1.08,
      d0: 30 / Math.min(1, aspect * 1.25),
      done: typeof done === 'function' ? done : null,
    };
    this._stepIntro(0);
    this._apply();
  }

  // Ends the intro now (done() fires immediately); the camera glides into the follow view.
  skipIntro() {
    if (this._mode !== 'intro') return;
    this._beginBlend(0.7);
    this._endIntro();
  }

  // Slow orbit around the player at (x, z): swings round to face them, then circles. Calling it again
  // while the victory orbit runs only moves its centre.
  victory(x, z) {
    const o = this._orbit;
    x = Number.isFinite(x) ? x : this._tx;
    z = Number.isFinite(z) ? z : this._tz;
    if (this._mode === 'victory') {
      o.x = x;
      o.z = z;
      return;
    }
    this._beginBlend(1.1);
    this._mode = 'victory';
    this._intro = null;
    this._clearFocus();
    const front = this._heading + Math.PI;
    Object.assign(o, { x, y: 1.0, z, yaw: this._out.y + wrap(front - this._out.y), pitch: 0.32, dist: 6.5, speed: 0.28 });
    this._snapRig();
  }

  // Slow orbit for the title screen / attract mode around `center` ({ x, y?, z }). Blends in from the
  // current view unless snap is set; calling it again while in menu mode just moves the orbit.
  menuOrbit(center, { distance, pitch = 0.62, speed = 0.06, snap = false } = {}) {
    const o = this._orbit;
    const wasMenu = this._mode === 'menu';
    const x = (center && center.x) || 0;
    const y = (center && center.y) || 0;
    const z = (center && center.z) || 0;
    const p = Number.isFinite(pitch) ? pitch : 0.62;
    const d = distance > 0 ? distance : 28 / Math.min(1, aspectOf(this.camera) * 1.3);
    const sp = Number.isFinite(speed) ? speed : 0.06;
    // Same orbit again (e.g. called every frame): nothing to do, keep turning.
    if (wasMenu && !snap && o.x === x && o.y === y && o.z === z && o.pitch === p && o.dist === d && o.speed === sp) return;
    if (!snap) this._beginBlend(1.2);
    this._mode = 'menu';
    this._intro = null;
    this._clearFocus();
    Object.assign(o, { x, y, z, yaw: wasMenu ? o.yaw : this._out.y, pitch: p, dist: d, speed: sp });
    this._snapRig();
    if (snap) {
      this._blendDur = 0;
      this._apply();
    }
  }

  // Screen shake: adds trauma (0..1); the shake grows with trauma squared and decays over ~0.6 s.
  shake(amount = 0.4) {
    if (Number.isFinite(amount) && amount > 0) this._trauma = Math.min(1, this._trauma + amount);
  }

  update(dt) {
    dt = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
    this._time += dt;
    this._reframe();
    if (this._mode === 'intro') this._stepIntro(dt);
    else if (this._mode === 'follow') this._stepFollow(dt);
    else this._stepOrbit(dt);
    if (this._blendDur > 0) {
      this._blendT += dt;
      if (this._blendT >= this._blendDur) this._blendDur = 0;
    }
    this._trauma = Math.max(0, this._trauma - SHAKE_DECAY * dt);
    this._apply();
  }

  // ------------------------------------------------------------------ internals

  // Starts easing the rendered pose from where it is now into whatever the rig does next.
  _beginBlend(dur) {
    copyPose(this._from, this._out);
    this._blendT = 0;
    this._blendDur = dur;
    this._rebase = true;
  }

  _clearFocus() {
    this._focus.on = false;
    this._leanX = 0;
    this._leanZ = 0;
    this._back = 0;
    this._liftNow = 0;
  }

  // Re-frames for a new viewport shape: the defaults change, the player's own zoom and tilt carry over.
  _reframe() {
    const a = aspectOf(this.camera);
    const h = Number.isFinite(this.viewHeight) && this.viewHeight > 0 ? this.viewHeight : 800;
    const key = a * 1e4 + h;
    if (key === this._frameKey) return;
    this._frameKey = key;
    const old = this._frame;
    const oldPitch = old.pitch;
    const oldDist = old.distance;
    framing(a, h, old);
    this.minDistance = old.distance * 0.6;
    this.maxDistance = old.distance * 1.5;
    this.pitch = clamp(this.pitch + old.pitch - oldPitch, this.minPitch, this.maxPitch);
    this.distance = clamp(this.distance * (old.distance / oldDist), this.minDistance, this.maxDistance);
  }

  // Follow goals with the rise for a focus behind the player (the building lift comes on top).
  _goalPitch() {
    const f = this._frame;
    return clamp(this.pitch + this._back * Math.max(0, f.backPitch - f.pitch), this.minPitch, this.maxPitch);
  }

  _goalDistance() {
    return this.distance * (1 + this._back * this._frame.backDist);
  }

  // Shifts every stored yaw by k (a whole number of turns) so angles stay small without any visible jump.
  _shiftYaw(k) {
    this._rig.y -= k;
    this._out.y -= k;
    this._from.y -= k;
    this._latch.yaw -= k;
  }

  // Puts the rig exactly on the current mode's goals.
  _snapRig() {
    const r = this._rig;
    if (this._mode === 'follow' || this._mode === 'intro') {
      this._sx = this._tx;
      this._sz = this._tz;
      r.px = this._tx + this._leanX;
      r.py = SHOULDER;
      r.pz = this._tz + this._leanZ;
      r.y = this.yaw;
      r.p = this._goalPitch();
      r.d = this._goalDistance();
      r.lead = this.lookAhead * (1 - this._back);
      if (this._mode === 'intro') this._stepIntro(0);
    } else {
      const o = this._orbit;
      r.px = o.x;
      r.py = o.y;
      r.pz = o.z;
      r.y = o.yaw;
      r.p = o.pitch;
      r.d = o.dist;
      r.lead = 0;
    }
    this._vx = 0;
    this._vz = 0;
  }

  _stepFollow(dt) {
    this._sanitize();
    const F = this._focus;
    const stick = this._time - this._stickT < 0.3;
    let fdx = 0;
    let fdz = 0;
    let fd = 0;
    if (F.on) {
      fdx = F.x - this._tx;
      fdz = F.z - this._tz;
      fd = Math.hypot(fdx, fdz);
    }

    // Auto-align, for auto-runs only (tap / HOME paths; never while the stick drives or just after a
    // manual orbit): turn gently toward the target, or the running direction when there is none nearby.
    if (this.autoAlign && !stick && this._moving > 0.15 && this._time - this._lastOrbit > ALIGN_DELAY) {
      const dir = fd > ALIGN_MIN_DIST ? Math.atan2(fdx, fdz) : this._heading;
      const diff = wrap(dir - this.yaw);
      const ad = Math.abs(diff);
      const rate = Math.min(ALIGN_MAX, ALIGN_GAIN * ad) * this._moving;
      this.yaw += Math.sign(diff) * Math.min(ad, rate * dt);
    }

    // Lean toward the focus (half way, capped, as far as the player stays well in view) and rise when it
    // lies behind the player.
    let wx = 0;
    let wz = 0;
    let behind = 0;
    if (fd > 0.01) {
      const k = Math.min(LEAN * fd, LEAN_MAX) / fd;
      wx = fdx * k;
      wz = fdz * k;
      behind = clamp(-(fdx * Math.sin(this.yaw) + fdz * Math.cos(this.yaw)) / BEHIND_M, 0, 1);
    }
    this._back += (behind - this._back) * ease(BACK_RATE, dt);
    if (wx !== 0 || wz !== 0) {
      const fit = this._fitLean(wx, wz);
      wx *= fit;
      wz *= fit;
    }
    const kl = ease(LEAN_RATE, dt);
    this._leanX += (wx - this._leanX) * kl;
    this._leanZ += (wz - this._leanZ) * kl;

    // Critically damped spring on the pivot (stable for any dt).
    const r = this._rig;
    const dx = this._sx - this._tx;
    const dz = this._sz - this._tz;
    if (dx * dx + dz * dz > SNAP_DIST * SNAP_DIST) {
      this._sx = this._tx;
      this._sz = this._tz;
      this._vx = 0;
      this._vz = 0;
    } else {
      const w = FOLLOW_OMEGA;
      const k = w * dt;
      const e = 1 / (1 + k + 0.48 * k * k + 0.235 * k * k * k);
      const tx = (this._vx + w * dx) * dt;
      const tz = (this._vz + w * dz) * dt;
      this._vx = (this._vx - w * tx) * e;
      this._vz = (this._vz - w * tz) * e;
      this._sx = this._tx + (dx + tx) * e;
      this._sz = this._tz + (dz + tz) * e;
    }
    r.px = this._sx + this._leanX;
    r.pz = this._sz + this._leanZ;
    r.py = lerp(r.py, SHOULDER, ease(6, dt));

    // Building lift: eased, and never faster than LIFT_RATE.
    const lift = Number.isFinite(this.lift) ? clamp(this.lift, 0, 0.6) : 0;
    const dl = (lift - this._liftNow) * ease(4, dt);
    this._liftNow += clamp(dl, -LIFT_RATE * dt, LIFT_RATE * dt);

    const a = ease(ANGLE_RATE, dt);
    r.y += wrap(this.yaw - r.y) * a;
    r.p += (clamp(this._goalPitch() + this._liftNow, this.minPitch, 1.45) - r.p) * a;
    r.d += (this._goalDistance() - r.d) * ease(DIST_RATE, dt);
    r.lead += (this.lookAhead * (1 - this._back) - r.lead) * ease(4, dt);
  }

  // Largest fraction (0..1) of the lean (wx, wz) that keeps the player's feet and head inside the safe
  // part of the screen, seen from the follow goals.
  _fitLean(wx, wz) {
    if (this._safe(1, wx, wz)) return 1;
    if (!this._safe(0, wx, wz)) return 0;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2;
      if (this._safe(mid, wx, wz)) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  _safe(k, wx, wz) {
    const px = this._tx + wx * k;
    const pz = this._tz + wz * k;
    const n = this._ndc;
    this._project(px, pz, this._tx, 0.1, this._tz, n);
    if (n.y < SAFE_BOTTOM || Math.abs(n.x) > SAFE_X) return false;
    this._project(px, pz, this._tx, 1.8, this._tz, n);
    return n.y <= SAFE_TOP && Math.abs(n.x) <= SAFE_X;
  }

  // NDC of the world point (x, y, z) seen from the follow goals with the pivot at (px, pz). No allocations.
  _project(px, pz, x, y, z, out) {
    const p = this._goalPitch() + this._liftNow;
    const d = this._goalDistance();
    const lead = this.lookAhead * (1 - this._back) * d;
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    const cp = Math.cos(p);
    const ex = px - sy * cp * d;
    const ey = SHOULDER + Math.sin(p) * d;
    const ez = pz - cy * cp * d;
    // forward (to the look point), right = forward x up, up = right x forward
    let fx = px + sy * lead - ex;
    let fy = SHOULDER - ey;
    let fz = pz + cy * lead - ez;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl;
    fy /= fl;
    fz /= fl;
    let rx = -fz;
    let rz = fx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl;
    rz /= rl;
    const ux = -rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy;
    const vx = x - ex;
    const vy = y - ey;
    const vz = z - ez;
    const depth = Math.max(0.1, vx * fx + vy * fy + vz * fz);
    const tv = Math.tan((this._frame.fov * Math.PI) / 360);
    out.x = (vx * rx + vz * rz) / (depth * tv * aspectOf(this.camera));
    out.y = (vx * ux + vy * uy + vz * uz) / (depth * tv);
    return out;
  }

  _stepOrbit(dt) {
    const o = this._orbit;
    const r = this._rig;
    o.yaw += o.speed * dt;
    if (Math.abs(o.yaw) > 4 * TAU) {
      const k = TAU * Math.round(o.yaw / TAU);
      o.yaw -= k;
      this._shiftYaw(k);
    }
    r.px = o.x;
    r.py = o.y;
    r.pz = o.z;
    r.y = o.yaw;
    r.p = o.pitch;
    r.d = o.dist;
    r.lead = 0;
  }

  _stepIntro(dt) {
    const it = this._intro;
    const r = this._rig;
    this._sanitize();
    it.t += dt;
    const u = clamp(it.t / it.dur, 0, 1);
    const e = easeInOut(u);
    const ep = smoothstep(0.2, 1, u); // the pivot leaves the island centre a little later
    r.y = lerp(it.y0, this.yaw, e);
    r.p = lerp(it.p0, this.pitch, e);
    r.d = Math.exp(lerp(Math.log(it.d0), Math.log(this.distance), e));
    r.px = lerp(it.cx, this._tx, ep);
    r.py = lerp(it.cy, SHOULDER, ep);
    r.pz = lerp(it.cz, this._tz, ep);
    r.lead = this.lookAhead * e;
    this._vx = 0;
    this._vz = 0;
    if (u >= 1) this._endIntro();
  }

  _endIntro() {
    const done = this._intro && this._intro.done;
    this._intro = null;
    this._mode = 'follow';
    this._lastOrbit = -1e9;
    this._snapRig(); // the natural end is already here; a skip blends from the intro pose
    if (done) done();
  }

  // Repairs follow goals set from outside (NaN, out of range) and keeps the goal yaw near zero turns so
  // it never loses precision (the rig and the rendered yaw move with it).
  _sanitize() {
    if (!Number.isFinite(this.yaw)) this.yaw = Number.isFinite(this._out.y) ? this._out.y : Math.PI;
    if (!Number.isFinite(this.pitch)) this.pitch = this._frame.pitch;
    if (!Number.isFinite(this.distance)) this.distance = this._frame.distance;
    this.pitch = clamp(this.pitch, this.minPitch, this.maxPitch);
    this.distance = clamp(this.distance, this.minDistance, this.maxDistance);
    if (Math.abs(this.yaw) > 4 * TAU) {
      const k = TAU * Math.round(this.yaw / TAU);
      this.yaw -= k;
      if (this._intro) this._intro.y0 -= k;
      this._shiftYaw(k);
    }
  }

  // Renders: blends the rig into the output pose, then places the THREE camera (+ shake).
  _apply() {
    const r = this._rig;
    const o = this._out;
    if (this._blendDur > 0) {
      const f = this._from;
      // Once per blend: take the short way round from the old yaw to the new rig, then follow the rig
      // continuously (no re-wrapping mid-blend, which could flip direction while the rig keeps turning).
      if (this._rebase) {
        f.y = r.y + wrap(f.y - r.y);
        this._rebase = false;
      }
      const u = easeInOut(clamp(this._blendT / this._blendDur, 0, 1));
      o.px = lerp(f.px, r.px, u);
      o.py = lerp(f.py, r.py, u);
      o.pz = lerp(f.pz, r.pz, u);
      o.y = lerp(f.y, r.y, u);
      o.p = lerp(f.p, r.p, u);
      o.d = Math.exp(lerp(Math.log(f.d), Math.log(r.d), u));
      o.lead = lerp(f.lead, r.lead, u);
    } else copyPose(o, r);

    const cam = this.camera;
    if (Math.abs(cam.fov - this._frame.fov) > 1e-4) {
      cam.fov = this._frame.fov;
      cam.updateProjectionMatrix();
    }
    const sy = Math.sin(o.y);
    const cy = Math.cos(o.y);
    const cp = Math.cos(o.p);
    const sp = Math.sin(o.p);
    const lead = o.lead * o.d;
    const pos = this._pos.set(o.px - sy * cp * o.d, o.py + sp * o.d, o.pz - cy * cp * o.d);
    const look = this._look.set(o.px + sy * lead, o.py, o.pz + cy * lead);

    let roll = 0;
    if (this._trauma > 0) {
      // Cheap smooth noise from a few incommensurate sines (no allocations, no random jumps).
      const s = this._trauma * this._trauma;
      const t = this._time * 38;
      const nx = Math.sin(t * 1.0) * 0.6 + Math.sin(t * 2.31 + 1.7) * 0.4;
      const ny = Math.sin(t * 1.17 + 4.1) * 0.6 + Math.sin(t * 2.73 + 0.3) * 0.4;
      const nr = Math.sin(t * 0.83 + 2.2) * 0.7 + Math.sin(t * 1.91 + 5.3) * 0.3;
      pos.x += nx * SHAKE_MOVE * s * cy;
      pos.z -= nx * SHAKE_MOVE * s * sy;
      pos.y += ny * SHAKE_MOVE * s;
      look.x += nx * SHAKE_MOVE * s * 0.5 * cy;
      look.z -= nx * SHAKE_MOVE * s * 0.5 * sy;
      look.y += ny * SHAKE_MOVE * s * 0.5;
      roll = nr * SHAKE_ROLL * s;
    }
    if (pos.y < MIN_CAM_Y) pos.y = MIN_CAM_Y;

    cam.position.copy(pos);
    cam.lookAt(look);
    if (roll) cam.rotateZ(roll);
    cam.updateMatrixWorld();
  }
}
