// The 3D island built from a sim `world`: bevelled grass tiles, a sandy beach sloping into an animated sea
// (water, lava or a cloud sea) over a rocky skirt, theme obstacles and decorations, the six kinds of
// resource node, and the Workshop hut with its two benches, chimney smoke and floating order display.
// update() turns the sim's node states into motion (sway, shake, regrow) and ground markers (gold rings
// on needed nodes, the rival's target ring, your own target).
//
// Draw calls stay low: all static geometry is merged into two vertex-coloured meshes (ground, props),
// the gatherable part of each resource type is one InstancedMesh, and every ground marker is one
// instanced decal mesh. Glowing bits (ore veins, crystals, windows, vents) use a per-vertex glow amount
// in the same material instead of extra meshes.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { W, H, idx, nextStep, tileField } from '../world.js';
import { RES, RES_IDS } from '../data.js';
import { mulberry32 } from '../rng.js';
import { drawIcon } from '../icons.js';
import { TILE, CX, CY, GROUND_Y, WATER_Y } from './coords.js';
import { makeDecalMesh, setDecal, hideDecal } from './fx.js';

const TAU = Math.PI * 2;
const SEG = 96; // angular segments of the beach, skirt and sea rings
const RIM = 2.3; // beach + shallows width beyond the land edge (m)
// Distances from the land edge (m) of the beach rings and the sea rings: rings follow iso-distance
// contours, so the beach has the same width all round and the sea depth matches the terrain under it.
const TERRAIN_ISO = [0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.05, RIM];
const WATER_ISO = [0.3, 0.8, 1.15, 1.3, 1.42, 1.55, 1.7, 1.9, 2.15, 2.5, 3.2, 4.5, 7, 10, 14, 19];
const DECK_Y = 0.14; // top of the Workshop deck
const GOLD = new THREE.Color('#ffc83d');
const BLUE = new THREE.Color('#3d7bff');
const RED = new THREE.Color('#ff4d6d');
const WHITE = new THREE.Color('#ffffff');
const DIM = new THREE.Color().setRGB(0.5, 0.5, 0.52); // linear: about 73% brightness

// Where the gatherable part of each node sits (top of its stump/base) and the node's full height.
const BASE_H = { wood: 0.34, stone: 0, ore: 0.05, sand: 0.04, fiber: 0.02, crystal: 0.16 };
const TOP_H = { wood: 2.65, stone: 1.25, ore: 1.55, sand: 0.95, fiber: 1.55, crystal: 1.75 };
const SHADOW_R = { wood: 1.05, stone: 1.0, ore: 0.95, sand: 0.95, fiber: 0.75, crystal: 0.9 };

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (t) => t * t * (3 - 2 * t);
const tileX = (x) => (x - CX) * TILE;
const tileZ = (y) => (y - CY) * TILE;

// ------------------------------------------------------------------ geometry kit
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _v1 = new THREE.Color();
const _v2 = new THREE.Color();

// Collects transformed, vertex-coloured primitive pieces (each vertex also gets a glow amount 0..1) and
// merges them into one non-indexed geometry with position, normal, color and aGlow attributes.
class Kit {
  constructor(rng) {
    this.rng = rng;
    this.parts = [];
  }

  // o: p [x,y,z] position, r [x,y,z] rotation, s scale (number or [x,y,z]), glow, jitter (lightness),
  // vc(x, y, z, color) -> glow? per vertex in template space, face(cx, cy, cz, nx, ny, nz, color) -> glow?
  // per triangle in world space (callbacks edit `color` in place; returning a number sets the glow).
  add(geo, color, o = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
    const pos = g.attributes.position;
    const n = pos.count;
    const colors = new Float32Array(n * 3);
    const glow = new Float32Array(n).fill(o.glow || 0);
    const base = _c.set(color);
    if (o.jitter) base.offsetHSL(0, 0, (this.rng() - 0.5) * o.jitter);
    for (let i = 0; i < n; i++) {
      _c2.copy(base);
      if (o.vc) {
        const gv = o.vc(pos.getX(i), pos.getY(i), pos.getZ(i), _c2);
        if (typeof gv === 'number') glow[i] = gv;
      }
      colors[i * 3] = _c2.r;
      colors[i * 3 + 1] = _c2.g;
      colors[i * 3 + 2] = _c2.b;
    }
    const s = o.s === undefined ? 1 : o.s;
    if (typeof s === 'number') _s.set(s, s, s);
    else _s.set(s[0], s[1], s[2]);
    const r = o.r || [0, 0, 0];
    _q.setFromEuler(_e.set(r[0], r[1], r[2]));
    const p = o.p || [0, 0, 0];
    _p.set(p[0], p[1], p[2]);
    g.applyMatrix4(_m.compose(_p, _q, _s));
    if (o.face) {
      for (let f = 0; f < n; f += 3) {
        _a.fromBufferAttribute(pos, f + 1).sub(_p.fromBufferAttribute(pos, f));
        _b.fromBufferAttribute(pos, f + 2).sub(_p);
        _n.crossVectors(_a, _b).normalize();
        const cx = (pos.getX(f) + pos.getX(f + 1) + pos.getX(f + 2)) / 3;
        const cy = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3;
        const cz = (pos.getZ(f) + pos.getZ(f + 1) + pos.getZ(f + 2)) / 3;
        _c2.setRGB(colors[f * 3], colors[f * 3 + 1], colors[f * 3 + 2]);
        const gl = o.face(cx, cy, cz, _n.x, _n.y, _n.z, _c2);
        for (let k = f; k < f + 3; k++) {
          colors[k * 3] = _c2.r;
          colors[k * 3 + 1] = _c2.g;
          colors[k * 3 + 2] = _c2.b;
          if (typeof gl === 'number') glow[k] = gl;
        }
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
    this.parts.push(g);
    return this;
  }

  addRaw(g) {
    this.parts.push(g);
  }

  build() {
    let out;
    if (!this.parts.length) {
      out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
      out.setAttribute('color', new THREE.Float32BufferAttribute([], 3));
      out.setAttribute('aGlow', new THREE.Float32BufferAttribute([], 1));
    } else out = mergeGeometries(this.parts, false);
    for (const g of this.parts) g.dispose();
    this.parts = [];
    out.computeVertexNormals();
    out.computeBoundingSphere();
    return out;
  }
}

// Low-poly rock: a polyhedron whose corners are pushed in/out (shared corners move together).
function rockGeo(rng, r = 1, detail = 0, amt = 0.22, dodeca = false) {
  const g = dodeca ? new THREE.DodecahedronGeometry(r, detail) : new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position;
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let f = seen.get(key);
    if (f === undefined) {
      f = 1 + (rng() - 0.5) * 2 * amt;
      seen.set(key, f);
    }
    p.setXYZ(i, p.getX(i) * f, p.getY(i) * f, p.getZ(i) * f);
  }
  return g;
}

function roundedRect(half, rad) {
  const s = new THREE.Shape();
  const a = half;
  s.moveTo(-a + rad, -a);
  s.lineTo(a - rad, -a);
  s.quadraticCurveTo(a, -a, a, -a + rad);
  s.lineTo(a, a - rad);
  s.quadraticCurveTo(a, a, a - rad, a);
  s.lineTo(-a + rad, a);
  s.quadraticCurveTo(-a, a, -a, a - rad);
  s.lineTo(-a, -a + rad);
  s.quadraticCurveTo(-a, -a, -a + rad, -a);
  return s;
}

function prism(points, depth) {
  const s = new THREE.Shape();
  s.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) s.lineTo(points[i], points[i + 1]);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
}

// Face shading helpers for the faceted look.
const facetJitter = (rng, amt = 0.12, topLift = 0.06) => (cx, cy, cz, nx, ny, nz, c) => {
  c.multiplyScalar(1 - amt / 2 + rng() * amt + (ny > 0.55 ? topLift : 0));
};

// Beach height (m) at a distance d outside the land edge; under the tiles it sits just below the lip.
function beachH(d) {
  if (d <= 0) return -0.14;
  if (d < 1.35) return -0.12 - 0.38 * Math.pow(d / 1.35, 1.5);
  return Math.max(-1.6, -0.5 - (d - 1.35) * 0.9);
}

// Land plus the sea tiles tucked into its concave corners (two or more land neighbours): the beach and
// sea follow this smoother outline, so stair-stepped coasts become diagonals and one-tile bays fill in.
function shoreMask(world) {
  const m = world.land.slice();
  const isLand = (x, y) => x >= 0 && y >= 0 && x < W && y < H && world.land[idx(x, y)];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (world.land[idx(x, y)]) continue;
      const n = isLand(x + 1, y) + isLand(x - 1, y) + isLand(x, y + 1) + isLand(x, y - 1);
      if (n >= 2) m[idx(x, y)] = true;
    }
  }
  return m;
}

// Signed distance (m) from the union of the masked tiles (positive outside).
function landSDF(mask) {
  const cs = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[idx(x, y)]) cs.push(tileX(x), tileZ(y));
  const half = TILE / 2;
  return (px, pz) => {
    let best = Infinity;
    for (let i = 0; i < cs.length; i += 2) {
      const qx = Math.abs(px - cs[i]) - half;
      const qz = Math.abs(pz - cs[i + 1]) - half;
      const d = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
      if (d < best) best = d;
    }
    return best;
  };
}

// For every angle, the radius (from the island centre) where the land distance first reaches each target.
// Sphere-traces outward from R[j]; sdf is 1-Lipschitz so a step of (target - d) never overshoots.
function isoRadii(sdf, R, targets) {
  const n = targets.length;
  const out = new Float32Array(SEG * n);
  for (let j = 0; j < SEG; j++) {
    const a = (j / SEG) * TAU;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    let r = R[j];
    let d0 = Math.max(0, sdf(ca * r, sa * r));
    let k = 0;
    while (k < n && r < R[j] + 40) {
      const step = Math.max(0.03, targets[k] - d0);
      const r1 = r + step;
      const d1 = sdf(ca * r1, sa * r1);
      while (k < n && d1 >= targets[k]) {
        out[j * n + k] = r + step * (d1 > d0 ? clamp01((targets[k] - d0) / (d1 - d0)) : 1);
        k++;
      }
      r = r1;
      d0 = d1;
    }
    for (; k < n; k++) out[j * n + k] = r + k * 0.1;
  }
  return out;
}

// ------------------------------------------------------------------ materials
// Lambert, flat shaded, vertex colours, plus `aGlow` added as emission (glowing veins, crystals, windows).
function toonMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow * 1.6;');
  };
  m.customProgramCacheKey = () => 'outcraft-toon';
  return m;
}

