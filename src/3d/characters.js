// 3D characters for OUTCRAFT: procedural chibi crafters (the player skins, the five rivals and the
// villager who posts orders), their procedural animation, carried resource items, offscreen portraits
// for the HTML UI and a turntable preview for the shop.
//
// How it is built: every body part is a three.js primitive baked (transformed + vertex coloured) into
// one merged geometry per bone, with one geometry group per material finish (matte, metal, glow...).
// A character is about a dozen meshes, every character shares the same handful of materials (so the
// shader programs are shared), and built geometries are cached per look, so the in-game player, its
// portrait and its shop preview reuse the same buffers.
//
// Model space: feet at y = 0, facing +Z, about 1.7 m tall (a little more with a hat).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { SKINS, SKIN_BY_ID, DEFAULT_SKIN } from '../skins.js';
import { RES, RIVALS, GATHER_TIME } from '../data.js';

const TAU = Math.PI * 2;
const SIDES = [1, -1]; // index 0 = the character's left (+X), 1 = its right (-X)

// Body layout in metres (world heights at rest).
const HIP = 0.4; // hip joints; the torso bone pivots here
const NECK = 0.84; // head bone pivot
const SHOULDER_X = 0.215;
const SHOULDER_Y = 0.74;
const ARM_LEN = 0.3; // shoulder to the centre of the hand
const LEG_X = 0.1;
const HEAD_C = 0.36; // head centre above the neck pivot
const HEAD_R = 0.42;
const HS = [1.06, 0.95, 1]; // head ellipsoid scale
const EYE_YAW = 0.34;
const EYE_PITCH = -0.06;
const MOUTH_PITCH = -0.33;
const SLOT_MAX = 6;
const CARRY_SCALE = 1.3;
const SHADOW_SIZE = 0.95; // blob shadow diameter

const STATES = new Set(['idle', 'walk', 'wait', 'gather', 'deposit', 'think']);
const EMOTES = new Set(['hop', 'sad', 'cheer', 'wave']);
const SCOOP_RES = new Set(['sand', 'fiber']);

// ------------------------------------------------------------------------------------------------
// Small helpers

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const easeInOut = (t) => t * t * (3 - 2 * t);
const easeOutBack = (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);

function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

const _rgbA = { r: 0, g: 0, b: 0 };
const _rgbB = { r: 0, g: 0, b: 0 };
const toColor = (c) => (c && c.isColor ? c : new THREE.Color(c));

// Mix two colours in sRGB (perceptually even), returns a THREE.Color.
function mix(a, b, t) {
  toColor(a).getRGB(_rgbA, THREE.SRGBColorSpace);
  toColor(b).getRGB(_rgbB, THREE.SRGBColorSpace);
  return new THREE.Color().setRGB(
    _rgbA.r + (_rgbB.r - _rgbA.r) * t,
    _rgbA.g + (_rgbB.g - _rgbA.g) * t,
    _rgbA.b + (_rgbB.b - _rgbA.b) * t,
    THREE.SRGBColorSpace,
  );
}
const shade = (c, t) => mix(c, '#000000', t);
const tint = (c, t) => mix(c, '#ffffff', t);
function luma(c) {
  toColor(c).getRGB(_rgbA, THREE.SRGBColorSpace);
  return 0.299 * _rgbA.r + 0.587 * _rgbA.g + 0.114 * _rgbA.b;
}

// ------------------------------------------------------------------------------------------------
// Geometry helpers

const ZERO3 = [0, 0, 0];
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

// Transform { p: [x,y,z], r: [x,y,z], o: euler order, s: number | [x,y,z] } -> Matrix4.
function tmat(t) {
  const m = new THREE.Matrix4();
  if (!t) return m;
  const r = t.r || ZERO3;
  const s = t.s == null ? 1 : t.s;
  _e.set(r[0], r[1], r[2], t.o || 'XYZ');
  if (typeof s === 'number') _s.set(s, s, s);
  else _s.fromArray(s);
  return m.compose(_p.fromArray(t.p || ZERO3), _q.setFromEuler(_e), _s);
}

// Normalise a primitive for merging: indexed, only position + normal.
function prep(geo) {
  if (!geo.index) {
    const n = geo.attributes.position.count;
    const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
  if (!geo.attributes.normal) geo.computeVertexNormals();
  return geo;
}

function paint(geo, color) {
  const c = toColor(color);
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
}

// Turn a mesh inside out (for linings seen from inside: basket, cape, crown).
function flip(geo) {
  prep(geo);
  const idx = geo.index.array;
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  const n = geo.attributes.normal.array;
  for (let i = 0; i < n.length; i++) n[i] = -n[i];
  return geo;
}

// Box with rounded edges; normals point away from the inner box so shading is smooth.
function rbox(w, h, d, r, seg = 4) {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const hx = w / 2 - r;
  const hy = h / 2 - r;
  const hz = d / 2 - r;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const cx = clamp(x, -hx, hx);
    const cy = clamp(y, -hy, hy);
    const cz = clamp(z, -hz, hz);
    let nx = x - cx;
    let ny = y - cy;
    let nz = z - cz;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    pos.setXYZ(i, cx + nx * r, cy + ny * r, cz + nz * r);
    nor.setXYZ(i, nx, ny, nz);
  }
  return g;
}

// Bend a geometry that runs along +Y into an arc of `ang` radians toward +X (or +Z).
function bend(geo, ang, axis = 'x') {
  if (!ang) return geo;
  geo.computeBoundingBox();
  const y0 = geo.boundingBox.min.y;
  const h = geo.boundingBox.max.y - y0;
  const R = h / ang;
  const pos = geo.attributes.position;
  const ai = axis === 'x' ? 0 : 2;
  const v = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    v[0] = pos.getX(i);
    v[1] = pos.getY(i);
    v[2] = pos.getZ(i);
    const a = (v[1] - y0) / R;
    const rad = R - v[ai];
    v[ai] = R - rad * Math.cos(a);
    v[1] = y0 + rad * Math.sin(a);
    pos.setXYZ(i, v[0], v[1], v[2]);
  }
  geo.computeVertexNormals();
  return geo;
}

// Faceted rock: an icosahedron with every corner pushed in or out by a hash of its position.
function rock(r, amt, seed) {
  const g = new THREE.IcosahedronGeometry(r, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed) * 43758.5453;
    const k = 1 + (h - Math.floor(h) - 0.5) * amt;
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}

const ball = (w = 12, h = 9) => new THREE.SphereGeometry(1, w, h);
const sphere = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
const cyl = (rt, rb, h, seg = 12, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const capsule = (r, len, seg = 10) => new THREE.CapsuleGeometry(r, len, 3, seg);
const cone = (r, h, seg = 12) => new THREE.ConeGeometry(r, h, seg);
const torus = (R, r, rs = 6, ts = 20, arc = TAU) => new THREE.TorusGeometry(R, r, rs, ts, arc);
const lathe = (pts, seg = 18) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);

// A point on the head surface (head-local coordinates) with a rotation that turns local +Z outward.
function surf(yaw, pitch, lift = 0, roll = 0) {
  const r = HEAD_R + lift;
  const cp = Math.cos(pitch);
  return {
    p: [Math.sin(yaw) * cp * r * HS[0], HEAD_C + Math.sin(pitch) * r * HS[1], Math.cos(yaw) * cp * r * HS[2]],
    r: [-pitch, yaw, roll],
    o: 'YXZ',
  };
}

// Collects coloured parts for one mesh, grouped by material finish. frame(t) returns a kit that
// writes into the same store with an extra parent transform.
class Kit {
  constructor(store = new Map(), base = null) {
    this.store = store;
    this.base = base;
  }

  frame(t) {
    const m = tmat(t);
    if (this.base) m.premultiply(this.base);
    return new Kit(this.store, m);
  }

  add(geo, color, t = null, finish = 'matte') {
    prep(geo);
    const m = tmat(t);
    if (this.base) m.premultiply(this.base);
    geo.applyMatrix4(m);
    paint(geo, color);
    let list = this.store.get(finish);
    if (!list) this.store.set(finish, (list = []));
    list.push(geo);
    return this;
  }

  build() {
    const finishes = [...this.store.keys()];
    if (!finishes.length) return null;
    const merged = finishes.map((f) => {
      const list = this.store.get(f);
      const g = list.length === 1 ? list[0] : mergeGeometries(list);
      if (list.length > 1) for (const x of list) x.dispose();
      return g;
    });
    const geometry = merged.length === 1 ? merged[0] : mergeGeometries(merged, true);
    if (merged.length > 1) for (const x of merged) x.dispose();
    geometry.computeBoundingSphere();
    return { geometry, finishes };
  }
}

// ------------------------------------------------------------------------------------------------
// Shared materials (one per finish; vertex colours carry the actual colours)

let ENV = null;
// Tiny procedural sky/ground cube map so metal, chrome and glass have something to reflect.
function envMap() {
  if (ENV) return ENV;
  const S = 32;
  const faces = [];
  for (let i = 0; i < 6; i++) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    if (i === 2) {
      g.fillStyle = '#bfe2ff';
      g.fillRect(0, 0, S, S);
    } else if (i === 3) {
      g.fillStyle = '#5a4e3e';
      g.fillRect(0, 0, S, S);
    } else {
      const gr = g.createLinearGradient(0, 0, 0, S);
      gr.addColorStop(0, '#8ec6ff');
      gr.addColorStop(0.46, '#f4fbff');
      gr.addColorStop(0.54, '#cfc2a6');
      gr.addColorStop(1, '#5a4e3e');
      g.fillStyle = gr;
      g.fillRect(0, 0, S, S);
      if (i === 0 || i === 4) {
        const sun = g.createRadialGradient(S * 0.62, S * 0.26, 0, S * 0.62, S * 0.26, S * 0.3);
        sun.addColorStop(0, 'rgba(255,255,255,1)');
        sun.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = sun;
        g.fillRect(0, 0, S, S);
      }
    }
    faces.push(cv);
  }
  ENV = new THREE.CubeTexture(faces);
  ENV.colorSpace = THREE.SRGBColorSpace;
  ENV.needsUpdate = true;
  return ENV;
}

const MATS = {};
function material(f) {
  let m = MATS[f];
  if (m) return m;
  const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
  switch (f) {
    case 'metal':
      m = std({ metalness: 0.8, roughness: 0.36, envMap: envMap(), envMapIntensity: 1 });
      break;
    case 'chrome':
      m = std({ metalness: 1, roughness: 0.06, envMap: envMap(), envMapIntensity: 1.3 });
      break;
    case 'glossy':
      m = std({ metalness: 0, roughness: 0.3, envMap: envMap(), envMapIntensity: 0.45 });
      break;
    case 'eye':
      m = std({ metalness: 0, roughness: 0.12, envMap: envMap(), envMapIntensity: 0.7 });
      break;
    case 'glow':
      m = new THREE.MeshBasicMaterial({ vertexColors: true });
      break;
    case 'glass':
      m = new THREE.MeshStandardMaterial({
        color: 0xeaf8ff,
        transparent: true,
        opacity: 0.2,
        metalness: 0.1,
        roughness: 0.04,
        envMap: envMap(),
        envMapIntensity: 1.6,
        depthWrite: false,
      });
      break;
    case 'crystal':
      m = std({ metalness: 0.1, roughness: 0.16, emissive: 0x1784b8, emissiveIntensity: 0.5, flatShading: true });
      break;
    default:
      m = std({ metalness: 0, roughness: 0.72 });
  }
  m.name = 'char-' + f;
  return (MATS[f] = m);
}

const _matLists = new Map();
function materialsFor(finishes) {
  if (finishes.length === 1) return material(finishes[0]);
  const key = finishes.join('|');
  let list = _matLists.get(key);
  if (!list) _matLists.set(key, (list = finishes.map(material)));
  return list;
}

let BLOB = null;
// Soft round contact shadow under the feet (helps readability on top of real shadows).
function blobShadow() {
  if (!BLOB) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(18,24,36,0.62)');
    gr.addColorStop(0.55, 'rgba(18,24,36,0.34)');
    gr.addColorStop(1, 'rgba(18,24,36,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    const map = new THREE.CanvasTexture(cv);
    map.colorSpace = THREE.SRGBColorSpace;
    BLOB = {
      geo: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      mat: new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    };
  }
  const m = new THREE.Mesh(BLOB.geo, BLOB.mat);
  m.name = 'blob-shadow';
  m.position.y = 0.012;
  m.renderOrder = 1;
  return m;
}

// ------------------------------------------------------------------------------------------------
// Looks: a flat description of what to build, derived from a skin, a rival or the villager.

const LONG_SLEEVES = new Set(['space', 'headband', 'wizard', 'crown', 'helmet', 'antenna']);

