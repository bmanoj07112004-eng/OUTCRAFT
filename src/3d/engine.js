// The one WebGL engine every 3D module shares: renderer, scene and camera, the gradient sky dome, fog,
// hemisphere + sun lights (the sun's shadow camera is fitted to the island), quality levels with an
// automatic fps fallback, resize, and helpers to project 3D points to CSS pixels and to raycast taps.

import * as THREE from 'three';

const LEVELS = ['low', 'medium', 'high'];
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
  constructor(canvas, { quality = 'auto' } = {}) {
    this.canvas = canvas;
    this.quality = LEVELS.includes(quality) ? quality : 'auto';
    this.level = this.quality === 'auto' ? deviceDefault() : this.quality;
    this.width = 1;
    this.height = 1;
    this.fps = 60;

    // Antialiasing is a context attribute, so it is decided once here from the starting level.
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.level !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

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
    this._corners = Array.from({ length: 8 }, () => new THREE.Vector3());

    this.applyLevel();
    this.fitShadow();
    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
  }

  // 'low' | 'medium' | 'high' | 'auto'. Auto starts at the device default and may step down later.
  setQuality(q) {
    this.quality = LEVELS.includes(q) ? q : 'auto';
    this.level = this.quality === 'auto' ? deviceDefault() : this.quality;
    this.applyLevel();
  }

  applyLevel() {
    const r = this.renderer;
    const lvl = this.level;
    const dpr = window.devicePixelRatio || 1;
    r.setPixelRatio(lvl === 'low' ? 1 : Math.min(dpr, lvl === 'medium' ? 1.5 : 2));
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
    // Shadow settings are baked into shader programs: make every material recompile once.
    if (changed) {
      this.scene.traverse((o) => {
        if (!o.material) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
      });
    }
    this._grace = 2;
    this._slow = 0;
    this.resize();
  }

  // Colours of THEMES[i]: sky gradient, fog, hemisphere and sun.
  setTheme(theme) {
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
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    const now = performance.now();
    const dt = this._last ? (now - this._last) / 1000 : 0;
    this._last = now;
    // Ignore hitches from hidden tabs; smooth over roughly half a second.
    if (dt > 0 && dt < 0.5) {
      this.fps += (1 / dt - this.fps) * (1 - Math.exp(-dt / 0.5));
      this.autoTick(dt);
    }
    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  // Auto quality: drop one level when the frame rate stays under 40 fps for 3 seconds.
  autoTick(dt) {
    if (this.quality !== 'auto' || this.level === 'low') return;
    if (this._grace > 0) {
      this._grace -= dt;
      return;
    }
    this._slow = this.fps < 40 ? this._slow + dt : 0;
    if (this._slow > 3) {
      this.level = LEVELS[LEVELS.indexOf(this.level) - 1];
      this.applyLevel();
    }
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
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    if (this.sun.shadow.map) this.sun.shadow.map.dispose();
    this.renderer.dispose();
  }
}
