// Canvas renderer: plain shapes only. The Oracle is an eye, you are a square, shards are diamonds.
// All layout is derived from a portrait "column" so the game reads the same on phones and desktops.

const TAU = Math.PI * 2;
const COLORS = {
  bg: '#07070d',
  lane: 'rgba(255,255,255,0.055)',
  text: '#ecebf5',
  dim: '#8b8aa3',
  player: '#f2f7ff',
  glow: '#7fe3ff',
  shard: '#ffd34d',
  read: '#ff3d5a',
  dodge: '#46f0a0',
};
export { COLORS };

const reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex, a) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

export class Renderer {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.particles = [];
    this.floaters = [];
    this.beams = [];
    this.shake = 0;
    this.flash = 0;
    this.flashColor = '#fff';
    this.playerX = null;
    this.pupilX = 0;
    this.barShown = 50;
    this.crackFx = 0;
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.c.width = Math.round(w * dpr);
    this.c.height = Math.round(h * dpr);
    this.c.style.width = `${w}px`;
    this.c.style.height = `${h}px`;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w;
    this.H = h;
    const colW = Math.min(w, 520);
    const L = {
      colX: (w - colW) / 2,
      colW,
      hudY: Math.max(18, h * 0.035),
      barY: h * 0.095,
      eyeY: h * 0.225,
      eyeR: Math.min(colW * 0.17, h * 0.085),
      laneTop: h * 0.33,
      rowY: h * 0.8,
    };
    L.laneW = colW / 3;
    L.size = Math.min(L.laneW * 0.34, h * 0.06);
    this.L = L;
  }

  laneCenter(i) {
    return this.L.colX + this.L.laneW * (i + 0.5);
  }

  laneAt(x) {
    const i = Math.floor((x - this.L.colX) / this.L.laneW);
    return Math.max(0, Math.min(2, i));
  }

  // ---------- effects ----------
  burst(x, y, color, n = 16, speed = 260, life = 0.6) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.35 + Math.random() * 0.65);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size: 2 + Math.random() * 3 });
    }
  }

  floater(text, x, y, color, size = 16, life = 0.9, rise = 40) {
    this.floaters.push({ text, x, y, color, size, life, max: life, rise });
  }

  beam(lane, color, hit) {
    this.beams.push({ lane, color, hit, life: 0.38, max: 0.38 });
  }

  doShake(px) {
    if (!reduceMotion) this.shake = Math.max(this.shake, px);
  }

  doFlash(color, amount = 0.5) {
    this.flashColor = color;
    this.flash = Math.max(this.flash, amount);
  }

  update(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy = p.vy * 0.92 + 240 * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const f of this.floaters) f.life -= dt;
    this.floaters = this.floaters.filter((f) => f.life > 0);
    for (const b of this.beams) b.life -= dt;
    this.beams = this.beams.filter((b) => b.life > 0);
    this.shake = Math.max(0, this.shake - dt * 60);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.crackFx = Math.max(0, this.crackFx - dt);
  }

  // ---------- main frame ----------
  // view: { oracle:{name,color,level}, bar, lane, beat:{progress, calibration, shardLane, confidence, double},
  //         score, streak, multiplier, eyeState:{cracks, dead, spawn}, caption, speech, mode, now }
  draw(view, dt) {
    const { g, W, H, L } = this;
    this.update(dt);
    g.save();
    g.fillStyle = COLORS.bg;
    g.fillRect(0, 0, W, H);
    if (this.shake > 0) g.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);

    this.drawBackdrop(view);
    if (view.playing) {
      this.drawLanes(view);
      this.drawSweep(view);
      this.drawBeams();
      this.drawShard(view);
      this.drawPlayer(view, dt);
    }
    this.drawEye(view, dt);
    if (view.playing) this.drawHud(view, dt);
    this.drawParticles();
    this.drawFloaters();
    if (view.caption) this.drawCaption(view.caption);
    g.restore();

    if (this.flash > 0) {
      g.fillStyle = rgba(this.flashColor, this.flash * 0.35);
      g.fillRect(0, 0, W, H);
    }
  }

  drawBackdrop(view) {
    const { g, W, H, L } = this;
    const col = view.oracle?.color || '#9d8cff';
    const grd = g.createRadialGradient(W / 2, L.eyeY, 10, W / 2, L.eyeY, Math.max(W, H) * 0.8);
    grd.addColorStop(0, rgba(col, 0.13));
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    // faint scanlines
    g.fillStyle = 'rgba(255,255,255,0.018)';
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
  }

  drawLanes(view) {
    const { g, L } = this;
    g.strokeStyle = COLORS.lane;
    g.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      const x = L.colX + L.laneW * i;
      g.beginPath();
      g.moveTo(x, L.laneTop);
      g.lineTo(x, this.H - 8);
      g.stroke();
    }
    // lane key hints under the row
    g.fillStyle = 'rgba(255,255,255,0.16)';
    g.font = '600 12px ui-monospace, Menlo, Consolas, monospace';
    g.textAlign = 'center';
    const keys = ['A', 'S', 'D'];
    for (let i = 0; i < 3; i++) g.fillText(keys[i], this.laneCenter(i), L.rowY + L.size + 26);
  }

  drawSweep(view) {
    const b = view.beat;
    if (!b) return;
    const { g, L } = this;
    const y0 = L.eyeY + L.eyeR + 6;
    const y = lerp(y0, L.rowY, clamp01(b.progress));
    const col = b.calibration ? '#8b8aa3' : view.oracle.color;
    g.strokeStyle = rgba(col, 0.25 + 0.55 * b.progress);
    g.lineWidth = 2;
    g.setLineDash([6, 8]);
    g.beginPath();
    g.moveTo(L.colX + 6, y);
    g.lineTo(L.colX + L.colW - 6, y);
    g.stroke();
    g.setLineDash([]);
    // lock marker at the player row
    g.strokeStyle = rgba(col, 0.35);
    g.beginPath();
    g.moveTo(L.colX + 6, L.rowY);
    g.lineTo(L.colX + L.colW - 6, L.rowY);
    g.stroke();
  }

  drawBeams() {
    const { g, L } = this;
    for (const b of this.beams) {
      const t = b.life / b.max;
      const x = this.laneCenter(b.lane);
      const w = L.laneW * (0.25 + 0.55 * t);
      const grd = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
      grd.addColorStop(0, rgba(b.color, 0));
      grd.addColorStop(0.5, rgba(b.hit ? '#ffffff' : b.color, 0.85 * t));
      grd.addColorStop(1, rgba(b.color, 0));
      g.fillStyle = grd;
      g.fillRect(x - w / 2, L.eyeY + L.eyeR * 0.6, w, this.H);
    }
  }

  drawShard(view) {
    const b = view.beat;
    if (!b || b.shardLane == null || b.shardTaken) return;
    const { g, L } = this;
    const x = this.laneCenter(b.shardLane);
    const y = L.rowY;
    const s = L.size * (0.5 + 0.06 * Math.sin(view.now / 90));
    g.save();
    g.translate(x, y);
    g.rotate(Math.PI / 4);
    g.shadowColor = COLORS.shard;
    g.shadowBlur = 18;
    g.fillStyle = COLORS.shard;
    g.fillRect(-s / 2, -s / 2, s, s);
    g.restore();
  }

  drawPlayer(view, dt) {
    const { g, L } = this;
    const target = this.laneCenter(view.lane);
    if (this.playerX == null) this.playerX = target;
    this.playerX = lerp(this.playerX, target, 1 - Math.pow(0.0001, dt * 6));
    const s = L.size;
    const hurt = view.hurt > 0;
    g.save();
    g.shadowColor = hurt ? COLORS.read : COLORS.glow;
    g.shadowBlur = 22;
    g.fillStyle = hurt ? COLORS.read : COLORS.player;
    g.fillRect(this.playerX - s / 2, L.rowY - s / 2, s, s);
    g.restore();
    // streak ring
    if (view.streak >= 4) {
      g.strokeStyle = rgba(COLORS.dodge, Math.min(0.9, 0.25 + view.streak * 0.05));
      g.lineWidth = 2;
      g.strokeRect(this.playerX - s / 2 - 7, L.rowY - s / 2 - 7, s + 14, s + 14);
    }
  }

  drawEye(view, dt) {
    const { g, L } = this;
    const o = view.oracle || { color: '#9d8cff', name: '' };
    const es = view.eyeState || {};
    const x = this.W / 2;
    const y = L.eyeY;
    const spawn = es.spawn == null ? 1 : easeOut(clamp01(es.spawn));
    const r = L.eyeR * (0.6 + 0.4 * spawn) * (es.dead ? 1 + (1 - clamp01(es.deadT)) * 0.1 : 1);
    if (es.hidden) return;
    const alpha = es.dead ? clamp01(es.deadT) : spawn;
    const conf = view.beat && !view.beat.calibration ? view.beat.confidence || 0 : 0;

    g.save();
    g.globalAlpha = alpha;
    // certainty gauge
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(x, y, r + 12, Math.PI * 0.75, Math.PI * 2.25);
    g.stroke();
    if (conf > 0) {
      g.strokeStyle = rgba(o.color, 0.4 + 0.6 * conf);
      g.beginPath();
      g.arc(x, y, r + 12, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * conf);
      g.stroke();
    }

    // sclera with blink at beat start
    const blink = view.beat ? Math.max(0, 1 - view.beat.progress * 7) : 0;
    const open = 1 - 0.85 * Math.sin(Math.PI * clamp01(blink));
    g.shadowColor = o.color;
    g.shadowBlur = 30 + conf * 30;
    g.fillStyle = '#10101a';
    g.beginPath();
    g.ellipse(x, y, r, r * open, 0, 0, TAU);
    g.fill();
    g.shadowBlur = 0;
    g.lineWidth = 3;
    g.strokeStyle = o.color;
    g.stroke();

    // pupil(s) follow the player; two pupils = double strike armed
    const targetPX = view.playing && this.playerX != null ? (this.playerX - x) / (L.colW / 2) : Math.sin(view.now / 1400) * 0.6;
    this.pupilX = lerp(this.pupilX, targetPX, 1 - Math.pow(0.001, dt * 3));
    const px = x + this.pupilX * r * 0.42;
    const ir = r * (0.42 + 0.12 * conf);
    g.save();
    g.beginPath();
    g.ellipse(x, y, r - 2, Math.max(1, (r - 2) * open), 0, 0, TAU);
    g.clip();
    const pupils = view.beat?.double ? [-0.3, 0.3] : [0];
    for (const off of pupils) {
      const cx = px + off * r;
      const grd = g.createRadialGradient(cx, y, ir * 0.1, cx, y, ir);
      grd.addColorStop(0, '#ffffff');
      grd.addColorStop(0.25, o.color);
      grd.addColorStop(1, rgba(o.color, 0.15));
      g.fillStyle = grd;
      g.beginPath();
      g.arc(cx, y, ir, 0, TAU);
      g.fill();
      g.fillStyle = '#05050a';
      g.beginPath();
      g.arc(cx, y, ir * (0.38 - 0.1 * conf), 0, TAU);
      g.fill();
    }
    g.restore();

    // cracks appear as you push the Mind Bar toward 100
    const cracks = es.cracks || 0;
    if (cracks > 0) {
      g.strokeStyle = `rgba(255,255,255,${0.35 + 0.5 * cracks})`;
      g.lineWidth = 1.5;
      const n = Math.ceil(cracks * 7);
      for (let i = 0; i < n; i++) {
        const a = (i / 7) * TAU + 0.6;
        g.beginPath();
        g.moveTo(x + Math.cos(a) * r * 0.25, y + Math.sin(a) * r * 0.25);
        g.lineTo(x + Math.cos(a + 0.18) * r * 0.62, y + Math.sin(a + 0.18) * r * 0.62);
        g.lineTo(x + Math.cos(a - 0.05) * r * 1.02, y + Math.sin(a - 0.05) * r * 1.02);
        g.stroke();
      }
    }
    g.restore();
  }

  drawHud(view, dt) {
    const { g, L } = this;
    const o = view.oracle;
    // score + streak
    g.textAlign = 'left';
    g.fillStyle = COLORS.text;
    g.font = '700 20px ui-monospace, Menlo, Consolas, monospace';
    g.fillText(String(view.score), L.colX + 14, L.hudY + 12);
    g.textAlign = 'right';
    if (view.multiplier > 1) {
      g.fillStyle = COLORS.dodge;
      g.fillText(`x${view.multiplier}`, L.colX + L.colW - 14, L.hudY + 12);
    }
    g.textAlign = 'center';
    g.fillStyle = o.color;
    g.font = '800 13px system-ui, sans-serif';
    const roman = ['I', 'II', 'III', 'IV', 'V'][o.level] || '∞';
    g.fillText(`${roman} · ${o.name}${view.mode === 'daily' ? ' · DAILY' : ''}`, this.W / 2, L.hudY + 10);

    // Mind Bar (tug of war): push the marker right to crack the Oracle.
    this.barShown = lerp(this.barShown, view.bar, 1 - Math.pow(0.001, dt * 4));
    const bx = L.colX + 26;
    const bw = L.colW - 52;
    const by = L.barY;
    const bh = 10;
    const mx = bx + (bw * this.barShown) / 100;
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(bx, by, bw, bh);
    g.fillStyle = rgba(COLORS.glow, 0.85);
    g.fillRect(bx, by, mx - bx, bh);
    g.fillStyle = rgba(o.color, 0.35);
    g.fillRect(mx, by, bx + bw - mx, bh);
    g.fillStyle = '#fff';
    g.fillRect(mx - 2, by - 5, 4, bh + 10);
    g.font = '700 10px system-ui, sans-serif';
    g.fillStyle = COLORS.dim;
    g.textAlign = 'left';
    g.fillText('SOLVED', bx, by + bh + 14);
    g.textAlign = 'right';
    g.fillText('CRACK ▶', bx + bw, by + bh + 14);
    g.textAlign = 'center';
    g.fillText('MIND', this.W / 2, by + bh + 14);

    // speech bubble under the eye
    if (view.speech) {
      g.font = 'italic 500 14px system-ui, sans-serif';
      g.fillStyle = rgba(o.color, Math.min(1, view.speech.alpha));
      this.wrapText(`“${view.speech.text}”`, this.W / 2, L.eyeY + L.eyeR + 34, L.colW - 40, 18);
    }

    // explanation / tutorial line near the bottom
    if (view.note) {
      g.font = `${view.note.bold ? 700 : 500} 14px system-ui, sans-serif`;
      g.fillStyle = rgba(view.note.color || COLORS.text, Math.min(1, view.note.alpha));
      this.wrapText(view.note.text, this.W / 2, L.rowY - L.size - 30, L.colW - 36, 18, true);
    }
  }

  wrapText(text, x, y, maxW, lh, upward = false) {
    const { g } = this;
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (g.measureText(t).width > maxW && line) {
        lines.push(line);
        line = w;
      } else line = t;
    }
    if (line) lines.push(line);
    g.textAlign = 'center';
    const start = upward ? y - (lines.length - 1) * lh : y;
    lines.forEach((l, i) => g.fillText(l, x, start + i * lh));
  }

  drawCaption(c) {
    const { g } = this;
    const t = clamp01(c.t);
    const scale = c.pop ? 1 + 0.35 * Math.max(0, 1 - t * 4) : 1;
    g.save();
    g.translate(this.W / 2, c.y ?? this.H * 0.56);
    g.scale(scale, scale);
    g.textAlign = 'center';
    g.globalAlpha = Math.min(1, c.alpha ?? 1);
    g.shadowColor = c.color;
    g.shadowBlur = 24;
    g.fillStyle = c.color;
    g.font = `900 ${c.size || 44}px system-ui, sans-serif`;
    g.fillText(c.text, 0, 0);
    if (c.sub) {
      g.shadowBlur = 0;
      g.font = '600 15px system-ui, sans-serif';
      g.fillStyle = COLORS.text;
      this.wrapText(c.sub, 0, 32, (this.L.colW - 40) / scale, 19);
    }
    g.restore();
  }

  drawParticles() {
    const { g } = this;
    for (const p of this.particles) {
      g.globalAlpha = clamp01(p.life / p.max);
      g.fillStyle = p.color;
      g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    g.globalAlpha = 1;
  }

  drawFloaters() {
    const { g } = this;
    for (const f of this.floaters) {
      const t = 1 - f.life / f.max;
      g.globalAlpha = clamp01(f.life / f.max * 1.5);
      g.fillStyle = f.color;
      g.font = `800 ${f.size}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillText(f.text, f.x, f.y - f.rise * easeOut(t));
    }
    g.globalAlpha = 1;
  }
}