function baseLook(key, kind) {
  return {
    key,
    kind,
    species: null,
    c: {},
    hat: 'none',
    pack: 'none',
    glow: null,
    cloth: 'matte',
    head: null,
    headFinish: 'matte',
    hairFinish: 'matte',
    hair: 'short',
    longSleeves: false,
    hand: null,
    handFinish: 'matte',
    ears: true,
    cheeks: true,
    brows: null,
    browColor: '#3a2a22',
    eyes: 'dark',
    eyeColor: '#241f33',
    eyeGlow: null,
    highlight: '#ffffff',
    visor: null,
    mouthAt: null,
    belly: null,
    belt: true,
    robe: false,
    torsoScale: 1,
  };
}

function playerLook(skin) {
  const c = skin.colors;
  const metal = !!skin.metal;
  const L = baseLook('player:' + skin.id, 'player');
  const robot = skin.hat === 'antenna';
  Object.assign(L, {
    c: { ...c },
    hat: skin.hat || 'none',
    pack: skin.pack || 'satchel',
    glow: skin.glow || null,
    cloth: metal ? 'metal' : 'matte',
    head: c.skin,
    hairFinish: metal ? 'metal' : 'matte',
    hair: robot ? 'plate' : 'short',
    longSleeves: metal || LONG_SLEEVES.has(skin.hat),
    hand: metal ? c.boots : skin.hat === 'space' ? c.pants : c.skin,
    handFinish: metal ? 'metal' : 'matte',
    ears: !robot,
    cheeks: !robot,
    eyes: robot ? 'glow' : 'dark',
    eyeGlow: robot ? skin.glow || c.accent : null,
    visor: robot ? { color: '#18212d', finish: 'glossy' } : null,
    belt: skin.hat !== 'chef',
    robe: skin.hat === 'wizard',
  });
  return L;
}

function rivalLook(def) {
  const fur = def.color || '#ff7b2e';
  const look = ['sprout', 'beak', 'ears', 'crest', 'mirror'].includes(def.look) ? def.look : 'ears';
  const L = baseLook('rival:' + (def.id || look) + ':' + fur, 'rival');
  Object.assign(L, {
    species: look,
    c: { body: fur, accent: shade(fur, 0.2), pants: fur, skin: fur, hair: fur, boots: shade(fur, 0.32) },
    head: fur,
    hair: 'none',
    longSleeves: true,
    hand: tint(fur, 0.4),
    ears: false,
    brows: 'angry',
    browColor: shade(fur, 0.62),
    belly: tint(fur, 0.55),
    belt: false,
    pack: 'satchel',
  });
  switch (look) {
    case 'sprout': // PIP: soft and polite, a little seedling on its head
      L.brows = null;
      L.c.pack = '#4f9d5a';
      L.c.accent = '#8fd672';
      L.belly = tint(fur, 0.6);
      break;
    case 'beak': // WREN: pink bird, orange beak, head tuft, tail feathers, a woven basket
      L.pack = 'basket';
      L.hand = tint(fur, 0.5);
      break;
    case 'ears': // FOX: pointy ears, white muzzle, big tail, dark socks
      L.c.pack = '#7a4a2a';
      L.c.accent = '#b8773f';
      L.belly = '#fff3e6';
      L.hand = '#3b2b2b';
      L.c.boots = '#3b2b2b';
      L.mouthAt = { yaw: 0, pitch: -0.42, lift: 0.1 };
      break;
    case 'crest': // RAVEN: darker plumage, spiky crest, dark cloak, golden glint in the eyes
      L.c.body = mix(fur, '#241c3d', 0.5);
      L.c.pants = L.c.body;
      L.head = mix(fur, '#241c3d', 0.18);
      L.c.boots = '#231b36';
      L.hand = mix(fur, '#ffffff', 0.15);
      L.belly = mix(fur, '#ffffff', 0.3);
      L.pack = 'cape';
      L.c.cape = '#33284f';
      L.c.capeLining = '#7b5cd6';
      L.highlight = '#ffd23d';
      L.browColor = '#1c1530';
      break;
    case 'mirror': // MIMIC: glossy teal, mirror-chrome face, sleek chrome jetpack, pink leaf
      L.cloth = 'glossy';
      L.headFinish = 'glossy';
      L.visor = { color: '#cdeeea', finish: 'chrome' };
      L.brows = null;
      L.cheeks = false;
      L.eyeColor = '#0b2626';
      L.pack = 'jetpack';
      L.c.accent = '#9ff3e8';
      L.glow = '#7ff6ff';
      L.belly = tint(fur, 0.35);
      break;
  }
  return L;
}

function villagerLook() {
  const L = baseLook('villager', 'villager');
  Object.assign(L, {
    c: { body: '#ff8c42', accent: '#ffe066', pants: '#4f6d7a', skin: '#d4935c', hair: '#f4f1ea', boots: '#8b5a2b' },
    hat: 'straw',
    head: '#d4935c',
    hand: '#d4935c',
    brows: 'bushy',
    browColor: '#f4f1ea',
    torsoScale: 1.14,
    villager: true,
  });
  return L;
}

function skinOf(def) {
  if (def && typeof def === 'object' && def.colors) return def;
  return SKIN_BY_ID[def] || SKIN_BY_ID[DEFAULT_SKIN] || SKINS[0];
}
function rivalOf(def) {
  if (def && typeof def === 'object' && def.color) return def;
  return RIVALS.find((r) => r.id === def) || RIVALS[0];
}
function lookFor(kind, def) {
  if (kind === 'rival') return rivalLook(rivalOf(def));
  if (kind === 'villager') return villagerLook();
  return playerLook(skinOf(def));
}

// ------------------------------------------------------------------------------------------------
// Builders. Coordinates: torso kit = relative to the hip joint height (y 0 = HIP), head kit =
// relative to the neck pivot, arm/leg kits = relative to their joint, hanging along -Y.

const SHIRT = [
  [0.2, 0.43],
  [0.236, 0.436],
  [0.25, 0.5],
  [0.248, 0.6],
  [0.228, 0.69],
  [0.19, 0.77],
  [0.13, 0.83],
  [0, 0.87],
];
const ROBE = [
  [0.2, 0.27],
  [0.29, 0.275],
  [0.275, 0.36],
  [0.255, 0.48],
  [0.248, 0.6],
  [0.228, 0.69],
  [0.19, 0.77],
  [0.13, 0.83],
  [0, 0.87],
];

// Shirt radius at a world height (to put details on the chest).
function shirtR(y) {
  for (let i = 1; i < SHIRT.length; i++) {
    if (y <= SHIRT[i][1]) {
      const [r0, y0] = SHIRT[i - 1];
      const [r1, y1] = SHIRT[i];
      return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
    }
  }
  return 0;
}

// Place a part on the chest at world height y and angle a (0 = front), facing outward.
function onChest(L, y, a, lift = 0, s = 1, roll = 0) {
  const r = (shirtR(y) + lift) * L.torsoScale;
  return { p: [Math.sin(a) * r, y - HIP, Math.cos(a) * r], r: [0, a, roll], o: 'YXZ', s };
}

function capeColor(L) {
  if (L.c.cape) return L.c.cape;
  return luma(L.c.accent) > 0.62 ? shade(L.c.body, 0.18) : L.c.accent;
}

function buildTorso(k, L, accs) {
  const c = L.c;
  const ts = L.torsoScale;
  const body = k.frame({ s: [ts, 1, ts] });
  const cloth = L.cloth;
  const y = (w) => w - HIP;
  // hips / shorts, then the shirt (or robe) over them
  body.add(lathe([[0, 0.29], [0.15, 0.295], [0.2, 0.33], [0.215, 0.4], [0.215, 0.47]].map(([r, h]) => [r, y(h)]), 18), c.pants, null, cloth);
  body.add(lathe((L.robe ? ROBE : SHIRT).map(([r, h]) => [r, y(h)]), 18), c.body, null, cloth);
  if (L.belly) body.add(ball(), L.belly, { p: [0, y(0.56), 0.19], s: [0.17, 0.2, 0.08] }, cloth);

  // collar, belt and the outfit details that make each skin read at a glance
  const gold = '#ffd23d';
  const beltY = y(0.47);
  const belt = (color, finish = 'matte', buckle = gold) => {
    body.add(torus(0.238, 0.024, 6, 26), color, { p: [0, beltY, 0], r: [Math.PI / 2, 0, 0] }, finish);
    if (buckle) body.add(rbox(0.075, 0.055, 0.024, 0.01, 2), buckle, { p: [0, beltY, 0.248] }, 'metal');
  };
  if (L.kind === 'player') {
    const collar = (color, finish = 'matte') => k.add(torus(0.125, 0.032, 6, 18), color, { p: [0, y(0.82), 0.01], r: [Math.PI / 2 - 0.12, 0, 0] }, finish);
    switch (L.hat) {
      case 'cap': // Explorer: collar and a chest pocket
        collar(c.accent);
        k.add(rbox(0.1, 0.085, 0.025, 0.012, 2), shade(c.body, 0.18), onChest(L, 0.63, 0.38, 0.004), cloth);
        k.add(rbox(0.104, 0.03, 0.03, 0.01, 2), c.accent, onChest(L, 0.665, 0.38, 0.006), cloth);
        break;
      case 'bandana': // Scout: neckerchief
        collar(c.accent);
        k.add(cone(0.1, 0.16, 3), c.accent, { p: [0, y(0.73), 0.2], r: [Math.PI + 0.35, 0, 0], s: [1, 1, 0.3] });
        break;
      case 'chef': // Chef: red neckerchief and double-breasted buttons
        k.add(torus(0.12, 0.04, 6, 18), c.accent, { p: [0, y(0.82), 0.01], r: [Math.PI / 2 - 0.12, 0, 0] });
        k.add(cone(0.08, 0.13, 3), c.accent, { p: [0, y(0.745), 0.2], r: [Math.PI + 0.35, 0, 0], s: [1, 1, 0.3] });
        for (const s of SIDES) for (const h of [0.52, 0.6, 0.68]) k.add(ball(8, 6), '#3a3a44', { ...onChest(L, h, s * 0.3, 0.004), s: 0.018 });
        break;
      case 'pirate': // Pirate: gold buttons
        collar(shade(c.body, 0.2));
        for (const h of [0.55, 0.63, 0.71]) k.add(ball(8, 6), c.accent, { ...onChest(L, h, 0, 0.004), s: 0.02 }, 'metal');
        break;
      case 'headband': // Ninja: red sash with a knot
        belt(c.accent, 'matte', null);
        body.add(ball(), c.accent, { p: [0.17, beltY, 0.17], s: [0.05, 0.045, 0.04] });
        body.add(capsule(0.022, 0.08, 6), c.accent, { p: [0.19, beltY - 0.07, 0.17], r: [0, 0, 0.3] });
        break;
      case 'helmet': { // Knight: blue tabard with a gold emblem
        const tab = new THREE.CylinderGeometry(0.228, 0.258, 0.3, 14, 1, true, -0.62, 1.24);
        k.add(tab, c.accent, { p: [0, y(0.59), 0], s: [ts, 1, ts] });
        k.add(new THREE.OctahedronGeometry(0.045, 0), gold, { ...onChest(L, 0.62, 0, 0.018), s: [1, 1.3, 0.35] }, 'metal');
        collar(shade(c.body, 0.1), 'metal');
        break;
      }
      case 'horns': // Viking: fluffy fur collar
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * TAU;
          k.add(new THREE.IcosahedronGeometry(0.06, 1), tint(c.accent, 0.1), { p: [Math.sin(a) * 0.15, y(0.815) + Math.cos(a) * 0.012, Math.cos(a) * 0.15] });
        }
        break;
      case 'garland': // Festival: marigold necklace with little lights
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU;
          const droop = (1 + Math.cos(a)) * 0.5;
          const p = [Math.sin(a) * (0.17 + droop * 0.06), y(0.8) - droop * 0.07, Math.cos(a) * (0.16 + droop * 0.07)];
          k.add(new THREE.IcosahedronGeometry(0.042, 1), i % 2 ? c.accent : '#ff7a00', { p });
        }
        break;
      case 'space': // Astronaut: helmet ring and a chest control box
        k.add(torus(0.17, 0.05, 8, 22), c.pants, { p: [0, y(0.84), 0], r: [Math.PI / 2, 0, 0] });
        k.add(rbox(0.15, 0.1, 0.05, 0.015, 2), c.accent, onChest(L, 0.62, 0, 0.01));
        for (const [dx, col] of [[-0.035, L.glow || '#7fd6ff'], [0.035, '#ffffff']]) k.add(ball(8, 6), col, { ...onChest(L, 0.62, dx * 4, 0.04), s: 0.016 }, 'glow');
        break;
      case 'antenna': // Robot: chest screen with glowing bars
        k.add(rbox(0.17, 0.12, 0.035, 0.015, 2), '#18212d', onChest(L, 0.62, 0, 0.005), 'glossy');
        for (const [dx, h] of [[-0.045, 0.05], [0, 0.075], [0.045, 0.035]]) k.add(rbox(0.024, h, 0.01, 0.004, 1), L.glow || c.accent, { ...onChest(L, 0.6 + h / 2, dx * 4.3, 0.025) }, 'glow');
        break;
      case 'wizard': // Wizard: gold hem trim and a star on the chest
        body.add(torus(0.283, 0.018, 5, 26), c.accent, { p: [0, y(0.285), 0], r: [Math.PI / 2, 0, 0] });
        k.add(starGeo(0.05, 0.022, 0.012), L.glow || c.accent, onChest(L, 0.64, 0.35, 0.004), L.glow ? 'glow' : 'matte');
        break;
      case 'crown': // Royal: ermine collar and a gold medallion
        k.add(torus(0.15, 0.055, 8, 20), '#fbf8f2', { p: [0, y(0.81), 0.01], r: [Math.PI / 2 - 0.1, 0, 0] });
        for (let i = 0; i < 6; i++) {
          const a = -1.2 + (i / 5) * 2.4;
          k.add(ball(6, 5), '#1e1a1a', { p: [Math.sin(a) * 0.2, y(0.815), Math.cos(a) * 0.2], s: [0.014, 0.022, 0.01] });
        }
        k.add(ball(10, 8), gold, { ...onChest(L, 0.66, 0, 0.005), s: [0.04, 0.04, 0.015] }, 'metal');
        break;
      default:
        collar(c.accent, cloth);
    }
    if (L.belt && L.hat !== 'headband') {
      if (L.robe) belt(c.accent, 'matte', null);
      else if (L.hat === 'crown') belt(gold, 'metal', '#ff4d6d');
      else belt(L.cloth === 'metal' ? shade(c.boots, 0.1) : shade(c.boots, 0.12), L.cloth === 'metal' ? 'metal' : 'matte');
    }
  } else if (L.villager) {
    // islander shirt with a flower print and a round belly
    for (const [h, a] of [[0.72, 0.5], [0.58, -0.35], [0.66, -1.1], [0.52, 0.95], [0.78, -0.2], [0.55, 0.25], [0.7, 1.4], [0.62, 2.6], [0.72, -2.4]]) {
      k.add(ball(8, 6), a % 2 ? '#ffffff' : c.accent, onChest(L, h, a, 0.004, [0.035, 0.035, 0.012]));
    }
    k.add(torus(0.125, 0.032, 6, 18), tint(c.body, 0.25), { p: [0, y(0.82), 0.01], r: [Math.PI / 2 - 0.12, 0, 0] });
    belt('#6b4428');
  }
  return buildPack(k, L, accs);
}

