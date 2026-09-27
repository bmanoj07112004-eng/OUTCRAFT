// Visual effects for the 3D island: one pooled particle system (bursts, trail puffs), tumbling confetti,
// expanding ground rings, the rival's dotted route line, and the theme's ambient life (butterflies, dust,
// snow, embers, sparkles, drifting clouds). Everything is preallocated: effects reuse pool slots and the
// per-frame update never allocates. Also exports the instanced ground-decal mesh the island uses for its
// node rings, target markers and blob shadows.

import * as THREE from 'three';
import { TILE, CX, CY, GROUND_Y, WATER_Y } from './coords.js';

const TAU = Math.PI * 2;
const DANGER = '#ff4d6d';
const rand = Math.random;

// ------------------------------------------------------------------ ground decals
// Flat quads lying on the ground; every instance has a colour and aParams = (alpha, fill, dash, ring):
// "marker" = soft ring band (dash > 0.5 cuts it into 4 arcs) plus an optional soft centre fill,
// "dot" = crisp disc with a white rim (route dots), "shadow" = soft dark blob.
const DECAL_VERT = /* glsl */ `
attribute vec4 aParams;
varying vec2 vUv;
varying vec3 vCol;
varying vec4 vP;
void main() {
  vUv = uv * 2.0 - 1.0;
  vP = aParams;
  #ifdef USE_INSTANCING_COLOR
    vCol = instanceColor;
  #else
    vCol = vec3(1.0);
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const DECAL_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
varying vec4 vP;
void main() {
  float r = length(vUv);
  if (r > 1.0 || vP.x < 0.004) discard;
  #if defined(SHADOW)
    float a = vP.x * pow(1.0 - smoothstep(0.0, 1.0, r), 1.5);
    gl_FragColor = vec4(vCol, a);
  #elif defined(DOT)
    float a = vP.x * (1.0 - smoothstep(0.8, 0.98, r));
    gl_FragColor = vec4(mix(vCol, vec3(1.0), smoothstep(0.52, 0.68, r)), a);
  #else
    float band = smoothstep(0.64, 0.75, r) * (1.0 - smoothstep(0.88, 0.99, r));
    if (vP.z > 0.5) band *= smoothstep(-0.25, 0.35, sin(atan(vUv.y, vUv.x) * 4.0));
    float fill = 1.0 - smoothstep(0.05, 0.95, r);
    float a = vP.x * min(1.0, band * vP.w + fill * vP.y);
    gl_FragColor = vec4(vCol * (1.0 + band * 0.3), a);
  #endif
  if (gl_FragColor.a < 0.004) discard;
  #include <colorspace_fragment>
}`;

const _dm = new THREE.Matrix4();
const _dq = new THREE.Quaternion();
const _dp = new THREE.Vector3();
const _ds = new THREE.Vector3();
const _dc = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);

// count instances of mode 'marker' | 'dot' | 'shadow'. Owner disposes geometry and material.
export function makeDecalMesh(count, mode = 'marker') {
  const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const params = new Float32Array(count * 4);
  geo.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    vertexShader: DECAL_VERT,
    fragmentShader: DECAL_FRAG,
    defines: mode === 'shadow' ? { SHADOW: 1 } : mode === 'dot' ? { DOT: 1 } : {},
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  _dc.set(mode === 'shadow' ? '#000000' : '#ffffff');
  _dm.makeScale(0, 0, 0);
  for (let i = 0; i < count; i++) {
    mesh.setColorAt(i, _dc);
    mesh.setMatrixAt(i, _dm);
  }
  mesh.params = params;
  return mesh;
}

// Place decal instance i: centre (x, y, z), radius in metres, spin around Y, colour (any THREE.Color input
// or null to keep), alpha, fill, dash, ring. Flags the buffers for upload.
export function setDecal(mesh, i, x, y, z, radius, rotY, color, alpha, fill = 0, dash = 0, ring = 1) {
  _dp.set(x, y, z);
  _dq.setFromAxisAngle(_up, rotY);
  _ds.set(radius, 1, radius);
  mesh.setMatrixAt(i, _dm.compose(_dp, _dq, _ds));
  if (color !== null && color !== undefined) mesh.setColorAt(i, color.isColor ? color : _dc.set(color));
  const p = mesh.params;
  p[i * 4] = alpha;
  p[i * 4 + 1] = fill;
  p[i * 4 + 2] = dash;
  p[i * 4 + 3] = ring;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.geometry.attributes.aParams.needsUpdate = true;
}

