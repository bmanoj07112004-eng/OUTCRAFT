// Third-person camera for the 3D edition: a spring-smoothed follow rig (yaw / pitch / distance around a
// shoulder-height pivot) with orbit, zoom, a gentle auto-align behind the running player, cinematic modes
// (intro fly-in, victory orbit, title-screen orbit) and a decaying screen shake.
//
// Angles follow src/3d/coords.js. `yaw` is the ground direction the camera looks along, in the same
// convention as character headings: forward = (sin yaw, cos yaw) in world (x, z). So yaw = PI looks north
// (-Z) with +X (east) on the right of the screen, and "behind a player with heading h" is simply yaw = h.
// `pitch` is the camera's elevation above the pivot (0 = level, bigger = more top-down).
//
// The public yaw / pitch / distance are the follow-mode goals (what the player controls). Each mode drives
// a rig pose (pivot, yaw, pitch, distance, look-ahead); a mode change eases the rendered pose from where
// the camera was into the new rig over a short blend, so nothing ever cuts or whips.

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
const ALIGN_GAIN = 1.4; // auto-align turn speed per radian of misalignment (1/s)
const ALIGN_MAX = 0.4; // ...capped at this many rad/s
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

export class ThirdPersonCamera {
  constructor(camera) {
    this.camera = camera;
    // Follow goals (player controlled; safe to set directly).
    this.yaw = Math.PI;
    this.pitch = 0.55;
    this.distance = 10;
    this.minPitch = 0.2;
    this.maxPitch = 1.2;
    this.minDistance = 6;
    this.maxDistance = 16;
    this.autoAlign = true; // turn gently behind the player while running
    this.lookAhead = 0.22; // aim point ahead of the player, as a fraction of the distance

    this._mode = 'follow';
    this._time = 0;
    this._lastOrbit = -1e9;
    this._trauma = 0;

    // Follow target (world metres) and the player's heading / speed fraction.
    this._tx = 0;
    this._tz = 0;
    this._heading = Math.PI;
    this._moving = 0;

    // Poses: the current mode's rig, the rendered output, and the start of a blend between them.
    this._rig = pose();
    this._out = pose();
    this._from = pose();
    this._vx = 0; // pivot spring velocity
    this._vz = 0;
    this._blendT = 0;
    this._blendDur = 0; // 0 = not blending
    this._rebase = false; // align the blend's start yaw with the new rig on the next render

    // Cinematic state.
    this._intro = null; // { t, dur, cx, cy, cz, y0, p0, d0, done }
    this._orbit = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0.6, dist: 30, speed: 0.06 };

    this._pos = new THREE.Vector3();
    this._look = new THREE.Vector3();
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

  // Back to follow mode behind (x, z) looking along yaw (default north): snapped, or with snap = false
  // a smooth glide from wherever the camera is (e.g. out of the victory orbit).
  reset(x, z, yaw = Math.PI, snap = true) {
    yaw = Number.isFinite(yaw) ? yaw : Math.PI;
    if (!snap) this._beginBlend(0.9);
    this._mode = 'follow';
    this._intro = null;
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
  // Pure rotation by the rendered yaw, so the length is the stick magnitude (a unit vector at full tilt,
  // clamped to 1). Pass `out` to avoid allocating.
  moveFromStick(jx, jy, out = { x: 0, z: 0 }) {
    jx = Number.isFinite(jx) ? jx : 0;
    jy = Number.isFinite(jy) ? jy : 0;
    const s = Math.sin(this._out.y);
    const c = Math.cos(this._out.y);
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

  // Sweeping fly-in: starts high over `center` ({ x, z }, e.g. the island centre), circles in and lands
  // behind the follow target looking along `yaw` (default north). done() fires once when it ends or is
  // skipped. Call follow() first so the camera knows where the player is.
  intro(center, done, { duration = 3.4, yaw = Math.PI } = {}) {
    const aspect = aspectOf(this.camera);
    this._beginBlend(0.5); // eases out of whatever the camera was showing
    this._mode = 'intro';
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

  // Shifts every stored yaw by k (a whole number of turns) so angles stay small without any visible jump.
  _shiftYaw(k) {
    this._rig.y -= k;
    this._out.y -= k;
    this._from.y -= k;
  }

  // Puts the rig exactly on the current mode's goals.
  _snapRig() {
    const r = this._rig;
    if (this._mode === 'follow' || this._mode === 'intro') {
      r.px = this._tx;
      r.py = SHOULDER;
      r.pz = this._tz;
      r.y = this.yaw;
      r.p = this.pitch;
      r.d = this.distance;
      r.lead = this.lookAhead;
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
    // Gentle auto-align: turn toward the running direction, never while (or just after) the player
    // orbits, fading out for sideways / backwards running so strafing does not spin the camera.
    if (this.autoAlign && this._moving > 0.15 && this._time - this._lastOrbit > ALIGN_DELAY) {
      const diff = wrap(this._heading - this.yaw);
      const ad = Math.abs(diff);
      const fade = 1 - smoothstep(0.9, 1.9, ad);
      const rate = Math.min(ALIGN_MAX, ALIGN_GAIN * ad) * this._moving * fade;
      this.yaw += Math.sign(diff) * Math.min(ad, rate * dt);
    }

    // Critically damped spring on the pivot (stable for any dt).
    const r = this._rig;
    const dx = r.px - this._tx;
    const dz = r.pz - this._tz;
    if (dx * dx + dz * dz > SNAP_DIST * SNAP_DIST) {
      r.px = this._tx;
      r.pz = this._tz;
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
      r.px = this._tx + (dx + tx) * e;
      r.pz = this._tz + (dz + tz) * e;
    }
    r.py = lerp(r.py, SHOULDER, ease(6, dt));

    const a = ease(ANGLE_RATE, dt);
    r.y += wrap(this.yaw - r.y) * a;
    r.p += (this.pitch - r.p) * a;
    r.d += (this.distance - r.d) * ease(DIST_RATE, dt);
    r.lead += (this.lookAhead - r.lead) * ease(4, dt);
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
    if (!Number.isFinite(this.pitch)) this.pitch = 0.55;
    if (!Number.isFinite(this.distance)) this.distance = 10;
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