function buildArm(k, L, s) {
  const c = L.c;
  const cloth = L.cloth;
  k.add(sphere(0.082, 12, 10), c.body, null, cloth);
  if (L.longSleeves) {
    k.add(capsule(0.066, 0.17, 10), c.body, { p: [0, -0.125, 0] }, cloth);
    if (L.kind === 'player') k.add(torus(0.064, 0.02, 5, 12), L.cloth === 'metal' ? shade(c.body, 0.15) : c.accent, { p: [0, -0.215, 0], r: [Math.PI / 2, 0, 0] }, cloth);
  } else {
    k.add(cyl(0.08, 0.074, 0.15, 12), c.body, { p: [0, -0.06, 0] }, cloth);
    k.add(capsule(0.052, 0.13, 10), L.c.skin, { p: [0, -0.19, 0] });
  }
  k.add(sphere(0.074, 12, 10), L.hand, { p: [0, -ARM_LEN, 0.004] }, L.handFinish);
  if (L.villager && s === 1) {
    // a rolled-up order scroll in the left hand
    const f = k.frame({ p: [0.0, -ARM_LEN + 0.02, 0.06], r: [0.25, 0, 0] });
    f.add(cyl(0.036, 0.036, 0.28, 12), '#fbf3dc');
    for (const e of [-1, 1]) f.add(cyl(0.043, 0.043, 0.022, 12), '#d9c79a', { p: [0, e * 0.14, 0] });
    f.add(torus(0.039, 0.011, 4, 14), '#e63946', { p: [0, -0.02, 0], r: [Math.PI / 2, 0, 0] });
  }
}

function buildLeg(k, L) {
  const c = L.c;
  const fin = L.cloth;
  k.add(cyl(0.078, 0.07, 0.25, 12), c.pants, { p: [0, -0.13, 0] }, fin);
  k.add(cyl(0.084, 0.088, 0.06, 12), L.kind === 'player' ? tint(c.boots, 0.14) : c.boots, { p: [0, -0.265, 0] }, fin);
  k.add(ball(14, 10), c.boots, { p: [0, -0.33, 0.035], s: [0.095, 0.08, 0.13] }, fin);
  k.add(cyl(1, 1, 1, 14), shade(c.boots, 0.35), { p: [0, -0.392, 0.035], s: [0.094, 0.018, 0.125] });
}

