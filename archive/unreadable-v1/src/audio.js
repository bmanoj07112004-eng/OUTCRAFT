// Tiny WebAudio synth: every sound is generated, so the prototype ships with zero audio files.

let ctx = null;
let master = null;
let enabled = true;
let noiseBuf = null;

export function setSound(on) {
  enabled = on;
  if (master) master.gain.value = on ? 0.55 : 0;
}

// Browsers only allow audio after a user gesture; call this from the first tap/keypress.
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.55 : 0;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function tone({ f = 440, f2 = null, type = 'sine', dur = 0.12, vol = 0.3, at = 0, attack = 0.004 }) {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise({ dur = 0.2, vol = 0.3, freq = 1200, q = 0.8, type = 'lowpass', at = 0 }) {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const filt = ctx.createBiquadFilter();
  filt.type = type;
  filt.frequency.value = freq;
  filt.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filt).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

export const sfx = {
  tick(strong) {
    tone({ f: strong ? 660 : 520, type: 'triangle', dur: 0.05, vol: strong ? 0.12 : 0.07 });
  },
  move() {
    tone({ f: 300, f2: 380, type: 'sine', dur: 0.05, vol: 0.05 });
  },
  read() {
    noise({ dur: 0.28, vol: 0.5, freq: 900 });
    tone({ f: 190, f2: 50, type: 'sawtooth', dur: 0.32, vol: 0.28 });
  },
  dodge(streak) {
    const base = 620 + Math.min(streak, 12) * 35;
    tone({ f: base, f2: base * 1.6, type: 'sine', dur: 0.09, vol: 0.12 });
    noise({ dur: 0.08, vol: 0.06, freq: 4000, type: 'highpass' });
  },
  shard() {
    tone({ f: 1320, type: 'triangle', dur: 0.09, vol: 0.14 });
    tone({ f: 1760, type: 'triangle', dur: 0.14, vol: 0.12, at: 0.06 });
  },
  crack() {
    noise({ dur: 0.9, vol: 0.45, freq: 2500, type: 'bandpass', q: 0.6 });
    [1760, 1320, 990, 740, 555].forEach((f, i) => tone({ f, type: 'triangle', dur: 0.25, vol: 0.12, at: i * 0.07 }));
  },
  intro() {
    tone({ f: 110, f2: 165, type: 'sawtooth', dur: 0.9, vol: 0.1, attack: 0.2 });
    tone({ f: 220, f2: 330, type: 'sine', dur: 0.9, vol: 0.08, attack: 0.2 });
  },
  over() {
    tone({ f: 330, f2: 60, type: 'sawtooth', dur: 1.1, vol: 0.22 });
    noise({ dur: 1.0, vol: 0.2, freq: 400 });
  },
  ui() {
    tone({ f: 880, type: 'triangle', dur: 0.05, vol: 0.08 });
  },
};
