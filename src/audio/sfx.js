// Synthesised one-shot industrial transients (WebAudio, zero assets).
// Hard rules: every sound is a SINGLE short event tied to a physics event —
// no loops, no ambient beds, no periodic/rhythmic patterns, no cute timbres.
// The context is created lazily inside a user gesture (unlock()); every call
// is try/caught so headless or autoplay-blocked environments silently no-op.

let actx = null;
let noiseBuf = null;

/** Call from inside a pointer gesture: creates/resumes the AudioContext. */
export function unlock() {
  try {
    if (!actx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return;
      actx = new AC();
    }
    if (actx.state === 'suspended') {
      const p = actx.resume();
      if (p && p.catch) p.catch(() => {});
    }
  } catch {
    actx = null;
  }
}

function ctx() {
  return actx && actx.state !== 'closed' ? actx : null;
}

/** Shared 0.7 s white-noise buffer, sliced by each transient. */
function noiseSource(c) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.7), c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  return src;
}

function noiseBurst(c, t, { type, freq, q = 1, vol, dur }) {
  const src = noiseSource(c);
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(c.destination);
  src.start(t);
  src.stop(t + dur + 0.05);
}

function tone(c, t, { type = 'sine', f0, f1 = f0, vol, dur, lp = null }) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  let node = o;
  if (lp) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lp;
    o.connect(f); node = f;
  }
  node.connect(g); g.connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

const safe = (fn) => () => {
  const c = ctx();
  if (!c) return;
  try { fn(c, c.currentTime); } catch { /* audio must never break the game */ }
};

export const sfx = {
  /** Air escaping a punctured pressure loop: bandpassed noise, 0.6 s decay. */
  hiss: safe((c, t) => noiseBurst(c, t, { type: 'bandpass', freq: 3200, q: 0.8, vol: 0.5, dur: 0.6 })),

  /** Shears through a pipe: two 30 ms filtered clicks. */
  snip: safe((c, t) => {
    noiseBurst(c, t, { type: 'highpass', freq: 1800, vol: 0.55, dur: 0.03 });
    noiseBurst(c, t + 0.07, { type: 'highpass', freq: 2600, vol: 0.5, dur: 0.03 });
  }),

  /** Severed tension cable letting go: sawtooth sliding 180 -> 120 Hz. */
  twang: safe((c, t) => tone(c, t, { type: 'sawtooth', f0: 180, f1: 120, vol: 0.32, dur: 0.3, lp: 1400 })),

  /** Brittle conduit fracturing: 80 ms high-passed noise crack. */
  crack: safe((c, t) => noiseBurst(c, t, { type: 'highpass', freq: 900, vol: 0.7, dur: 0.08 })),

  /** Instrument confirmation on target completion: two clean sine blips. */
  chime: safe((c, t) => {
    tone(c, t, { f0: 880, vol: 0.22, dur: 0.2 });
    tone(c, t + 0.16, { f0: 1320, vol: 0.2, dur: 0.22 });
  }),

  /** Blade refused (knife must start outside): dull low tick. */
  thud: safe((c, t) => tone(c, t, { f0: 110, f1: 68, vol: 0.4, dur: 0.09, lp: 300 })),
};