function starGeo(ro, ri, depth) {
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    const r = i % 2 ? ri : ro;
    if (i) sh.lineTo(Math.sin(a) * r, Math.cos(a) * r);
    else sh.moveTo(Math.sin(a) * r, Math.cos(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

// The tricorn brim: a ring whose edges turn up between three corners.
function tricornBrim() {
  const g = new THREE.RingGeometry(0.36, 0.68, 36, 3).rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const r = Math.hypot(x, z);
    const c3 = Math.cos(3 * Math.atan2(x, z));
    const t = (r - 0.36) / 0.32;
    const rr = 0.36 + (r - 0.36) * (0.72 + 0.28 * c3);
    p.setXYZ(i, (x / r) * rr, t * t * 0.3 * (1 - c3) * 0.5 + t * 0.03, (z / r) * rr);
  }
  g.computeVertexNormals();
  return g;
}

function crownGeo() {
  const g = new THREE.CylinderGeometry(0.3, 0.28, 0.13, 20, 1, true);
  const p = g.attributes.position;
  for (let i = 0; i <= 20; i++) if (i % 2 === 0) p.setY(i, p.getY(i) + 0.1); // the top ring comes first
  g.computeVertexNormals();
  return g;
}

// Accessory kit: parts are given in the parent bone's coordinates; the mesh pivots at `pivot`.
function accKit(accs, parent, pivot, anim, side = 0) {
  const k = new Kit(new Map(), tmat({ p: [-pivot[0], -pivot[1], -pivot[2]] }));
  accs.push({ parent, pivot, anim, side, kit: k });
  return k;
}

function buildHair(k, hk, L) {
  const col = L.c.hair;
  const fin = L.hairFinish;
  if (L.hair === 'none') return;
  // a cap tilted back: covers the crown and the back of the head, leaves the forehead free
  hk.add(new THREE.SphereGeometry(HEAD_R * 1.05, 24, 14, 0, TAU, 0, 1.62), col, { r: [L.villager ? -0.95 : -0.45, 0, 0] }, fin);
  if (L.hair === 'plate' || L.hat === 'helmet' || L.villager) return;
  // fringe: a jagged shell over the forehead that joins the cap
  hk.add(fringeGeo(HEAD_R * 1.05), col, null, fin);
}

// A band of the head sphere across the forehead whose lower edge zigzags into pointed locks.
function fringeGeo(r) {
  const seg = 12;
  const g = new THREE.SphereGeometry(r, seg, 3, Math.PI / 2 - 1.2, 2.4, Math.PI / 2 - 0.95, 0.72);
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const bottom = 3 * (seg + 1);
  for (let ix = 0; ix <= seg; ix++) {
    const u = ix / seg;
    const phi = Math.PI / 2 - 1.2 + u * 2.4;
    const edge = Math.abs(u - 0.5) * 2; // 0 in the middle, 1 at the temples
    // tips on even vertices (longest in the middle), notches on odd ones
    const pitch = ix % 2 ? 0.44 + edge * 0.08 : 0.22 + edge * 0.16;
    const th = Math.PI / 2 - pitch;
    const x = -r * Math.cos(phi) * Math.sin(th);
    const y = r * Math.cos(th);
    const z = r * Math.sin(phi) * Math.sin(th);
    pos.setXYZ(bottom + ix, x, y, z);
    // the row above sits halfway between this edge and the row above it (pitch 0.71)
    const th2 = Math.PI / 2 - (pitch + 0.71) / 2;
    pos.setXYZ(bottom - seg - 1 + ix, -r * Math.cos(phi) * Math.sin(th2), r * Math.cos(th2), r * Math.sin(phi) * Math.sin(th2));
  }
  for (let i = 0; i < pos.count; i++) {
    _p.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    nor.setXYZ(i, _p.x, _p.y, _p.z);
  }
  return g;
}

function buildHat(k, hk, L, accs) {
  const c = L.c;
  const glow = L.glow;
  const headTop = [0, HEAD_C + HEAD_R * HS[1], 0];
  switch (L.hat) {
    case 'cap': {
      const f = hk.frame({ r: [-0.04, 0, 0] });
      f.add(new THREE.SphereGeometry(0.458, 24, 10, 0, TAU, 0, 1.2), c.body, null, L.cloth);
      f.add(new THREE.CylinderGeometry(0.32, 0.32, 0.034, 22, 1, false, -Math.PI / 2, Math.PI), c.accent, { p: [0, 0.17, 0.27], r: [0.16, 0, 0], s: [1.05, 1, 1.15] });
      f.add(ball(), c.accent, { p: [0, 0.455, 0], s: 0.042 });
      f.add(ball(), c.accent, { p: [0, 0.33, 0.33], r: [-0.8, 0, 0], s: [0.075, 0.075, 0.02] });
      f.add(ball(), '#ffffff', { p: [0, 0.335, 0.338], r: [-0.8, 0, 0], s: [0.035, 0.035, 0.015] });
      break;
    }
    case 'bandana': {
      const band = shade(c.body, 0.28);
      const f = hk.frame({ r: [-0.3, 0, 0] });
      f.add(new THREE.SphereGeometry(0.456, 24, 10, 0, TAU, 0, 1.3), band);
      f.add(ball(), shade(band, 0.1), { p: [0, 0.1, -0.44], s: [0.08, 0.07, 0.06] });
      for (const s of SIDES) f.add(capsule(0.034, 0.12, 6), band, { p: [s * 0.065, -0.02, -0.46], r: [0.35, 0, s * 0.55], s: [1.3, 1, 0.45] });
      for (const [yaw, pitch] of [[0.45, 0.42], [-0.4, 0.5], [0.05, 0.82], [-0.95, 0.3], [0.98, 0.52], [0, 0.45], [-0.55, 0.95], [0.6, 1.0], [1.6, 0.6], [-1.6, 0.62]]) {
        const d = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
        f.add(ball(8, 6), c.accent, { p: [d[0] * 0.458, d[1] * 0.458, d[2] * 0.458], r: [-pitch, yaw, 0], o: 'YXZ', s: [0.034, 0.034, 0.012] });
      }
      break;
    }
    case 'chef': {
      hk.add(cyl(0.31, 0.335, 0.17, 20), '#ffffff', { p: [0, 0.33, 0] });
      for (const [x, yy, z, r] of [[0, 0.6, 0, 0.21], [0.18, 0.52, 0.06, 0.17], [-0.18, 0.52, 0.06, 0.17], [0.09, 0.52, -0.16, 0.17], [-0.1, 0.52, -0.15, 0.17], [0, 0.5, 0.18, 0.16]]) {
        hk.add(sphere(r, 14, 10), '#fbfbf7', { p: [x, yy, z] });
      }
      break;
    }
    case 'pirate': {
      const hatCol = c.pants;
      hk.add(new THREE.SphereGeometry(0.452, 22, 9, 0, TAU, 0, 1.22), hatCol, { p: [0, 0.03, 0] });
      hk.add(torus(0.415, 0.022, 5, 30), c.accent, { p: [0, 0.18, 0], r: [Math.PI / 2, 0, 0] }, 'metal');
      const brim = tricornBrim();
      hk.add(brim, hatCol, { p: [0, 0.14, 0] });
      hk.add(flip(tricornBrim()), shade(hatCol, 0.2), { p: [0, 0.135, 0] });
      // skull badge
      hk.add(ball(10, 8), '#f4efe6', { p: [0, 0.3, 0.36], r: [-0.7, 0, 0], s: [0.07, 0.065, 0.03] });
      for (const s of SIDES) hk.add(ball(6, 5), '#141014', { p: [s * 0.022, 0.305, 0.388], r: [-0.7, 0, 0], s: 0.013 });
      // eye patch over the right eye and its strap
      k.add(ball(), '#141014', { ...surf(-EYE_YAW, EYE_PITCH, 0.03), s: [0.085, 0.1, 0.03] });
      hk.add(torus(0.45, 0.011, 4, 36), '#141014', { p: [0, 0.02, 0], r: [Math.PI / 2, 0, 0.42], o: 'ZYX' });
      break;
    }
    case 'headband': {
      hk.add(cyl(0.452, 0.452, 0.08, 28, true), c.accent, { p: [0, 0.2, 0], r: [0.1, 0, 0] });
      hk.add(rbox(0.17, 0.08, 0.03, 0.012, 2), '#c3cad6', { p: [0, 0.225, 0.448], r: [-0.3, 0, 0] }, 'metal');
      hk.add(ball(), c.accent, { p: [0, 0.18, -0.46], s: [0.065, 0.06, 0.05] });
      // the mask over the lower face
      hk.add(new THREE.SphereGeometry(0.447, 24, 8, Math.PI / 2 - 1.3, 2.6, Math.PI / 2 + 0.3, 0.95), c.body);
      const tails = accKit(accs, 'head', [0, HEAD_C + 0.17, -0.44], 'flutter');
      for (const s of SIDES) tails.add(capsule(0.03, 0.26, 6), c.accent, { p: [s * 0.05, HEAD_C + 0.1, -0.56], r: [1.1, s * 0.25, s * 0.2], s: [1.2, 1, 0.4] });
      break;
    }
    case 'helmet': {
      const m = c.body;
      hk.add(new THREE.SphereGeometry(0.472, 24, 10, 0, TAU, 0, 1.3), m, null, 'metal');
      hk.add(new THREE.SphereGeometry(0.472, 24, 5, Math.PI / 2 + 0.95, TAU - 1.9, 1.3, 0.62), m, null, 'metal');
      hk.add(torus(0.458, 0.03, 6, 32), shade(m, 0.12), { p: [0, 0.126, 0], r: [Math.PI / 2, 0, 0] }, 'metal');
      hk.add(rbox(0.055, 0.2, 0.035, 0.014, 2), m, { p: [0, 0.07, 0.458], r: [-0.12, 0, 0] }, 'metal');
      const plume = accKit(accs, 'head', headTop, 'sway');
      plume.add(sphere(0.05, 10, 8), '#ffd23d', { p: [0, headTop[1] + 0.03, 0] }, 'metal');
      plume.add(ball(), c.accent, { p: [0, headTop[1] + 0.13, -0.08], r: [-0.5, 0, 0], s: [0.055, 0.13, 0.19] });
      break;
    }
    case 'horns': {
      hk.add(new THREE.SphereGeometry(0.462, 24, 10, 0, TAU, 0, 1.28), '#aab2bf', null, 'metal');
      hk.add(torus(0.448, 0.036, 6, 32), c.body, { p: [0, 0.13, 0], r: [Math.PI / 2, 0, 0] });
      hk.add(rbox(0.07, 0.3, 0.05, 0.02, 2), c.body, { p: [0, 0.34, 0.24], r: [-0.62, 0, 0] });
      for (const s of SIDES) {
        const g = cone(0.078, 0.36, 12);
        g.translate(0, 0.18, 0);
        bend(g, -s * 1.05);
        hk.add(g, c.accent, { p: [s * 0.36, 0.2, 0.02], r: [0, 0, -s * 1.12] });
      }
      // braids and a chin-strap beard below the mouth
      k.add(ball(), c.hair, { ...surf(0, -0.74, -0.035), s: [0.3, 0.13, 0.075] });
      k.add(capsule(0.03, 0.06, 6), c.hair, { p: [0, HEAD_C - 0.44, 0.27], r: [0.35, 0, 0] });
      k.add(sphere(0.022, 8, 6), c.accent, { p: [0, HEAD_C - 0.5, 0.29] });
      for (const s of SIDES) {
        for (let i = 0; i < 3; i++) k.add(sphere(0.036 - i * 0.004, 8, 6), c.hair, { p: [s * 0.4, HEAD_C - 0.22 - i * 0.065, 0.1] });
        k.add(sphere(0.022, 8, 6), c.accent, { p: [s * 0.4, HEAD_C - 0.43, 0.1] });
      }
      break;
    }
    case 'garland': {
      const f = hk.frame({ p: [0, 0.22, 0], r: [-0.28, 0, 0] });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        f.add(new THREE.IcosahedronGeometry(0.068, 1), i % 2 ? c.accent : '#ff7a00', { p: [Math.sin(a) * 0.4, 0, Math.cos(a) * 0.4] });
        const b = a + TAU / 24;
        f.add(sphere(0.022, 8, 6), glow || '#fff3b0', { p: [Math.sin(b) * 0.41, 0.03, Math.cos(b) * 0.41] }, glow ? 'glow' : 'matte');
      }
      break;
    }
    case 'space': {
      const g = accKit(accs, 'head', [0, 0, 0], null);
      g.add(sphere(0.6, 28, 20), '#ffffff', { p: [0, HEAD_C + 0.02, 0] }, 'glass');
      const d = [Math.sin(-0.55) * Math.cos(0.6), Math.sin(0.6), Math.cos(-0.55) * Math.cos(0.6)];
      g.add(ball(10, 8), '#ffffff', { p: [d[0] * 0.6, HEAD_C + 0.02 + d[1] * 0.6, d[2] * 0.6], r: [-0.6, -0.55, 0.5], o: 'YXZ', s: [0.09, 0.035, 0.01] }, 'glow');
      g.add(ball(8, 6), '#ffffff', { p: [d[0] * 0.5, HEAD_C + 0.02 + d[1] * 0.42, d[2] * 0.66], r: [-0.4, -0.45, 0.5], o: 'YXZ', s: [0.03, 0.018, 0.008] }, 'glow');
      // side light
      hk.add(cyl(0.05, 0.05, 0.05, 10), c.accent, { p: [0.47, 0.05, 0], r: [0, 0, Math.PI / 2] });
      break;
    }
    case 'antenna': {
      for (const s of SIDES) {
        k.add(cyl(0.09, 0.09, 0.08, 16), c.body, { p: [s * 0.455, HEAD_C - 0.01, 0], r: [0, 0, Math.PI / 2] }, 'metal');
        k.add(torus(0.062, 0.014, 5, 16), glow || c.accent, { p: [s * 0.497, HEAD_C - 0.01, 0], r: [0, Math.PI / 2, 0] }, 'glow');
      }
      const ant = accKit(accs, 'head', headTop, 'sway');
      ant.add(cyl(0.015, 0.02, 0.24, 8), '#6f8298', { p: [0, headTop[1] + 0.1, 0] }, 'metal');
      ant.add(sphere(0.058, 12, 10), glow || c.accent, { p: [0, headTop[1] + 0.24, 0] }, 'glow');
      break;
    }
    case 'wizard': {
      const hatCol = c.body;
      hk.add(cyl(0.6, 0.6, 0.035, 30), shade(hatCol, 0.1), { p: [0, 0.2, 0] });
      hk.add(torus(0.415, 0.035, 6, 26), c.accent, { p: [0, 0.25, 0], r: [Math.PI / 2, 0, 0] });
      const pivot = [0, HEAD_C + 0.2 * HS[1], 0];
      const top = accKit(accs, 'head', pivot, 'sway');
      const f = top.frame({ p: [0, HEAD_C, 0], s: HS });
      const g = cone(0.43, 0.8, 22);
      g.translate(0, 0.4, 0);
      bend(g, -0.85, 'z');
      f.add(g, hatCol, { p: [0, 0.2, 0] });
      for (const [yy, a, sc] of [[0.36, 0.4, 1], [0.52, -0.5, 0.8], [0.27, -1.4, 0.75], [0.64, 0.9, 0.6]]) {
        const r = 0.43 * (1 - (yy - 0.2) / 0.8) + 0.012;
        f.add(starGeo(0.05 * sc, 0.022 * sc, 0.012), glow || c.accent, { p: [Math.sin(a) * r, yy, Math.cos(a) * r - (yy - 0.21) * 0.25], r: [0, a, 0] }, glow ? 'glow' : 'matte');
      }
      // long white beard and moustache
      k.add(ball(), c.hair, { ...surf(0, -0.62, -0.06), s: [0.26, 0.2, 0.16] });
      k.add(cone(0.2, 0.36, 14), c.hair, { p: [0, HEAD_C - 0.52, 0.26], r: [Math.PI + 0.3, 0, 0] });
      for (const s of SIDES) k.add(ball(), c.hair, { ...surf(s * 0.15, -0.27, 0.01, s * 0.5), s: [0.1, 0.045, 0.05] });
      break;
    }
    case 'crown': {
      const f = hk.frame({ p: [0, 0.35, 0], r: [0.06, 0, 0.12] });
      f.add(crownGeo(), '#ffc83d', null, 'metal');
      f.add(flip(crownGeo()), '#d99a1e', { s: [0.96, 1, 0.96] }, 'metal');
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        f.add(sphere(0.024, 8, 6), '#fff6e0', { p: [Math.sin(a) * 0.3, 0.165, Math.cos(a) * 0.3] }, 'glossy');
      }
      for (const [a, col] of [[0, '#ff3b5c'], [0.6, '#3d9bff'], [-0.6, '#3d9bff']]) {
        f.add(ball(10, 8), col, { p: [Math.sin(a) * 0.3, -0.01, Math.cos(a) * 0.3], r: [0, a, 0], s: [0.034, 0.04, 0.02] }, glow ? 'glow' : 'glossy');
      }
      break;
    }
    case 'halo': {
      const h = accKit(accs, 'head', [0, HEAD_C + 0.64, 0], 'halo');
      h.add(torus(0.22, 0.034, 8, 30), glow || '#ffe07a', { p: [0, HEAD_C + 0.64, 0], r: [Math.PI / 2, 0, 0] }, 'glow');
      break;
    }
    case 'straw': {
      const f = hk.frame({ r: [-0.16, 0, 0.06] });
      const straw = '#e9c46a';
      f.add(cyl(0.64, 0.66, 0.032, 32), straw, { p: [0, 0.22, 0] });
      f.add(torus(0.655, 0.02, 5, 32), shade(straw, 0.18), { p: [0, 0.22, 0], r: [Math.PI / 2, 0, 0] });
      f.add(new THREE.SphereGeometry(0.37, 22, 8, 0, TAU, 0, Math.PI / 2), straw, { p: [0, 0.22, 0], s: [1, 0.82, 1] });
      f.add(cyl(0.378, 0.386, 0.075, 24), '#e63946', { p: [0, 0.262, 0] });
      f.add(ball(), '#ffffff', { p: [0.25, 0.3, 0.25], r: [0, 0.8, 0], s: [0.06, 0.06, 0.03] });
      f.add(ball(), '#ffd166', { p: [0.268, 0.3, 0.268], r: [0, 0.8, 0], s: [0.025, 0.025, 0.02] });
      break;
    }
  }
}

