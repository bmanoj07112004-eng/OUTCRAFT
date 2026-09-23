// Procedural icon art: every resource, component and item is drawn from plain shapes in one flat,
// consistent style (no image files). Icons are designed in a 100x100 box centred on (0,0).

const TAU = Math.PI * 2;

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function circle(g, x, y, r) {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
}
function poly(g, pts) {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
}
function fill(g, c) {
  g.fillStyle = c;
  g.fill();
}
function stroke(g, c, w) {
  g.strokeStyle = c;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.stroke();
}

const OUT = '#3a2e2a';

const RES_ART = {
  wood(g) {
    rr(g, -38, -16, 76, 32, 14);
    fill(g, '#a8683a');
    stroke(g, OUT, 5);
    circle(g, 26, 0, 13);
    fill(g, '#e6b47e');
    stroke(g, OUT, 4);
    circle(g, 26, 0, 5);
    stroke(g, '#a8683a', 3);
    g.beginPath();
    g.moveTo(-26, -5);
    g.lineTo(6, -5);
    g.moveTo(-18, 6);
    g.lineTo(8, 6);
    stroke(g, '#7c4a26', 3.5);
  },
  stone(g) {
    poly(g, [-36, 14, -28, -16, -4, -30, 26, -22, 38, 6, 22, 28, -16, 30]);
    fill(g, '#a9b2c0');
    stroke(g, OUT, 5);
    poly(g, [-20, -10, -4, -20, 14, -14, 4, -4]);
    fill(g, '#d7dde6');
  },
  ore(g) {
    poly(g, [-36, 12, -26, -20, 2, -32, 30, -18, 38, 10, 18, 30, -18, 30]);
    fill(g, '#6b5a53');
    stroke(g, OUT, 5);
    for (const [x, y, r] of [[-12, -8, 8], [14, 4, 9], [-4, 16, 6], [20, -16, 5]]) {
      circle(g, x, y, r);
      fill(g, '#ff8a3d');
      circle(g, x - r * 0.3, y - r * 0.3, r * 0.35);
      fill(g, '#ffd08a');
    }
  },
  sand(g) {
    g.beginPath();
    g.moveTo(-40, 24);
    g.quadraticCurveTo(-20, -30, 0, -30);
    g.quadraticCurveTo(20, -30, 40, 24);
    g.closePath();
    fill(g, '#f0c96e');
    stroke(g, OUT, 5);
    for (const [x, y] of [[-12, 4], [6, -8], [14, 10], [-2, 14], [-20, 16]]) {
      circle(g, x, y, 2.6);
      fill(g, '#c9993f');
    }
  },
  fiber(g) {
    for (const [x, c] of [[-16, '#6fae44'], [0, '#8fd05a'], [16, '#6fae44']]) {
      g.beginPath();
      g.moveTo(x * 0.4, 32);
      g.quadraticCurveTo(x * 1.2, 0, x * 1.6, -34);
      stroke(g, OUT, 11);
      g.beginPath();
      g.moveTo(x * 0.4, 32);
      g.quadraticCurveTo(x * 1.2, 0, x * 1.6, -34);
      stroke(g, c, 6);
    }
    rr(g, -16, 6, 32, 10, 4);
    fill(g, '#d9a55a');
    stroke(g, OUT, 3.5);
  },
  crystal(g) {
    poly(g, [0, -40, 22, -8, 12, 34, -12, 34, -22, -8]);
    fill(g, '#39c2f0');
    stroke(g, OUT, 5);
    poly(g, [0, -40, 8, -8, 0, 34, -12, 34, -22, -8]);
    fill(g, '#8fe3ff');
    poly(g, [-22, -8, 22, -8, 8, -8]);
    stroke(g, '#1b87b3', 2.5);
  },
};

