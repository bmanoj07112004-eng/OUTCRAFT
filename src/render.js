// Canvas renderer for OUTCRAFT: a small diorama island, two crafters, and a HUD built around the order
// card. Plain shapes only; the "premium" comes from palette, depth, motion and feedback.

import { W as GW, H as GH, idx, nextStep } from './world.js';
import { COMPONENTS, RES } from './data.js';
import { drawIcon } from './icons.js';

const TAU = Math.PI * 2;
export const PAL = {
  sea1: '#46b3de',
  sea2: '#2a7fb8',
  grassA: '#8fd672',
  grassB: '#86cd69',
  cliff: '#7a5a3c',
  cliffDark: '#5e4430',
  card: '#fff8ec',
  ink: '#2e2838',
  inkSoft: '#7d7489',
  player: '#3d7bff',
  good: '#2fbf71',
  bad: '#ff4d6d',
  gold: '#ffc83d',
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => {
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
const reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Renderer {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.fx = [];
    this.flyers = [];
    this.floaters = [];
    this.ripples = [];
    this.pulses = {};
    this.shake = 0;
    this.staticLayer = null;
    this.staticKey = null;
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.c.width = Math.round(w * dpr);
    this.c.height = Math.round(h * dpr);
    this.c.style.width = `${w}px`;
    this.c.style.height = `${h}px`;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w;
    this.H = h;
    const topH = 56;
    // Pick whichever layout gives the bigger tiles: portrait stack (phones) or a side panel (landscape).
    const sideW = Math.min(340, Math.max(190, w * 0.3));
    const portraitColW = Math.min(w, 520);
    const portraitT = Math.floor(Math.min((portraitColW - 8) / GW, (h - 264) / (GH - 0.2)));
    const wideT = Math.floor(Math.min((h - topH - 16) / (GH - 0.2), (w - sideW - 60) / GW));
    const wide = w > h && wideT > portraitT;
    if (wide) {
      const T = Math.max(8, wideT);
      const colW = Math.min(w, 1180);
      const colX = (w - colW) / 2;
      // Island and side panel are laid out as one centred group, so they never overlap.
      const groupW = sideW + 28 + T * GW;
      const sx = Math.max(12, (w - groupW) / 2);
      const ox = sx + sideW + 28;
      const oy = topH + (h - topH - T * GH) / 2 - T * 0.1;
      const compact = h < 340;
      const card = { x: sx, y: topH + (compact ? 4 : 16), w: sideW, h: 92 };
      const bag = { x: sx, y: card.y + card.h + (compact ? 6 : 14), w: sideW, h: 62 };
      const home = { x: sx, y: bag.y + bag.h + (compact ? 6 : 12), w: sideW, h: compact ? 44 : 52 };
      this.L = { wide, colW, colX, topH, card, bag, home, T, ox, oy, hintY: home.y + home.h + 20, hintX: sx + sideW / 2, toastY: h - 18 };
    } else {
      const colW = portraitColW;
      const colX = (w - colW) / 2;
      const card = { x: colX + 10, y: topH + 4, w: colW - 20, h: 92 };
      const bottomH = 104;
      const mapTop = card.y + card.h + 8;
      const mapH = h - mapTop - bottomH;
      const T = Math.max(8, portraitT);
      const ox = colX + (colW - T * GW) / 2;
      const oy = mapTop + (mapH - T * GH) / 2 - T * 0.15;
      const bagY = h - bottomH + 8;
      const home = { x: colX + colW - 128, y: bagY + 20, w: 116, h: 52 };
      const bag = { x: colX + 10, y: bagY + 14, w: home.x - 8 - (colX + 10), h: 62 };
      this.L = { wide, colW, colX, topH, card, bag, home, T, ox, oy, hintY: bagY + 6, hintX: w / 2, toastY: bagY - 18 };
    }
    this.Lgame = this.L;
    // Menu (attract mode): the island plays itself above / beside the title panel.
    const menuWide = w > h * 1.05 && w >= 720;
    let mT;
    let mox;
    let moy;
    if (menuWide) {
      mT = Math.max(8, Math.floor((h - 50) / GH));
      mox = Math.max(20, w * 0.3 - (mT * GW) / 2);
      moy = 22;
    } else {
      const availH = Math.max(250, h - 470);
      mT = Math.max(8, Math.floor(Math.min((w - 24) / GW, availH / GH)));
      mox = (w - mT * GW) / 2;
      moy = 10 + (availH - mT * GH) / 2;
    }
    this.Lmenu = { ...this.L, T: mT, ox: mox, oy: moy };
    this.staticKey = null;
  }

  tileCenter(x, y) {
    const { ox, oy, T } = this.L;
    return { x: ox + (x + 0.5) * T, y: oy + (y + 0.5) * T };
  }

  // Map a tap to a target tile, preferring nodes/Workshop within a generous radius (fat-finger friendly).
  pick(world, sx, sy) {
    const { ox, oy, T } = this.L;
    let best = null;
    for (const n of world.nodes) {
      const c = this.tileCenter(n.x, n.y);
      const d = Math.hypot(sx - c.x, sy - (c.y - T * 0.15));
      if (d < T * 0.78 && (!best || d < best.d)) best = { x: n.x, y: n.y, d };
    }
    if (best) return best;
    const hx = sx - ox;
    const hy = sy - oy;
    if (hx >= 3 * T && hx < 6 * T && hy >= (world.hubY - 1.4) * T && hy < (world.hubY + 1) * T) return { x: 4, y: world.hubY };
    const tx = Math.floor((sx - ox) / T);
    const ty = Math.floor((sy - oy) / T);
    if (tx < 0 || ty < 0 || tx >= GW || ty >= GH) return null;
    return { x: tx, y: ty };
  }

  homeButton() {
    return this.L.home;
  }

  // ------------------------------------------------------------ effects API
  burst(x, y, color, n = 14, speed = 180, life = 0.6, size = 4) {
    if (reduceMotion) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.fx.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.3, life, max: life, color, size: size * (0.6 + Math.random() * 0.8) });
    }
  }
  fly(kind, id, from, to, { dur = 0.55, size = 26, delay = 0, onDone = null } = {}) {
    this.flyers.push({ kind, id, from, to, t: -delay, dur, size, onDone });
  }
  floater(text, x, y, color, size = 16, life = 1.1) {
    this.floaters.push({ text, x, y, color, size, life, max: life });
  }
  ripple(x, y, color) {
    this.ripples.push({ x, y, color, life: 0.45, max: 0.45 });
  }
  pulse(key) {
    this.pulses[key] = 1;
  }
  doShake(px) {
    if (!reduceMotion) this.shake = Math.max(this.shake, px);
  }

  update(dt) {
    for (const p of this.fx) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 420 * dt;
      p.vx *= 0.96;
    }
    this.fx = this.fx.filter((p) => p.life > 0);
    for (const f of this.flyers) {
      const before = f.t;
      f.t += dt;
      if (before < f.dur && f.t >= f.dur && f.onDone) f.onDone();
    }
    this.flyers = this.flyers.filter((f) => f.t < f.dur);
    for (const f of this.floaters) f.life -= dt;
    this.floaters = this.floaters.filter((f) => f.life > 0);
    for (const r of this.ripples) r.life -= dt;
    this.ripples = this.ripples.filter((r) => r.life > 0);
    for (const k of Object.keys(this.pulses)) {
      this.pulses[k] -= dt * 2.2;
      if (this.pulses[k] <= 0) delete this.pulses[k];
    }
    this.shake = Math.max(0, this.shake - dt * 40);
    if (this.pops) {
      for (const p of this.pops) p.life -= dt;
      this.pops = this.pops.filter((p) => p.life > 0);
    }
  }

  // ------------------------------------------------------------ frame
  // view: { match, now, rivalDef, glass, hint, toast, caption, intro, menu }
  draw(view, dt) {
    const { g, W, H } = this;
    this.L = view.menu ? this.Lmenu : this.Lgame;
    this.update(dt);
    const m = view.match;
    g.save();
    this.drawSea(view.now);
    if (this.shake) g.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    if (m) {
      this.drawIsland(m.world, view.now);
      this.drawWorldObjects(view);
      this.drawPops(view.now);
    }
    g.restore();
    if (m && !view.menu) {
      this.drawTopBar(view);
      this.drawOrderCard(view);
      this.drawBottom(view);
      if (m.phase === 'intro' && !view.vs) this.drawIntro(view);
    }
    if (view.pointer && !view.menu) this.drawPointer(view.pointer, view.now);
    this.drawFlyers();
    this.drawParticles();
    this.drawFloaters();
    if (view.toast && !view.menu) this.drawToast(view.toast, view.now);
    if (view.caption) this.drawCaption(view.caption, view.now);
    if (view.vs) this.drawVersus(view);
  }

  // Icons that rise out of the Workshop when a part or item is crafted.
  pop(kind, id, x, y, { life = 1.1, size = 26 } = {}) {
    this.pops = this.pops || [];
    this.pops.push({ kind, id, x, y, life, max: life, size });
  }

  drawPops() {
    if (!this.pops) return;
    const { g } = this;
    for (const p of this.pops) {
      const t = 1 - p.life / p.max;
      const s = easeOutBack(clamp01(t * 3)) * (1 - Math.max(0, t - 0.75) * 2);
      g.save();
      g.globalAlpha = clamp01((1 - t) * 3);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(p.x, p.y - easeOut(t) * 40, p.size * 0.7 * s, 0, TAU);
      g.fill();
      drawIcon(g, p.kind, p.id, p.x, p.y - easeOut(t) * 40, p.size * s);
      g.restore();
    }
  }

  starPos(who, i) {
    const { colX, colW } = this.Lgame;
    const w = Math.min(160, colW * 0.4);
    if (who === 'player') return { x: colX + 10 + 19 + 26 + i * 16, y: 38 };
    return { x: colX + colW - 10 - 19 - 26 - i * 16, y: 38 };
  }

  // Tutorial hand: a bouncing arrow and a pulsing ring on the thing to tap.
  drawPointer(p, now) {
    const { g } = this;
    const b = Math.abs(Math.sin(now / 220)) * 12;
    const ring = (now / 900) % 1;
    g.save();
    g.strokeStyle = `rgba(255,255,255,${1 - ring})`;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(p.x, p.y, 14 + ring * 26, 0, TAU);
    g.stroke();
    g.translate(p.x, p.y - 38 - b);
    g.fillStyle = '#ffffff';
    g.strokeStyle = PAL.ink;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-11, -16);
    g.lineTo(11, -16);
    g.lineTo(11, 0);
    g.lineTo(20, 0);
    g.lineTo(0, 20);
    g.lineTo(-20, 0);
    g.lineTo(-11, 0);
    g.closePath();
    g.fill();
    g.stroke();
    if (p.label) {
      g.font = '900 13px system-ui, sans-serif';
      g.textAlign = 'center';
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(20,20,40,0.7)';
      g.strokeText(p.label, 0, -26);
      g.fillStyle = '#fff';
      g.fillText(p.label, 0, -26);
    }
    g.restore();
  }

  // Fighting-game style VS splash before a match.
  drawVersus(view) {
    const { g, W, H } = this;
    const vs = view.vs;
    const t = clamp01(vs.t);
    const inT = easeOutBack(clamp01(t * 3));
    const out = t > 0.85 ? (t - 0.85) / 0.15 : 0;
    g.save();
    g.globalAlpha = 1 - out;
    const slide = (1 - clamp01(t * 3)) * W * 0.6;
    g.fillStyle = PAL.player;
    g.beginPath();
    g.moveTo(-slide, 0);
    g.lineTo(W * 0.62 - slide, 0);
    g.lineTo(W * 0.38 - slide, H);
    g.lineTo(-slide, H);
    g.closePath();
    g.fill();
    g.fillStyle = vs.rival.color;
    g.beginPath();
    g.moveTo(W * 0.62 + slide, 0);
    g.lineTo(W + slide, 0);
    g.lineTo(W + slide, H);
    g.lineTo(W * 0.38 + slide, H);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 12; i++) g.fillRect(0, (i / 12) * H + ((view.now / 20) % (H / 12)), W, 2);
    const r = Math.min(W * 0.11, H * 0.07, 62);
    const lx = W * 0.23 - slide;
    const rx = W * 0.77 + slide;
    const ay = H * 0.36;
    for (const [x, c] of [
      [lx, '#dfe9ff'],
      [rx, '#fff1dc'],
    ]) {
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.25)';
      g.shadowBlur = 18;
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(x, ay + r * 0.1, r * 1.75 * inT, 0, TAU);
      g.fill();
      g.restore();
      g.fillStyle = c;
      g.beginPath();
      g.arc(x, ay + r * 0.1, r * 1.55 * inT, 0, TAU);
      g.fill();
    }
    this.drawAvatar(lx, ay, r * inT, PAL.player, 'player', 1, view.now);
    this.drawAvatar(rx, ay, r * inT, vs.rival.color, vs.rival.look, -1, view.now);
    g.textAlign = 'center';
    g.lineJoin = 'round';
    const txt = (s, x, y, size, color = '#fff') => {
      g.font = `900 ${size}px system-ui, sans-serif`;
      g.lineWidth = size / 5;
      g.strokeStyle = 'rgba(20,20,40,0.55)';
      g.strokeText(s, x, y);
      g.fillStyle = color;
      g.fillText(s, x, y);
    };
    txt('YOU', lx, ay + r * 2.4, 22);
    txt(vs.rival.name, rx, ay + r * 2.4, 22);
    g.font = '800 12px system-ui, sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillText(vs.rival.title.toUpperCase(), rx, ay + r * 2.4 + 18);
    g.save();
    g.translate(W / 2, H * 0.36);
    g.rotate(-0.12);
    g.scale(inT, inT);
    txt('VS', 0, 18, Math.min(84, W * 0.15), PAL.gold);
    g.restore();
    // quote card
    const qw = Math.min(W - 40, 420);
    const qy = H * 0.62;
    g.fillStyle = 'rgba(255,248,236,0.96)';
    rr(g, W / 2 - qw / 2, qy, qw, 92, 18);
    g.fill();
    g.fillStyle = PAL.ink;
    g.font = 'italic 700 15px system-ui, sans-serif';
    const words = `“${vs.rival.intro}”`.split(' ');
    const lines = [];
    let line = '';
    for (const wd of words) {
      const tt = line ? `${line} ${wd}` : wd;
      if (g.measureText(tt).width > qw - 30 && line) {
        lines.push(line);
        line = wd;
      } else line = tt;
    }
    lines.push(line);
    lines.slice(0, 2).forEach((l, i) => g.fillText(l, W / 2, qy + 30 + i * 20));
    g.font = '800 12px system-ui, sans-serif';
    g.fillStyle = PAL.inkSoft;
    g.fillText(vs.sub, W / 2, qy + 78);
    g.restore();
  }

  drawSea(now) {
    const { g, W, H } = this;
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, PAL.sea1);
    grd.addColorStop(1, PAL.sea2);
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,0.13)';
    g.lineWidth = 2;
    const t = now / 1000;
    for (let i = 0; i < 18; i++) {
      const y = ((i * 97 + t * 14) % (H + 40)) - 20;
      const x = (i * 173) % W;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + 14, y - 5 + Math.sin(t * 2 + i) * 2, x + 28, y);
      g.stroke();
    }
  }

  buildStatic(world) {
    const { T, ox, oy } = this.L;
    const pad = T;
    const c = document.createElement('canvas');
    const w = T * GW + pad * 2;
    const h = T * GH + pad * 2;
    c.width = Math.round(w * this.dpr);
    c.height = Math.round(h * this.dpr);
    const g = c.getContext('2d');
    g.scale(this.dpr, this.dpr);
    g.translate(pad, pad);
    const land = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH && world.land[idx(x, y)];
    // soft island shadow
    g.fillStyle = 'rgba(10,40,70,0.25)';
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) if (land(x, y)) {
        rr(g, x * T - 2, y * T + T * 0.45, T + 4, T, T * 0.3);
        g.fill();
      }
    // cliffs (south faces)
    const cliffH = T * 0.34;
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) {
        if (!land(x, y) || land(x, y + 1)) continue;
        g.fillStyle = PAL.cliff;
        rr(g, x * T, y * T + T * 0.5, T, T * 0.5 + cliffH, T * 0.18);
        g.fill();
        g.fillStyle = PAL.cliffDark;
        g.fillRect(x * T + 2, y * T + T + cliffH * 0.55, T - 4, cliffH * 0.3);
      }
    // grass tops
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) {
        if (!land(x, y)) continue;
        g.fillStyle = (x + y) % 2 ? PAL.grassA : PAL.grassB;
        const rN = !land(x, y - 1);
        const rS = !land(x, y + 1);
        const rW = !land(x - 1, y);
        const rE = !land(x + 1, y);
        const r = T * 0.32;
        g.beginPath();
        g.moveTo(x * T + (rN && rW ? r : 0), y * T);
        g.lineTo(x * T + T - (rN && rE ? r : 0), y * T);
        if (rN && rE) g.quadraticCurveTo(x * T + T, y * T, x * T + T, y * T + r);
        g.lineTo(x * T + T, y * T + T - (rS && rE ? r : 0));
        if (rS && rE) g.quadraticCurveTo(x * T + T, y * T + T, x * T + T - r, y * T + T);
        g.lineTo(x * T + (rS && rW ? r : 0), y * T + T);
        if (rS && rW) g.quadraticCurveTo(x * T, y * T + T, x * T, y * T + T - r);
        g.lineTo(x * T, y * T + (rN && rW ? r : 0));
        if (rN && rW) g.quadraticCurveTo(x * T, y * T, x * T + r, y * T);
        g.closePath();
        g.fill();
        if (rN) {
          g.fillStyle = 'rgba(255,255,255,0.18)';
          g.fillRect(x * T + (rW ? r : 0), y * T, T - (rW ? r : 0) - (rE ? r : 0), 3);
        }
      }
    // flowers and grass tufts (seeded by position)
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) {
        if (!world.walkable[idx(x, y)]) continue;
        const h2 = ((x * 73856093) ^ (y * 19349663) ^ world.seed) >>> 0;
        if (h2 % 5 === 0) {
          const fx = x * T + ((h2 >> 3) % 70) / 100 * T + T * 0.15;
          const fy = y * T + ((h2 >> 9) % 70) / 100 * T + T * 0.15;
          g.fillStyle = ['#ffffff', '#ffe26b', '#ff9ec4'][h2 % 3];
          g.beginPath();
          g.arc(fx, fy, T * 0.05, 0, TAU);
          g.fill();
        } else if (h2 % 5 === 1) {
          const fx = x * T + ((h2 >> 4) % 60) / 100 * T + T * 0.2;
          const fy = y * T + ((h2 >> 10) % 60) / 100 * T + T * 0.3;
          g.strokeStyle = '#6fb957';
          g.lineWidth = 1.5;
          g.beginPath();
          g.moveTo(fx - 3, fy);
          g.lineTo(fx - 1, fy - 5);
          g.moveTo(fx + 1, fy);
          g.lineTo(fx + 3, fy - 6);
          g.stroke();
        }
      }
    this.staticLayer = { c, pad, w, h };
    this.staticKey = world;
    this.staticT = this.L.T;
  }

  drawIsland(world, now) {
    if (this.staticKey !== world || this.staticT !== this.L.T) this.buildStatic(world);
    const { ox, oy } = this.L;
    const s = this.staticLayer;
    this.g.drawImage(s.c, ox - s.pad, oy - s.pad, s.w, s.h);
    // coast foam
    const { g } = this;
    const { T } = this.L;
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 2;
    const t = now / 600;
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) {
        if (!world.land[idx(x, y)]) continue;
        if (y + 1 < GH && !world.land[idx(x, y + 1)]) {
          const yy = oy + (y + 1) * T + T * 0.34 + 3 + Math.sin(t + x) * 1.5;
          g.beginPath();
          g.moveTo(ox + x * T + 4, yy);
          g.lineTo(ox + x * T + T - 4, yy);
          g.stroke();
        }
      }
  }

  // Everything that stands on the island, drawn back to front.
  drawWorldObjects(view) {
    const m = view.match;
    const w = m.world;
    const { g } = this;
    const { T } = this.L;
    const needP = m.phase === 'race' ? m.needRemaining('player') : {};
    const bagFull = m.player.bag.length >= m.bagSize;
    const objs = [];
    for (const o of w.obstacles) objs.push({ y: o.y, draw: () => this.drawObstacle(o) });
    for (const n of w.nodes) objs.push({ y: n.y, draw: () => this.drawNode(m, n, view.now, !!needP[n.type] && !bagFull) });
    objs.push({ y: w.hubY, draw: () => this.drawWorkshop(m, view) });
    const agents = [
      { a: m.rival, color: view.rivalDef.color, kind: 'rival' },
      { a: m.player, color: PAL.player, kind: 'player' },
    ];
    for (const ag of agents) objs.push({ y: ag.a.fy + 0.01, draw: () => this.drawAgent(ag.a, ag.color, ag.kind, view) });

    // guidance lines under everything
    if (m.phase === 'race') {
      this.drawPath(m, m.player, PAL.player, 0.35);
      this.drawRivalIntent(m, view);
    }
    for (const r of this.ripples) {
      const t = 1 - r.life / r.max;
      g.strokeStyle = hexA(r.color, 1 - t);
      g.lineWidth = 3;
      g.beginPath();
      g.ellipse(r.x, r.y, T * (0.2 + 0.4 * t), T * (0.1 + 0.2 * t), 0, 0, TAU);
      g.stroke();
    }
    objs.sort((a, b) => a.y - b.y).forEach((o) => o.draw());
    if (this.pendingPill) {
      const p = this.pendingPill;
      this.pendingPill = null;
      const { g } = this;
      g.font = '800 11px system-ui, sans-serif';
      const pw = g.measureText(p.label).width + 16;
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.25)';
      g.shadowBlur = 6;
      g.fillStyle = p.color;
      rr(g, p.x - pw / 2, p.y - 9, pw, 19, 9.5);
      g.fill();
      g.restore();
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.fillText(p.label, p.x, p.y + 4);
    }
    if (view.glass && m.pred && m.phase === 'race') this.drawGlass(m, view);
  }

  pathPoints(m, a) {
    if (!a.dest) return [];
    const field = m.fieldFor(a.dest);
    const pts = [{ x: a.fx, y: a.fy }];
    let x = a.to ? a.to.x : a.x;
    let y = a.to ? a.to.y : a.y;
    pts.push({ x, y });
    for (let i = 0; i < 30; i++) {
      const s = nextStep(m.world, field, x, y);
      if (!s) break;
      x = s.x;
      y = s.y;
      pts.push({ x, y });
    }
    if (a.dest.kind === 'node') {
      const n = m.world.nodes[a.dest.id];
      pts.push({ x: n.x, y: n.y });
    }
    return pts;
  }

  drawPath(m, a, color, alpha, width = 3, dash = [4, 7], under = false) {
    const pts = this.pathPoints(m, a);
    if (pts.length < 2) return;
    const { g } = this;
    const trace = () => {
      g.beginPath();
      pts.forEach((p, i) => {
        const c = this.tileCenter(p.x, p.y);
        i ? g.lineTo(c.x, c.y + 4) : g.moveTo(c.x, c.y + 4);
      });
    };
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    if (under) {
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = width + 4;
      trace();
      g.stroke();
    }
    g.setLineDash(dash);
    g.lineDashOffset = -performance.now() / 40;
    g.strokeStyle = hexA(color, alpha);
    g.lineWidth = width;
    trace();
    g.stroke();
    g.restore();
  }

  // Seconds until an agent reaches a node (for the "who gets there first" verdict).
  eta(m, a, nodeId) {
    const f = m.world.nodeField[nodeId];
    const s = a.to || a;
    const d = f[idx(s.x, s.y)];
    if (d < 0) return 99;
    return (d + (a.to ? 1 - a.t : 0)) / a.speed + (a.state === 'think' ? a.timer : 0);
  }

  drawRivalIntent(m, view) {
    const r = m.rival;
    const intent = m.rivalIntent;
    if (!r.dest || !intent) return;
    const color = view.rivalDef.color;
    const contested = r.dest.kind === 'node' && m.player.dest && m.player.dest.kind === 'node' && m.player.dest.id === r.dest.id;
    const rivalFirst = contested && this.eta(m, r, r.dest.id) < this.eta(m, m.player, r.dest.id);
    this.rivalFirst = rivalFirst;
    if (rivalFirst) this.drawPath(m, r, PAL.bad, 1, 5, [10, 6], true);
    else this.drawPath(m, r, color, 0.8, 4, [4, 7], true);
    if (r.dest.kind === 'node') {
      const n = m.world.nodes[r.dest.id];
      const c = this.tileCenter(n.x, n.y);
      const { g } = this;
      const { T } = this.L;
      const t = performance.now() / 300;
      if (contested) {
        // pulsing danger/opportunity ring on the node + a verdict pill everyone can read
        g.fillStyle = hexA(rivalFirst ? PAL.bad : PAL.good, 0.25 + 0.15 * Math.sin(performance.now() / 120));
        g.beginPath();
        g.ellipse(c.x, c.y + T * 0.3, T * 0.5, T * 0.2, 0, 0, TAU);
        g.fill();
        // drawn after the island objects so trees never cover it
        this.pendingPill = { x: c.x, y: c.y - T * 1.6, label: rivalFirst ? `${view.rivalDef.name} FIRST` : 'YOU FIRST', color: rivalFirst ? PAL.bad : PAL.good };
      }
      g.save();
      g.strokeStyle = rivalFirst ? PAL.bad : color;
      g.lineWidth = 2.5;
      g.translate(c.x, c.y + T * 0.05);
      g.rotate(t * 0.5);
      for (let i = 0; i < 4; i++) {
        g.rotate(TAU / 4);
        g.beginPath();
        g.arc(0, 0, T * 0.55, -0.35, 0.35);
        g.stroke();
      }
      g.restore();
    }
  }

  drawGlass(m, view) {
    const { g } = this;
    const { T } = this.L;
    for (const [id, pr] of m.pred) {
      const n = m.world.nodes[id];
      const c = this.tileCenter(n.x, n.y);
      g.fillStyle = hexA('#1d1530', 0.78);
      rr(g, c.x - T * 0.42, c.y - T * 0.95, T * 0.84, T * 0.36, 6);
      g.fill();
      g.fillStyle = pr.p > 0.4 ? '#ffd166' : '#ffffff';
      g.font = `800 ${Math.max(10, T * 0.24)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillText(`${Math.round(pr.p * 100)}%`, c.x, c.y - T * 0.7);
    }
  }

  drawObstacle(o) {
    const { g } = this;
    const { T } = this.L;
    const c = this.tileCenter(o.x, o.y);
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.beginPath();
    g.ellipse(c.x, c.y + T * 0.28, T * 0.38, T * 0.14, 0, 0, TAU);
    g.fill();
    if (o.kind === 'bush') {
      for (const [dx, dy, r, col] of [[-0.18, 0.02, 0.24, '#3f8a3a'], [0.16, 0.04, 0.22, '#3f8a3a'], [0, -0.14, 0.26, '#4d9a45']]) {
        g.fillStyle = col;
        g.beginPath();
        g.arc(c.x + dx * T, c.y + dy * T, r * T, 0, TAU);
        g.fill();
      }
      g.fillStyle = '#ff6b6b';
      g.beginPath();
      g.arc(c.x - T * 0.08, c.y - T * 0.16, T * 0.045, 0, TAU);
      g.arc(c.x + T * 0.12, c.y - 0.02 * T, T * 0.045, 0, TAU);
      g.fill();
    } else {
      g.fillStyle = '#7d8594';
      g.beginPath();
      g.ellipse(c.x, c.y + T * 0.05, T * 0.38, T * 0.3, 0, 0, TAU);
      g.fill();
      g.fillStyle = '#9aa3b2';
      g.beginPath();
      g.ellipse(c.x - T * 0.06, c.y - T * 0.04, T * 0.26, T * 0.18, 0, 0, TAU);
      g.fill();
    }
  }

  drawNode(m, n, now, needed) {
    const { g } = this;
    const { T } = this.L;
    const c = this.tileCenter(n.x, n.y);
    const ready = m.nodeReady(n);
    const beingTaken = !!n.reserved;
    const regrow = ready ? 1 : clamp01(1 - (n.readyAt - m.time) / (n.respawn * m.respawnMul));
    const wob = beingTaken ? Math.sin(now / 30) * T * 0.04 : 0;
    const pulse = this.pulses[`node${n.id}`] || 0;
    // shadow
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.beginPath();
    g.ellipse(c.x, c.y + T * 0.3, T * 0.36, T * 0.13, 0, 0, TAU);
    g.fill();
    // "you need this" glow
    if (ready && needed && m.phase === 'race') {
      const a = 0.6 + 0.35 * Math.sin(now / 220 + n.id);
      g.strokeStyle = `rgba(255,214,90,${a})`;
      g.lineWidth = 4;
      g.beginPath();
      g.ellipse(c.x, c.y + T * 0.3, T * 0.46, T * 0.18, 0, 0, TAU);
      g.stroke();
      const by = c.y - T * 0.82 - Math.abs(Math.sin(now / 260 + n.id)) * 4;
      g.fillStyle = '#ffd65a';
      g.strokeStyle = 'rgba(60,40,0,0.5)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(c.x - 6, by - 6);
      g.lineTo(c.x + 6, by - 6);
      g.lineTo(c.x, by + 2);
      g.closePath();
      g.fill();
      g.stroke();
    }
    g.save();
    if (m.phase === 'race' && ready && !needed) g.globalAlpha = 0.55;
    g.translate(c.x + wob, c.y);
    const s = 1 + pulse * 0.15;
    g.scale(s, s);
    if (!ready && !beingTaken) {
      this.drawDepleted(n, T);
      // regrow ring
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(0, -T * 0.05, T * 0.34, 0, TAU);
      g.stroke();
      g.strokeStyle = '#ffffff';
      g.beginPath();
      g.arc(0, -T * 0.05, T * 0.34, -Math.PI / 2, -Math.PI / 2 + TAU * regrow);
      g.stroke();
    } else this.drawResourceNode(n.type, T, now + n.id * 500, needed || m.phase !== 'race');
    g.restore();
  }

  drawDepleted(n, T) {
    const { g } = this;
    if (n.type === 'wood') {
      g.fillStyle = '#8a5a2e';
      rr(g, -T * 0.12, T * 0.02, T * 0.24, T * 0.2, 4);
      g.fill();
      g.fillStyle = '#d9a86b';
      g.beginPath();
      g.ellipse(0, T * 0.03, T * 0.12, T * 0.05, 0, 0, TAU);
      g.fill();
    } else {
      g.fillStyle = hexA(RES[n.type].color, 0.55);
      for (const [dx, dy, r] of [[-0.14, 0.12, 0.08], [0.1, 0.14, 0.07], [0, 0.04, 0.06]]) {
        g.beginPath();
        g.arc(dx * T, dy * T, r * T, 0, TAU);
        g.fill();
      }
    }
  }

  drawResourceNode(type, T, now, lit = true) {
    const { g } = this;
    const sway = Math.sin(now / 700) * 0.04;
    if (type === 'wood') {
      g.fillStyle = '#8a5a2e';
      rr(g, -T * 0.08, -T * 0.05, T * 0.16, T * 0.34, 3);
      g.fill();
      g.save();
      g.rotate(sway);
      for (const [dx, dy, r, col] of [[0, -0.42, 0.26, '#3f9e4a'], [-0.17, -0.22, 0.22, '#48ad52'], [0.17, -0.22, 0.22, '#48ad52'], [0, -0.28, 0.24, '#58bf5f']]) {
        g.fillStyle = col;
        g.beginPath();
        g.arc(dx * T, dy * T, r * T, 0, TAU);
        g.fill();
      }
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.beginPath();
      g.arc(-T * 0.08, -T * 0.46, T * 0.08, 0, TAU);
      g.fill();
      g.restore();
    } else if (type === 'stone' || type === 'ore') {
      g.fillStyle = type === 'stone' ? '#9aa3b2' : '#6b5a53';
      g.beginPath();
      g.moveTo(-T * 0.36, T * 0.22);
      g.lineTo(-T * 0.3, -T * 0.12);
      g.lineTo(-T * 0.05, -T * 0.3);
      g.lineTo(T * 0.26, -T * 0.2);
      g.lineTo(T * 0.36, T * 0.18);
      g.closePath();
      g.fill();
      g.fillStyle = type === 'stone' ? '#c9d0db' : '#85726a';
      g.beginPath();
      g.moveTo(-T * 0.22, -T * 0.08);
      g.lineTo(-T * 0.04, -T * 0.22);
      g.lineTo(T * 0.14, -T * 0.14);
      g.lineTo(T * 0.02, -T * 0.02);
      g.closePath();
      g.fill();
      if (type === 'ore') {
        const glint = 0.6 + 0.4 * Math.sin(now / 300);
        for (const [dx, dy, r] of [[-0.14, 0.06, 0.07], [0.14, 0.02, 0.08], [0.02, -0.12, 0.05]]) {
          g.fillStyle = `rgba(255,138,61,${glint})`;
          g.beginPath();
          g.arc(dx * T, dy * T, r * T, 0, TAU);
          g.fill();
        }
      }
    } else if (type === 'sand') {
      g.fillStyle = '#e8c26a';
      g.beginPath();
      g.moveTo(-T * 0.4, T * 0.2);
      g.quadraticCurveTo(-T * 0.18, -T * 0.3, 0, -T * 0.28);
      g.quadraticCurveTo(T * 0.2, -T * 0.3, T * 0.4, T * 0.2);
      g.closePath();
      g.fill();
      g.fillStyle = '#f8dc93';
      g.beginPath();
      g.ellipse(-T * 0.06, -T * 0.14, T * 0.16, T * 0.07, -0.3, 0, TAU);
      g.fill();
      g.fillStyle = '#c9993f';
      for (const [dx, dy] of [[-0.14, 0.05], [0.1, 0.0], [0.2, 0.12], [-0.02, 0.12]]) {
        g.beginPath();
        g.arc(dx * T, dy * T, T * 0.025, 0, TAU);
        g.fill();
      }
    } else if (type === 'fiber') {
      g.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const x0 = (i - 2.5) * T * 0.1;
        const tipX = x0 * 1.6 + Math.sin(now / 500 + i) * T * 0.05;
        g.strokeStyle = i % 2 ? '#78b04a' : '#5f9a3a';
        g.lineWidth = T * 0.07;
        g.beginPath();
        g.moveTo(x0, T * 0.22);
        g.quadraticCurveTo(x0 * 1.2, -T * 0.05, tipX, -T * 0.42 + (i % 2) * T * 0.08);
        g.stroke();
        g.fillStyle = '#d9c26b';
        g.beginPath();
        g.ellipse(tipX, -T * 0.42 + (i % 2) * T * 0.08, T * 0.035, T * 0.07, 0, 0, TAU);
        g.fill();
      }
    } else if (type === 'crystal') {
      const glow = lit ? 0.3 + 0.2 * Math.sin(now / 350) : 0.1;
      g.fillStyle = `rgba(143,227,255,${glow})`;
      g.beginPath();
      g.arc(0, -T * 0.1, T * 0.42, 0, TAU);
      g.fill();
      for (const [dx, h, w2, col] of [[-0.16, 0.44, 0.13, '#27a8de'], [0.15, 0.38, 0.12, '#27a8de'], [0, 0.6, 0.16, '#5ad1ff']]) {
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(dx * T, -h * T);
        g.lineTo(dx * T + w2 * T, 0);
        g.lineTo(dx * T, T * 0.2);
        g.lineTo(dx * T - w2 * T, 0);
        g.closePath();
        g.fill();
      }
      g.fillStyle = '#e6fbff';
      g.beginPath();
      g.moveTo(0, -0.6 * T);
      g.lineTo(T * 0.05, -T * 0.1);
      g.lineTo(-T * 0.06, -T * 0.1);
      g.closePath();
      g.fill();
    }
  }

  drawWorkshop(m, view) {
    const { g } = this;
    const { T } = this.L;
    const w = m.world;
    const left = this.tileCenter(3, w.hubY);
    const x0 = left.x - T * 0.5;
    const y0 = left.y - T * 0.5;
    const pulse = this.pulses.workshop || 0;
    g.fillStyle = 'rgba(0,0,0,0.18)';
    rr(g, x0 + 4, y0 + T * 0.7, T * 3 - 8, T * 0.36, 8);
    g.fill();
    // body
    g.fillStyle = '#f3dcb4';
    rr(g, x0 + T * 0.12, y0 + T * 0.05 - pulse * 3, T * 2.76, T * 0.9, 6);
    g.fill();
    g.fillStyle = '#d9b98a';
    g.fillRect(x0 + T * 0.12, y0 + T * 0.78 - pulse * 3, T * 2.76, T * 0.17);
    // roof
    g.fillStyle = '#e8644a';
    g.beginPath();
    g.moveTo(x0 - T * 0.02, y0 + T * 0.12 - pulse * 3);
    g.lineTo(x0 + T * 0.45, y0 - T * 0.55 - pulse * 3);
    g.lineTo(x0 + T * 2.55, y0 - T * 0.55 - pulse * 3);
    g.lineTo(x0 + T * 3.02, y0 + T * 0.12 - pulse * 3);
    g.closePath();
    g.fill();
    g.fillStyle = '#c94d37';
    g.fillRect(x0 - T * 0.02, y0 + T * 0.05 - pulse * 3, T * 3.04, T * 0.1);
    // chimney + smoke
    g.fillStyle = '#8a6a55';
    g.fillRect(x0 + T * 2.1, y0 - T * 0.8, T * 0.24, T * 0.4);
    const t = view.now / 1000;
    for (let i = 0; i < 3; i++) {
      const k = (t * 0.6 + i / 3) % 1;
      g.fillStyle = `rgba(255,255,255,${0.5 * (1 - k)})`;
      g.beginPath();
      g.arc(x0 + T * 2.22 + Math.sin(k * 6 + i) * 4, y0 - T * 0.85 - k * T * 0.8, T * (0.08 + k * 0.12), 0, TAU);
      g.fill();
    }
    // door + villager
    g.fillStyle = '#8a5a2e';
    rr(g, x0 + T * 1.3, y0 + T * 0.35, T * 0.4, T * 0.6, 5);
    g.fill();
    const bob = Math.sin(t * 3) * 1.5;
    g.fillStyle = '#ffd7a8';
    g.beginPath();
    g.arc(x0 + T * 1.5, y0 + T * 0.42 + bob, T * 0.16, 0, TAU);
    g.fill();
    g.fillStyle = PAL.ink;
    g.beginPath();
    g.arc(x0 + T * 1.45, y0 + T * 0.4 + bob, 1.6, 0, TAU);
    g.arc(x0 + T * 1.56, y0 + T * 0.4 + bob, 1.6, 0, TAU);
    g.fill();
    // benches: blue flag (you) left, rival flag right
    this.flag(x0 + T * 0.35, y0 + T * 0.1, PAL.player);
    this.flag(x0 + T * 2.65, y0 + T * 0.1, view.rivalDef.color);
    // order bubble over the roof
    if (m.order) {
      const bx = x0 + T * 1.5;
      const by = y0 - T * 1.05 + Math.sin(t * 2) * 2;
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(bx, by, T * 0.36, 0, TAU);
      g.fill();
      g.beginPath();
      g.moveTo(bx - 5, by + T * 0.3);
      g.lineTo(bx, by + T * 0.48);
      g.lineTo(bx + 5, by + T * 0.3);
      g.fill();
      drawIcon(g, 'item', m.order.id, bx, by, T * 0.52);
    }
  }

  flag(x, y, color) {
    const { g } = this;
    const { T } = this.L;
    g.strokeStyle = '#6b4f36';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, y - T * 0.55);
    g.stroke();
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x, y - T * 0.55);
    g.lineTo(x + T * 0.3, y - T * 0.45);
    g.lineTo(x, y - T * 0.35);
    g.closePath();
    g.fill();
  }

  // One painter for every crafter: in the world, on the VS splash, anywhere. `look` gives each rival a silhouette.
  drawAvatar(cx, cy, r, color, look, faceX, now, { blink = false, sad = false } = {}) {
    const { g } = this;
    g.save();
    g.translate(cx, cy);
    if (look === 'ears') {
      g.fillStyle = color;
      g.save();
      g.translate(-faceX * r * 0.9, r * 0.55);
      g.rotate(-faceX * (0.6 + Math.sin(now / 300) * 0.15));
      g.beginPath();
      g.ellipse(0, -r * 0.5, r * 0.32, r * 0.7, 0, 0, TAU);
      g.fill();
      g.fillStyle = '#fff';
      g.beginPath();
      g.ellipse(0, -r * 1.0, r * 0.18, r * 0.24, 0, 0, TAU);
      g.fill();
      g.restore();
      for (const sx of [-1, 1]) {
        g.fillStyle = color;
        g.beginPath();
        g.moveTo(sx * r * 0.78, -r * 0.4);
        g.lineTo(sx * r * 0.98, -r * 1.3);
        g.lineTo(sx * r * 0.2, -r * 0.86);
        g.closePath();
        g.fill();
        g.fillStyle = '#fff3e6';
        g.beginPath();
        g.moveTo(sx * r * 0.72, -r * 0.55);
        g.lineTo(sx * r * 0.86, -r * 1.08);
        g.lineTo(sx * r * 0.38, -r * 0.82);
        g.closePath();
        g.fill();
      }
    } else if (look === 'crest') {
      g.fillStyle = '#3b2f5c';
      for (const [dx, h] of [
        [-0.3, 1.2],
        [0, 1.45],
        [0.3, 1.2],
      ]) {
        g.beginPath();
        g.moveTo(dx * r - r * 0.16, -r * 0.8);
        g.lineTo(dx * r + faceX * r * 0.15, -r * h);
        g.lineTo(dx * r + r * 0.16, -r * 0.8);
        g.closePath();
        g.fill();
      }
    } else if (look === 'beak') {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(-r * 0.1, -r * 0.85);
      g.quadraticCurveTo(faceX * r * 0.3, -r * 1.5, faceX * r * 0.45, -r * 1.1);
      g.quadraticCurveTo(faceX * r * 0.2, -r * 1.05, r * 0.15, -r * 0.85);
      g.fill();
    } else {
      const lx = look === 'mirror' ? -1 : 1;
      g.strokeStyle = look === 'mirror' ? '#8a2233' : '#3a8f4a';
      g.lineWidth = Math.max(2, r * 0.08);
      g.beginPath();
      g.moveTo(0, -r * 0.95);
      g.lineTo(r * 0.1 * lx, -r * 1.3);
      g.stroke();
      g.fillStyle = look === 'mirror' ? '#ff9aae' : '#58bf5f';
      g.beginPath();
      g.ellipse(lx * r * 0.28, -r * 1.35, r * 0.24, r * 0.12, lx * -0.5, 0, TAU);
      g.fill();
      if (look === 'sprout') {
        g.beginPath();
        g.ellipse(-r * 0.2, -r * 1.3, r * 0.18, r * 0.1, 0.5, 0, TAU);
        g.fill();
      }
    }
    // body
    const sq = sad ? 0.92 : 1;
    g.fillStyle = color;
    rr(g, -r, -r * sq, r * 2, r * 2.05 * sq, r * 0.95);
    g.fill();
    if (look === 'mirror') {
      const off = ((now / 12) % (r * 5)) - r * 2.5;
      g.save();
      rr(g, -r, -r, r * 2, r * 2.05, r * 0.95);
      g.clip();
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath();
      g.moveTo(-r * 0.2 + off, -r * 1.2);
      g.lineTo(r * 0.3 + off, -r * 1.2);
      g.lineTo(-r * 0.3 + off, r * 1.3);
      g.lineTo(-r * 0.8 + off, r * 1.3);
      g.fill();
      g.restore();
    }
    g.fillStyle = 'rgba(255,255,255,0.28)';
    g.beginPath();
    g.ellipse(-r * 0.35, -r * 0.45, r * 0.3, r * 0.18, -0.6, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    g.ellipse(0, r * 0.5, r * 0.6, r * 0.42, 0, 0, TAU);
    g.fill();
    // eyes
    const shift = faceX * r * 0.12;
    const eyeY = sad ? -r * 0.02 : -r * 0.12;
    for (const sx of [-1, 1]) {
      g.fillStyle = '#fff';
      g.beginPath();
      g.ellipse(sx * r * 0.36 + shift, eyeY, r * 0.22, blink ? r * 0.04 : r * 0.26, 0, 0, TAU);
      g.fill();
      if (!blink) {
        g.fillStyle = PAL.ink;
        g.beginPath();
        g.arc(sx * r * 0.36 + shift * 1.8, eyeY + (sad ? r * 0.1 : r * 0.04), r * 0.11, 0, TAU);
        g.fill();
      }
    }
    if (look !== 'player' && look !== 'sprout') {
      g.strokeStyle = PAL.ink;
      g.lineWidth = Math.max(2, r * 0.07);
      const by = sad ? -r * 0.4 : -r * 0.46;
      g.beginPath();
      g.moveTo(-r * 0.6 + shift, by);
      g.lineTo(-r * 0.15 + shift, sad ? by - r * 0.08 : by + r * 0.12);
      g.moveTo(r * 0.6 + shift, by);
      g.lineTo(r * 0.15 + shift, sad ? by - r * 0.08 : by + r * 0.12);
      g.stroke();
    }
    if (look === 'beak' || look === 'crest') {
      g.fillStyle = look === 'beak' ? '#ffb13d' : '#4a4460';
      g.beginPath();
      g.moveTo(faceX * r * 0.2, r * 0.12);
      g.lineTo(faceX * r * 0.75, r * 0.25);
      g.lineTo(faceX * r * 0.2, r * 0.38);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  drawAgent(a, color, kind, view) {
    const { g } = this;
    const { T } = this.L;
    const c = this.tileCenter(a.fx, a.fy);
    const now = view.now;
    const walking = !!a.to;
    const emote = view.emotes && view.emotes[kind];
    const hop = emote && emote.type === 'hop' ? Math.abs(Math.sin(now / 120)) * T * 0.35 : 0;
    const sad = !!(emote && emote.type === 'sad');
    const bob = walking ? -Math.abs(Math.sin(now / 90)) * T * 0.08 : Math.sin(now / 400) * T * 0.015;
    const gathering = a.state === 'gather';
    const squash = gathering ? 1 + Math.sin(now / 45) * 0.08 : 1;
    const r = T * 0.3;
    const cx = c.x;
    const cy = c.y - T * 0.08 + bob - hop;
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.beginPath();
    g.ellipse(c.x, c.y + T * 0.28, r * 0.9 * (1 - hop / (T * 1.5)), r * 0.32, 0, 0, TAU);
    g.fill();
    const blink = (Math.floor(now / 2600) + (kind === 'rival' ? 1 : 0)) % 3 === 0 && now % 2600 < 120;
    const look = kind === 'player' ? 'player' : view.rivalDef.look || 'ears';
    g.save();
    g.translate(cx, cy + r);
    g.scale(1 / squash, squash);
    this.drawAvatar(0, -r, r, color, look, a.faceX, now, { blink, sad });
    g.restore();
    // carried items
    const high = look === 'crest' || look === 'ears' || look === 'beak';
    a.bag.forEach((res, i) => {
      const n = a.bag.length;
      drawIcon(g, 'res', res, cx + (i - (n - 1) / 2) * T * 0.3, cy - r * 1.8 - (high ? r * 0.4 : 0), T * 0.3);
    });
    const bub = view.bubbles && view.bubbles[kind];
    if (bub) this.drawBubble(bub, cx, cy - r * (high ? 2.5 : 2.2) - (a.bag.length ? r * 0.8 : 0), now);
    // danger "!" when the rival is heading for the node you are walking to
    if (kind === 'rival' && view.match.phase === 'race' && !bub) {
      const m = view.match;
      if (this.rivalFirst) {
        const yy = cy - r * 2.4 - Math.abs(Math.sin(now / 150)) * 4;
        g.fillStyle = PAL.bad;
        g.beginPath();
        g.arc(cx + r, yy, T * 0.24, 0, TAU);
        g.fill();
        g.fillStyle = '#fff';
        g.font = `900 ${T * 0.34}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.fillText('!', cx + r, yy + T * 0.12);
      }
    }
  }

  drawBubble(b, x, y, now) {
    const { g } = this;
    const t = (now - b.start) / b.dur;
    if (t > 1 || t < 0) return;
    const s = easeOutBack(clamp01(t * 5)) * (t > 0.85 ? (1 - t) / 0.15 : 1);
    g.save();
    g.translate(x, y);
    g.scale(s, s);
    g.font = '800 12px system-ui, sans-serif';
    const w = g.measureText(b.text).width + 18;
    const x0 = -w / 2;
    g.fillStyle = '#ffffff';
    g.shadowColor = 'rgba(0,0,0,0.2)';
    g.shadowBlur = 6;
    rr(g, x0, -30, w, 24, 12);
    g.fill();
    g.shadowBlur = 0;
    g.beginPath();
    g.moveTo(-5, -7);
    g.lineTo(0, 1);
    g.lineTo(5, -7);
    g.fill();
    g.fillStyle = b.color || PAL.ink;
    g.textAlign = 'center';
    g.fillText(b.text, 0, -13);
    g.restore();
  }

  // ------------------------------------------------------------ HUD
  drawTopBar(view) {
    const { g } = this;
    const m = view.match;
    const { colX, colW } = this.L;
    const y = 10;
    const chip = (x, w, color, label, stars, alignRight) => {
      g.fillStyle = 'rgba(20,40,70,0.35)';
      rr(g, x, y, w, 38, 19);
      g.fill();
      const ax = alignRight ? x + w - 19 : x + 19;
      g.fillStyle = color;
      g.beginPath();
      g.arc(ax, y + 19, 13, 0, TAU);
      g.fill();
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(ax - 4, y + 17, 3, 0, TAU);
      g.arc(ax + 4, y + 17, 3, 0, TAU);
      g.fill();
      g.font = '800 13px system-ui, sans-serif';
      g.textAlign = alignRight ? 'right' : 'left';
      g.fillStyle = '#fff';
      g.fillText(label, alignRight ? ax - 20 : ax + 20, y + 16);
      for (let i = 0; i < 3; i++) {
        const sx = alignRight ? ax - 26 - i * 16 : ax + 26 + i * 16;
        this.star(sx, y + 28, 6.5, i < stars ? PAL.gold : 'rgba(255,255,255,0.3)', this.pulses[`star-${label}-${i}`]);
      }
    };
    const w = Math.min(160, colW * 0.4);
    chip(colX + 10, w, PAL.player, 'YOU', m.stars.player, false);
    chip(colX + colW - 10 - w, w, view.rivalDef.color, view.rivalDef.name, m.stars.rival, true);
  }

  star(x, y, r, color, pulse = 0) {
    const { g } = this;
    const s = 1 + (pulse || 0) * 0.8;
    g.save();
    g.translate(x, y);
    g.scale(s, s);
    g.fillStyle = color;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 ? r * 0.45 : r;
      g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    g.closePath();
    g.fill();
    g.restore();
  }

  // Ingredient slots for the order card: what is crafted, in stock, in your bag, or still missing.
  slotsFor(m, who) {
    const b = m.bench[who];
    const bag = {};
    for (const r of m[who].bag) bag[r] = (bag[r] || 0) + 1;
    const raw = { ...b.raw };
    return m.order.parts.map((p, i) => {
      const needs = COMPONENTS[p].needs;
      if (b.made[i]) return { part: p, made: true, items: needs.map((r) => ({ r, st: 'done' })) };
      return {
        part: p,
        made: false,
        items: needs.map((r) => {
          if (raw[r] > 0) {
            raw[r]--;
            return { r, st: 'stock' };
          }
          if (bag[r] > 0) {
            bag[r]--;
            return { r, st: 'bag' };
          }
          return { r, st: 'need' };
        }),
      };
    });
  }

  drawOrderCard(view) {
    const { g } = this;
    const m = view.match;
    const { x, y, w, h } = this.L.card;
    const pulse = this.pulses.card || 0;
    g.save();
    g.shadowColor = 'rgba(10,30,60,0.3)';
    g.shadowBlur = 16;
    g.shadowOffsetY = 4;
    g.fillStyle = PAL.card;
    rr(g, x, y, w, h, 18);
    g.fill();
    g.restore();
    if (pulse) {
      g.strokeStyle = hexA(PAL.good, pulse);
      g.lineWidth = 3;
      rr(g, x, y, w, h, 18);
      g.stroke();
    }
    // item medallion
    const mx = x + 44;
    const my = y + 44;
    g.fillStyle = '#ffe7b8';
    g.beginPath();
    g.arc(mx, my, 32, 0, TAU);
    g.fill();
    drawIcon(g, 'item', m.order.id, mx, my, 48);
    g.fillStyle = PAL.inkSoft;
    g.font = '700 10px system-ui, sans-serif';
    g.textAlign = 'center';
    g.font = '800 11px system-ui, sans-serif';
    g.fillText(`ORDER ${m.orderIndex + 1}`, mx, y + h - 6);
    // name
    g.textAlign = 'left';
    g.fillStyle = PAL.ink;
    g.font = '900 17px system-ui, sans-serif';
    g.fillText(m.order.name.toUpperCase(), x + 86, y + 24);
    // component chips
    const slots = this.slotsFor(m, 'player');
    const avail = w - 86 - 12;
    const ing = 19;
    const widths = slots.map((s) => 30 + s.items.length * (ing + 3) + 8);
    const total = widths.reduce((a, b) => a + b, 0) + (slots.length - 1) * 6;
    const k = Math.min(1, avail / total);
    let cx = x + 86;
    const cy = y + 34;
    this.cardSlots = [];
    slots.forEach((s, i) => {
      const cw = widths[i] * k;
      const ch = 30 * Math.max(0.85, k);
      g.fillStyle = s.made ? hexA(PAL.good, 0.18) : '#f1e6d2';
      rr(g, cx, cy, cw, ch, 10);
      g.fill();
      if (s.made) {
        g.strokeStyle = PAL.good;
        g.lineWidth = 2;
        rr(g, cx, cy, cw, ch, 10);
        g.stroke();
      }
      const pk = this.pulses[`part${i}`] || 0;
      drawIcon(g, 'comp', s.part, cx + 15 * k, cy + ch / 2, 22 * k * (1 + pk * 0.5), { alpha: s.made ? 1 : 0.9 });
      s.items.forEach((it, j) => {
        const ix = cx + 30 * k + j * (ing + 3) * k + ing * k * 0.5;
        const iy = cy + ch / 2;
        if (it.st === 'need') {
          g.strokeStyle = 'rgba(46,40,56,0.55)';
          g.setLineDash([3, 3]);
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(ix, iy, ing * k * 0.5, 0, TAU);
          g.stroke();
          g.setLineDash([]);
          drawIcon(g, 'res', it.r, ix, iy, ing * k * 0.9, { alpha: 0.65 });
        } else {
          drawIcon(g, 'res', it.r, ix, iy, ing * k * 0.95, { alpha: it.st === 'done' ? 0.55 : 1 });
          if (it.st === 'bag') {
            g.fillStyle = PAL.player;
            g.beginPath();
            g.arc(ix + ing * k * 0.4, iy - ing * k * 0.4, 4, 0, TAU);
            g.fill();
          }
          if (it.st === 'done' || it.st === 'stock') {
            g.fillStyle = PAL.good;
            g.beginPath();
            g.arc(ix + ing * k * 0.4, iy - ing * k * 0.4, 4, 0, TAU);
            g.fill();
          }
        }
        this.cardSlots.push({ part: i, j, x: ix, y: iy });
      });
      this.cardSlots.push({ part: i, center: true, x: cx + cw / 2, y: cy + ch / 2 });
      cx += cw + 6 * k;
    });
    // who is ahead: YOU vs RIVAL progress bars
    const progress = (who) => {
      let done = 0;
      let tot = 0;
      this.slotsFor(m, who).forEach((sl) =>
        sl.items.forEach((it) => {
          tot++;
          if (it.st === 'done' || it.st === 'stock') done += 1;
          else if (it.st === 'bag') done += 0.5;
        }),
      );
      return tot ? done / tot : 0;
    };
    const bx = x + 86;
    const bw = w - 86 - 14;
    const lx = bx + 46;
    const lw = bw - 46;
    [
      ['YOU', PAL.player, progress('player'), y + h - 26],
      [view.rivalDef.name, view.rivalDef.color, progress('rival'), y + h - 12],
    ].forEach(([label, col, frac, by]) => {
      g.fillStyle = col;
      g.font = '800 11px system-ui, sans-serif';
      g.textAlign = 'left';
      g.fillText(label, bx, by + 4);
      g.fillStyle = '#eadcc4';
      rr(g, lx, by - 3.5, lw, 7, 3.5);
      g.fill();
      g.fillStyle = col;
      rr(g, lx, by - 3.5, Math.max(7, lw * frac), 7, 3.5);
      g.fill();
    });
  }

  bagStep(n) {
    const b = this.L.bag;
    return Math.min(50, (b.w - 80 - 24) / Math.max(1, n - 1));
  }

  bagSlotPos(i, n = 3) {
    const b = this.L.bag;
    return { x: b.x + 80 + i * this.bagStep(n), y: b.y + 31 };
  }

  drawBottom(view) {
    const { g } = this;
    const m = view.match;
    const b = this.L.bag;
    g.fillStyle = hexA(PAL.card, 0.96);
    const step = this.bagStep(m.bagSize);
    const slotW = Math.min(42, step - 4);
    rr(g, b.x, b.y, Math.min(b.w, 80 + (m.bagSize - 1) * step + slotW / 2 + 14), b.h, 16);
    g.fill();
    g.fillStyle = PAL.inkSoft;
    g.font = '800 10px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText('BAG', b.x + 14, b.y + 28);
    g.fillText(`${m.player.bag.length}/${m.bagSize}`, b.x + 14, b.y + 42);
    for (let i = 0; i < m.bagSize; i++) {
      const p = this.bagSlotPos(i, m.bagSize);
      g.fillStyle = '#efe3cd';
      rr(g, p.x - slotW / 2, p.y - 20, slotW, 40, 10);
      g.fill();
      const r = m.player.bag[i];
      if (r) drawIcon(g, 'res', r, p.x, p.y, 30 * (1 + (this.pulses[`bag${i}`] || 0) * 0.4));
    }
    // home button
    const hb = this.homeButton();
    const home = m.player.dest && m.player.dest.kind === 'hub';
    const full = m.player.bag.length >= m.bagSize;
    g.fillStyle = full ? PAL.good : home ? '#7fa6ff' : hexA(PAL.card, 0.96);
    rr(g, hb.x, hb.y, hb.w, hb.h, 16);
    g.fill();
    g.fillStyle = full || home ? '#fff' : PAL.ink;
    g.font = '900 13px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('⌂ WORKSHOP', hb.x + hb.w / 2, hb.y + 23);
    g.font = '600 10px system-ui, sans-serif';
    g.fillText(full ? 'bag full, go!' : 'deposit & craft', hb.x + hb.w / 2, hb.y + 39);
    if (view.hint) {
      g.fillStyle = 'rgba(255,255,255,0.92)';
      g.font = '700 12px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(view.hint, this.L.hintX, this.L.hintY);
    }
  }

  drawIntro(view) {
    const { g, W, H } = this;
    const m = view.match;
    const t = clamp01(1 - m.phaseTimer / (m.orderIndex === 0 ? 2.6 : 1.4));
    const cw = Math.min(360, this.W - 30);
    const ch = 266;
    const x = (W - cw) / 2;
    const y = H * 0.42 - ch / 2;
    const pop = easeOutBack(clamp01(t * 3));
    g.fillStyle = 'rgba(10,25,45,0.35)';
    g.fillRect(0, 0, W, H);
    g.save();
    g.translate(W / 2, y + ch / 2);
    g.scale(pop, pop);
    g.translate(-W / 2, -(y + ch / 2));
    g.fillStyle = PAL.card;
    rr(g, x, y, cw, ch, 22);
    g.fill();
    g.fillStyle = PAL.inkSoft;
    g.font = '800 12px system-ui, sans-serif';
    g.textAlign = 'center';
    const art = /^[AEIOU]|^HOUR/i.test(m.order.name) ? 'AN' : 'A';
    g.fillText(`ORDER ${m.orderIndex + 1} · FIRST TO 3 WINS · THE VILLAGER NEEDS ${art}`, W / 2, y + 28);
    g.fillStyle = '#ffe7b8';
    g.beginPath();
    g.arc(W / 2, y + 86, 46, 0, TAU);
    g.fill();
    drawIcon(g, 'item', m.order.id, W / 2, y + 86, 72);
    g.fillStyle = PAL.ink;
    g.font = '900 26px system-ui, sans-serif';
    g.fillText(m.order.name.toUpperCase(), W / 2, y + 160);
    // recipe line
    const parts = m.order.parts;
    const pw = 84;
    const sx = W / 2 - ((parts.length - 1) * pw) / 2;
    parts.forEach((p, i) => {
      const px = sx + i * pw;
      drawIcon(g, 'comp', p, px, y + 188, 26);
      g.fillStyle = PAL.inkSoft;
      g.font = '800 10px system-ui, sans-serif';
      g.fillText(COMPONENTS[p].name.toUpperCase(), px, y + 212);
      const needs = COMPONENTS[p].needs;
      needs.forEach((r, j) => drawIcon(g, 'res', r, px + (j - (needs.length - 1) / 2) * 22, y + 236, 20));
      if (i < parts.length - 1) {
        g.fillStyle = PAL.inkSoft;
        g.font = '900 16px system-ui, sans-serif';
        g.fillText('+', px + pw / 2, y + 196);
      }
    });
    g.restore();
  }

  drawToast(toast, now) {
    const { g, W } = this;
    const t = (now - toast.start) / toast.dur;
    if (t > 1) return;
    const a = Math.min(1, t * 10, (1 - t) * 5);
    const y = this.L.toastY;
    g.font = '700 13px system-ui, sans-serif';
    const maxW = Math.min(this.L.colW - 40, 480);
    const words = toast.text.split(' ');
    const lines = [];
    let line = '';
    for (const wd of words) {
      const tt = line ? `${line} ${wd}` : wd;
      if (g.measureText(tt).width > maxW - 24 && line) {
        lines.push(line);
        line = wd;
      } else line = tt;
    }
    if (line) lines.push(line);
    const bw = Math.min(maxW, Math.max(...lines.map((l) => g.measureText(l).width)) + 28);
    const bh = lines.length * 17 + 14;
    g.save();
    g.globalAlpha = a;
    g.fillStyle = toast.color || 'rgba(30,24,44,0.92)';
    rr(g, W / 2 - bw / 2, y - bh, bw, bh, 12);
    g.fill();
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    lines.forEach((l, i) => g.fillText(l, W / 2, y - bh + 20 + i * 17));
    g.restore();
  }

  drawCaption(c, now) {
    const { g, W, H } = this;
    const t = (now - c.start) / c.dur;
    if (t > 1) return;
    const s = c.pop ? easeOutBack(clamp01(t * 4)) : 1;
    const a = t < 0.8 ? 1 : (1 - t) / 0.2;
    g.save();
    g.globalAlpha = a;
    g.translate(W / 2, c.y ?? H * 0.47);
    g.scale(s, s);
    g.font = `900 ${c.size || 40}px system-ui, sans-serif`;
    const fit = Math.min(1, (W - 28) / (g.measureText(c.text).width + 10));
    g.scale(fit, fit);
    g.textAlign = 'center';
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(20,20,40,0.55)';
    g.lineWidth = 8;
    g.strokeText(c.text, 0, 0);
    g.fillStyle = c.color || '#fff';
    g.fillText(c.text, 0, 0);
    if (c.sub) {
      g.font = '800 15px system-ui, sans-serif';
      g.lineWidth = 5;
      g.strokeText(c.sub, 0, 28);
      g.fillStyle = '#fff';
      g.fillText(c.sub, 0, 28);
    }
    g.restore();
  }

  drawFlyers() {
    const { g } = this;
    for (const f of this.flyers) {
      if (f.t < 0) continue;
      const t = easeOut(clamp01(f.t / f.dur));
      const x = f.from.x + (f.to.x - f.from.x) * t;
      const y = f.from.y + (f.to.y - f.from.y) * t - Math.sin(Math.PI * t) * 60;
      drawIcon(g, f.kind, f.id, x, y, f.size * (1 + Math.sin(Math.PI * t) * 0.3));
    }
  }

  drawParticles() {
    const { g } = this;
    for (const p of this.fx) {
      g.globalAlpha = clamp01(p.life / p.max);
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(p.x, p.y, p.size, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  drawFloaters() {
    const { g } = this;
    for (const f of this.floaters) {
      const t = 1 - f.life / f.max;
      g.globalAlpha = clamp01((f.life / f.max) * 2);
      g.font = `900 ${f.size}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.lineWidth = Math.max(4, f.size * 0.25);
      g.strokeStyle = 'rgba(20,20,40,0.75)';
      g.strokeText(f.text, f.x, f.y - easeOut(t) * 36);
      g.fillStyle = f.color;
      g.fillText(f.text, f.x, f.y - easeOut(t) * 36);
    }
    g.globalAlpha = 1;
  }
}