function buildSpecies(k, hk, L, accs) {
  const c = L.c;
  const headTop = [0, HEAD_C + HEAD_R * HS[1], 0];
  switch (L.species) {
    case 'sprout':
    case 'mirror': {
      const mirror = L.species === 'mirror';
      const sp = accKit(accs, 'head', headTop, 'sway');
      sp.add(cyl(0.017, 0.022, 0.18, 8), mirror ? '#8a2233' : '#3a8f4a', { p: [0, headTop[1] + 0.06, 0], r: [0, 0, mirror ? 0.12 : -0.12] });
      const leaf = mirror ? '#ff9aae' : '#58bf5f';
      const tip = [mirror ? -0.02 : 0.02, headTop[1] + 0.15, 0];
      const leaves = mirror ? [-1] : [1, -1];
      for (const s of leaves) sp.add(ball(), leaf, { p: [tip[0] + s * 0.1, tip[1] + 0.03, 0], r: [0.2, 0, s * 0.45], s: [0.13, 0.03, 0.07] });
      break;
    }
    case 'beak': {
      const g = cone(0.075, 0.19, 12).rotateX(Math.PI / 2);
      k.add(g, '#ffb13d', { ...surf(0, -0.2, 0.06), s: [1.15, 0.75, 1] });
      k.add(cone(0.05, 0.1, 10).rotateX(Math.PI / 2), '#e08a1e', { ...surf(0, -0.3, 0.02), s: [1.1, 0.6, 1] });
      const tuft = accKit(accs, 'head', headTop, 'sway');
      for (const [x, h, a] of [[-0.06, 0.2, 0.3], [0, 0.26, 0.45], [0.06, 0.2, 0.3]]) {
        tuft.add(ball(), c.body, { p: [x, headTop[1] + h * 0.5, 0.05], r: [a, 0, x * 3], s: [0.04, h * 0.6, 0.06] });
      }
      const tail = accKit(accs, 'torso', [0, 0.05, -0.2], 'tail');
      for (const a of [-0.45, 0, 0.45]) tail.add(ball(), shade(c.body, 0.15), { p: [a * 0.18, 0.12, -0.3], r: [-0.9, 0, -a], s: [0.05, 0.16, 0.025] });
      break;
    }
    case 'ears': {
      for (const s of SIDES) {
        k.add(cone(0.135, 0.3, 10), c.body, { p: [s * 0.25, HEAD_C + 0.37, -0.03], r: [-0.12, 0, -s * 0.36], s: [1, 1, 0.62] });
        k.add(cone(0.085, 0.2, 8), '#fff3e6', { p: [s * 0.237, HEAD_C + 0.35, 0.02], r: [-0.12, 0, -s * 0.36], s: [1, 1, 0.4] });
      }
      k.add(ball(), '#fff3e6', { ...surf(0, -0.3, -0.03), s: [0.2, 0.14, 0.14] });
      for (const s of SIDES) k.add(ball(), '#fff3e6', { ...surf(s * 0.7, -0.3, -0.03, -s * 0.3), s: [0.12, 0.085, 0.07] });
      k.add(ball(), '#2a1f24', { ...surf(0, -0.18, 0.1), s: [0.05, 0.036, 0.036] }, 'glossy');
      const tail = accKit(accs, 'torso', [0, -0.02, -0.2], 'tail');
      tail.add(ball(), c.body, { p: [0, 0.02, -0.33], r: [-1.1, 0, 0], s: [0.1, 0.19, 0.1] });
      tail.add(ball(), c.body, { p: [0, 0.13, -0.56], r: [-0.8, 0, 0], s: [0.15, 0.2, 0.15] });
      tail.add(ball(), '#fff3e6', { p: [0, 0.3, -0.7], r: [-0.4, 0, 0], s: [0.12, 0.13, 0.11] });
      break;
    }
    case 'crest': {
      const crest = accKit(accs, 'head', headTop, 'sway');
      for (const [x, h, a] of [[-0.1, 0.24, -0.25], [0, 0.32, -0.4], [0.1, 0.24, -0.25]]) {
        const g = cone(0.065, h, 8);
        g.translate(0, h / 2, 0);
        crest.add(g, '#33284f', { p: [x, headTop[1] - 0.05, -0.02], r: [a, 0, -x * 1.5], s: [1, 1, 0.6] });
      }
      k.add(cone(0.06, 0.16, 10).rotateX(Math.PI / 2), '#4a4460', { ...surf(0, -0.22, 0.05), s: [1.1, 0.72, 1] }, 'glossy');
      break;
    }
  }
}

function buildFace(k, hk, L) {
  if (L.ears) for (const s of SIDES) k.add(ball(), L.c.skin, { ...surf(s * 1.46, -0.12, -0.03), s: [0.07, 0.09, 0.07] });
  if (L.visor) {
    hk.add(new THREE.SphereGeometry(HEAD_R + 0.012, 22, 12, Math.PI / 2 - 0.88, 1.76, Math.PI / 2 - 0.4, 0.86), L.visor.color, null, L.visor.finish);
  }
  if (L.cheeks) for (const s of SIDES) k.add(ball(), mix(L.head, '#ff4f79', 0.42), { ...surf(s * 0.6, -0.27, -0.008), s: [0.07, 0.042, 0.02] });
  if (L.brows === 'angry') {
    for (const s of SIDES) k.add(capsule(0.017, 0.07, 6), L.browColor, { ...surf(s * 0.31, 0.24, 0.006, Math.PI / 2 - s * 0.38), s: [1, 1, 0.6] });
  } else if (L.brows === 'bushy') {
    for (const s of SIDES) k.add(ball(), L.browColor, { ...surf(s * 0.31, 0.25, 0.01, -s * 0.2), s: [0.09, 0.04, 0.04] });
  }
  if (L.villager) {
    k.add(ball(), shade(L.c.skin, 0.1), { ...surf(0, -0.16, 0.02), s: [0.06, 0.05, 0.05] });
    for (const s of SIDES) k.add(ball(), L.c.hair, { ...surf(s * 0.14, -0.26, 0.018, s * 0.35), s: [0.11, 0.05, 0.05] });
  }
}

function buildEyes(L, mode) {
  const eyeY = surf(0, EYE_PITCH).p[1];
  const k = new Kit().frame({ p: [0, -eyeY, 0] });
  const lift = L.visor ? 0.02 : 0;
  const glow = L.eyes === 'glow';
  const col = glow ? L.eyeGlow : L.eyeColor;
  const fin = glow ? 'glow' : 'eye';
  for (const s of SIDES) {
    const yaw = s * EYE_YAW;
    if (mode === 'happy') {
      k.add(torus(0.055, 0.017, 5, 12, Math.PI), col, surf(yaw, EYE_PITCH - 0.04, 0.012 + lift), fin);
    } else if (glow) {
      k.add(rbox(0.1, 0.13, 0.03, 0.045, 3), col, surf(yaw, EYE_PITCH, lift - 0.004), fin);
    } else {
      k.add(ball(14, 10), col, { ...surf(yaw, EYE_PITCH, lift - 0.008), s: [0.068, 0.092, 0.034] }, fin);
      k.add(ball(8, 6), L.highlight, { ...surf(yaw + 0.05, EYE_PITCH + 0.075, lift + 0.019), s: [0.024, 0.027, 0.01] }, 'glow');
      k.add(ball(6, 5), L.highlight, { ...surf(yaw - 0.045, EYE_PITCH - 0.075, lift + 0.017), s: 0.011 }, 'glow');
    }
  }
  return k.build();
}

function buildMouth(L, mode, pivot, at) {
  const k = new Kit().frame({ p: [-pivot[0], -pivot[1], -pivot[2]] });
  const glow = L.eyes === 'glow';
  const col = glow ? L.eyeGlow : '#6b2230';
  const fin = glow ? 'glow' : 'matte';
  const lift = at.lift + (L.visor ? 0.02 : 0);
  switch (mode) {
    case 'open':
      k.add(ball(12, 8), col, { ...surf(at.yaw, at.pitch - 0.02, lift - 0.006), s: [0.058, 0.05, 0.022] }, fin);
      if (!glow) k.add(ball(10, 6), '#ff7a8a', { ...surf(at.yaw, at.pitch - 0.055, lift + 0.006), s: [0.034, 0.02, 0.012] });
      break;
    case 'frown':
      k.add(torus(0.036, 0.012, 5, 10, Math.PI), col, surf(at.yaw, at.pitch - 0.06, lift + 0.004), fin);
      break;
    case 'o':
      k.add(ball(10, 8), col, { ...surf(at.yaw, at.pitch - 0.02, lift), s: [0.024, 0.03, 0.014] }, fin);
      break;
    case 'flat':
      k.add(capsule(0.011, 0.05, 5), col, { ...surf(at.yaw, at.pitch, lift + 0.004, Math.PI / 2) }, fin);
      break;
    default: // smile
      k.add(torus(0.046, 0.012, 5, 12, Math.PI), col, surf(at.yaw, at.pitch + 0.035, lift + 0.004, Math.PI), fin);
  }
  return k.build();
}

function buildPack(k, L, accs) {
  const c = L.c;
  const gold = '#ffd23d';
  switch (L.pack) {
    case 'satchel': {
      const bag = c.pack || tint(c.boots, 0.12);
      const flap = c.accent;
      k.add(rbox(0.3, 0.27, 0.14, 0.05, 3), bag, { p: [0, 0.2, -0.29], r: [0.08, 0, 0] });
      k.add(rbox(0.312, 0.13, 0.152, 0.045, 3), flap, { p: [0, 0.3, -0.293], r: [0.08, 0, 0] });
      k.add(rbox(0.06, 0.05, 0.02, 0.01, 2), gold, { p: [0, 0.25, -0.372], r: [0.08, 0, 0] }, 'metal');
      k.add(torus(0.268, 0.02, 5, 34), shade(bag, 0.15), { p: [0, 0.2, 0], r: [Math.PI / 2, 0, 0.62], o: 'ZYX', s: [L.torsoScale, L.torsoScale, 1] });
      return { base: [0, 0.34, -0.3], float: false };
    }
    case 'basket': {
      const wick = '#c98d4c';
      const dark = '#8e5b2c';
      const f = k.frame({ p: [0, 0.21, -0.33], r: [-0.1, 0, 0] });
      f.add(cyl(0.19, 0.15, 0.3, 16, true), wick);
      f.add(flip(cyl(0.18, 0.142, 0.3, 16, true)), dark);
      f.add(cyl(0.15, 0.15, 0.02, 16), dark, { p: [0, -0.15, 0] });
      f.add(cyl(0.178, 0.178, 0.02, 16), shade(wick, 0.5), { p: [0, 0.1, 0] });
      for (const [yy, r] of [[0.15, 0.19], [0.03, 0.172], [-0.09, 0.158]]) f.add(torus(r, 0.016, 5, 22), yy === 0.15 ? dark : shade(wick, 0.14), { p: [0, yy, 0], r: [Math.PI / 2, 0, 0] });
      for (const s of SIDES) k.add(torus(0.16, 0.017, 5, 16, Math.PI), dark, { p: [s * 0.12, 0.28, -0.1], r: [0, Math.PI / 2, 0], s: [1.3, 0.95, 1] });
      return { base: [0, 0.32, -0.34], float: false };
    }
    case 'jetpack': {
      const tank = c.body;
      const fin = L.cloth === 'matte' ? 'glossy' : L.cloth;
      k.add(rbox(0.27, 0.27, 0.06, 0.025, 2), shade(tank, 0.12), { p: [0, 0.22, -0.235] }, fin);
      for (const s of SIDES) {
        k.add(capsule(0.072, 0.2, 12), tank, { p: [s * 0.088, 0.22, -0.3] }, fin);
        k.add(torus(0.074, 0.014, 5, 16), L.glow || c.accent, { p: [s * 0.088, 0.26, -0.3], r: [Math.PI / 2, 0, 0] }, L.glow ? 'glow' : 'matte');
        k.add(cone(0.058, 0.09, 12), '#4a5260', { p: [s * 0.088, 0.055, -0.3] }, 'metal');
      }
      const flame = accKit(accs, 'torso', [0, 0.01, -0.3], 'flame');
      for (const s of SIDES) {
        flame.add(cone(0.046, 0.18, 10).rotateX(Math.PI), L.glow || '#ffb347', { p: [s * 0.088, -0.08, -0.3] }, 'glow');
        flame.add(cone(0.024, 0.1, 8).rotateX(Math.PI), '#ffffff', { p: [s * 0.088, -0.04, -0.3] }, 'glow');
      }
      return { base: [0, 0.39, -0.3], float: false };
    }
    case 'cape': {
      const outer = capeColor(L);
      const lining = c.capeLining || shade(outer, 0.35);
      const trim = luma(c.accent) > 0.62 && !c.cape ? c.accent : null;
      const len = 0.52;
      const cape = accKit(accs, 'torso', [0, 0.42, -0.02], 'cape');
      const cy = 0.42 - len / 2 + 0.02;
      cape.add(new THREE.CylinderGeometry(0.2, 0.33, len, 18, 3, true, Math.PI - 1.35, 2.7), outer, { p: [0, cy, -0.02] });
      cape.add(flip(new THREE.CylinderGeometry(0.188, 0.318, len, 18, 3, true, Math.PI - 1.35, 2.7)), lining, { p: [0, cy, -0.02] });
      if (trim) {
        cape.add(new THREE.CylinderGeometry(0.335, 0.337, 0.04, 18, 1, true, Math.PI - 1.35, 2.7), trim, { p: [0, cy - len / 2 + 0.02, -0.02] });
        cape.add(flip(new THREE.CylinderGeometry(0.315, 0.317, 0.04, 18, 1, true, Math.PI - 1.35, 2.7)), trim, { p: [0, cy - len / 2 + 0.02, -0.02] });
      }
      for (const s of SIDES) k.add(sphere(0.035, 10, 8), trim || gold, { p: [s * 0.1, 0.4, 0.12] }, 'metal');
      return { base: [0, 0.5, -0.36], float: true };
    }
    case 'wings': {
      const feather = c.accent;
      const edge = L.glow || tint(feather, 0.3);
      for (const s of SIDES) {
        const w = accKit(accs, 'torso', [s * 0.06, 0.3, -0.22], 'wing', s);
        for (const [x, yy, rz, sx, sy] of [[0.2, 0.38, 0.4, 0.26, 0.085], [0.18, 0.28, 0.05, 0.22, 0.075], [0.14, 0.19, -0.3, 0.17, 0.065]]) {
          const t = { p: [s * x, yy, -0.3 - x * 0.35], r: [0, s * 0.45, s * rz], s: [sx, sy, 0.028] };
          w.add(ball(14, 8), feather, t, L.cloth === 'metal' ? 'glossy' : 'matte');
          w.add(ball(14, 8), edge, { ...t, p: [t.p[0] + s * 0.012, t.p[1] + 0.006, t.p[2] - 0.012], s: [sx * 1.06, sy * 1.2, 0.02] }, L.glow ? 'glow' : 'matte');
        }
      }
      return { base: [0, 0.52, -0.36], float: true };
    }
    default:
      return { base: [0, 0.5, -0.34], float: true };
  }
}