export function hideDecal(mesh, i) {
  mesh.params[i * 4] = 0;
  mesh.geometry.attributes.aParams.needsUpdate = true;
}

// ------------------------------------------------------------------ particles
// Round soft sprites with per-particle colour, size (metres) and alpha.
const POINT_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aAlpha > 0.0 ? aSize * uScale / max(0.1, -mv.z) : 0.0;
  gl_Position = projectionMatrix * mv;
}`;

const POINT_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  if (r > 1.0) discard;
  float a = vAlpha * (1.0 - smoothstep(0.3, 1.0, r));
  gl_FragColor = vec4(vColor * (1.0 + 0.35 * (1.0 - r)), a);
  #include <colorspace_fragment>
}`;

function makePoints(n, blending) {
  const geo = new THREE.BufferGeometry();
  const attr = (name, size) => {
    const a = new THREE.BufferAttribute(new Float32Array(n * size), size).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, a);
    return a.array;
  };
  const buf = { pos: attr('position', 3), col: attr('aColor', 3), size: attr('aSize', 1), alpha: attr('aAlpha', 1) };
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 800 } },
    vertexShader: POINT_VERT,
    fragmentShader: POINT_FRAG,
    transparent: true,
    depthWrite: false,
    blending,
    fog: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 3;
  return { pts, geo, mat, ...buf };
}

function flagPoints(p) {
  const a = p.geo.attributes;
  a.position.needsUpdate = true;
  a.aColor.needsUpdate = true;
  a.aSize.needsUpdate = true;
  a.aAlpha.needsUpdate = true;
}

const CONFETTI_COLORS = ['#ff4d6d', '#ffc83d', '#3d7bff', '#2fbf71', '#b48cff', '#ff9f43', '#ffffff'].map((c) => new THREE.Color(c));
const BUTTERFLY_COLORS = ['#ffd166', '#ff8fb1', '#8fd3ff', '#ffffff', '#c49bff', '#ff9f43'].map((c) => new THREE.Color(c));

const POOL = 420;
const CONFETTI = 120;
const RINGS = 12;
const ROUTE_DOTS = 60;
const ROUTE_PTS = 64;
const AMBIENT = 170;
const FLIERS = 10;

export class FX {
  constructor(engine) {
    this.engine = engine;
    this.group = new THREE.Group();
    this.group.name = 'fx';
    engine.scene.add(this.group);
    this.time = 0;
    this._c = new THREE.Color();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._axis = new THREE.Vector3();
    this._size = new THREE.Vector2();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);

    // Burst / trail pool.
    this.pool = makePoints(POOL, THREE.NormalBlending);
    this.group.add(this.pool.pts);
    this.vel = new Float32Array(POOL * 3);
    this.age = new Float32Array(POOL);
    this.life = new Float32Array(POOL);
    this.grav = new Float32Array(POOL);
    this.drag = new Float32Array(POOL);
    this.size0 = new Float32Array(POOL);
    this.grow = new Float32Array(POOL);
    this.alpha0 = new Float32Array(POOL);
    this.next = 0;
    this.live = 0;
    this.lastTrail = -1;

    // Confetti: small lit paper squares that tumble and flutter down.
    const cGeo = new THREE.PlaneGeometry(0.13, 0.22);
    const cMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    this.confettiMesh = new THREE.InstancedMesh(cGeo, cMat, CONFETTI);
    this.confettiMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.confettiMesh.frustumCulled = false;
    for (let i = 0; i < CONFETTI; i++) {
      this.confettiMesh.setMatrixAt(i, this._zero);
      this.confettiMesh.setColorAt(i, CONFETTI_COLORS[i % CONFETTI_COLORS.length]);
    }
    this.group.add(this.confettiMesh);
    this.cf = {
      pos: new Float32Array(CONFETTI * 3),
      vel: new Float32Array(CONFETTI * 3),
      axis: new Float32Array(CONFETTI * 3),
      ang: new Float32Array(CONFETTI),
      spin: new Float32Array(CONFETTI),
      age: new Float32Array(CONFETTI),
      life: new Float32Array(CONFETTI),
      next: 0,
      live: 0,
    };