const COMP_ART = {
  plank(g) {
    rr(g, -40, -14, 80, 28, 6);
    fill(g, '#dfae72');
    stroke(g, OUT, 5);
    g.beginPath();
    g.moveTo(-30, -3);
    g.bezierCurveTo(-10, -8, 10, 2, 30, -3);
    g.moveTo(-28, 6);
    g.bezierCurveTo(-6, 2, 12, 10, 28, 5);
    stroke(g, '#b07c43', 3);
  },
  glass(g) {
    rr(g, -30, -30, 60, 60, 8);
    fill(g, 'rgba(160,225,255,0.85)');
    stroke(g, OUT, 5);
    g.beginPath();
    g.moveTo(-18, 8);
    g.lineTo(8, -18);
    g.moveTo(-10, 18);
    g.lineTo(18, -10);
    stroke(g, '#ffffff', 5);
  },
  iron(g) {
    poly(g, [-38, 18, -26, -14, 26, -14, 38, 18]);
    fill(g, '#9aa6b5');
    stroke(g, OUT, 5);
    poly(g, [-26, -14, 26, -14, 20, -4, -20, -4]);
    fill(g, '#d5dde8');
  },
  rope(g) {
    circle(g, 0, 0, 32);
    fill(g, '#d6a863');
    stroke(g, OUT, 5);
    circle(g, 0, 0, 20);
    stroke(g, '#a9773a', 4);
    circle(g, 0, 0, 9);
    fill(g, '#7a5530');
  },
  lens(g) {
    circle(g, 0, 0, 32);
    fill(g, '#c9a24a');
    stroke(g, OUT, 5);
    circle(g, 0, 0, 23);
    fill(g, 'rgba(170,230,255,0.95)');
    g.beginPath();
    g.arc(-4, -4, 13, Math.PI * 1.05, Math.PI * 1.55);
    stroke(g, '#fff', 5);
  },
  block(g) {
    poly(g, [-30, -14, 0, -30, 30, -14, 0, 2]);
    fill(g, '#d4d9e2');
    stroke(g, OUT, 4.5);
    poly(g, [-30, -14, 0, 2, 0, 34, -30, 18]);
    fill(g, '#a5adbb');
    stroke(g, OUT, 4.5);
    poly(g, [30, -14, 0, 2, 0, 34, 30, 18]);
    fill(g, '#8a93a3');
    stroke(g, OUT, 4.5);
  },
  gem(g) {
    poly(g, [-26, -12, -12, -28, 12, -28, 26, -12, 0, 32]);
    fill(g, '#5ad1ff');
    stroke(g, OUT, 5);
    poly(g, [-26, -12, 26, -12, 0, 32]);
    fill(g, '#27a8de');
    poly(g, [-12, -28, 0, -12, 12, -28]);
    fill(g, '#b9efff');
  },
};