// Build (or fetch) every geometry of a look.
const BUILT = new Map();
function built(L) {
  let B = BUILT.get(L.key);
  if (B) return B;
  const accs = [];
  const torso = new Kit();
  const carry = buildTorso(torso, L, accs);
  const head = new Kit();
  const hk = head.frame({ p: [0, HEAD_C, 0], s: HS });
  hk.add(sphere(HEAD_R, 26, 18), L.head, null, L.headFinish);
  buildFace(head, hk, L);
  buildHair(head, hk, L);
  buildHat(head, hk, L, accs);
  buildSpecies(head, hk, L, accs);
  const arms = SIDES.map((s) => {
    const a = new Kit();
    buildArm(a, L, s);
    return a.build();
  });
  const leg = new Kit();
  buildLeg(leg, L);
  const legG = leg.build();
  const at = L.mouthAt || { yaw: 0, pitch: MOUTH_PITCH, lift: 0 };
  const mouthPivot = surf(at.yaw, at.pitch, at.lift + (L.visor ? 0.02 : 0)).p;
  const mouth = {};
  for (const m of ['smile', 'open', 'frown', 'o', 'flat']) mouth[m] = buildMouth(L, m, mouthPivot, at);
  const top = headTopOf(L);
  B = {
    torso: torso.build(),
    head: head.build(),
    arms,
    legs: [legG, legG],
    eyes: { open: buildEyes(L, 'open'), happy: buildEyes(L, 'happy') },
    eyeY: surf(0, EYE_PITCH).p[1],
    mouth,
    mouthPivot,
    acc: accs.map((a) => ({ parent: a.parent, pivot: a.pivot, anim: a.anim, side: a.side, build: a.kit.build() })),
    carry: carry || { base: [0, 0.5, -0.34], float: true },
    top,
    shoulderX: SHOULDER_X * Math.sqrt(L.torsoScale),
  };
  BUILT.set(L.key, B);
  return B;
}

// Approximate top of the character (metres above the feet) for labels and portrait framing.
function headTopOf(L) {
  const base = NECK + HEAD_C + HEAD_R * HS[1];
  const extra = { chef: 0.36, wizard: 0.62, crown: 0.14, halo: 0.3, antenna: 0.3, helmet: 0.18, horns: 0.12, space: 0.2, straw: 0.08 }[L.hat] || 0.03;
  const sp = { sprout: 0.2, mirror: 0.2, beak: 0.16, crest: 0.26, ears: 0.14 }[L.species] || 0;
  return base + Math.max(extra, sp);
}

// ------------------------------------------------------------------------------------------------
// Resource items (for backpacks, and reusable by any module: shared geometry and materials)

const ITEMS = new Map();

export function resourceItemMesh(type) {
  let e = ITEMS.get(type);
  if (!e) {
    const b = buildItem(type);
    e = { geometry: b.geometry, mats: materialsFor(b.finishes) };
    ITEMS.set(type, e);
  }
  const m = new THREE.Mesh(e.geometry, e.mats);
  m.name = 'res-' + type;
  m.castShadow = true;
  return m;
}

function buildItem(type) {
  const k = new Kit();
  const r = RES[type] || { color: '#9aa3b2', light: '#c9d0db' };
  switch (type) {
    case 'wood':
      k.add(cyl(0.07, 0.076, 0.27, 12), r.color, { p: [0, 0.076, 0], r: [0, 0, Math.PI / 2] });
      for (const s of SIDES) {
        k.add(cyl(0.06, 0.06, 0.012, 12), '#e9c38d', { p: [s * 0.136, 0.076, 0], r: [0, 0, Math.PI / 2] });
        k.add(torus(0.032, 0.006, 4, 12), '#c49258', { p: [s * 0.143, 0.076, 0], r: [0, Math.PI / 2, 0] });
      }
      k.add(cyl(0.018, 0.024, 0.08, 6), r.color, { p: [0.03, 0.155, 0], r: [0, 0, -0.55] });
      k.add(ball(8, 6), r.light, { p: [0.07, 0.19, 0], r: [0, 0, -0.5], s: [0.045, 0.018, 0.03] });
      break;
    case 'stone':
      k.add(rock(0.11, 0.35, 1), r.color, { p: [0, 0.085, 0], s: [1.1, 0.8, 1] });
      k.add(rock(0.06, 0.4, 2), r.light, { p: [0.1, 0.045, 0.05] });
      break;
    case 'ore':
      k.add(rock(0.11, 0.35, 3), r.color, { p: [0, 0.085, 0], s: [1.05, 0.85, 1] });
      for (const [x, yy, z, s] of [[0.05, 0.15, 0.05, 0.04], [-0.07, 0.11, 0.06, 0.032], [0.02, 0.07, 0.1, 0.03], [-0.03, 0.16, -0.05, 0.028]]) {
        k.add(new THREE.OctahedronGeometry(s, 0), r.light, { p: [x, yy, z], r: [0.4, x * 10, 0.3] }, 'glow');
      }
      break;
    case 'sand':
      k.add(sphere(0.1, 14, 10), r.color, { p: [0, 0.09, 0], s: [1, 0.88, 1] });
      k.add(cyl(0.035, 0.055, 0.06, 10), r.color, { p: [0, 0.185, 0] });
      k.add(torus(0.04, 0.012, 5, 12), '#a8742e', { p: [0, 0.19, 0], r: [Math.PI / 2, 0, 0] });
      k.add(cone(0.05, 0.05, 10).rotateX(Math.PI), shade(r.color, 0.08), { p: [0, 0.235, 0] });
      k.add(ball(8, 6), r.light, { p: [-0.04, 0.12, 0.08], s: [0.03, 0.02, 0.012] });
      break;
    case 'fiber':
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU;
        const tilt = 0.18;
        k.add(cyl(0.011, 0.014, 0.27, 5), i % 2 ? r.color : shade(r.color, 0.12), { p: [Math.sin(a) * 0.025, 0.135, Math.cos(a) * 0.025], r: [Math.cos(a) * tilt, 0, -Math.sin(a) * tilt] });
        k.add(ball(6, 4), r.light, { p: [Math.sin(a) * 0.05, 0.275, Math.cos(a) * 0.05], s: [0.02, 0.035, 0.02] });
      }
      k.add(cyl(0.04, 0.04, 0.04, 10), '#d8b777', { p: [0, 0.12, 0] });
      break;
    case 'crystal':
      for (const [x, z, h, rx, rz] of [[0, 0, 0.3, 0, 0], [0.06, 0.02, 0.2, 0.2, -0.45], [-0.055, 0.01, 0.18, -0.1, 0.5]]) {
        const g = new THREE.OctahedronGeometry(0.06, 0);
        k.add(g, x ? r.light : r.color, { p: [x, h * 0.42, z], r: [rx, 0.4, rz], s: [1, h / 0.12, 1] }, 'crystal');
      }
      break;
    default:
      k.add(rbox(0.16, 0.16, 0.16, 0.03, 2), r.color, { p: [0, 0.08, 0] });
  }
  return k.build();
}

let TOOL = null;
// Small crafting mallet held during gather; the handle continues the arm (-Y), the head is at its end.
function toolMesh() {
  if (!TOOL) {
    const k = new Kit();
    k.add(cyl(0.02, 0.022, 0.36, 8), '#8a5a34', { p: [0, -0.1, 0] });
    k.add(cyl(0.028, 0.028, 0.07, 8), '#c8323c', { p: [0, 0.02, 0] });
    k.add(rbox(0.22, 0.095, 0.09, 0.025, 2), '#aeb6c2', { p: [0.02, -0.28, 0] }, 'metal');
    k.add(rbox(0.03, 0.1, 0.095, 0.01, 1), '#7d8794', { p: [0.13, -0.28, 0] }, 'metal');
    TOOL = k.build();
  }
  const m = new THREE.Mesh(TOOL.geometry, materialsFor(TOOL.finishes));
  m.name = 'tool';
  m.castShadow = true;
  return m;
}

// ------------------------------------------------------------------------------------------------
// Character: rig + procedural animation

const POSE_KEYS = ['y', 'ty', 'lean', 'twist', 'roll', 'hx', 'hy', 'hz', 'alx', 'alz', 'arx', 'arz', 'llx', 'lrx', 'lly', 'lry', 'sq', 'br'];
const NK = POSE_KEYS.length;
function newPose() {
  const p = {};
  for (let i = 0; i < NK; i++) p[POSE_KEYS[i]] = 0;
  p.sq = 1;
  return p;
}
function copyPose(dst, src) {
  for (let i = 0; i < NK; i++) dst[POSE_KEYS[i]] = src[POSE_KEYS[i]];
}
function blendPose(dst, src, w) {
  for (let i = 0; i < NK; i++) {
    const k = POSE_KEYS[i];
    dst[k] += (src[k] - dst[k]) * w;
  }
}

// Carried item slots around the pack's carry point: x, y, z, tilt (z), turn (y).
const SLOT_PATTERN = [
  [-0.1, 0, 0, 0.3, 0.3],
  [0.1, 0, 0.01, -0.3, -0.5],
  [0, 0.04, -0.05, 0.06, 1.2],
  [-0.055, 0.15, -0.02, -0.22, 2.1],
  [0.06, 0.16, -0.03, 0.36, -1.4],
  [0, 0.27, -0.03, 0, 0.7],
];

let SERIAL = 0;

export class Character {
  constructor(kind, look) {
    this.kind = kind;
    this.group = new THREE.Group();
    this.group.name = 'character-' + kind;
    this.root = new THREE.Group();
    this.group.add(this.root);
    this.shadow = blobShadow();
    this.group.add(this.shadow);
    this.pose = newPose();
    this._tmp = newPose();
    const n = SERIAL++;
    this.t = (n * 1.37) % 7;
    this.phase = 0;
    this.heading = 0;
    this._hInit = false;
    this.turn = 0;
    this.w = { run: 0, gather: 0, deposit: 0, wait: 0, think: 0, emote: 0 };
    this.timers = { gather: 0, deposit: 0, wait: 0, think: 0 };
    this.state = 'idle';
    this.emote = null;
    this.emoteShown = null;
    this.emoteT = 0;
    this.res = null;
    this.blinkT = 0;
    this.blinkNext = 1.2 + ((n * 0.73) % 2.5);
    this.eyeMode = 'open';
    this.mouthMode = 'smile';
    this.disposed = false;
    this._build(look);
  }

  // Height of the top of the head (with hat) above the feet, in metres.
  get top() {
    return this.B.top;
  }

  // World position just above the head (for HUD labels and speech bubbles).
  anchor(out = new THREE.Vector3()) {
    this.group.updateWorldMatrix(true, false);
    return out.set(0, this.B.top + 0.15 + Math.max(0, this.pose.y), 0).applyMatrix4(this.group.matrixWorld);
  }

  _build(look) {
    this.look = look;
    const B = (this.B = built(look));
    const mesh = (entry, parent, name, shadow = true) => {
      if (!entry) return null;
      const m = new THREE.Mesh(entry.geometry, materialsFor(entry.finishes));
      m.name = name;
      m.castShadow = shadow && !entry.finishes.includes('glass');
      parent.add(m);
      return m;
    };
    const rig = (this.rig = new THREE.Group());
    this.root.add(rig);
    const torso = (this.torso = new THREE.Group());
    torso.position.y = HIP;
    rig.add(torso);
    mesh(B.torso, torso, 'torso');
    const head = (this.head = new THREE.Group());
    head.position.y = NECK - HIP;
    torso.add(head);
    mesh(B.head, head, 'head');
    this.eyes = mesh(B.eyes.open, head, 'eyes', false);
    this.eyes.position.y = B.eyeY;
    this.mouth = mesh(B.mouth.smile, head, 'mouth', false);
    this.mouth.position.fromArray(B.mouthPivot);
    this.eyeMode = 'open';
    this.mouthMode = 'smile';
    this.arms = SIDES.map((s, i) => {
      const a = new THREE.Group();
      a.position.set(s * B.shoulderX, SHOULDER_Y - HIP, 0);
      torso.add(a);
      mesh(B.arms[i], a, i ? 'armR' : 'armL');
      return a;
    });
    this.legs = SIDES.map((s, i) => {
      const l = new THREE.Group();
      l.position.set(s * LEG_X, HIP, 0);
      rig.add(l);
      mesh(B.legs[i], l, i ? 'legR' : 'legL');
      return l;
    });
    const parents = { torso, head, root: rig };
    this.acc = B.acc.map((a) => {
      const g = new THREE.Group();
      g.position.fromArray(a.pivot);
      (parents[a.parent] || torso).add(g);
      mesh(a.build, g, 'acc-' + (a.anim || 'static'), a.anim !== 'flame');
      return { obj: g, anim: a.anim, side: a.side, y: a.pivot[1] };
    });
    this.tool = toolMesh();
    this.tool.position.set(0, -ARM_LEN, 0.01);
    this.tool.visible = false;
    this.arms[1].add(this.tool);
    this.carryRoot = new THREE.Group();
    this.carryRoot.position.fromArray(B.carry.base);
    torso.add(this.carryRoot);
    this.slots = [];
    this.carryShown = [];
    this.shadow.scale.setScalar(SHADOW_SIZE);
  }