// Water: faceted Phong with gentle vertex waves, depth-tinted colour, shoreline foam, soft transparency.
// Lava: dark crust with slowly flowing glowing veins and a hot rim along the shore.
function seaMaterial(sea, timeU) {
  const lava = sea.kind === 'lava';
  const shallow = new THREE.Color(sea.color).offsetHSL(-0.02, 0.05, 0.04);
  const U = {
    uTime: timeU,
    uAmp: { value: lava ? 0.05 : 0.1 },
    uDeep: { value: new THREE.Color(sea.deep) },
    uShallow: { value: shallow },
    uHot: { value: new THREE.Color(sea.color) },
    uFoam: { value: new THREE.Color(sea.foam) },
  };
  const m = lava
    ? new THREE.MeshLambertMaterial({ color: '#2a0f0a', flatShading: true })
    : new THREE.MeshPhongMaterial({ color: sea.color, specular: '#5a5a5a', shininess: 60, flatShading: true, transparent: true });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader =
      'attribute float aDepth;\nuniform float uTime;\nuniform float uAmp;\nvarying float vDepth;\nvarying vec3 vWPos;\n' +
      sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 wp0 = modelMatrix * vec4(transformed, 1.0);
        float far = 1.0 - smoothstep(20.0, 30.0, length(wp0.xz));
        float amp = uAmp * (0.3 + 0.7 * smoothstep(0.0, 1.6, aDepth)) * far;
        transformed.y += amp * (sin(wp0.x * 0.8 + uTime * 1.2) * 0.55 + sin(wp0.z * 1.1 - uTime * 0.9) * 0.45
          + sin((wp0.x + wp0.z) * 2.3 + uTime * 2.1) * 0.22);
        vDepth = aDepth;
        vWPos = wp0.xyz;`,
      );
    const head = 'uniform float uTime;\nuniform vec3 uDeep;\nuniform vec3 uShallow;\nuniform vec3 uHot;\nuniform vec3 uFoam;\nvarying float vDepth;\nvarying vec3 vWPos;\n';
    if (lava) {
      sh.fragmentShader = head + sh.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        // slow warped flow: broad hot currents, a few thin bright veins, dark cooling crust patches
        vec2 q = vWPos.xz * 0.16 + vec2(uTime * 0.03, uTime * 0.018);
        vec2 w = q + 0.6 * vec2(sin(q.y * 2.3 + uTime * 0.11), sin(q.x * 1.9 - uTime * 0.09));
        float flow = 0.5 + 0.5 * sin(w.x * 3.1 + sin(w.y * 2.2) * 1.4);
        float n = sin(w.x * 5.3 + sin(w.y * 4.1) * 1.8) * sin(w.y * 4.7 - sin(w.x * 3.3) * 1.8);
        float veins = 1.0 - smoothstep(0.0, 0.07, abs(n));
        float crust = smoothstep(0.55, 0.85, sin(w.x * 2.2 - 1.3) * sin(w.y * 2.6 + 0.7) * 0.5 + 0.5);
        vec3 lavaCol = mix(uDeep, uHot, 0.35 + 0.5 * flow);
        lavaCol = mix(lavaCol, uFoam, veins * 0.55 * (1.0 - crust));
        lavaCol *= 1.0 - 0.75 * crust;
        float rim = 1.0 - smoothstep(0.02, 0.2, vDepth);
        float shore = smoothstep(0.15, 0.4, vDepth) * (1.0 - smoothstep(0.4, 1.1, vDepth));
        totalEmissiveRadiance = lavaCol * (1.0 - 0.5 * shore) + uFoam * rim;`,
      );
    } else {
      sh.fragmentShader = head + sh.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // shallows tint near the beach; the open sea is between the theme colour and the deep colour,
        // darkening toward the horizon
        float far = smoothstep(14.0, 60.0, length(vWPos.xz));
        vec3 open = mix(uHot, uDeep, 0.5 + 0.5 * far);
        diffuseColor.rgb = mix(uShallow, open, smoothstep(0.0, 1.4, vDepth));
        float edge = 0.05 + 0.035 * sin(uTime * 1.6 + vWPos.x * 0.9 + vWPos.z * 0.7);
        float foam = 1.0 - smoothstep(edge, edge + 0.08, vDepth);
        diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, foam * 0.9);
        diffuseColor.a = max(mix(0.7, 0.97, smoothstep(0.0, 1.0, vDepth)), foam * 0.9);`,
      );
    }
  };
  m.customProgramCacheKey = () => (lava ? 'outcraft-lava' : 'outcraft-water');
  return m;
}

// Soft cloud puffs, bobbing in the vertex shader (phase from the instance position).
function cloudMaterial(sea, timeU) {
  const m = new THREE.MeshLambertMaterial({ color: sea.color, emissive: new THREE.Color(sea.deep).multiplyScalar(0.8) });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = timeU;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
        transformed.y += sin(uTime * 0.6 + ph) * 0.12;
        transformed *= 1.0 + 0.04 * sin(uTime * 0.9 + ph * 2.0);
      #endif`,
    );
  };
  m.customProgramCacheKey = () => 'outcraft-cloud';
  return m;
}

// ------------------------------------------------------------------ resource nodes
// The static base (stump, pebbles, socket...) goes in the props mesh; the gatherable top is instanced.
function nodeBase(kit, type, x, z, rng) {
  const res = RES[type];
  const j = facetJitter(rng);
  if (type === 'wood') {
    kit.add(new THREE.CylinderGeometry(0.24, 0.32, 0.36, 8), res.color, {
      p: [x, 0.18, z],
      face: (cx, cy, cz, nx, ny, nz, c) => {
        if (ny > 0.9) c.set('#e9c48e');
      },
    });
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + rng();
      kit.add(new THREE.ConeGeometry(0.09, 0.42, 4), res.color, { p: [x + Math.cos(a) * 0.28, 0.06, z + Math.sin(a) * 0.28], r: [0, -a, Math.PI / 2 - 0.25], s: [1, 1, 0.8] });
    }
  } else if (type === 'stone') {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU + rng();
      const d = 0.55 + rng() * 0.25;
      kit.add(rockGeo(rng, 0.13 + rng() * 0.07, 0, 0.25, true), k % 2 ? res.color : '#838c9b', { p: [x + Math.cos(a) * d, 0.06, z + Math.sin(a) * d], s: [1, 0.6, 1], face: j });
    }
  } else if (type === 'ore') {
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + rng();
      const d = 0.55 + rng() * 0.2;
      kit.add(rockGeo(rng, 0.16 + rng() * 0.08, 0, 0.3), '#4f423d', { p: [x + Math.cos(a) * d, 0.08, z + Math.sin(a) * d], s: [1, 0.7, 1], face: j });
    }
    kit.add(new THREE.OctahedronGeometry(0.07), res.light, { p: [x + 0.62, 0.08, z - 0.2], glow: 1 });
    kit.add(new THREE.OctahedronGeometry(0.06), res.light, { p: [x - 0.5, 0.07, z + 0.45], glow: 1 });
  } else if (type === 'sand') {
    kit.add(new THREE.CylinderGeometry(0.85, 0.95, 0.06, 14), res.light, { p: [x, 0.03, z] });
    // a little shovel stuck in the sand
    kit.add(new THREE.CylinderGeometry(0.025, 0.025, 0.75, 5), '#a86b3c', { p: [x + 0.62, 0.4, z - 0.42], r: [0.25, 0, -0.3] });
    kit.add(new THREE.BoxGeometry(0.2, 0.22, 0.03), '#9aa3b2', { p: [x + 0.56, 0.06, z - 0.44], r: [0.25, 0, -0.3] });
  } else if (type === 'fiber') {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU + rng() * 0.5;
      kit.add(new THREE.ConeGeometry(0.05, 0.24, 3), '#5f9440', { p: [x + Math.cos(a) * 0.3, 0.12, z + Math.sin(a) * 0.3], r: [Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4] });
    }
  } else if (type === 'crystal') {
    kit.add(rockGeo(rng, 0.5, 0, 0.2), '#4b4868', { p: [x, 0.08, z], s: [1, 0.42, 1], face: j });
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU + rng();
      kit.add(new THREE.ConeGeometry(0.06, 0.22, 5), res.color, { p: [x + Math.cos(a) * 0.62, 0.1, z + Math.sin(a) * 0.62], r: [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5], glow: 0.7 });
    }
  }
}