const ITEM_ART = {
  torch(g) {
    poly(g, [-8, -6, 8, -6, 5, 42, -5, 42]);
    fill(g, '#a8683a');
    stroke(g, OUT, 5);
    rr(g, -12, -12, 24, 10, 3);
    fill(g, '#d6a863');
    stroke(g, OUT, 4);
    g.beginPath();
    g.moveTo(0, -46);
    g.quadraticCurveTo(22, -24, 10, -14);
    g.lineTo(-10, -14);
    g.quadraticCurveTo(-22, -24, 0, -46);
    fill(g, '#ff8a3d');
    stroke(g, OUT, 4);
    g.beginPath();
    g.moveTo(0, -32);
    g.quadraticCurveTo(10, -22, 4, -16);
    g.lineTo(-4, -16);
    g.quadraticCurveTo(-10, -22, 0, -32);
    fill(g, '#ffe066');
  },
  shovel(g) {
    g.save();
    g.rotate(-0.6);
    rr(g, -5, -46, 10, 58, 4);
    fill(g, '#a8683a');
    stroke(g, OUT, 4.5);
    rr(g, -12, -50, 24, 8, 4);
    fill(g, '#a8683a');
    stroke(g, OUT, 4);
    g.beginPath();
    g.moveTo(-18, 10);
    g.lineTo(18, 10);
    g.lineTo(14, 36);
    g.quadraticCurveTo(0, 50, -14, 36);
    g.closePath();
    fill(g, '#b9c3d0');
    stroke(g, OUT, 5);
    g.restore();
  },
  lantern(g) {
    circle(g, 0, -38, 9);
    stroke(g, OUT, 5);
    rr(g, -24, -30, 48, 10, 4);
    fill(g, '#4b4f5c');
    stroke(g, OUT, 4);
    rr(g, -20, -20, 40, 44, 6);
    fill(g, '#ffe38a');
    stroke(g, OUT, 5);
    circle(g, 0, 2, 9);
    fill(g, '#ff9d3d');
    g.beginPath();
    g.moveTo(-7, -20);
    g.lineTo(-7, 24);
    g.moveTo(7, -20);
    g.lineTo(7, 24);
    stroke(g, '#4b4f5c', 3.5);
    rr(g, -24, 24, 48, 10, 4);
    fill(g, '#4b4f5c');
    stroke(g, OUT, 4);
  },
  anvil(g) {
    g.beginPath();
    g.moveTo(-42, -18);
    g.lineTo(30, -18);
    g.quadraticCurveTo(44, -18, 44, -8);
    g.lineTo(18, -4);
    g.lineTo(12, 12);
    g.lineTo(-12, 12);
    g.lineTo(-18, -4);
    g.quadraticCurveTo(-34, -6, -42, -18);
    g.closePath();
    fill(g, '#5b6272');
    stroke(g, OUT, 5);
    rr(g, -24, 12, 48, 14, 4);
    fill(g, '#454b59');
    stroke(g, OUT, 5);
    rr(g, -30, -18, 50, 6, 3);
    fill(g, '#8a93a3');
  },
  ring(g) {
    circle(g, 0, 8, 28);
    stroke(g, OUT, 16);
    circle(g, 0, 8, 28);
    stroke(g, '#ffc83d', 9);
    poly(g, [-14, -24, -6, -38, 6, -38, 14, -24, 0, -12]);
    fill(g, '#5ad1ff');
    stroke(g, OUT, 4.5);
  },
  rod(g) {
    g.beginPath();
    g.moveTo(-38, 40);
    g.lineTo(34, -40);
    stroke(g, OUT, 10);
    g.beginPath();
    g.moveTo(-38, 40);
    g.lineTo(34, -40);
    stroke(g, '#a8683a', 5);
    circle(g, -20, 20, 9);
    fill(g, '#9aa6b5');
    stroke(g, OUT, 4);
    g.beginPath();
    g.moveTo(34, -40);
    g.quadraticCurveTo(40, 0, 30, 20);
    stroke(g, '#f5f5f5', 2.5);
    g.beginPath();
    g.arc(26, 22, 6, 0, Math.PI);
    stroke(g, OUT, 4);
  },
  hourglass(g) {
    rr(g, -30, -44, 60, 10, 4);
    fill(g, '#a8683a');
    stroke(g, OUT, 4.5);
    rr(g, -30, 34, 60, 10, 4);
    fill(g, '#a8683a');
    stroke(g, OUT, 4.5);
    poly(g, [-22, -34, 22, -34, 4, 0, 22, 34, -22, 34, -4, 0]);
    fill(g, 'rgba(170,230,255,0.9)');
    stroke(g, OUT, 4.5);
    poly(g, [-14, 34, 14, 34, 0, 16]);
    fill(g, '#f0c96e');
    poly(g, [-8, -20, 8, -20, 2, -8, -2, -8]);
    fill(g, '#f0c96e');
  },
  compass(g) {
    circle(g, 0, 0, 40);
    fill(g, '#c9a24a');
    stroke(g, OUT, 5);
    circle(g, 0, 0, 31);
    fill(g, '#fff7e8');
    poly(g, [0, -26, 8, 0, -8, 0]);
    fill(g, '#ff4d4d');
    poly(g, [0, 26, 8, 0, -8, 0]);
    fill(g, '#5b6272');
    circle(g, 0, 0, 4);
    fill(g, OUT);
  },
  telescope(g) {
    g.save();
    g.rotate(-0.45);
    rr(g, -44, -10, 30, 20, 5);
    fill(g, '#5b6272');
    stroke(g, OUT, 4.5);
    rr(g, -16, -13, 34, 26, 5);
    fill(g, '#c9a24a');
    stroke(g, OUT, 4.5);
    rr(g, 16, -16, 26, 32, 5);
    fill(g, '#5b6272');
    stroke(g, OUT, 4.5);
    circle(g, 42, 0, 12);
    fill(g, '#8fe3ff');
    stroke(g, OUT, 4);
    g.restore();
    g.beginPath();
    g.moveTo(-6, 10);
    g.lineTo(-22, 44);
    g.moveTo(-6, 10);
    g.lineTo(10, 44);
    stroke(g, OUT, 5);
  },
  bell(g) {
    g.beginPath();
    g.moveTo(-34, 26);
    g.quadraticCurveTo(-26, 16, -24, -8);
    g.quadraticCurveTo(-22, -36, 0, -36);
    g.quadraticCurveTo(22, -36, 24, -8);
    g.quadraticCurveTo(26, 16, 34, 26);
    g.closePath();
    fill(g, '#ffc83d');
    stroke(g, OUT, 5);
    circle(g, 0, 34, 8);
    fill(g, '#c9922a');
    stroke(g, OUT, 4);
    circle(g, 0, -40, 6);
    stroke(g, OUT, 4);
    g.beginPath();
    g.moveTo(-14, -20);
    g.quadraticCurveTo(-16, 0, -18, 14);
    stroke(g, '#fff0b3', 5);
  },
  crown(g) {
    poly(g, [-40, 28, -40, -22, -20, 0, 0, -34, 20, 0, 40, -22, 40, 28]);
    fill(g, '#ffc83d');
    stroke(g, OUT, 5);
    rr(g, -40, 16, 80, 12, 3);
    fill(g, '#e0a526');
    for (const [x, c] of [[-22, '#ff4d6d'], [0, '#5ad1ff'], [22, '#78d36a']]) {
      circle(g, x, 6, 6);
      fill(g, c);
      stroke(g, OUT, 3);
    }
  },
  clock(g) {
    circle(g, -26, -30, 11);
    fill(g, '#ffc83d');
    stroke(g, OUT, 4);
    circle(g, 26, -30, 11);
    fill(g, '#ffc83d');
    stroke(g, OUT, 4);
    circle(g, 0, 6, 38);
    fill(g, '#c9a24a');
    stroke(g, OUT, 5);
    circle(g, 0, 6, 29);
    fill(g, '#fff7e8');
    g.beginPath();
    g.moveTo(0, 6);
    g.lineTo(0, -14);
    g.moveTo(0, 6);
    g.lineTo(14, 14);
    stroke(g, OUT, 5);
    circle(g, 0, 6, 4);
    fill(g, '#ff4d4d');
    for (const [dx, dy] of [[-30, 40], [30, 40]]) {
      g.beginPath();
      g.moveTo(dx * 0.6, dy * 0.95);
      g.lineTo(dx, dy + 6);
      stroke(g, OUT, 6);
    }
  },
};