  _clearRig() {
    if (this.rig) this.root.remove(this.rig);
    this.rig = null;
    this.acc = [];
    this.slots = [];
  }

  // Swap the look in place (player skins). Keeps the animation state and the carried items.
  setSkin(skin) {
    if (this.disposed) return;
    const look = this.kind === 'rival' ? rivalLook(rivalOf(skin)) : playerLook(skinOf(skin));
    if (look.key === this.look.key) return;
    const carry = this.carryShown.slice();
    this._clearRig();
    this._build(look);
    this._carry(carry, 1);
    this._apply(this.pose);
  }

  update(dt, o = {}) {
    if (this.disposed || !this.rig) return;
    dt = dt > 0 ? Math.min(dt, 0.1) : 0;
    this.t += dt;
    const g = this.group;
    if (Number.isFinite(o.x) && Number.isFinite(o.z)) {
      g.position.x = o.x;
      g.position.z = o.z;
    }
    if (Number.isFinite(o.y)) g.position.y = o.y;

    // heading: smooth turn along the shortest arc
    let rate = 0;
    if (Number.isFinite(o.heading)) {
      if (!this._hInit) {
        this.heading = wrapAngle(o.heading);
        this._hInit = true;
      }
      const step = wrapAngle(o.heading - this.heading) * damp(12, dt);
      this.heading = wrapAngle(this.heading + step);
      if (dt > 0) rate = step / dt;
    }
    g.rotation.y = this.heading;
    this.turn += (rate - this.turn) * damp(8, dt);

    const state = STATES.has(o.state) ? o.state : 'idle';
    const moving = clamp(Number.isFinite(o.moving) ? o.moving : state === 'walk' ? 1 : 0, 0, 1);
    if (state !== this.state) {
      if (this.timers[state] !== undefined) this.timers[state] = 0;
      this.state = state;
    }
    if (o.res !== undefined) this.res = o.res;
    const emote = EMOTES.has(o.emote) ? o.emote : null;
    if (emote !== this.emote) {
      if (emote) {
        this.emoteShown = emote;
        this.emoteT = 0;
      }
      this.emote = emote;
    }
    this.emoteT += dt;

    // layer weights fade in and out so every transition is smooth
    const w = this.w;
    const tm = this.timers;
    const k = damp(11, dt);
    w.run += (moving - w.run) * damp(12, dt);
    w.gather += ((state === 'gather' ? 1 : 0) - w.gather) * k;
    w.deposit += ((state === 'deposit' ? 1 : 0) - w.deposit) * damp(16, dt);
    w.wait += ((state === 'wait' ? 1 : 0) - w.wait) * damp(6, dt);
    w.think += ((state === 'think' ? 1 : 0) - w.think) * damp(7, dt);
    w.emote += ((emote ? 1 : 0) - w.emote) * damp(emote ? 14 : 7, dt);
    tm.gather += dt;
    tm.deposit += dt;
    tm.wait += dt;
    tm.think += dt;
    this.phase = (this.phase + dt * TAU * (1.5 + 3.2 * moving)) % (TAU * 64);

    const p = this.pose;
    const q = this._tmp;
    this._idle(p);
    if (w.run > 0.002) this._layer(p, q, w.run, this._run);
    if (w.gather > 0.002) this._layer(p, q, w.gather, this._gather);
    if (w.deposit > 0.002) this._layer(p, q, w.deposit, this._deposit);
    if (w.wait > 0.002) this._layer(p, q, w.wait, this._wait);
    if (w.think > 0.002) this._layer(p, q, w.think, this._think);
    if (w.emote > 0.002 && this.emoteShown) this._layer(p, q, w.emote, this._emotePose);
    p.roll += clamp(-this.turn * 0.045, -0.28, 0.28) * w.run;

    this._apply(p);
    this.tool.visible = w.gather > 0.08 && !SCOOP_RES.has(this.res);
    if (this.tool.visible) this.tool.scale.setScalar(Math.min(1, w.gather * 1.3));
    this._face(dt, state, emote);
    this._animateAccessories(w.run);
    this._carry(o.carry, dt);
    const air = Math.max(0, p.y);
    this.shadow.scale.setScalar(SHADOW_SIZE * (1 - Math.min(air, 0.5) * 0.9));
  }

  _layer(p, q, w, fn) {
    copyPose(q, p);
    fn.call(this, q);
    blendPose(p, q, w);
  }

  _idle(p) {
    const t = this.t;
    for (let i = 0; i < NK; i++) p[POSE_KEYS[i]] = 0;
    const br = Math.sin(t * 2.1);
    const vil = this.kind === 'villager' ? 1.8 : 1;
    p.sq = 1;
    p.br = br * 0.014;
    p.ty = br * 0.004;
    p.hx = Math.sin(t * 0.7) * 0.03 - br * 0.01;
    p.hy = (Math.sin(t * 0.43) * 0.12 + Math.sin(t * 1.13) * 0.03) * vil;
    p.hz = Math.sin(t * 0.61 + 1) * 0.045;
    p.alx = br * 0.03;
    p.arx = -br * 0.03;
    p.alz = 0.1 + br * 0.018;
    p.arz = 0.1 + br * 0.018;
    p.roll = Math.sin(t * 0.52) * 0.012 * vil;
  }

  _run(q) {
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    q.llx = -s * 0.85;
    q.lrx = s * 0.85;
    q.lly = Math.max(0, c) * 0.07;
    q.lry = Math.max(0, -c) * 0.07;
    q.alx = s * 0.95;
    q.arx = -s * 0.95;
    q.alz = 0.2;
    q.arz = 0.2;
    q.y = Math.abs(c) * 0.065;
    q.ty = 0;
    q.lean = 0.2;
    q.twist = s * 0.13;
    q.roll = 0;
    q.hx = -0.13;
    q.hy = -s * 0.09;
    q.hz = 0;
    q.sq = 1 + (Math.abs(c) - 0.5) * 0.05;
  }

  _gather(q) {
    const cyc = (this.timers.gather / GATHER_TIME) % 1;
    q.alz = -0.12;
    q.arz = -0.12;
    q.llx = -0.2;
    q.lrx = 0.18;
    q.lly = 0;
    q.lry = 0;
    if (SCOOP_RES.has(this.res)) {
      // scoop: dip down to the ground, swing the arms up and forward
      const up = cyc < 0.45 ? easeInOut(cyc / 0.45) : 1 - easeInOut((cyc - 0.45) / 0.55);
      q.alx = q.arx = -0.35 - (1 - up) * 0.25 - up * 1.35;
      q.lean = 0.5 - up * 0.38;
      q.ty = -0.05 * (1 - up);
      q.hx = 0.1 - up * 0.2;
      return;
    }
    // chop: a two-handed sideways swing. Wind up to the right (0 -> 0.3), swing through to the left
    // (0.3 -> 0.5, the hit), then ease back. The arms follow the torso twist, so the tool sweeps an arc
    // that reads from any camera angle (an overhead chop would hide the hands inside the big head).
    let a;
    if (cyc < 0.3) a = 0.3 * (1 - easeInOut(cyc / 0.3));
    else if (cyc < 0.5) a = ((cyc - 0.3) / 0.2) ** 2;
    else a = 1 - 0.7 * easeInOut((cyc - 0.5) / 0.5);
    const hit = cyc >= 0.46 && cyc < 0.62 ? 1 - Math.abs(cyc - 0.5) / 0.12 : 0;
    q.twist = -0.85 + a * 1.25;
    q.alx = q.arx = -1.3;
    q.alz = q.arz = -0.3;
    q.lean = 0.12 + Math.max(0, hit) * 0.12;
    q.hx = -0.04;
    q.hy = -q.twist * 0.7;
    q.roll = 0;
    q.sq = 1 - Math.max(0, hit) * 0.05;
    q.ty = -0.02 - Math.max(0, hit) * 0.02;
  }

  _deposit(q) {
    const cyc = (this.timers.deposit / 0.3) % 1;
    const push = Math.sin(cyc * Math.PI);
    q.alx = q.arx = -0.95 - push * 0.45;
    q.alz = q.arz = -0.05;
    q.lean = 0.14 + push * 0.18;
    q.hx = 0.18;
    q.ty = -push * 0.03;
    q.llx = -0.08;
    q.lrx = 0.08;
  }

  _wait(q) {
    const t = this.timers.wait;
    const tap = Math.max(0, Math.sin(t * 9));
    q.lrx = -0.22 - tap * 0.14;
    q.lry = tap * 0.035;
    q.llx = 0.05;
    q.alx = -1.3;
    q.arx = -1.12;
    q.alz = -0.55;
    q.arz = -0.6;
    q.hz = 0.1 + Math.sin(t * 1.3) * 0.04;
    q.hy = Math.sin(t * 0.9) * 0.35;
    q.roll = 0.035;
  }

  _think(q) {
    const t = this.timers.think;
    q.arx = -2.05;
    q.arz = -0.45;
    q.alx = -1.02;
    q.alz = -0.52;
    q.hx = -0.14;
    q.hz = 0.14 + Math.sin(t * 1.2) * 0.05;
    q.hy = 0.16 + Math.sin(t * 0.8) * 0.1;
    q.roll = 0.03;
    q.twist = -0.08;
  }

  _emotePose(q) {
    const t = this.emoteT;
    switch (this.emoteShown) {
      case 'hop': {
        const ph = (t / 0.52) % 1;
        const h = Math.sin(ph * Math.PI);
        q.y = h * 0.38;
        q.sq = ph < 0.08 || ph > 0.92 ? 0.9 : 1 + h * 0.06;
        q.alz = q.arz = 0.45 + h * 0.95;
        q.alx = q.arx = -0.2;
        q.llx = -0.4 * h;
        q.lrx = 0.25 * h;
        q.hx = -0.15;
        break;
      }
      case 'cheer': {
        // arms in a wide V (straight up would hide the hands behind the big head)
        q.y = Math.abs(Math.sin(t * 7)) * 0.12;
        q.alz = 2.15 + Math.sin(t * 14) * 0.22;
        q.arz = 2.15 + Math.sin(t * 14 + 1.2) * 0.22;
        q.alx = q.arx = -0.45;
        q.hx = -0.22;
        q.lean = -0.06;
        q.llx = q.lrx = 0;
        break;
      }
      case 'sad': {
        q.hx = 0.42;
        q.hy = Math.sin(t * 0.8) * 0.12;
        q.hz = 0.06;
        q.lean = 0.14;
        q.ty = -0.035;
        q.alz = q.arz = -0.06;
        q.alx = q.arx = -0.14;
        q.sq = 0.97;
        q.twist = 0;
        break;
      }
      case 'wave': {
        q.arz = 2.05 + Math.sin(t * 11) * 0.4;
        q.arx = -0.4;
        q.hz = -0.12;
        q.hy = -0.1;
        q.y = Math.abs(Math.sin(t * 5.5)) * 0.025;
        break;
      }
    }
  }

  _apply(p) {
    this.root.position.y = p.y;
    const sq = p.sq > 0.5 ? p.sq : 0.5;
    const xz = 1 / Math.sqrt(sq);
    this.root.scale.set(xz, sq, xz);
    this.torso.position.y = HIP + p.ty;
    this.torso.rotation.set(p.lean, p.twist, p.roll);
    this.torso.scale.set(1 + p.br * 0.6, 1 + p.br, 1 + p.br * 0.6);
    this.head.rotation.set(p.hx, p.hy, p.hz);
    this.arms[0].rotation.set(p.alx, 0, p.alz);
    this.arms[1].rotation.set(p.arx, 0, -p.arz);
    this.legs[0].rotation.x = p.llx;
    this.legs[0].position.y = HIP + p.lly;
    this.legs[1].rotation.x = p.lrx;
    this.legs[1].position.y = HIP + p.lry;
  }