// Gatherable top of each type, modelled at the origin (bottom at y = 0), for its InstancedMesh.
function nodeTopGeometry(type, rng) {
  const kit = new Kit(rng);
  const res = RES[type];
  const j = facetJitter(rng, 0.14, 0.08);
  if (type === 'wood') {
    kit.add(new THREE.CylinderGeometry(0.15, 0.21, 0.9, 7), res.color, { p: [0, 0.45, 0] });
    kit.add(new THREE.CylinderGeometry(0.04, 0.07, 0.5, 5), res.color, { p: [0.22, 0.72, 0], r: [0, 0, -0.9] });
    const leaf = ['#4f9f5c', '#58b368', '#67c275', '#4a9656'];
    const blobs = [
      [0, 1.35, 0, 0.78], [0.42, 1.12, 0.2, 0.55], [-0.4, 1.15, -0.18, 0.56],
      [0.1, 1.2, -0.42, 0.5], [-0.15, 1.18, 0.4, 0.5], [0.05, 1.9, 0.02, 0.5],
    ];
    blobs.forEach(([bx, by, bz, br], k) => kit.add(rockGeo(rng, br, 1, 0.1), leaf[k % leaf.length], { p: [bx, by, bz], face: j }));
  } else if (type === 'stone') {
    const cols = [res.color, res.light, '#a9b2c0', '#8d96a6'];
    const rocks = [
      [0, 0.42, 0, 0.58, 0.8], [0.52, 0.26, 0.28, 0.38, 0.75], [-0.48, 0.24, 0.3, 0.34, 0.8],
      [0.08, 0.26, -0.5, 0.33, 0.8], [0.06, 0.9, -0.02, 0.28, 0.85],
    ];
    rocks.forEach(([rx, ry, rz, rr, sy], k) => kit.add(rockGeo(rng, rr, 0, 0.2, true), cols[k % cols.length], { p: [rx, ry, rz], s: [1.1, sy, 1], r: [0, rng() * TAU, 0], face: j }));
  } else if (type === 'ore') {
    // Dark rock with glowing orange veins: vertices near a few random planes glow, so the colour bleeds
    // along the facets like cracks full of molten ore.
    const planes = [];
    for (let k = 0; k < 3; k++) planes.push(new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(), (rng() - 0.5) * 0.3);
    const dark = new THREE.Color('#4f4540');
    const hot = new THREE.Color('#ff7a1a');
    const vein = (vx, vy, vz, c) => {
      let best = 1;
      for (let k = 0; k < planes.length; k += 2) {
        const pl = planes[k];
        best = Math.min(best, Math.abs(pl.x * vx + pl.y * vy + pl.z * vz - planes[k + 1] * 0.6) / 0.08);
      }
      if (best >= 1) return 0;
      c.lerpColors(hot, dark, best * best);
      return 0.75 * (1 - best);
    };
    kit.add(rockGeo(rng, 0.6, 2, 0.07), dark, { p: [0, 0.72, 0], s: [0.95, 1.35, 0.88], vc: vein });
    kit.add(rockGeo(rng, 0.36, 1, 0.12), dark, { p: [0.5, 0.3, 0.26], r: [1, 2, 0], vc: vein });
    kit.add(rockGeo(rng, 0.28, 0, 0.25), '#4a403b', { p: [-0.46, 0.22, 0.2], face: j });
    for (let k = 0; k < 7; k++) {
      const a = rng() * TAU;
      const u = rng() * 1.4 - 0.5;
      const rr = Math.sqrt(Math.max(0.05, 1 - u * u * 0.5));
      kit.add(new THREE.OctahedronGeometry(0.09 + rng() * 0.05), k % 2 ? '#ff9a2e' : '#ff7a1a', {
        p: [Math.cos(a) * 0.55 * rr, 0.72 + u * 0.75, Math.sin(a) * 0.5 * rr],
        r: [rng() * 3, rng() * 3, rng() * 3],
        s: [1, 1.7, 1],
        glow: 0.7,
      });
    }
  } else if (type === 'sand') {
    // Leaning dune mounds with ripple stripes.
    const ripple = (vx, vy, vz, c) => {
      const t = Math.sin(vy * 26 + vx * 4);
      c.set(t > 0.35 ? res.light : res.color);
    };
    const dune = new THREE.SphereGeometry(0.85, 14, 7, 0, TAU, 0, Math.PI / 2);
    const p = dune.attributes.position;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + p.getY(i) * 0.35);
    kit.add(dune, res.color, { p: [-0.05, 0, 0], s: [1, 0.95, 0.85], vc: ripple });
    kit.add(dune, res.color, { p: [0.5, 0, 0.38], s: [0.55, 0.6, 0.5], r: [0, 0.8, 0], vc: ripple });
    kit.add(dune, res.color, { p: [-0.45, 0, -0.35], s: [0.45, 0.45, 0.45], r: [0, -0.6, 0], vc: ripple });
    kit.add(new THREE.ConeGeometry(0.06, 0.12, 5), '#ffd9c7', { p: [0.2, 0.62, 0.3], r: [1.2, 0, 0.3] });
    dune.dispose();
  } else if (type === 'fiber') {
    // A tied sheaf of tall flat flax leaves with pale tips and a few blue flowers.
    const lo = _v1.set(res.color);
    const hi = _v2.set(res.light);
    for (let k = 0; k < 15; k++) {
      const a = (k / 15) * TAU + rng() * 0.3;
      const tilt = 0.1 + rng() * 0.3;
      const h = 1.0 + rng() * 0.5;
      const blade = new THREE.ConeGeometry(0.11, h, 4).scale(1, 1, 0.3).rotateY(Math.PI / 2 - a);
      const r0 = 0.07 + rng() * 0.07;
      const off = r0 + Math.sin(tilt) * h * 0.5;
      kit.add(blade, res.color, {
        p: [Math.cos(a) * off, h * 0.5 * Math.cos(tilt), Math.sin(a) * off],
        r: [Math.sin(a) * tilt, 0, -Math.cos(a) * tilt],
        vc: (vx, vy, vz, c) => c.lerpColors(lo, hi, clamp01(vy / h + 0.45)),
        glow: 0.06,
      });
      if (k % 3 === 0) {
        const tip = h * 0.97;
        const tr = r0 + Math.sin(tilt) * tip;
        kit.add(new THREE.IcosahedronGeometry(0.08, 0), '#9cc3ff', { p: [Math.cos(a) * tr, Math.cos(tilt) * tip, Math.sin(a) * tr], glow: 0.2 });
      }
      blade.dispose();
    }
    kit.add(new THREE.TorusGeometry(0.22, 0.055, 4, 12), '#e2b04e', { p: [0, 0.32, 0], r: [Math.PI / 2, 0, 0] });
  } else if (type === 'crystal') {
    const gem = (cx, cy, cz, nx, ny, nz, c) => {
      c.multiplyScalar(0.8 + 0.45 * Math.abs(nx * 0.7 + nz * 0.3));
      return undefined;
    };
    const shards = [
      [0, 0, 0.23, 1.05, 0, 0], [0.3, 0.2, 0.15, 0.7, 0.5, 0.2], [-0.28, -0.1, 0.16, 0.8, -0.45, 1.1],
      [0.05, -0.32, 0.13, 0.6, 0.55, 2.2], [-0.1, 0.34, 0.12, 0.55, -0.5, 3.6],
    ];
    for (const [sx, sz, r, h, tilt, az] of shards) {
      const rot = [Math.sin(az) * tilt, 0, -Math.cos(az) * tilt];
      // prism body + pointed tip, both tilted about the shard's foot
      const body = new THREE.CylinderGeometry(r, r * 0.9, h, 6).translate(0, h / 2, 0);
      const tip = new THREE.ConeGeometry(r, r * 1.8, 6).translate(0, h + r * 0.9, 0);
      kit.add(body, res.color, { p: [sx, 0, sz], r: rot, glow: 0.45, face: gem });
      kit.add(tip, res.light, { p: [sx, 0, sz], r: rot, glow: 0.8, face: gem });
      body.dispose();
      tip.dispose();
    }
  }
  return kit.build();
}

// ------------------------------------------------------------------ obstacles and decoration
function blobs(kit, rng, x, z, color, list, detail = 1) {
  for (const [bx, by, bz, br] of list) kit.add(rockGeo(rng, br, detail, 0.12), color, { p: [x + bx, by, z + bz], jitter: 0.08, face: facetJitter(rng, 0.1, 0.06) });
}

