// The one WebGL engine every 3D module shares: renderer, scene and camera, the gradient sky dome, fog,
// hemisphere + sun lights (the sun's shadow camera is fitted to the island), quality levels with an
// automatic fps fallback (it only switches at a break and remembers where it settled), WebGL context
// loss / restore, shader warm-up, resize, and helpers to project 3D points to CSS pixels and to raycast.

import * as THREE from 'three';

const LEVELS = ['low', 'medium', 'high'];
// Auto quality: a frame rate under SLOW_FPS that is also well under the best rate this device has shown
// (so a 30 fps display cap is not "slow"), or under FLOOR_FPS whatever the best, for SLOW_SECS steps down.
const SLOW_FPS = 40;
const SLOW_REL = 0.75;
const FLOOR_FPS = 26;
const SLOW_SECS = 3;
const SETTLE_SECS = 20; // measured seconds at a level without a step down = settled
const WARM_MAX_MS = 2500; // longest a background shader compile may hold back rendering
// Default shadow box: the 9x13 tile island (18 x 26 m) plus its beach, from the sea up to the treetops.
const ISLAND_BOX = new THREE.Box3(new THREE.Vector3(-11, -1, -15), new THREE.Vector3(11, 4.5, 15));

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always on the far plane
}`;

// Top colour overhead, theme "bottom" colour just above the horizon, fog colour at and below it (so the
// sea fades seamlessly into the sky), plus a soft glow around the sun.
const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uFog;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uBottom, uTop, pow(smoothstep(0.02, 0.75, h), 0.8));
  col = mix(uFog, col, smoothstep(-0.02, 0.16, h));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(s, 12.0) * 0.22 + pow(s, 200.0) * 0.6) * smoothstep(-0.05, 0.1, h);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

function deviceDefault() {
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return coarse ? 'medium' : 'high';
}

export class Engine {
  // quality: 'low' | 'medium' | 'high' | 'auto'; autoLevel: the level auto quality settled on last time
  // (saved by the game from onAutoLevel), so auto starts there instead of re-learning it.
  constructor(canvas, { quality = 'auto', autoLevel = null } = {}) {
    this.canvas = canvas;
    this.quality = LEVELS.includes(quality) ? quality : 'auto';
    this.autoLevel = LEVELS.includes(autoLevel) ? autoLevel : null;
    this.level = this.quality === 'auto' ? this.autoLevel || deviceDefault() : this.quality;
    this.width = 1;
    this.height = 1;
    this.fps = 60;
    this.theme = null;
    this.contextLost = false;

    // Set by the game. Auto quality only switches levels while allowQualityChange is true (the game turns
    // it off during a race: a switch recompiles every shader, a visible freeze); a step decided meanwhile
    // waits for the next break. onAutoLevel(level) fires when auto quality settles on a level.
    this.allowQualityChange = true;
    this.onAutoLevel = null;
    this.onContextLost = null;
    this.onContextRestored = null;

    // Antialiasing is a context attribute, so it is decided once here from the starting level.
    this.antialias = this.level !== 'low';
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.antialias,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    // three resets renderer.info after the shadow pass; reset it ourselves so the stats include shadows.
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.3, 700);
    this.camera.position.set(0, 20, 26);
    this.camera.lookAt(0, 0, 0);

    this.skyUniforms = {
      uTop: { value: new THREE.Color('#5fb8ff') },
      uBottom: { value: new THREE.Color('#dff3ff') },
      uFog: { value: new THREE.Color('#cdeaff') },
      uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      uSunColor: { value: new THREE.Color('#fff1d0') },
    };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(500, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.skyUniforms,
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    this.scene.fog = new THREE.Fog('#cdeaff', 45, 120);
    this.hemi = new THREE.HemisphereLight('#ffffff', '#6b8f58', 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff1d0', 2.4);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.sunDir = new THREE.Vector3(0.55, 1, 0.35).normalize();
    this.shadowBox = ISLAND_BOX.clone();

    this._ndc = new THREE.Vector2();
    this._v = new THREE.Vector3();
    this._ray = new THREE.Raycaster();
    this._last = 0;
    this._slow = 0;
    this._grace = 2;
    this._pending = null; // auto level waiting for a break
    this._best = 0; // best sustained frame rate seen this session (rAF rate, rendering or not)
    this._rateDt = 0.1;
    this._fpsDt = 1 / 60;
    this._measured = 0; // seconds measured at the current level without stepping down
    this._settled = null; // last level reported through onAutoLevel
    this._warmUntil = 0; // rendering is held back until a background shader compile finishes
    this._corners = Array.from({ length: 8 }, () => new THREE.Vector3());

    this.applyLevel();
    this.fitShadow();
    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    // three.js also listens (and rebuilds its own GL state on restore); these tell the game and re-apply
    // the engine's settings.
    this._onLost = (e) => {
      e.preventDefault(); // allows the browser to restore the context
      if (this.contextLost) return;
      this.contextLost = true;
      if (this.onContextLost) this.onContextLost();
    };
    this._onRestored = () => {
      this.contextLost = false;
      this._last = 0;
      this._grace = 2;
      if (this.theme) this.setTheme(this.theme);
      this.applyLevel();
      if (this.onContextRestored) this.onContextRestored();
    };
    canvas.addEventListener('webglcontextlost', this._onLost);
    canvas.addEventListener('webglcontextrestored', this._onRestored);
    // The display's own frame rate, measured on every animation frame (menus that skip rendering show
    // what the screen can do), so auto quality can tell a capped display from a slow GPU.
    this._probeT = 0;
    this._probe = (t) => {
      const dt = this._probeT ? (t - this._probeT) / 1000 : 0;
      this._probeT = t;
      if (dt > 0 && dt < 0.25) {
        this._rateDt += (dt - this._rateDt) * (1 - Math.exp(-dt / 0.6));
        if (1 / this._rateDt > this._best) this._best = 1 / this._rateDt;
      }
      this._probeId = requestAnimationFrame(this._probe);
    };
    this._probeId = requestAnimationFrame(this._probe);
  }

  // 'low' | 'medium' | 'high' | 'auto'. Auto starts where it settled before (or the device default) and
  // may step down later, between matches.
  setQuality(q) {
    this.quality = LEVELS.includes(q) ? q : 'auto';
    this.level = this.quality === 'auto' ? this.autoLevel || deviceDefault() : this.quality;
    this._pending = null;
    this._settled = null;
    this.applyLevel();
  }

  // True when the current level wants a different antialiasing than the context was created with (a
  // context attribute): the level then applies fully after a restart.
  get needsRestart() {
    return this.antialias !== (this.level !== 'low');
  }

  // Compiles the shaders of everything in the scene now (in the background where the browser supports
  // parallel compiling), so the first frames of a match do not stall. Resolves when done.
  warmup() {
    const r = this.renderer;
    if (this.contextLost) return Promise.resolve();
    this.camera.updateMatrixWorld();
    try {
      if (r.extensions.has('KHR_parallel_shader_compile')) return r.compileAsync(this.scene, this.camera).then(() => {}, () => {});
      r.compile(this.scene, this.camera);
    } catch (err) {
      console.warn(err);
    }
    return Promise.resolve();
  }

  applyLevel() {
    const r = this.renderer;
    const lvl = this.level;
    const shadows = lvl !== 'low';
    const size = lvl === 'high' ? 2048 : 1024;
    const type = lvl === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    const changed = r.shadowMap.enabled !== shadows || r.shadowMap.type !== type || this.sun.shadow.mapSize.x !== size;
    r.shadowMap.enabled = shadows;
    r.shadowMap.type = type;
    this.sun.castShadow = shadows;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
    // Shadow settings are baked into shader programs: make every material recompile once. Where the
    // browser compiles in the background, rendering waits for it (the last frame stays on screen) instead
    // of stalling the page on the first draw.
    if (changed) {
      this.scene.traverse((o) => {
        if (!o.material) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
      });
      if (this._rendered && !this.contextLost && r.extensions.has('KHR_parallel_shader_compile')) {
        const until = (this._warmUntil = performance.now() + WARM_MAX_MS);
        this.warmup().then(() => {
          if (this._warmUntil === until) this._warmUntil = 0;
        });
      }
    }
    this._grace = 2;
    this._slow = 0;
    this._measured = 0;
    this.resize();
  }

  // Colours of THEMES[i]: sky gradient, fog, hemisphere and sun.
  setTheme(theme) {
    this.theme = theme;
    const u = this.skyUniforms;
    u.uTop.value.set(theme.sky.top);
    u.uBottom.value.set(theme.sky.bottom);
    u.uFog.value.set(theme.fog.color);
    u.uSunColor.value.set(theme.sun.color);
    this.scene.fog.color.set(theme.fog.color);
    this.scene.fog.near = theme.fog.near;
    this.scene.fog.far = theme.fog.far;
    this.renderer.setClearColor(theme.fog.color);
    this.hemi.color.set(theme.hemi.sky);
    this.hemi.groundColor.set(theme.hemi.ground);
    this.hemi.intensity = theme.hemi.intensity;
    this.sun.color.set(theme.sun.color);
    this.sun.intensity = theme.sun.intensity;
    const [x, y, z] = theme.sun.dir;
    this.sunDir.set(x, y, z).normalize();
    u.uSunDir.value.copy(this.sunDir);
    this.fitShadow();
  }

  // Point the sun at the box centre and fit its orthographic shadow camera tightly around the box.
  fitShadow(box = this.shadowBox) {
    if (box !== this.shadowBox) this.shadowBox.copy(box);
    const b = this.shadowBox;
    const c = b.getCenter(this._v);
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(this.sunDir, 40);
    this.sun.updateMatrixWorld();
    this.sun.target.updateMatrixWorld();
    const cam = this.sun.shadow.camera;
    cam.position.copy(this.sun.position);
    cam.lookAt(this.sun.target.position);
    cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < 8; i++) {
      const p = this._corners[i].set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(inv);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    cam.left = minX - 0.5;
    cam.right = maxX + 0.5;
    cam.bottom = minY - 0.5;
    cam.top = maxY + 0.5;
    cam.near = Math.max(0.1, -maxZ - 2);
    cam.far = -minZ + 2;
    cam.updateProjectionMatrix();
  }

  // Match the canvas to the window (CSS pixels); the drawing buffer follows the pixel ratio.
  resize() {
    const w = Math.max(1, window.innerWidth || this.canvas.clientWidth || 1);
    const h = Math.max(1, window.innerHeight || this.canvas.clientHeight || 1);
    this.width = w;
    this.height = h;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(this.level === 'low' ? 1 : Math.min(dpr, this.level === 'medium' ? 1.5 : 2));
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    const now = performance.now();
    const dt = this._last ? (now - this._last) / 1000 : 0;
    this._last = now;
    // Ignore hitches from hidden tabs; smooth the frame time over roughly half a second.
    if (dt > 0 && dt < 0.5) {
      this._fpsDt += (dt - this._fpsDt) * (1 - Math.exp(-dt / 0.5));
      this.fps = 1 / this._fpsDt;
      this.autoTick(dt);
    }
    if (this._pending && this.allowQualityChange) this._applyAuto(this._pending);
    if (this.contextLost) return;
    if (this._warmUntil) {
      if (now < this._warmUntil) return;
      this._warmUntil = 0;
    }
    this._rendered = true;
    this.sky.position.copy(this.camera.position);
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
  }

  // Auto quality: step down when the frame rate stays low for SLOW_SECS (straight to 'low' when it is
  // very low). The step waits for a break when allowQualityChange is off. A level that ran SETTLE_SECS
  // without being too slow counts as settled.
  autoTick(dt) {
    if (this.quality !== 'auto' || this._pending) return;
    if (this._grace > 0) {
      this._grace -= dt;
      return;
    }
    const slow = this.fps < SLOW_FPS && (this.fps < SLOW_REL * this._best || this.fps < FLOOR_FPS);
    this._slow = slow && this.level !== 'low' ? this._slow + dt : 0;
    if (this._slow > SLOW_SECS) {
      const i = LEVELS.indexOf(this.level);
      const next = LEVELS[Math.max(0, i - (this.fps < SLOW_FPS * 0.5 ? 2 : 1))];
      this._slow = 0;
      if (this.allowQualityChange) this._applyAuto(next);
      else this._pending = next;
      return;
    }
    this._measured += dt;
    if (this._measured > SETTLE_SECS && this._settled !== this.level) this._settle();
  }

  _applyAuto(level) {
    this._pending = null;
    if (this.quality !== 'auto' || level === this.level) return;
    this.level = level;
    this.applyLevel();
    this._settle();
  }

  _settle() {
    this._settled = this.level;
    this.autoLevel = this.level;
    if (this.onAutoLevel) this.onAutoLevel(this.level);
  }

  // CSS-pixel position of a world point, for HTML labels. `visible` is false behind the camera or off screen.
  worldToScreen(v3, out = { x: 0, y: 0, visible: false }) {
    this.camera.updateMatrixWorld();
    const p = this._v.copy(v3).project(this.camera);
    out.x = ((p.x + 1) / 2) * this.width;
    out.y = ((1 - p.y) / 2) * this.height;
    out.visible = p.z > -1 && p.z < 1 && Math.abs(p.x) <= 1.05 && Math.abs(p.y) <= 1.05;
    return out;
  }

  raycast(clientX, clientY, objects, recursive = true) {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return [];
    this._ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.camera.updateMatrixWorld();
    this._ray.setFromCamera(this._ndc, this.camera);
    return this._ray.intersectObjects(objects, recursive);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    this.canvas.removeEventListener('webglcontextlost', this._onLost);
    this.canvas.removeEventListener('webglcontextrestored', this._onRestored);
    cancelAnimationFrame(this._probeId);
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    if (this.sun.shadow.map) this.sun.shadow.map.dispose();
    this.renderer.dispose();
  }
}
