// Tiny WebAudio synth: every sound is generated, so the prototype ships with zero audio files.

let ctx = null;
let master = null;
let enabled = true;
let noiseBuf = null;

export function setSound(on) {
  enabled = on;
  if (master) master.gain.value = on ? 0.5 : 0;
}

// Browsers only allow audio after a user gesture; call from the first tap or keypress.
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.5 : 0;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function tone({ f = 440, f2 = null, type = 'sine', dur = 0.12, vol = 0.25, at = 0, attack = 0.005 }) {
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

function noise({ dur = 0.15, vol = 0.2, freq = 1500, type = 'lowpass', q = 0.7, at = 0 }) {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime + at;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t);
  s.stop(t + dur + 0.02);
}

const PITCH = { wood: 392, stone: 330, ore: 294, sand: 440, fiber: 494, crystal: 659 };
const note = (base, semis) => base * Math.pow(2, semis / 12);

export const sfx = {
  tap() {
    tone({ f: 700, type: 'triangle', dur: 0.04, vol: 0.06 });
  },
  gather(res) {
    const f = PITCH[res] || 440;
    noise({ dur: 0.06, vol: 0.12, freq: 2500, type: 'bandpass' });
    tone({ f, type: 'triangle', dur: 0.12, vol: 0.18 });
    tone({ f: note(f, 7), type: 'sine', dur: 0.14, vol: 0.1, at: 0.05 });
  },
  rivalGather() {
    tone({ f: 260, type: 'triangle', dur: 0.08, vol: 0.06 });
  },
  deposit() {
    tone({ f: 180, f2: 120, type: 'sine', dur: 0.14, vol: 0.25 });
    noise({ dur: 0.08, vol: 0.1, freq: 600 });
  },
  craft() {
    tone({ f: 784, type: 'triangle', dur: 0.12, vol: 0.14 });
    tone({ f: 1175, type: 'triangle', dur: 0.2, vol: 0.12, at: 0.07 });
  },
  complete() {
    [523, 659, 784, 1047].forEach((f, i) => tone({ f, type: 'triangle', dur: 0.22, vol: 0.16, at: i * 0.08 }));
    noise({ dur: 0.5, vol: 0.06, freq: 6000, type: 'highpass', at: 0.2 });
  },
  rivalComplete() {
    [440, 392, 330].forEach((f, i) => tone({ f, type: 'sawtooth', dur: 0.18, vol: 0.07, at: i * 0.1 }));
  },
  snatch() {
    tone({ f: 520, f2: 180, type: 'square', dur: 0.2, vol: 0.09 });
    noise({ dur: 0.12, vol: 0.12, freq: 900 });
  },
  outread() {
    noise({ dur: 0.18, vol: 0.1, freq: 3000, type: 'bandpass' });
    tone({ f: 880, f2: 1320, type: 'sine', dur: 0.16, vol: 0.14, at: 0.05 });
  },
  order() {
    tone({ f: 988, type: 'sine', dur: 0.5, vol: 0.12 });
    tone({ f: 1480, type: 'sine', dur: 0.4, vol: 0.06, at: 0.02 });
  },
  go() {
    tone({ f: 600, f2: 1200, type: 'triangle', dur: 0.18, vol: 0.14 });
  },
  win() {
    [523, 659, 784, 659, 784, 1047].forEach((f, i) => tone({ f, type: 'triangle', dur: 0.2, vol: 0.15, at: i * 0.11 }));
  },
  lose() {
    [392, 370, 330, 262].forEach((f, i) => tone({ f, type: 'triangle', dur: 0.26, vol: 0.12, at: i * 0.16 }));
  },
  ui() {
    tone({ f: 880, type: 'triangle', dur: 0.05, vol: 0.07 });
  },
};

// ---------------------------------------------------------------- music
// A small procedural loop (C - G - Am - F): bass, plucked arpeggio, soft pad, and a shaker during races.
// Scheduled slightly ahead on the audio clock so it never drifts.
const BPM = 104;
const EIGHTH = 60 / BPM / 2;
const CHORDS = [
  [261.63, 329.63, 392.0],
  [196.0, 246.94, 293.66],
  [220.0, 261.63, 329.63],
  [174.61, 220.0, 261.63],
];
const ARP = [0, 1, 2, 1, 0, 2, 1, 2];
const MASK = [1, 0, 1, 1, 0, 1, 1, 0];
let music = null;
let musicGain = null;
let intensity = 0;

function mtone(f, t, dur, vol, type = 'triangle', attack = 0.01) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(musicGain);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function scheduleStep(step, t) {
  const bar = Math.floor(step / 8) % 4;
  const i = step % 8;
  const chord = CHORDS[bar];
  if (i === 0) {
    chord.forEach((f) => mtone(f, t, EIGHTH * 8, 0.018, 'sine', 0.4));
    mtone(chord[0] / 2, t, 0.45, 0.07, 'sine');
  }
  if (i === 4) mtone(chord[0] / 2, t, 0.35, 0.05, 'sine');
  if (MASK[i]) mtone(chord[ARP[i]] * 2, t, 0.22, 0.03 + intensity * 0.01, 'triangle');
  if (intensity > 0 && (i === 2 || i === 6)) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.02 * intensity, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    s.connect(f).connect(g).connect(musicGain);
    s.start(t);
    s.stop(t + 0.06);
  }
}

export function startMusic() {
  if (!ctx || music) return;
  musicGain = ctx.createGain();
  musicGain.gain.value = 0.9;
  musicGain.connect(master);
  music = { next: ctx.currentTime + 0.15, step: 0 };
  music.timer = setInterval(() => {
    if (!ctx || ctx.state !== 'running') return;
    // After a background stall, skip ahead instead of firing a backlog of notes at once.
    if (music.next < ctx.currentTime - 0.1) music.next = ctx.currentTime + 0.05;
    while (music.next < ctx.currentTime + 0.35) {
      scheduleStep(music.step, music.next);
      music.next += EIGHTH;
      music.step++;
    }
  }, 90);
}

export function setIntensity(v) {
  intensity = v;
}

// Short vibrations on phones that support it (ignored elsewhere).
export function buzz(pattern) {
  if (enabled && navigator.vibrate && matchMedia('(pointer: coarse)').matches) navigator.vibrate(pattern);
}

// Silence everything while the game is paused or the tab is hidden.
export function suspendAudio(on) {
  if (!ctx) return;
  if (on && ctx.state === 'running') ctx.suspend();
  else if (!on && ctx.state === 'suspended') ctx.resume();
}