const OBSTACLES = {
  meadow: {
    bush(kit, rng, x, z, c) {
      blobs(kit, rng, x, z, c, [[0, 0.45, 0, 0.55], [0.4, 0.32, 0.2, 0.4], [-0.38, 0.33, 0.14, 0.42], [0.05, 0.32, -0.38, 0.4], [0.1, 0.78, 0.05, 0.36]]);
      for (let k = 0; k < 6; k++) {
        const a = rng() * TAU;
        const up = 0.3 + rng() * 0.6;
        kit.add(new THREE.IcosahedronGeometry(0.065, 0), '#ff5a6e', { p: [x + Math.cos(a) * 0.5 * (1 - up * 0.4), 0.35 + up * 0.5, z + Math.sin(a) * 0.5 * (1 - up * 0.4)], glow: 0.1 });
      }
    },
    boulder(kit, rng, x, z, c) {
      kit.add(rockGeo(rng, 0.62, 0, 0.22, true), c, { p: [x, 0.42, z], s: [1.1, 0.8, 0.95], face: facetJitter(rng) });
      kit.add(rockGeo(rng, 0.36, 0, 0.22, true), c, { p: [x + 0.55, 0.22, z + 0.32], face: facetJitter(rng), jitter: 0.1 });
      kit.add(rockGeo(rng, 0.42, 1, 0.1), '#6dbb57', { p: [x - 0.05, 0.78, z], s: [1, 0.28, 0.9] });
    },
  },
  dunes: {
    bush(kit, rng, x, z, c) {
      const ribs = (cx, cy, cz, nx, ny, nz, col) => col.multiplyScalar(Math.floor((Math.atan2(nz, nx) + Math.PI) / (TAU / 8)) % 2 ? 0.86 : 1.04);
      kit.add(new THREE.CylinderGeometry(0.22, 0.26, 1.25, 8), c, { p: [x, 0.62, z], face: ribs });
      kit.add(new THREE.SphereGeometry(0.22, 8, 4, 0, TAU, 0, Math.PI / 2), c, { p: [x, 1.24, z], face: ribs });
      kit.add(new THREE.CylinderGeometry(0.11, 0.11, 0.34, 7), c, { p: [x + 0.3, 0.62, z], r: [0, 0, Math.PI / 2] });
      kit.add(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 7), c, { p: [x + 0.46, 0.85, z], face: ribs });
      kit.add(new THREE.SphereGeometry(0.12, 7, 3, 0, TAU, 0, Math.PI / 2), c, { p: [x + 0.46, 1.1, z] });
      kit.add(new THREE.CylinderGeometry(0.1, 0.1, 0.3, 7), c, { p: [x - 0.28, 0.45, z + 0.05], r: [0, 0, Math.PI / 2] });
      kit.add(new THREE.CylinderGeometry(0.1, 0.1, 0.36, 7), c, { p: [x - 0.42, 0.62, z + 0.05], face: ribs });
      kit.add(new THREE.SphereGeometry(0.1, 7, 3, 0, TAU, 0, Math.PI / 2), c, { p: [x - 0.42, 0.8, z + 0.05] });
      kit.add(new THREE.IcosahedronGeometry(0.09, 0), '#ff7eb6', { p: [x, 1.46, z], glow: 0.15 });
      kit.add(new THREE.SphereGeometry(0.45, 10, 4, 0, TAU, 0, Math.PI / 2), '#e8c274', { p: [x, 0, z], s: [1, 0.3, 1] });
    },
    boulder(kit, rng, x, z, c) {
      const light = new THREE.Color(c).offsetHSL(0, -0.05, 0.08);
      kit.add(new THREE.BoxGeometry(1.25, 0.42, 1.05), c, { p: [x, 0.21, z], r: [0, 0.2, 0] });
      kit.add(new THREE.BoxGeometry(1.0, 0.36, 0.85), light, { p: [x + 0.05, 0.6, z - 0.03], r: [0, -0.25, 0] });
      kit.add(new THREE.BoxGeometry(0.62, 0.32, 0.56), c, { p: [x - 0.08, 0.94, z + 0.04], r: [0, 0.45, 0] });
      kit.add(rockGeo(rng, 0.2, 0, 0.3), c, { p: [x + 0.6, 0.1, z + 0.5], face: facetJitter(rng) });
    },
  },
  frost: {
    bush(kit, rng, x, z, c) {
      kit.add(new THREE.CylinderGeometry(0.08, 0.11, 0.35, 6), '#6b4a34', { p: [x, 0.17, z] });
      [[0.62, 0.75, 0.62], [0.48, 0.62, 1.04], [0.33, 0.52, 1.4]].forEach(([r, h, y]) => {
        kit.add(new THREE.ConeGeometry(r, h, 7), c, { p: [x, y, z], r: [0, rng(), 0] });
        kit.add(new THREE.ConeGeometry(r * 0.72, h * 0.42, 7), '#ffffff', { p: [x, y + h * 0.29, z], r: [0, rng(), 0] });
      });
    },
    boulder(kit, rng, x, z, c) {
      const ice = (cx, cy, cz, nx, ny, nz, col) => {
        col.multiplyScalar(0.9 + 0.2 * Math.abs(nx) + (ny > 0.6 ? 0.1 : 0));
        return 0.18;
      };
      kit.add(rockGeo(rng, 0.62, 0, 0.12, true), c, { p: [x, 0.45, z], s: [1, 0.9, 0.9], r: [0, 0.4, 0], face: ice });
      kit.add(rockGeo(rng, 0.36, 0, 0.12, true), c, { p: [x + 0.55, 0.25, z + 0.3], face: ice });
      kit.add(rockGeo(rng, 0.42, 1, 0.08), '#ffffff', { p: [x, 0.86, z], s: [1, 0.25, 0.9] });
    },
  },
  ember: {
    bush(kit, rng, x, z, c) {
      const cracks = (cx, cy, cz, nx, ny, nz, col) => {
        if (rng() < 0.16) {
          col.set('#ff7a2a');
          return 1;
        }
        col.multiplyScalar(0.8 + rng() * 0.4);
        return 0;
      };
      c = new THREE.Color(c).offsetHSL(0, 0, 0.08);
      kit.add(new THREE.CylinderGeometry(0.3, 0.4, 0.75, 8, 3), c, { p: [x, 0.37, z], face: cracks });
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU + rng();
        kit.add(new THREE.ConeGeometry(0.1, 0.35 + rng() * 0.3, 4), c, { p: [x + Math.cos(a) * 0.2, 0.85, z + Math.sin(a) * 0.2], r: [Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3] });
        kit.add(new THREE.ConeGeometry(0.1, 0.5, 4), c, { p: [x + Math.cos(a + 0.4) * 0.38, 0.08, z + Math.sin(a + 0.4) * 0.38], r: [0, -a, Math.PI / 2 - 0.2] });
      }
      kit.add(new THREE.SphereGeometry(0.6, 10, 4, 0, TAU, 0, Math.PI / 2), '#4a3d3b', { p: [x, 0, z], s: [1, 0.18, 1] });
    },
    boulder(kit, rng, x, z, c) {
      const side = new THREE.Color(c).offsetHSL(0, 0.02, 0.14);
      const top = (cx, cy, cz, nx, ny, nz, col) => col.multiplyScalar(ny > 0.9 ? 1.6 : 0.85 + rng() * 0.3);
      const cols = [[0, 0, 1.3], [0.36, 0.1, 0.9], [-0.33, 0.14, 1.05], [0.1, -0.36, 0.75], [-0.12, 0.42, 0.6], [0.42, -0.3, 0.5]];
      for (const [bx, bz, h] of cols) kit.add(new THREE.CylinderGeometry(0.21, 0.23, h, 6), side, { p: [x + bx, h / 2, z + bz], face: top });
      kit.add(new THREE.OctahedronGeometry(0.08), '#ff7a2a', { p: [x + 0.5, 0.06, z + 0.35], glow: 1 });
    },
  },
  crystal: {
    bush(kit, rng, x, z, c) {
      const shroom = (sx, sz, k) => {
        kit.add(new THREE.CylinderGeometry(0.1 * k, 0.15 * k, 0.9 * k, 7), '#efe6ff', { p: [x + sx, 0.45 * k, z + sz] });
        kit.add(new THREE.SphereGeometry(0.55 * k, 10, 5, 0, TAU, 0, Math.PI / 2), c, { p: [x + sx, 0.82 * k, z + sz], s: [1, 0.62, 1], glow: 0.5 });
        for (let s = 0; s < 5; s++) {
          const a = rng() * TAU;
          const rr = 0.35 * k * rng();
          kit.add(new THREE.IcosahedronGeometry(0.05 * k, 0), '#ffffff', { p: [x + sx + Math.cos(a) * rr, 0.82 * k + 0.32 * k * Math.sqrt(1 - (rr / (0.55 * k)) ** 2), z + sz + Math.sin(a) * rr], glow: 0.9 });
        }
      };
      shroom(0, 0, 1);
      shroom(0.5, 0.35, 0.55);
      shroom(-0.45, 0.3, 0.45);
    },
    boulder(kit, rng, x, z, c) {
      const gem = (cx, cy, cz, nx, ny, nz, col) => {
        col.multiplyScalar(0.8 + 0.5 * Math.abs(nx));
        return 0.3;
      };
      kit.add(rockGeo(rng, 0.45, 0, 0.2), '#3d3466', { p: [x, 0.1, z], s: [1.2, 0.45, 1.2], face: facetJitter(rng) });
      [[0, 0, 0.26, 1.5, 0, 0], [0.3, 0.15, 0.18, 1.0, 0.45, 0.5], [-0.28, 0.1, 0.18, 1.1, -0.5, 1.4], [0.05, -0.3, 0.16, 0.8, 0.5, 2.6]].forEach(([sx, sz, r, h, tilt, az]) => {
        kit.add(new THREE.ConeGeometry(r, h, 5).translate(0, h / 2, 0), c, { p: [x + sx, 0.05, z + sz], r: [Math.sin(az) * tilt, 0, -Math.cos(az) * tilt], face: gem });
      });
    },
  },
  sky: {
    bush(kit, rng, x, z, c) {
      kit.add(new THREE.CylinderGeometry(0.07, 0.1, 0.4, 6), '#9a6a4a', { p: [x, 0.2, z] });
      blobs(kit, rng, x, z, c, [[0, 0.65, 0, 0.5], [0.38, 0.52, 0.15, 0.36], [-0.36, 0.55, 0.1, 0.38], [0.02, 0.55, -0.36, 0.36], [0.05, 0.98, 0.02, 0.32]]);
      for (let k = 0; k < 7; k++) {
        const a = rng() * TAU;
        const up = rng();
        kit.add(new THREE.IcosahedronGeometry(0.06, 0), '#ffffff', { p: [x + Math.cos(a) * 0.48 * (1 - up * 0.3), 0.55 + up * 0.45, z + Math.sin(a) * 0.48 * (1 - up * 0.3)], glow: 0.2 });
      }
    },
    boulder(kit, rng, x, z, c) {
      kit.add(rockGeo(rng, 0.55, 0, 0.15, true), c, { p: [x, 0.95, z], s: [1.15, 0.5, 1.05], face: facetJitter(rng) });
      kit.add(new THREE.ConeGeometry(0.55, 0.8, 7), '#cfc6ee', { p: [x, 0.5, z], r: [Math.PI, 0, 0], face: facetJitter(rng) });
      kit.add(new THREE.CylinderGeometry(0.5, 0.55, 0.1, 9), '#9ee3a0', { p: [x, 1.2, z] });
    },
  },
};

// Small, low, non-blocking decoration at a spot (x, z).
const DECO = {
  flowers(kit, rng, x, z) {
    const cols = ['#ff6b8b', '#ffd166', '#ffffff', '#c49bff', '#ff9f43'];
    for (let k = 0; k < 3; k++) {
      const fx = x + (rng() - 0.5) * 0.3;
      const fz = z + (rng() - 0.5) * 0.3;
      const h = 0.16 + rng() * 0.1;
      kit.add(new THREE.CylinderGeometry(0.014, 0.014, h, 3), '#4c9a3f', { p: [fx, h / 2, fz] });
      kit.add(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 5), cols[Math.floor(rng() * cols.length)], { p: [fx, h, fz], r: [rng() * 0.3, rng(), 0], glow: 0.08 });
      kit.add(new THREE.IcosahedronGeometry(0.028, 0), '#ffd23a', { p: [fx, h + 0.02, fz] });
    }
  },
  shells(kit, rng, x, z) {
    kit.add(new THREE.ConeGeometry(0.07, 0.15, 6), rng() < 0.5 ? '#ffd9c7' : '#f7b6a3', { p: [x, 0.05, z], r: [Math.PI / 2 - 0.3, rng() * TAU, 0] });
    const star = [];
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * TAU;
      const r = k % 2 ? 0.05 : 0.13;
      star.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    const g = prism(star, 0.03);
    kit.add(g, '#ff8a5c', { p: [x + 0.2, 0.035, z + 0.12], r: [-Math.PI / 2, 0, rng()] });
    g.dispose();
  },
  snowpiles(kit, rng, x, z) {
    kit.add(rockGeo(rng, 0.26, 1, 0.12), '#ffffff', { p: [x, 0.04, z], s: [1, 0.42, 1] });
    kit.add(rockGeo(rng, 0.17, 1, 0.12), '#f2f7ff', { p: [x + 0.22, 0.03, z + 0.1], s: [1, 0.45, 1] });
  },
  vents(kit, rng, x, z) {
    kit.add(new THREE.CylinderGeometry(0.1, 0.24, 0.18, 7), '#2a2222', { p: [x, 0.09, z], face: facetJitter(rng) });
    kit.add(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 7), '#ff6a1a', { p: [x, 0.185, z], glow: 1 });
  },
  glowshrooms(kit, rng, x, z) {
    for (let k = 0; k < 3; k++) {
      const fx = x + (rng() - 0.5) * 0.3;
      const fz = z + (rng() - 0.5) * 0.3;
      const h = 0.08 + rng() * 0.08;
      kit.add(new THREE.CylinderGeometry(0.02, 0.025, h, 4), '#efe6ff', { p: [fx, h / 2, fz] });
      kit.add(new THREE.SphereGeometry(0.07, 6, 3, 0, TAU, 0, Math.PI / 2), k % 2 ? '#ff8ad8' : '#7af0ff', { p: [fx, h, fz], glow: 0.85 });
    }
  },
};

// Share of free tiles that get decoration.
const DECO_RATE = { vents: 0.22, glowshrooms: 0.4, snowpiles: 0.45 };

// Grass tufts per theme (null = none): colour relative to the ground.
const TUFTS = { meadow: '#5fae4b', dunes: '#b9a45a', sky: '#6fc977', crystal: '#4fd1c1' };