    // Expanding ground rings.
    this.rings = makeDecalMesh(RINGS, 'marker');
    this.group.add(this.rings);
    this.ringAge = new Float32Array(RINGS);
    this.ringDur = new Float32Array(RINGS);
    this.ringPos = new Float32Array(RINGS * 3);
    this.ringNext = 0;

    // Rival route: marching dots along a polyline.
    this.route = makeDecalMesh(ROUTE_DOTS, 'dot');
    this.group.add(this.route);
    this.routeX = new Float32Array(ROUTE_PTS);
    this.routeZ = new Float32Array(ROUTE_PTS);
    this.routeD = new Float32Array(ROUTE_PTS);
    this.routeN = 0;
    this.routeDanger = false;
    this.routeColor = new THREE.Color();
    this.routeKey = null;
    this.routeShown = 0;

    // Ambient particles (shared buffer; the kind decides the motion) and butterflies.
    this.amb = makePoints(AMBIENT, THREE.NormalBlending);
    this.group.add(this.amb.pts);
    this.ambSeed = new Float32Array(AMBIENT * 4);
    this.ambKind = null;
    this.ambN = 0;
    this.timeU = { value: 0 };
    this.fliers = this.makeButterflies();
    this.group.add(this.fliers);
    this.puffs = this.makeCloudPuffs();
    this.group.add(this.puffs);
    this.flierSeed = new Float32Array(FLIERS * 6);
    for (let i = 0; i < FLIERS * 6; i++) this.flierSeed[i] = rand();
  }

  // ---------------------------------------------------------------- pool particles
  spawn(x, y, z, vx, vy, vz, color, size, life, grav, drag, grow, alpha) {
    const i = this.next;
    this.next = (this.next + 1) % POOL;
    const P = this.pool;
    P.pos[i * 3] = x;
    P.pos[i * 3 + 1] = y;
    P.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    P.col[i * 3] = color.r;
    P.col[i * 3 + 1] = color.g;
    P.col[i * 3 + 2] = color.b;
    P.size[i] = size;
    P.alpha[i] = alpha;
    if (this.life[i] <= 0) this.live++;
    this.age[i] = 0;
    this.life[i] = life;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.size0[i] = size;
    this.grow[i] = grow;
    this.alpha0[i] = alpha;
  }

  burst(pos, color, count = 14, speed = 4, life = 0.7) {
    const base = this._c.set(color);
    const br = base.r;
    const bg = base.g;
    const bb = base.b;
    const n = Math.min(count, 80);
    for (let k = 0; k < n; k++) {
      const th = rand() * TAU;
      const up = 0.35 + rand() * 0.65;
      const h = Math.sqrt(1 - up * up);
      const v = speed * (0.45 + 0.55 * rand());
      const w = rand() * 0.35; // some lighter sparks
      base.setRGB(br + (1 - br) * w, bg + (1 - bg) * w, bb + (1 - bb) * w);
      this.spawn(
        pos.x + (rand() - 0.5) * 0.3, pos.y + rand() * 0.2, pos.z + (rand() - 0.5) * 0.3,
        Math.cos(th) * h * v, up * v, Math.sin(th) * h * v,
        base, 0.14 + rand() * 0.16, life * (0.7 + 0.5 * rand()), -9, 1.2, -0.7, 1,
      );
    }
    base.setRGB(br, bg, bb);
  }

  // Soft puff at the feet while running; rate-limited so it can be called every frame.
  trail(pos, color) {
    if (this.time - this.lastTrail < 0.045) return;
    this.lastTrail = this.time;
    const c = this._c.set(color);
    this.spawn(
      pos.x + (rand() - 0.5) * 0.2, (pos.y || 0) + 0.12, pos.z + (rand() - 0.5) * 0.2,
      (rand() - 0.5) * 0.4, 0.5 + rand() * 0.3, (rand() - 0.5) * 0.4,
      c, 0.22 + rand() * 0.1, 0.55, 0.4, 2.5, 1.4, 0.55,
    );
  }

  // ---------------------------------------------------------------- confetti
  confetti(pos) {
    const C = this.cf;
    for (let k = 0; k < 70; k++) {
      const i = C.next;
      C.next = (C.next + 1) % CONFETTI;
      if (C.life[i] <= 0) C.live++;
      const th = rand() * TAU;
      const h = 1.2 + rand() * 3.2;
      C.pos[i * 3] = pos.x + (rand() - 0.5) * 0.4;
      C.pos[i * 3 + 1] = pos.y + rand() * 0.3;
      C.pos[i * 3 + 2] = pos.z + (rand() - 0.5) * 0.4;
      C.vel[i * 3] = Math.cos(th) * h;
      C.vel[i * 3 + 1] = 5 + rand() * 4.5;
      C.vel[i * 3 + 2] = Math.sin(th) * h;
      this._axis.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
      C.axis[i * 3] = this._axis.x;
      C.axis[i * 3 + 1] = this._axis.y;
      C.axis[i * 3 + 2] = this._axis.z;
      C.ang[i] = rand() * TAU;
      C.spin[i] = (4 + rand() * 8) * (rand() < 0.5 ? -1 : 1);
      C.age[i] = 0;
      C.life[i] = 2.4 + rand() * 1.2;
    }
  }

  // ---------------------------------------------------------------- rings
  ring(pos, color, dur = 0.6) {
    const i = this.ringNext;
    this.ringNext = (this.ringNext + 1) % RINGS;
    this.ringAge[i] = 0;
    this.ringDur[i] = Math.max(0.1, dur);
    this.ringPos[i * 3] = pos.x;
    this.ringPos[i * 3 + 1] = pos.y > 0.4 ? GROUND_Y + 0.2 : (pos.y || 0) + 0.05;
    this.ringPos[i * 3 + 2] = pos.z;
    setDecal(this.rings, i, pos.x, this.ringPos[i * 3 + 1], pos.z, 0.3, 0, color, 1, 0.25, 0, 1);
  }

  // ---------------------------------------------------------------- route
  // points: [{x, y}] in sim tiles (routeTiles) or [{x, y, z}] in world metres; null hides the route.
  setRoute(points, color, danger = false) {
    if (!points || points.length < 2) {
      this.routeN = 0;
      return;
    }
    const n = Math.min(points.length, ROUTE_PTS);
    let d = 0;
    for (let i = 0; i < n; i++) {
      const p = points[i];
      const world = p.z !== undefined;
      const x = world ? p.x : (p.x - CX) * TILE;
      const z = world ? p.z : (p.y - CY) * TILE;
      if (i > 0) d += Math.hypot(x - this.routeX[i - 1], z - this.routeZ[i - 1]);
      this.routeX[i] = x;
      this.routeZ[i] = z;
      this.routeD[i] = d;
    }
    this.routeN = n;
    this.routeDanger = !!danger;
    const key = danger ? DANGER : color;
    if (key !== this.routeKey) {
      this.routeKey = key;
      this.routeColor.set(key || '#ffffff');
    }
  }

  updateRoute(t) {
    const R = this.route;
    const total = this.routeN > 1 ? this.routeD[this.routeN - 1] : 0;
    const spacing = 0.62;
    const start = 0.55;
    const end = total - 1.0;
    let k = 0;
    if (end > start) {
      const danger = this.routeDanger;
      const radius = danger ? 0.17 : 0.13;
      const pulse = danger ? 0.8 + 0.2 * Math.sin(t * 10) : 0.9;
      let seg = 1;
      for (let s = start + ((t * 1.4) % spacing); s < end && k < ROUTE_DOTS; s += spacing) {
        while (seg < this.routeN - 1 && this.routeD[seg] < s) seg++;
        const d0 = this.routeD[seg - 1];
        const f = (s - d0) / Math.max(1e-6, this.routeD[seg] - d0);
        const x = this.routeX[seg - 1] + (this.routeX[seg] - this.routeX[seg - 1]) * f;
        const z = this.routeZ[seg - 1] + (this.routeZ[seg] - this.routeZ[seg - 1]) * f;
        // fade in/out at the ends so dots do not pop
        const fade = Math.min(1, (s - start) / 0.5, (end - s) / 0.5);
        setDecal(R, k, x, GROUND_Y + 0.05, z, radius, 0, this.routeColor, pulse * fade, 0, 0, 0);
        k++;
      }
    }
    for (let i = k; i < this.routeShown; i++) hideDecal(R, i);
    this.routeShown = k;
  }

  // ---------------------------------------------------------------- ambient
  makeButterflies() {
    // Two wings (x < 0 and x > 0) flapped in the vertex shader around the body axis (z).
    const v = [];
    const wing = (s) => {
      v.push(0, 0, 0.1, s * 0.2, 0, 0.16, s * 0.22, 0, -0.02);
      v.push(0, 0, 0.1, s * 0.22, 0, -0.02, 0, 0, -0.04);
      v.push(0, 0, -0.02, s * 0.15, 0, -0.06, s * 0.1, 0, -0.16);
      v.push(0, 0, -0.02, s * 0.1, 0, -0.16, 0, 0, -0.1);
    };
    wing(1);
    wing(-1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, emissive: '#333333' });
    const timeU = this.timeU;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = timeU;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float ph = instanceMatrix[3].x * 2.3 + instanceMatrix[3].z * 1.7;
        float flap = sin(uTime * 17.0 + ph) * 0.95 + 0.2;
        float ax = abs(transformed.x);
        transformed.y += sin(flap) * ax;
        transformed.x = sign(transformed.x) * cos(flap) * ax;`,
      );
    };
    mat.customProgramCacheKey = () => 'outcraft-butterfly';
    const mesh = new THREE.InstancedMesh(geo, mat, FLIERS);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    for (let i = 0; i < FLIERS; i++) mesh.setColorAt(i, BUTTERFLY_COLORS[i % BUTTERFLY_COLORS.length]);
    mesh.visible = false;
    return mesh;
  }

  makeCloudPuffs() {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#8c8ca0', transparent: true, opacity: 0.85, depthWrite: false });
    const mesh = new THREE.InstancedMesh(geo, mat, 18);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.puffSeed = new Float32Array(18 * 4);
    for (let i = 0; i < 18 * 4; i++) this.puffSeed[i] = rand();
    return mesh;
  }

  // 'butterflies' | 'dust' | 'snow' | 'embers' | 'sparkles' | 'clouds' | null
  setAmbient(kind) {
    this.ambKind = kind || null;
    const A = this.amb;
    const counts = { dust: 90, snow: 170, embers: 110, sparkles: 110, butterflies: 40, clouds: 30 };
    this.ambN = counts[kind] || 0;
    A.mat.blending = kind === 'embers' || kind === 'sparkles' ? THREE.AdditiveBlending : THREE.NormalBlending;
    A.alpha.fill(0);
    for (let i = 0; i < AMBIENT * 4; i++) this.ambSeed[i] = rand();
    for (let i = 0; i < this.ambN; i++) this.resetAmbient(i, true);
    flagPoints(A);
    this.fliers.visible = kind === 'butterflies';
    this.puffs.visible = kind === 'clouds';
  }

  // (Re)spawn ambient particle i somewhere in the air around the island.
  resetAmbient(i, initial) {
    const A = this.amb;
    const s = this.ambSeed;
    const k = this.ambKind;
    let x = (rand() - 0.5) * 30;
    let z = (rand() - 0.5) * 38;
    let y = 0.3 + rand() * 6;
    const c = this._c;
    let size = 0.1;
    if (k === 'snow') {
      y = initial ? WATER_Y + rand() * 10 : 9 + rand();
      size = 0.07 + rand() * 0.08;
      c.set('#ffffff');
    } else if (k === 'embers') {
      y = initial ? WATER_Y + rand() * 7 : WATER_Y;
      size = 0.06 + rand() * 0.08;
      c.setHSL(0.03 + rand() * 0.07, 1, 0.55 + rand() * 0.1);
    } else if (k === 'sparkles') {
      size = 0.08 + rand() * 0.1;
      c.setHSL([0.5, 0.55, 0.85, 0.15][i % 4], 0.9, 0.75);
    } else if (k === 'dust') {
      y = 0.2 + rand() * 4;
      size = 0.05 + rand() * 0.07;
      c.set(i % 3 ? '#fff4d6' : '#ffe0a0');
    } else if (k === 'clouds') {
      size = 0.06 + rand() * 0.06;
      c.set('#ffffff');
    } else {
      // pollen motes drifting with the butterflies
      y = 0.4 + rand() * 2.5;
      size = 0.05 + rand() * 0.04;
      c.set('#fff8c8');
    }
    A.pos[i * 3] = x;
    A.pos[i * 3 + 1] = y;
    A.pos[i * 3 + 2] = z;
    A.col[i * 3] = c.r;
    A.col[i * 3 + 1] = c.g;
    A.col[i * 3 + 2] = c.b;
    A.size[i] = size;
    s[i * 4 + 3] = y; // spawn height, for fading embers
  }

  updateAmbient(dt, t) {
    const A = this.amb;
    const s = this.ambSeed;
    const k = this.ambKind;
    if (!k) return;
    for (let i = 0; i < this.ambN; i++) {
      const ph = s[i * 4] * TAU;
      const sp = s[i * 4 + 1];
      const j = i * 3;
      let a = 0.6;
      if (k === 'snow') {
        A.pos[j] += Math.sin(t * 0.8 + ph) * 0.35 * dt;
        A.pos[j + 1] -= (0.55 + sp * 0.6) * dt;
        A.pos[j + 2] += Math.cos(t * 0.6 + ph) * 0.25 * dt;
        a = 0.85;
        if (A.pos[j + 1] < WATER_Y) this.resetAmbient(i, false);
      } else if (k === 'embers') {
        A.pos[j] += Math.sin(t * 1.3 + ph) * 0.4 * dt;
        A.pos[j + 1] += (0.5 + sp * 0.9) * dt;
        const rise = A.pos[j + 1] - s[i * 4 + 3];
        a = Math.max(0, 1 - rise / 7) * (0.6 + 0.4 * Math.sin(t * 9 + ph));
        if (rise > 7) this.resetAmbient(i, false);
      } else if (k === 'sparkles') {
        A.pos[j + 1] += Math.sin(t * 0.7 + ph) * 0.15 * dt;
        const tw = Math.max(0, Math.sin(t * (1.2 + sp * 1.5) + ph));
        a = tw * tw * tw;
      } else {
        // dust, pollen, cloud wisps: lazy drift
        A.pos[j] += (Math.sin(t * 0.3 + ph) * 0.25 + (k === 'dust' ? 0.35 : 0.08)) * dt;
        A.pos[j + 1] += Math.sin(t * 0.5 + ph * 2) * 0.12 * dt;
        A.pos[j + 2] += Math.cos(t * 0.25 + ph) * 0.2 * dt;
        a = (k === 'dust' ? 0.45 : 0.55) * (0.6 + 0.4 * Math.sin(t * 1.5 + ph));
        if (A.pos[j] > 15) A.pos[j] -= 30;
      }
      A.alpha[i] = a;
    }
    flagPoints(A);
    if (this.fliers.visible) this.updateButterflies(t);
    if (this.puffs.visible) this.updatePuffs(t);
  }

  updateButterflies(t) {
    const F = this.flierSeed;
    for (let i = 0; i < FLIERS; i++) {
      const cx = (F[i * 6] - 0.5) * 14;
      const cz = (F[i * 6 + 1] - 0.5) * 20;
      const a = 0.35 + F[i * 6 + 2] * 0.35;
      const ph = F[i * 6 + 3] * TAU;
      const rx = 1.5 + F[i * 6 + 4] * 2.5;
      const rz = 1.5 + F[i * 6 + 5] * 2.5;
      const u = t * a + ph;
      const x = cx + Math.sin(u) * rx;
      const z = cz + Math.sin(u * 0.8 + 1.3) * rz;
      const y = 0.9 + Math.sin(u * 2.7) * 0.35 + Math.sin(t * 7 + ph) * 0.06;
      const dx = Math.cos(u) * rx;
      const dz = Math.cos(u * 0.8 + 1.3) * rz * 0.8;
      this._p.set(x, y, z);
      this._q.setFromAxisAngle(_up, Math.atan2(dx, dz));
      this._s.set(1, 1, 1);
      this.fliers.setMatrixAt(i, this._m.compose(this._p, this._q, this._s));
    }
    this.fliers.instanceMatrix.needsUpdate = true;
  }

  // Small clouds drifting past the island's edge.
  updatePuffs(t) {
    const S = this.puffSeed;
    for (let i = 0; i < 18; i++) {
      const ang = S[i * 4] * TAU;
      const rad = 13 + S[i * 4 + 1] * 9;
      const x = ((Math.cos(ang) * rad + t * (0.25 + S[i * 4 + 2] * 0.3) + 40) % 80) - 40;
      const z = Math.sin(ang) * rad * 1.25;
      const y = -1.2 + S[i * 4 + 3] * 3.5 + Math.sin(t * 0.4 + i) * 0.2;
      const sc = 0.8 + S[i * 4 + 2] * 1.4;
      this._p.set(x, y, z);
      this._q.identity();
      this._s.set(sc * 1.5, sc * 0.7, sc);
      this.puffs.setMatrixAt(i, this._m.compose(this._p, this._q, this._s));
    }
    this.puffs.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- frame update
  update(dt, now) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    const t = now / 1000;
    this.time = t;
    this.timeU.value = t;

    // Keep particle sizes in metres whatever the viewport or pixel ratio.
    const r = this.engine.renderer;
    r.getDrawingBufferSize(this._size);
    const scale = this._size.y / (2 * Math.tan(THREE.MathUtils.degToRad(this.engine.camera.fov) / 2));
    this.pool.mat.uniforms.uScale.value = scale;
    this.amb.mat.uniforms.uScale.value = scale;

    if (this.live > 0) {
      const P = this.pool;
      for (let i = 0; i < POOL; i++) {
        if (this.life[i] <= 0) continue;
        this.age[i] += dt;
        const f = this.age[i] / this.life[i];
        if (f >= 1) {
          this.life[i] = 0;
          P.alpha[i] = 0;
          this.live--;
          continue;
        }
        const j = i * 3;
        const dr = Math.exp(-this.drag[i] * dt);
        this.vel[j] *= dr;
        this.vel[j + 1] = this.vel[j + 1] * dr + this.grav[i] * dt;
        this.vel[j + 2] *= dr;
        P.pos[j] += this.vel[j] * dt;
        P.pos[j + 1] = Math.max(GROUND_Y + 0.03, P.pos[j + 1] + this.vel[j + 1] * dt);
        P.pos[j + 2] += this.vel[j + 2] * dt;
        P.size[i] = this.size0[i] * Math.max(0.05, 1 + this.grow[i] * f);
        P.alpha[i] = this.alpha0[i] * (f < 0.1 ? f / 0.1 : 1 - (f - 0.1) / 0.9);
      }
      flagPoints(P);
    }

    const C = this.cf;
    if (C.live > 0) {
      const M = this.confettiMesh;
      for (let i = 0; i < CONFETTI; i++) {
        if (C.life[i] <= 0) continue;
        C.age[i] += dt;
        if (C.age[i] >= C.life[i]) {
          C.life[i] = 0;
          C.live--;
          M.setMatrixAt(i, this._zero);
          continue;
        }
        const j = i * 3;
        const dr = Math.exp(-1.6 * dt);
        C.vel[j] = C.vel[j] * dr + Math.sin(C.age[i] * 6 + i) * 1.2 * dt;
        C.vel[j + 1] = Math.max(-1.6, C.vel[j + 1] * dr - 7 * dt);
        C.vel[j + 2] *= dr;
        C.pos[j] += C.vel[j] * dt;
        C.pos[j + 1] = Math.max(GROUND_Y + 0.05, C.pos[j + 1] + C.vel[j + 1] * dt);
        C.pos[j + 2] += C.vel[j + 2] * dt;
        C.ang[i] += C.spin[i] * dt;
        const shrink = Math.min(1, (C.life[i] - C.age[i]) / 0.4);
        this._axis.set(C.axis[j], C.axis[j + 1], C.axis[j + 2]);
        this._q.setFromAxisAngle(this._axis, C.ang[i]);
        this._p.set(C.pos[j], C.pos[j + 1], C.pos[j + 2]);
        this._s.setScalar(shrink);
        M.setMatrixAt(i, this._m.compose(this._p, this._q, this._s));
      }
      M.instanceMatrix.needsUpdate = true;
    }

    for (let i = 0; i < RINGS; i++) {
      if (this.ringDur[i] <= 0) continue;
      this.ringAge[i] += dt;
      const f = this.ringAge[i] / this.ringDur[i];
      if (f >= 1) {
        this.ringDur[i] = 0;
        hideDecal(this.rings, i);
        continue;
      }
      const e = 1 - (1 - f) * (1 - f) * (1 - f);
      setDecal(this.rings, i, this.ringPos[i * 3], this.ringPos[i * 3 + 1], this.ringPos[i * 3 + 2], 0.3 + 1.5 * e, 0, null, 1 - f, 0.2 * (1 - f), 0, 1);
    }

    this.updateRoute(t);
    this.updateAmbient(dt, t);
  }

  dispose() {
    this.engine.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