export function drawIcon(g, kind, id, x, y, size, { alpha = 1, silhouette = false } = {}) {
  const art = kind === 'res' ? RES_ART[id] : kind === 'comp' ? COMP_ART[id] : ITEM_ART[id];
  if (!art) return;
  g.save();
  g.globalAlpha *= alpha;
  g.translate(x, y);
  g.scale(size / 100, size / 100);
  if (silhouette) {
    // Draw into the current context, then flatten to one colour with source-atop via an offscreen pass.
    const c = iconCanvas(kind, id, 100);
    g.restore();
    g.save();
    g.globalAlpha *= alpha;
    g.drawImage(silhouetteOf(c), x - size / 2, y - size / 2, size, size);
    g.restore();
    return;
  }
  art(g);
  g.restore();
}

const cache = new Map();
function iconCanvas(kind, id, px) {
  const key = `${kind}:${id}:${px}`;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  const g = c.getContext('2d');
  g.translate(px / 2, px / 2);
  g.scale(px / 110, px / 110);
  const art = kind === 'res' ? RES_ART[id] : kind === 'comp' ? COMP_ART[id] : ITEM_ART[id];
  art(g);
  cache.set(key, c);
  return c;
}

const silCache = new Map();
function silhouetteOf(c) {
  if (silCache.has(c)) return silCache.get(c);
  const s = document.createElement('canvas');
  s.width = c.width;
  s.height = c.height;
  const g = s.getContext('2d');
  g.drawImage(c, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(60,52,70,0.35)';
  g.fillRect(0, 0, s.width, s.height);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = 'rgba(80,70,95,0.55)';
  g.fillRect(0, 0, s.width, s.height);
  silCache.set(c, s);
  return s;
}

// PNG data URL for DOM screens (codex, results).
export function iconURL(kind, id, px = 96, silhouette = false) {
  const c = iconCanvas(kind, id, px);
  return (silhouette ? silhouetteOf(c) : c).toDataURL();
}