// ------------------------------------------------------------------ the island
export class Island3D {
  constructor(engine) {
    this.engine = engine;
    this.group = null;
    this.world = null;
    this.theme = null;
    this.pickTargets = [];
    this.labels = [];
    this.labelPool = [];
    this.addLabel = this.addLabel.bind(this);
    this.timeU = { value: 0 };
    this.buildGeos = [];
    this.buildMats = [];

    this.toon = toonMaterial();
    this.proxyMat = new THREE.MeshBasicMaterial({ visible: false });
    this.clothMat = new THREE.MeshLambertMaterial({ color: '#ff7b2e', flatShading: true });
    this.clothKey = null;
    this.smokeMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#9a9aa2', transparent: true, opacity: 0.7, depthWrite: false });

    // Floating order display: a double-sided card drawn from the item icon, and a spinning gold halo.
    this.cardCanvas = document.createElement('canvas');
    this.cardCanvas.width = 256;
    this.cardCanvas.height = 256;
    this.cardTex = new THREE.CanvasTexture(this.cardCanvas);
    this.cardTex.colorSpace = THREE.SRGBColorSpace;
    this.cardTex.anisotropy = 4;
    this.cardMat = new THREE.MeshBasicMaterial({ map: this.cardTex, transparent: true, alphaTest: 0.02, toneMapped: false, fog: false });
    this.haloMat = new THREE.MeshBasicMaterial({ color: '#ffc83d', toneMapped: false, transparent: true });
    this.orderItem = null;
    this.orderColor = '#ffc83d';
  }

  // (Re)build every mesh for a sim world; disposes the previous island.
  build(world, theme) {
    this.clear();
    this.world = world;
    this.theme = theme;
    const rng = mulberry32((world.seed ^ 0x9e3779b9) >>> 0);
    const g = (this.group = new THREE.Group());
    g.name = 'island';
    this.engine.scene.add(g);
    const sdfLand = landSDF(world.land);
    const sdf = landSDF(shoreMask(world));
    const zc = tileZ(world.hubY);
    this.hubZ = zc;

    // Farthest land edge along each angle from the island centre (for the beach, skirt and sea rings).
    const R = new Float32Array(SEG);
    for (let j = 0; j < SEG; j++) {
      const a = (j / SEG) * TAU;
      let last = 2;
      for (let r = 0; r < 26; r += 0.1) if (sdf(Math.cos(a) * r, Math.sin(a) * r) <= 0.02) last = r;
      R[j] = last;
    }

    // --- ground: tiles + beach + skirt (receives shadows only)
    const ground = new Kit(rng);
    this.buildTiles(ground, world, theme, rng);
    ground.addRaw(this.terrainGeometry(theme, sdf, sdfLand, R, isoRadii(sdf, R, TERRAIN_ISO), rng));
    const groundMesh = this.addMesh(ground.build(), this.toon, false, true);
    groundMesh.name = 'ground';

    // --- sea
    this.buildSea(theme, sdf, R, rng);

    // --- props: node bases, obstacles, decoration, beach rocks, workshop (cast + receive)
    const props = new Kit(rng);
    for (const n of world.nodes) nodeBase(props, n.type, tileX(n.x), tileZ(n.y), rng);
    const style = OBSTACLES[theme.id] || OBSTACLES.meadow;
    for (const o of world.obstacles) (o.kind === 'bush' ? style.bush : style.boulder)(props, rng, tileX(o.x), tileZ(o.y), o.kind === 'bush' ? theme.props.bush : theme.props.boulder);
    this.buildDeco(props, world, theme, rng, sdf, R);
    this.buildWorkshop(props, zc, theme, rng);
    this.addMesh(props.build(), this.toon, true, true).name = 'props';

    // --- node tops (one InstancedMesh per resource type) and per-node animation state
    this.nodeFx = [];
    this.tops = {};
    const byType = {};
    for (const n of world.nodes) (byType[n.type] = byType[n.type] || []).push(n);
    for (const type of RES_IDS) {
      const list = byType[type];
      if (!list) continue;
      const geo = nodeTopGeometry(type, rng);
      this.buildGeos.push(geo);
      const mesh = new THREE.InstancedMesh(geo, this.toon, list.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      list.forEach((n, i) => {
        mesh.setColorAt(i, WHITE);
        this.nodeFx[n.id] = { mesh, i, type, x: tileX(n.x), z: tileZ(n.y), s: 1, ready: true, pop: 0, shake: 0, dim: false, yaw: rng() * TAU, phase: rng() * TAU };
      });
      g.add(mesh);
      this.tops[type] = mesh;
    }

    // --- ground decals: blob shadows (static) and markers (rings, targets, glows)
    const nN = world.nodes.length;
    const blobCount = nN + world.obstacles.length + 3;
    this.blobs = makeDecalMesh(blobCount, 'shadow');
    let b = 0;
    for (const n of world.nodes) setDecal(this.blobs, b++, tileX(n.x), GROUND_Y + 0.02, tileZ(n.y), SHADOW_R[n.type], 0, null, 0.3);
    for (const o of world.obstacles) setDecal(this.blobs, b++, tileX(o.x), GROUND_Y + 0.02, tileZ(o.y), 0.9, 0, null, 0.28);
    for (let k = -1; k <= 1; k++) setDecal(this.blobs, b++, k * 2, DECK_Y + 0.02, zc, 1.35, 0, null, 0.2);
    g.add(this.blobs);
    this.buildGeos.push(this.blobs.geometry);
    this.buildMats.push(this.blobs.material);

    this.iPM = nN; // player target marker
    this.iRR = nN + 1; // rival target ring
    this.iDD = nN + 2; // danger disc
    this.markers = makeDecalMesh(nN + 3 + nN, 'marker');
    let gi = nN + 3;
    for (const n of world.nodes) {
      if (n.type === 'crystal' || n.type === 'ore') {
        setDecal(this.markers, gi++, tileX(n.x), GROUND_Y + 0.025, tileZ(n.y), 1.3, 0, RES[n.type].light, n.type === 'crystal' ? 0.45 : 0.3, 1, 0, 0);
      }
    }
    g.add(this.markers);
    this.buildGeos.push(this.markers.geometry);
    this.buildMats.push(this.markers.material);

    this.buildWorkshopDynamic(zc);
    this.buildPickTargets(world, zc);

    // Fit the sun's shadow camera to the island (land extent + beach, up to the treetops).
    const box = new THREE.Box3();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (world.land[idx(x, y)]) box.expandByPoint(_p.set(tileX(x), 0, tileZ(y)));
    box.min.x -= 2;
    box.min.z -= 2;
    box.max.x += 2;
    box.max.z += 2;
    box.min.y = WATER_Y - 0.5;
    box.max.y = 4.2;
    this.engine.fitShadow(box);

    this.setOrderItem(this.orderItem, this.orderColor);
    g.updateMatrixWorld(true);
    return this;
  }

  addMesh(geo, mat, cast, receive) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    this.buildGeos.push(geo);
    this.group.add(m);
    return m;
  }