  _face(dt, state, emote) {
    // blink every few seconds, sometimes twice
    this.blinkT += dt;
    let sy = 1;
    if (this.blinkT > this.blinkNext) {
      const b = (this.blinkT - this.blinkNext) / 0.14;
      if (b >= 1) {
        this.blinkT = 0;
        this.blinkNext = Math.random() < 0.18 ? 0.12 : 1.8 + Math.random() * 3.2;
      } else sy = 1 - Math.sin(b * Math.PI) * 0.92;
    }
    const eye = emote === 'cheer' ? 'happy' : 'open';
    const mouth = emote === 'cheer' || emote === 'hop' || emote === 'wave' ? 'open' : emote === 'sad' ? 'frown' : state === 'think' ? 'o' : state === 'gather' || state === 'wait' ? 'flat' : 'smile';
    if (eye !== this.eyeMode) {
      const e = this.B.eyes[eye];
      this.eyes.geometry = e.geometry;
      this.eyes.material = materialsFor(e.finishes);
      this.eyeMode = eye;
    }
    if (mouth !== this.mouthMode) {
      const m = this.B.mouth[mouth];
      this.mouth.geometry = m.geometry;
      this.mouth.material = materialsFor(m.finishes);
      this.mouthMode = mouth;
    }
    this.eyes.scale.y = eye === 'happy' ? 1 : sy;
  }

  _animateAccessories(m) {
    const t = this.t;
    const ph = this.phase;
    const turn = clamp(this.turn * 0.03, -0.3, 0.3);
    for (let i = 0; i < this.acc.length; i++) {
      const a = this.acc[i];
      const o = a.obj;
      switch (a.anim) {
        case 'sway':
          o.rotation.x = -0.26 * m + Math.sin(ph * 2) * 0.1 * m + Math.sin(t * 2.2) * 0.05 - this.pose.y * 0.4;
          o.rotation.z = Math.sin(t * 1.7) * 0.06 + turn;
          break;
        case 'flutter':
          o.rotation.x = -0.2 - 0.85 * m + Math.sin(t * 13) * (0.04 + 0.1 * m);
          o.rotation.y = Math.sin(t * 7) * 0.15 * (0.3 + m);
          break;
        case 'cape':
          o.rotation.x = 0.08 + 0.75 * m + Math.sin(t * 10) * 0.05 * m + Math.sin(t * 1.4) * 0.03 + this.pose.y * 0.5;
          o.rotation.z = Math.sin(t * 6) * 0.04 * m;
          break;
        case 'tail':
          o.rotation.y = Math.sin(t * 2.6) * 0.35 * (1 - m) + Math.sin(ph) * 0.3 * m;
          o.rotation.x = -0.55 * m + Math.sin(t * 1.9) * 0.06;
          break;
        case 'wing': {
          const f = Math.sin(t * (2.2 + 8 * m));
          o.rotation.y = a.side * (0.08 + f * (0.2 + 0.25 * m));
          o.rotation.z = a.side * f * 0.08;
          break;
        }
        case 'flame': {
          const f = 0.5 + 0.65 * m + Math.sin(t * 43) * 0.1 + Math.sin(t * 27) * 0.07;
          const wd = 0.85 + Math.sin(t * 31) * 0.08;
          o.scale.set(wd, f, wd);
          break;
        }
        case 'halo':
          o.position.y = a.y + Math.sin(t * 2.1) * 0.025;
          o.rotation.x = Math.sin(t * 1.3) * 0.08;
          o.rotation.z = Math.cos(t * 1.1) * 0.08;
          break;
      }
    }
  }

  _carry(list, dt) {
    if (list !== undefined) {
      const n = list ? Math.min(list.length, SLOT_MAX) : 0;
      for (let i = 0; i < SLOT_MAX; i++) {
        const want = i < n ? list[i] || null : null;
        if ((this.carryShown[i] || null) !== want) this._setSlot(i, want);
      }
    }
    const float = this.B.carry.float;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s || !s.item) continue;
      if (s.age < 0.35) {
        s.age += dt;
        s.obj.scale.setScalar(Math.max(0.001, easeOutBack(Math.min(1, s.age / 0.3))) * CARRY_SCALE);
      }
      if (float) s.obj.position.y = s.y + Math.sin(this.t * 2.6 + i * 1.3) * 0.02;
    }
  }

  _setSlot(i, type) {
    let s = this.slots[i];
    if (!s) {
      const [x, y, z, rz, ry] = SLOT_PATTERN[i];
      s = this.slots[i] = { obj: new THREE.Group(), item: null, age: 1, y };
      s.obj.position.set(x, y, z);
      s.obj.rotation.set(-0.22, ry, rz);
      this.carryRoot.add(s.obj);
    }
    if (s.item) {
      s.obj.remove(s.item);
      s.item = null;
    }
    this.carryShown[i] = type;
    if (type) {
      s.item = resourceItemMesh(type);
      s.obj.add(s.item);
      s.age = 0;
      s.obj.scale.setScalar(0.001);
    }
  }

  // Geometries and materials are shared caches; nothing per instance needs freeing on the GPU.
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this._clearRig();
    this.root.clear();
    this.group.clear();
  }
}

export function createPlayer(skin) {
  return new Character('player', playerLook(skinOf(skin)));
}

export function createRival(rivalDef) {
  return new Character('rival', rivalLook(rivalOf(rivalDef)));
}

export function createVillager() {
  return new Character('villager', villagerLook());
}

// ------------------------------------------------------------------------------------------------
// Studio lighting shared by portraits and the preview

function studioLights(scene) {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x9a8fa8, 1.25);
  const key = new THREE.DirectionalLight(0xfff1dc, 2.5);
  key.position.set(2.2, 3.4, 4);
  const rim = new THREE.DirectionalLight(0xd6e8ff, 1.7);
  rim.position.set(-3, 2.6, -3.2);
  const fill = new THREE.DirectionalLight(0xffffff, 0.55);
  fill.position.set(-3.5, 1.2, 2.5);
  scene.add(hemi, key, rim, fill);
  return { key };
}

// ------------------------------------------------------------------------------------------------
// Portraits: head-and-shoulders PNG data URLs, rendered offscreen by one shared small renderer

let PR = null;
const PORTRAITS = new Map();

export function portraitURL(kind, def, size = 128) {
  size = clamp(Math.round(size) || 128, 16, 512);
  const look = lookFor(kind, def);
  const key = look.key + '@' + size;
  const hit = PORTRAITS.get(key);
  if (hit) return hit;
  let url;
  try {
    url = renderPortrait(kind, look, size);
  } catch (err) {
    console.warn('portraitURL: WebGL portrait failed, using a flat fallback', err);
    url = fallbackPortrait(look, size);
  }
  PORTRAITS.set(key, url);
  return url;
}

function portraitRig() {
  if (PR) return PR;
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  studioLights(scene);
  const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 30);
  canvas.addEventListener('webglcontextlost', () => {
    PR = null;
  });
  PR = { renderer, scene, camera };
  return PR;
}

function renderPortrait(kind, look, size) {
  const { renderer, scene, camera } = portraitRig();
  renderer.setSize(size, size, false);
  const ch = new Character(kind, look);
  ch.t = 0;
  ch.blinkNext = 1e9;
  ch.shadow.visible = false;
  const facing = kind === 'rival' ? -0.42 : kind === 'villager' ? 0.25 : 0.42;
  ch.update(0, { x: 0, z: 0, heading: facing, moving: 0, state: 'idle' });
  ch.head.rotation.set(-0.06, -facing * 0.35, kind === 'rival' ? -0.07 : 0.07);
  scene.add(ch.group);
  // frame the head and shoulders with the hat (very tall hats run off the top a little)
  const bottom = 0.68;
  const top = Math.max(bottom + 1.18, Math.min(ch.top + 0.05, 2.05));
  const h = top - bottom;
  const cy = (top + bottom) / 2;
  const fov = (camera.fov * Math.PI) / 180;
  const dist = (h * 0.5) / Math.tan(fov / 2);
  camera.position.set(0, cy + dist * 0.1, dist);
  camera.lookAt(0, cy, 0);
  camera.aspect = 1;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(ch.group);
  ch.dispose();
  return url;
}

function fallbackPortrait(look, size) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const r = size / 2;
  g.fillStyle = '#' + toColor(look.head || '#f2c29b').getHexString();
  g.beginPath();
  g.arc(r, r * 1.05, r * 0.72, 0, TAU);
  g.fill();
  g.fillStyle = '#241f33';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(r + s * r * 0.26, r * 1.02, r * 0.08, r * 0.11, 0, 0, TAU);
    g.fill();
  }
  return cv.toDataURL('image/png');
}

// ------------------------------------------------------------------------------------------------
// Preview: a small turntable for the shop / locker (own renderer on the given canvas)

export class Preview {
  constructor(canvas, { pedestal = '#ffffff', trim = '#ffd23d' } = {}) {
    this.canvas = canvas;
    const renderer = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    const { key } = studioLights(this.scene);
    key.castShadow = true;
    key.shadow.mapSize.set(512, 512);
    const sc = key.shadow.camera;
    sc.left = sc.bottom = -1.6;
    sc.right = sc.top = 1.6;
    sc.near = 0.5;
    sc.far = 12;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 40);
    this.table = new THREE.Group();
    this.scene.add(this.table);

    // pedestal: soft disc with a gold rim
    this._own = [];
    const own = (x) => (this._own.push(x), x);
    const stone = own(new THREE.MeshStandardMaterial({ color: pedestal, roughness: 0.55 }));
    const rimMat = own(new THREE.MeshStandardMaterial({ color: trim, roughness: 0.3, metalness: 0.8, envMap: envMap() }));
    const base = new THREE.Mesh(own(new THREE.CylinderGeometry(0.8, 0.88, 0.22, 48)), stone);
    base.position.y = -0.11;
    base.receiveShadow = true;
    const rim = new THREE.Mesh(own(new THREE.TorusGeometry(0.8, 0.03, 8, 64)), rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.005;
    this.table.add(base, rim);

    this.character = null;
    this.angle = 0.45;
    this.vel = 0.55;
    this._hop = 0;
    this._w = 0;
    this._h = 0;
    this._drag = null;
    this._onDown = (e) => {
      this._drag = { x: e.clientX, t: performance.now() };
      canvas.setPointerCapture?.(e.pointerId);
    };
    this._onMove = (e) => {
      if (!this._drag) return;
      const now = performance.now();
      const dx = e.clientX - this._drag.x;
      this.angle += dx * 0.012;
      this.vel = (dx * 0.012) / Math.max(0.016, (now - this._drag.t) / 1000);
      this._drag.x = e.clientX;
      this._drag.t = now;
    };
    this._onUp = () => {
      this._drag = null;
    };
    canvas.style.touchAction = 'pan-y';
    canvas.addEventListener('pointerdown', this._onDown);
    canvas.addEventListener('pointermove', this._onMove);
    canvas.addEventListener('pointerup', this._onUp);
    canvas.addEventListener('pointercancel', this._onUp);
  }

  // Shows a character on the turntable. The preview takes ownership: the previously shown
  // character is disposed when replaced, and the current one when the preview is disposed.
  show(character) {
    if (character === this.character) return;
    if (this.character) this.character.dispose();
    this.character = character || null;
    if (!character) return;
    character.group.removeFromParent();
    this.table.add(character.group);
    character.update(0, { x: 0, z: 0, heading: 0, moving: 0, state: 'idle' });
    this._hop = 0.55;
  }

  _resize() {
    const w = this.canvas.clientWidth || this.canvas.width || 1;
    const h = this.canvas.clientHeight || this.canvas.height || 1;
    if (w === this._w && h === this._h) return;
    this._w = w;
    this._h = h;
    this.renderer.setSize(w, h, false);
    const cam = this.camera;
    cam.aspect = w / h;
    // fit a 1.9 m x 2.5 m box (character, hat and pedestal)
    const fov = (cam.fov * Math.PI) / 180;
    const dist = Math.max(1.25 / Math.tan(fov / 2), 0.95 / (Math.tan(fov / 2) * cam.aspect)) + 0.6;
    cam.position.set(0, 1.25 + dist * 0.12, dist);
    cam.lookAt(0, 0.88, 0);
    cam.updateProjectionMatrix();
  }

  update(dt) {
    if (!this.renderer) return;
    dt = dt > 0 ? Math.min(dt, 0.1) : 0;
    this._resize();
    if (!this._drag) {
      this.vel += (0.55 - this.vel) * damp(1.8, dt);
      this.angle += this.vel * dt;
    }
    this.table.rotation.y = this.angle;
    if (this.character) {
      this._hop -= dt;
      this.character.update(dt, { x: 0, z: 0, heading: 0, moving: 0, state: 'idle', emote: this._hop > 0 ? 'hop' : null });
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (!this.renderer) return;
    const c = this.canvas;
    c.removeEventListener('pointerdown', this._onDown);
    c.removeEventListener('pointermove', this._onMove);
    c.removeEventListener('pointerup', this._onUp);
    c.removeEventListener('pointercancel', this._onUp);
    if (this.character) this.character.dispose();
    this.character = null;
    for (const x of this._own) x.dispose();
    this._own = [];
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer = null;
  }
}