  // Bevelled grass tiles with a soil band under the lip, checker + slight random colour variation.
  buildTiles(kit, world, theme, rng) {
    const shape = roundedRect(0.885, 0.2);
    const tile = new THREE.ExtrudeGeometry(shape, { depth: 0.34, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 2, curveSegments: 3 });
    tile.rotateX(-Math.PI / 2);
    tile.translate(0, -0.41, 0);
    const soil = new THREE.Color(theme.ground.cliff);
    const soilDark = new THREE.Color(theme.ground.cliffDark);
    // On the lava world the tile sides glow like magma, so the gaps between tiles shine.
    const magma = theme.sea.kind === 'lava' ? new THREE.Color(theme.sea.color) : null;
    const [ga, gb] = theme.ground.top;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!world.land[idx(x, y)]) continue;
        const top = new THREE.Color((x + y) % 2 ? gb : ga).offsetHSL((rng() - 0.5) * 0.012, (rng() - 0.5) * 0.04, (rng() - 0.5) * 0.035);
        kit.add(tile, top, {
          p: [tileX(x), GROUND_Y, tileZ(y)],
          vc: (vx, vy, vz, c) => {
            if (vy > -0.005) return 0;
            if (vy > -0.1) {
              c.multiplyScalar(0.9);
              return 0;
            }
            if (magma) {
              c.copy(magma);
              return 0.9;
            }
            c.lerpColors(soil, soilDark, clamp01((-vy - 0.1) / 0.35));
            return 0;
          },
        });
      }
    }
    tile.dispose();
  }

  // Beach + rocky skirt as one polar mesh around the island centre. Rings inside the land follow R(angle)
  // (hidden under the tiles, visible only in the gaps), rings outside follow iso-distance contours.
  terrainGeometry(theme, sdf, sdfLand, R, iso, rng) {
    const sand = new THREE.Color(theme.ground.beach);
    const wet = sand.clone().multiplyScalar(0.78);
    const under = sand.clone().multiplyScalar(0.45).lerp(new THREE.Color(theme.sea.deep), 0.55);
    const soilDark = new THREE.Color(theme.ground.cliffDark);
    const cliff = new THREE.Color(theme.ground.cliff);
    const inner = [[0, 0], [0.35, 0], [0.6, 0], [1, -3], [1, -2.3], [1, -1.7], [1, -1.2], [1, -0.8], [1, -0.45], [1, -0.2], [1, 0]];
    const nIso = TERRAIN_ISO.length;
    const nTop = inner.length + nIso;
    const skirt = [[0.985, -1.85], [0.94, -2.5], [0.85, -3.35], [0.71, -4.5], [0.52, -5.8], [0.3, -7.1], [0.1, -8.3], [0, -8.9]];
    const rings = nTop + skirt.length;
    const P = new Float32Array(rings * SEG * 3);
    const C = new Float32Array(rings * SEG * 3);
    const G = new Float32Array(rings * SEG); // per-vertex glow (unused for now, kept for themed ground)
    const magma = theme.sea.kind === 'lava';
    for (let j = 0; j < SEG; j++) {
      const a = (j / SEG) * TAU;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      let prev = 0;
      let rimR = 0;
      for (let i = 0; i < nTop; i++) {
        let r;
        let d;
        let fill = false; // inside a filled bay: flat sand just under the grass lip
        if (i < inner.length) {
          r = Math.max(prev + (i ? 0.05 : 0), R[j] * inner[i][0] + inner[i][1]);
          d = sdf(ca * r, sa * r);
          if (d <= 0.02 && sdfLand(ca * r, sa * r) > 0.02) {
            fill = true;
            d = 0.1;
          }
        } else {
          r = Math.max(prev + 0.02, iso[j * nIso + i - inner.length]);
          d = TERRAIN_ISO[i - inner.length];
        }
        prev = r;
        let y = fill ? -0.13 : beachH(d);
        if (i === nTop - 1) {
          y = Math.min(y, -1.3);
          rimR = r;
        }
        const k = (i * SEG + j) * 3;
        P[k] = ca * r;
        P[k + 1] = y;
        P[k + 2] = sa * r;
        if (d <= 0.02) _c.copy(sand).multiplyScalar(magma ? 0.4 : 0.7);
        else if (y > -0.44) _c.copy(sand).multiplyScalar(Math.min(1, 0.84 + d * 0.6) * (0.97 + rng() * 0.06));
        else if (y > -0.58) _c.copy(wet);
        else _c.copy(under);
        C[k] = _c.r;
        C[k + 1] = _c.g;
        C[k + 2] = _c.b;
      }
      for (let s = 0; s < skirt.length; s++) {
        const [f, y0] = skirt[s];
        const last = s === skirt.length - 1;
        const r = last ? 0 : rimR * f + (rng() - 0.5) * 0.5;
        const k = ((nTop + s) * SEG + j) * 3;
        P[k] = ca * r;
        P[k + 1] = y0 + (last ? 0 : (rng() - 0.5) * 0.35);
        P[k + 2] = sa * r;
        _c.copy(s === 0 && theme.sea.kind === 'water' ? under : s % 2 ? soilDark : cliff);
        C[k] = _c.r;
        C[k + 1] = _c.g;
        C[k + 2] = _c.b;
      }
    }
    // Two triangles per quad, wound so faces point up/outward. Skirt faces get a per-face tint.
    const quads = (rings - 1) * SEG;
    const pos = new Float32Array(quads * 18);
    const col = new Float32Array(quads * 18);
    const glow = new Float32Array(quads * 6);
    let o = 0;
    const put = (i, j, tint) => {
      const k = (i * SEG + (j % SEG)) * 3;
      glow[o / 3] = G[k / 3];
      pos[o] = P[k];
      pos[o + 1] = P[k + 1];
      pos[o + 2] = P[k + 2];
      col[o] = C[k] * tint;
      col[o + 1] = C[k + 1] * tint;
      col[o + 2] = C[k + 2] * tint;
      o += 3;
    };
    for (let i = 0; i < rings - 1; i++) {
      for (let j = 0; j < SEG; j++) {
        const rock = i >= nTop - 1;
        const t1 = rock ? 0.86 + rng() * 0.28 : 1;
        const t2 = rock ? 0.86 + rng() * 0.28 : 1;
        put(i, j, t1);
        put(i, j + 1, t1);
        put(i + 1, j, t1);
        put(i, j + 1, t2);
        put(i + 1, j + 1, t2);
        put(i + 1, j, t2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
    return geo;
  }

  // Water or lava: a polar sea mesh with a per-vertex depth (for foam, colour and wave size). Clouds: a
  // soft cloud floor plus instanced puffs around the island.
  buildSea(theme, sdf, R, rng) {
    const sea = theme.sea;
    if (sea.kind === 'clouds') {
      const floor = new THREE.CircleGeometry(320, 48).rotateX(-Math.PI / 2);
      const floorMat = new THREE.MeshLambertMaterial({ color: sea.deep, emissive: new THREE.Color(sea.deep).multiplyScalar(0.5) });
      const fm = new THREE.Mesh(floor, floorMat);
      fm.position.y = -5.6;
      this.group.add(fm);
      this.buildGeos.push(floor);
      this.buildMats.push(floorMat);
      // Puffs below the island's rim, small near it and bigger far out, so the rocky skirt shows.
      const N = 150;
      const puff = new THREE.IcosahedronGeometry(1, 1);
      const mat = cloudMaterial(sea, this.timeU);
      const mesh = new THREE.InstancedMesh(puff, mat, N);
      for (let i = 0; i < N; i++) {
        const a = rng() * TAU;
        const j = Math.floor((a / TAU) * SEG) % SEG;
        const out = Math.pow(rng(), 1.3) * 40;
        const r = R[j] + 2.6 + out;
        const sc = (0.6 + rng() * 0.8) * (1 + out / 14);
        _p.set(Math.cos(a) * r, -3.0 - rng() * 2.2 - out * 0.03, Math.sin(a) * r);
        _q.setFromEuler(_e.set(0, rng() * TAU, 0));
        _s.set(sc * 1.4, sc * (0.45 + rng() * 0.2), sc * 1.1);
        mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      }
      this.group.add(mesh);
      this.buildGeos.push(puff);
      this.buildMats.push(mat);
      return;
    }
    // rings: one under the land edge, iso-distance rings over the shallows, then far out to the horizon
    const iso = isoRadii(sdf, R, WATER_ISO);
    const nIso = WATER_ISO.length;
    const far = [45, 90, 170, 330];
    const rings = 1 + nIso + far.length;
    const verts = new Float32Array(rings * SEG * 3);
    const depth = new Float32Array(rings * SEG);
    for (let j = 0; j < SEG; j++) {
      const a = (j / SEG) * TAU;
      let prev = 0;
      for (let i = 0; i < rings; i++) {
        let r;
        let d;
        if (i === 0) {
          r = R[j] - 1.2;
          d = sdf(Math.cos(a) * r, Math.sin(a) * r);
        } else if (i <= nIso) {
          r = Math.max(prev + 0.02, iso[j * nIso + i - 1]);
          d = WATER_ISO[i - 1];
        } else {
          r = Math.max(prev + 2, far[i - 1 - nIso]);
          d = 99;
        }
        prev = r;
        const k = i * SEG + j;
        verts[k * 3] = Math.cos(a) * r;
        verts[k * 3 + 1] = WATER_Y;
        verts[k * 3 + 2] = Math.sin(a) * r;
        const floorY = d < RIM ? beachH(d) : -1.35 - (d - RIM) * 1.5;
        depth[k] = Math.max(-0.4, Math.min(6, WATER_Y - floorY));
      }
    }
    const index = [];
    for (let i = 0; i < rings - 1; i++) {
      for (let j = 0; j < SEG; j++) {
        const a = i * SEG + j;
        const b = i * SEG + ((j + 1) % SEG);
        const c = (i + 1) * SEG + j;
        const d = (i + 1) * SEG + ((j + 1) % SEG);
        index.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mat = seaMaterial(sea, this.timeU);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -1; // before other transparent things (particles over the sea stay visible)
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.buildGeos.push(geo);
    this.buildMats.push(mat);
  }

  // Decoration on free tiles (kept to tile corners so nodes and paths stay clear), grass tufts, beach rocks.
  buildDeco(kit, world, theme, rng, sdf, R) {
    const busy = new Set();
    for (const n of world.nodes) busy.add(idx(n.x, n.y));
    for (const o of world.obstacles) busy.add(idx(o.x, o.y));
    for (const i of world.workshop) {
      const x = i % W;
      const y = Math.floor(i / W);
      busy.add(i);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) busy.add(idx(x + dx, y + dy));
    }
    busy.add(idx(world.spawn.player.x, world.spawn.player.y));
    busy.add(idx(world.spawn.rival.x, world.spawn.rival.y));
    const deco = DECO[theme.props.deco] || DECO.flowers;
    const tuft = TUFTS[theme.id];
    const blade = new THREE.ConeGeometry(0.035, 0.26, 3);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = idx(x, y);
        if (!world.land[i]) continue;
        const cx = tileX(x);
        const cz = tileZ(y);
        if (tuft) {
          const nt = 1 + Math.floor(rng() * 3);
          for (let k = 0; k < nt; k++) {
            const tx = cx + (rng() - 0.5) * 1.6;
            const tz = cz + (rng() - 0.5) * 1.6;
            for (let s = 0; s < 3; s++) {
              const a = (s / 3) * TAU + rng();
              kit.add(blade, tuft, { p: [tx + Math.cos(a) * 0.05, 0.11, tz + Math.sin(a) * 0.05], r: [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35], s: [1, 0.7 + rng() * 0.6, 1], jitter: 0.1 });
            }
          }
        }
        if (busy.has(i) || !world.walkable[i] || rng() > (DECO_RATE[theme.props.deco] || 0.5)) continue;
        const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
        const nDeco = rng() < 0.3 ? 2 : 1;
        for (let k = 0; k < nDeco; k++) {
          const [sx, sz] = corners.splice(Math.floor(rng() * corners.length), 1)[0];
          deco(kit, rng, cx + sx * (0.55 + rng() * 0.15), cz + sz * (0.55 + rng() * 0.15));
        }
      }
    }
    blade.dispose();
    // A few rocks on the beach.
    const rockCol = new THREE.Color(theme.ground.cliff).lerp(new THREE.Color(theme.ground.beach), 0.3);
    for (let k = 0; k < 16; k++) {
      const a = rng() * TAU;
      const j = Math.floor((a / TAU) * SEG) % SEG;
      const r = R[j] + 0.5 + rng() * 0.8;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const d = sdf(x, z);
      if (d < 0.35 || d > 1.3) continue;
      kit.add(rockGeo(rng, 0.14 + rng() * 0.18, 0, 0.3), rockCol, { p: [x, beachH(d) + 0.04, z], s: [1, 0.65, 1], jitter: 0.1, face: facetJitter(rng) });
    }
  }

  // The Workshop: a deck across the three hub tiles, the hut in the middle (door and window facing south,
  // toward the default camera), the player's bench on the west tile and the rival's on the east.
  buildWorkshop(kit, zc, theme, rng) {
    const wood = '#c7935c';
    const woodDark = '#8a5a33';
    const plaster = '#f6e8c8';
    const roof = theme.id === 'frost' ? '#6f8fc9' : theme.id === 'ember' ? '#7a3a2e' : theme.id === 'crystal' ? '#8a6bff' : '#e2574c';
    const deckTop = DECK_Y;
    kit.add(new THREE.BoxGeometry(5.8, deckTop, 1.8), wood, { p: [0, deckTop / 2, zc] });
    for (let k = -2; k <= 2; k++) kit.add(new THREE.BoxGeometry(5.82, 0.012, 0.025), '#9c6b3f', { p: [0, deckTop + 0.004, zc + k * 0.33] });
    // hut
    const hz = zc - 0.22;
    const wallH = 1.3;
    kit.add(new THREE.BoxGeometry(2.0, wallH, 1.25), plaster, { p: [0, deckTop + wallH / 2, hz] });
    for (const [px, pz] of [[-1, -0.625], [1, -0.625], [-1, 0.625], [1, 0.625]]) kit.add(new THREE.BoxGeometry(0.14, wallH + 0.04, 0.14), woodDark, { p: [px, deckTop + wallH / 2, hz + pz] });
    kit.add(new THREE.BoxGeometry(2.12, 0.12, 1.37), woodDark, { p: [0, deckTop + wallH, hz] });
    kit.add(new THREE.BoxGeometry(0.56, 0.9, 0.06), '#7a4a2a', { p: [-0.45, deckTop + 0.45, hz + 0.64] });
    kit.add(new THREE.BoxGeometry(0.66, 0.08, 0.08), woodDark, { p: [-0.45, deckTop + 0.93, hz + 0.65] });
    kit.add(new THREE.IcosahedronGeometry(0.04, 0), '#ffc83d', { p: [-0.26, deckTop + 0.45, hz + 0.68], glow: 0.3 });
    for (const side of [1, -1]) {
      // warm glowing windows on the south and north faces
      const wz = hz + side * 0.635;
      const wx = side > 0 ? 0.5 : 0;
      kit.add(new THREE.BoxGeometry(0.46, 0.4, 0.04), '#ffcf6b', { p: [wx, deckTop + 0.82, wz], glow: 0.9 });
      kit.add(new THREE.BoxGeometry(0.56, 0.06, 0.07), woodDark, { p: [wx, deckTop + 1.04, wz] });
      kit.add(new THREE.BoxGeometry(0.56, 0.06, 0.07), woodDark, { p: [wx, deckTop + 0.6, wz] });
      kit.add(new THREE.BoxGeometry(0.05, 0.4, 0.06), woodDark, { p: [wx, deckTop + 0.82, wz] });
    }
    // roof: two slanted slabs, gable triangles, ridge cap
    const ry = deckTop + wallH + 0.06;
    const half = 0.84;
    const rise = 0.72;
    const ang = Math.atan2(rise, half);
    const slope = Math.hypot(half, rise) + 0.18;
    for (const side of [1, -1]) {
      kit.add(new THREE.BoxGeometry(2.5, 0.1, slope), roof, {
        p: [0, ry + rise / 2, hz + side * half * 0.5 + side * 0.06],
        r: [side * ang, 0, 0],
        face: (cx, cy, cz, nx, ny, nz, c) => c.multiplyScalar(Math.floor(((cy - ry) / rise) * 4) % 2 ? 0.9 : 1),
      });
    }
    const gable = prism([-half, 0, half, 0, 0, rise], 0.06);
    for (const side of [1, -1]) kit.add(gable, plaster, { p: [side * 0.98 - (side > 0 ? 0.06 : 0), ry - 0.02, hz], r: [0, Math.PI / 2, 0] });
    gable.dispose();
    kit.add(new THREE.BoxGeometry(2.56, 0.12, 0.16), '#8e3a33', { p: [0, ry + rise + 0.02, hz], r: [Math.PI / 4, 0, 0] });
    // chimney
    this.chimney = new THREE.Vector3(0.62, ry + rise + 0.62, hz - 0.3);
    kit.add(new THREE.BoxGeometry(0.34, 1.0, 0.34), '#a7a4ad', { p: [0.62, ry + rise + 0.1, hz - 0.3], face: (cx, cy, cz, nx, ny, nz, c) => c.multiplyScalar(0.9 + ((Math.floor(cy * 6) + Math.floor(cx * 6)) % 2) * 0.12) });
    kit.add(new THREE.BoxGeometry(0.44, 0.1, 0.44), '#6f6c75', { p: [0.62, ry + rise + 0.62, hz - 0.3] });
    // benches: table, legs, anvil, tools; player's cloth and flag are blue (the rival's are a dynamic mesh)
    for (const side of [-1, 1]) {
      const bx = side * 2;
      const topY = deckTop + 0.74;
      kit.add(new THREE.BoxGeometry(1.4, 0.1, 0.84), '#b9794a', { p: [bx, topY, zc] });
      for (const [lx, lz] of [[-0.6, -0.34], [0.6, -0.34], [-0.6, 0.34], [0.6, 0.34]]) kit.add(new THREE.BoxGeometry(0.09, 0.74, 0.09), woodDark, { p: [bx + lx, deckTop + 0.37, zc + lz] });
      kit.add(new THREE.BoxGeometry(1.25, 0.06, 0.06), woodDark, { p: [bx, deckTop + 0.2, zc + 0.34] });
      kit.add(new THREE.CylinderGeometry(0.035, 0.035, 2.3, 5), woodDark, { p: [bx + side * 0.78, deckTop + 1.15, zc - 0.55] });
      if (side < 0) {
        kit.add(new THREE.BoxGeometry(1.42, 0.02, 0.36), '#3d7bff', { p: [bx, topY + 0.06, zc + 0.05] });
        kit.add(new THREE.BoxGeometry(0.62, 0.38, 0.03), '#3d7bff', { p: [bx - 1.1, deckTop + 2.05, zc - 0.55] });
      }
      // anvil
      const ax = bx - side * 0.25;
      kit.add(new THREE.BoxGeometry(0.22, 0.12, 0.18), '#4a4d57', { p: [ax, topY + 0.11, zc - 0.12] });
      kit.add(new THREE.BoxGeometry(0.42, 0.1, 0.2), '#5d616d', { p: [ax, topY + 0.21, zc - 0.12] });
      kit.add(new THREE.ConeGeometry(0.1, 0.22, 4), '#5d616d', { p: [ax + side * 0.28, topY + 0.21, zc - 0.12], r: [0, Math.PI / 4, -side * Math.PI / 2] });
      // hammer and a small crate
      kit.add(new THREE.CylinderGeometry(0.02, 0.02, 0.36, 4), woodDark, { p: [bx + side * 0.3, topY + 0.07, zc + 0.2], r: [Math.PI / 2, 0, 0.5] });
      kit.add(new THREE.BoxGeometry(0.16, 0.08, 0.08), '#4a4d57', { p: [bx + side * 0.22, topY + 0.08, zc + 0.36] });
      kit.add(new THREE.BoxGeometry(0.34, 0.3, 0.34), '#d6a46a', { p: [bx + side * 0.45, deckTop + 0.15, zc + 0.62], face: facetJitter(rng, 0.08, 0) });
    }
    // barrels by the hut
    for (const [bx, bz] of [[-1.2, 0.35], [1.22, -0.55]]) {
      kit.add(new THREE.CylinderGeometry(0.2, 0.2, 0.46, 9), '#a8703f', { p: [bx, deckTop + 0.23, zc + bz] });
      kit.add(new THREE.CylinderGeometry(0.215, 0.215, 0.05, 9), '#5d616d', { p: [bx, deckTop + 0.12, zc + bz] });
      kit.add(new THREE.CylinderGeometry(0.215, 0.215, 0.05, 9), '#5d616d', { p: [bx, deckTop + 0.36, zc + bz] });
    }
  }

  // Rival's cloth + flag (coloured per rival every frame), chimney smoke, the floating order display.
  buildWorkshopDynamic(zc) {
    const cloth = new Kit(Math.random);
    const topY = DECK_Y + 0.74;
    cloth.add(new THREE.BoxGeometry(1.42, 0.02, 0.36), WHITE, { p: [2, topY + 0.06, zc + 0.05] });
    cloth.add(new THREE.BoxGeometry(0.62, 0.38, 0.03), WHITE, { p: [3.1, DECK_Y + 2.05, zc - 0.55] });
    const cg = cloth.build();
    this.buildGeos.push(cg);
    const clothMesh = new THREE.Mesh(cg, this.clothMat);
    clothMesh.castShadow = true;
    this.group.add(clothMesh);

    this.smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), this.smokeMat, 7);
    this.smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.smoke.frustumCulled = false;
    this.buildGeos.push(this.smoke.geometry);
    this.group.add(this.smoke);

    this.display = new THREE.Group();
    this.display.position.set(0, 3.7, zc - 0.2);
    const front = new THREE.PlaneGeometry(1.3, 1.3);
    const back = new THREE.PlaneGeometry(1.3, 1.3).rotateY(Math.PI);
    const cardGeo = mergeGeometries([front, back]);
    front.dispose();
    back.dispose();
    this.card = new THREE.Mesh(cardGeo, this.cardMat);
    this.card.renderOrder = 2;
    this.display.add(this.card);
    const halo = new THREE.TorusGeometry(0.5, 0.045, 5, 28).rotateX(Math.PI / 2);
    this.halo = new THREE.Mesh(halo, this.haloMat);
    this.halo.position.y = -0.95;
    this.display.add(this.halo);
    this.buildGeos.push(cardGeo, halo);
    this.group.add(this.display);
  }

  // Invisible, generous hit shapes for tap-to-target.
  buildPickTargets(world, zc) {
    const nodeGeo = new THREE.CylinderGeometry(0.9, 0.9, 2.6, 8);
    const hubGeo = new THREE.BoxGeometry(6, 3, 2.2);
    const groundGeo = new THREE.PlaneGeometry(TILE * W + 4, TILE * H + 4).rotateX(-Math.PI / 2);
    this.buildGeos.push(nodeGeo, hubGeo, groundGeo);
    const add = (geo, x, y, z, data) => {
      const m = new THREE.Mesh(geo, this.proxyMat);
      m.position.set(x, y, z);
      m.visible = false;
      m.userData = data;
      this.group.add(m);
      this.pickTargets.push(m);
    };
    for (const n of world.nodes) add(nodeGeo, tileX(n.x), 1.3, tileZ(n.y), { kind: 'node', id: n.id });
    add(hubGeo, 0, 1.5, zc, { kind: 'hub' });
    add(groundGeo, 0, GROUND_Y, 0, { kind: 'ground' });
  }

  // Show the current order item floating above the Workshop (null hides it). color tints the halo/glow.
  setOrderItem(itemId, color = '#ffc83d') {
    this.orderItem = itemId || null;
    this.orderColor = color || '#ffc83d';
    const S = 256;
    const g = this.cardCanvas.getContext('2d');
    g.clearRect(0, 0, S, S);
    if (this.orderItem) {
      const rr = (x, y, w, h, r) => {
        g.beginPath();
        g.moveTo(x + r, y);
        g.arcTo(x + w, y, x + w, y + h, r);
        g.arcTo(x + w, y + h, x, y + h, r);
        g.arcTo(x, y + h, x, y, r);
        g.arcTo(x, y, x + w, y, r);
        g.closePath();
      };
      g.save();
      g.shadowColor = this.orderColor;
      g.shadowBlur = 28;
      rr(30, 30, 196, 196, 40);
      g.fillStyle = '#fff8ec';
      g.fill();
      g.restore();
      g.lineWidth = 10;
      g.strokeStyle = this.orderColor;
      rr(30, 30, 196, 196, 40);
      g.stroke();
      drawIcon(g, 'item', this.orderItem, 128, 128, 160);
    }
    this.cardTex.needsUpdate = true;
    this.haloMat.color.set(this.orderColor);
    if (this.display) this.display.visible = !!this.orderItem;
  }

  // Per frame: node motion and regrowth, ground markers, smoke, display, sea time. Returns glass-mode label
  // anchors [{ id, pos, p }] (empty otherwise); the array and its objects are reused between calls.
  update(match, dt, now, view = {}) {
    this.labels.length = 0;
    if (!this.group) return this.labels;
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    const t = now / 1000;
    this.timeU.value = t;
    const nodes = match ? match.world.nodes : this.world.nodes;
    const time = match ? match.time : 0;
    const respawnMul = (match && match.respawnMul) || 1;
    const need = view.need && view.need.size ? view.need : null;
    const inRace = match ? match.phase === 'race' : false;

    for (const n of nodes) {
      const st = this.nodeFx[n.id];
      if (!st) continue;
      const reserved = !!n.reserved;
      const ready = !reserved && n.readyAt <= time;
      let target = 1;
      if (!ready && !reserved) {
        const total = Math.max(0.1, n.respawn * respawnMul);
        target = 0.14 + 0.62 * smooth(clamp01(1 - (n.readyAt - time) / total));
      }
      if (ready && !st.ready && st.s < 0.95) st.pop = 1;
      st.ready = ready;
      st.s += (target - st.s) * (1 - Math.exp(-(target < st.s ? 12 : 3.5) * dt));
      let s = st.s;
      if (st.pop > 0) {
        st.pop = Math.max(0, st.pop - dt * 2.2);
        s *= 1 + Math.sin((1 - st.pop) * Math.PI * 2.5) * 0.2 * st.pop;
      }
      let rx = 0;
      let rz = 0;
      let dy = 0;
      let ry = st.yaw;
      let sy = 1;
      const ph = st.phase;
      if (reserved) {
        rx = Math.sin(t * 41 + ph) * 0.07;
        rz = Math.cos(t * 37 + ph) * 0.07;
        sy = 1 - Math.abs(Math.sin(t * 24)) * 0.07;
      } else if (ready) {
        if (st.type === 'wood') {
          rz = Math.sin(t * 1.1 + ph) * 0.03;
          rx = Math.cos(t * 0.9 + ph) * 0.02;
        } else if (st.type === 'fiber') {
          rz = Math.sin(t * 1.6 + ph) * 0.08;
          rx = Math.cos(t * 1.3 + ph) * 0.05;
        } else if (st.type === 'crystal') {
          dy = 0.04 + Math.sin(t * 1.8 + ph) * 0.04;
          ry += t * 0.25;
        } else sy = 1 + Math.sin(t * 2 + ph) * 0.015;
      }
      _p.set(st.x, GROUND_Y + BASE_H[st.type] + dy, st.z);
      _q.setFromEuler(_e.set(rx, ry, rz));
      _s.set(s, s * sy, s);
      st.mesh.setMatrixAt(st.i, _m.compose(_p, _q, _s));
      st.mesh.instanceMatrix.needsUpdate = true;
      // Nodes the order does not need are dimmed during the race.
      const dim = inRace && !!need && !need.has(n.type);
      if (dim !== st.dim) {
        st.dim = dim;
        st.mesh.setColorAt(st.i, dim ? DIM : WHITE);
        st.mesh.instanceColor.needsUpdate = true;
      }
      // Pulsing gold ring on needed, ready nodes.
      if (ready && need && need.has(n.type)) {
        const pulse = Math.sin(t * 5 + ph);
        setDecal(this.markers, n.id, st.x, GROUND_Y + 0.035, st.z, 1.02 + pulse * 0.05, 0, GOLD, 0.85 + pulse * 0.15, 0.18, 0, 1);
      } else hideDecal(this.markers, n.id);
    }

    // Your target: soft blue ring. The rival's: a spinning dashed ring in its colour, red + a pulsing
    // danger disc when it is going for your node and will get there first.
    const pt = view.playerTarget;
    const ptFx = pt !== null && pt !== undefined ? this.nodeFx[pt] : null;
    if (ptFx) setDecal(this.markers, this.iPM, ptFx.x, GROUND_Y + 0.04, ptFx.z, 1.2 + Math.sin(t * 3) * 0.04, 0, BLUE, 0.75, 0.3, 0, 1);
    else hideDecal(this.markers, this.iPM);
    const rt = view.rivalTarget;
    const rtFx = rt !== null && rt !== undefined ? this.nodeFx[rt] : null;
    const danger = !!rtFx && !!view.rivalFirst && rt === pt;
    if (rtFx) {
      if (!danger && view.rivalColor && view.rivalColor !== this.rivalRingKey) {
        this.rivalRingKey = view.rivalColor;
        (this.rivalRingColor = this.rivalRingColor || new THREE.Color()).set(view.rivalColor);
      }
      const col = danger ? RED : this.rivalRingColor || RED;
      setDecal(this.markers, this.iRR, rtFx.x, GROUND_Y + 0.045, rtFx.z, 1.42, t * (danger ? 2.6 : 1.2), col, 0.95, 0, 1, 1);
      if (danger) setDecal(this.markers, this.iDD, rtFx.x, GROUND_Y + 0.03, rtFx.z, 1.3, 0, RED, 0.35 + 0.2 * Math.sin(t * 9), 1, 0, 0);
      else hideDecal(this.markers, this.iDD);
    } else {
      hideDecal(this.markers, this.iRR);
      hideDecal(this.markers, this.iDD);
    }

    if (view.rivalColor && view.rivalColor !== this.clothKey) {
      this.clothKey = view.rivalColor;
      this.clothMat.color.set(view.rivalColor);
    }

    // Chimney smoke: puffs rise, drift and swell, then shrink away.
    const ch = this.chimney;
    for (let i = 0; i < 7; i++) {
      const f = (t * 0.28 + i / 7) % 1;
      const sc = (0.1 + f * 0.32) * (1 - smooth(clamp01((f - 0.7) / 0.3)));
      _p.set(ch.x + f * 0.9 + Math.sin(f * 7 + i) * 0.1, ch.y + 0.1 + f * 2.2, ch.z - f * 0.3);
      _q.setFromEuler(_e.set(f * 2 + i, f * 3, 0));
      _s.set(sc, sc * 0.85, sc);
      this.smoke.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    this.smoke.instanceMatrix.needsUpdate = true;

    if (this.display.visible) {
      // Fade the floating card when the camera comes close (it would fill the view over the Workshop).
      const cd = this.engine.camera.position.distanceTo(this.display.position);
      const fade = clamp01((cd - 5) / 5) * 0.88 + 0.12;
      this.cardMat.opacity = fade;
      this.haloMat.opacity = fade;
      this.card.rotation.y = t * 0.9;
      this.card.position.y = Math.sin(t * 2) * 0.08;
      this.halo.rotation.y = -t * 1.5;
      this.halo.scale.setScalar(1 + Math.sin(t * 3) * 0.05);
    }

    // Glass mode: where the rival thinks you are going, as anchors for HUD labels.
    if (view.glass && view.pred && typeof view.pred.forEach === 'function') view.pred.forEach(this.addLabel);
    return this.labels;
  }

  // Glass-mode label anchor for one prediction (bound once in the constructor: no per-frame closures).
  addLabel(pr, id) {
    const st = this.nodeFx[id];
    if (!st) return;
    let l = this.labelPool[this.labels.length];
    if (!l) l = this.labelPool[this.labels.length] = { id: 0, pos: new THREE.Vector3(), p: 0 };
    l.id = id;
    l.p = pr && typeof pr === 'object' ? pr.p : pr;
    l.pos.set(st.x, GROUND_Y + TOP_H[st.type] + 0.45, st.z);
    this.labels.push(l);
  }

  // Top of a node (for particles and labels).
  nodePos(id, out = new THREE.Vector3()) {
    const st = this.nodeFx && this.nodeFx[id];
    if (!st) return out.set(0, 0, 0);
    return out.set(st.x, GROUND_Y + TOP_H[st.type], st.z);
  }

  // 'player' bench (x = 3), 'rival' bench (x = 5), or the hut's door (centre).
  workshopPos(side, out = new THREE.Vector3()) {
    const z = this.hubZ === undefined ? tileZ(10) : this.hubZ;
    if (side === 'player') return out.set(-2, DECK_Y + 0.85, z);
    if (side === 'rival') return out.set(2, DECK_Y + 0.85, z);
    return out.set(0, DECK_Y + 0.9, z + 0.5);
  }

  // Where the floating order display hovers.
  displayPos(out = new THREE.Vector3()) {
    const z = this.hubZ === undefined ? tileZ(10) : this.hubZ;
    return out.set(0, 3.7, z - 0.2);
  }

  // Feet of the villager: on the deck in front of the hut, between the door and the window.
  villagerPos(out = new THREE.Vector3()) {
    const z = this.hubZ === undefined ? tileZ(10) : this.hubZ;
    return out.set(0.12, DECK_Y, z + 0.72);
  }

  clear() {
    if (this.group) this.engine.scene.remove(this.group);
    for (const g of this.buildGeos) g.dispose();
    for (const m of this.buildMats) m.dispose();
    this.buildGeos = [];
    this.buildMats = [];
    this.group = null;
    this.pickTargets = [];
    this.nodeFx = [];
    this.labels.length = 0;
  }

  dispose() {
    this.clear();
    this.toon.dispose();
    this.proxyMat.dispose();
    this.clothMat.dispose();
    this.smokeMat.dispose();
    this.cardMat.dispose();
    this.cardTex.dispose();
    this.haloMat.dispose();
  }
}

// Sim tile centre as a world position on the ground.
export function tilePos(x, y, out = new THREE.Vector3()) {
  return out.set(tileX(x), GROUND_Y, tileZ(y));
}

// The tiles an agent will walk through to its current destination (following world.nextStep exactly like
// the sim does), starting at its exact position and ending on the target node / Workshop tile.
// Returns [{ x, y }] in sim tile units; pass `out` to reuse the array and its objects.
export function routeTiles(match, who, out = []) {
  const a = match[who];
  const w = match.world;
  let n = putTile(out, 0, a.fx, a.fy);
  const d = a.dest;
  const field = !d ? null : d.kind === 'node' ? w.nodeField[d.id] : d.kind === 'hub' ? w.hubField : d.kind === 'tile' ? tileField(w, d.x, d.y) : null;
  if (field) {
    let x = a.to ? a.to.x : a.x;
    let y = a.to ? a.to.y : a.y;
    let pdx = a.dx;
    let pdy = a.dy;
    if (a.to) n = putTile(out, n, x, y);
    for (let g = 0; g < 48; g++) {
      const s = nextStep(w, field, x, y, pdx, pdy);
      if (!s) break;
      x = s.x;
      y = s.y;
      pdx = s.dx;
      pdy = s.dy;
      n = putTile(out, n, x, y);
    }
    if (d.kind === 'node' && w.nodes[d.id]) n = putTile(out, n, w.nodes[d.id].x, w.nodes[d.id].y);
    else if (d.kind === 'hub') {
      let best = -1;
      let bd = Infinity;
      for (const i of w.workshop) {
        const dd = Math.abs((i % W) - x) + Math.abs(Math.floor(i / W) - y);
        if (dd < bd) {
          bd = dd;
          best = i;
        }
      }
      if (best >= 0) n = putTile(out, n, best % W, Math.floor(best / W));
    }
  }
  out.length = n;
  return out;
}

function putTile(out, n, x, y) {
  const o = out[n] || (out[n] = { x: 0, y: 0 });
  o.x = x;
  o.y = y;
  return n + 1;
}
