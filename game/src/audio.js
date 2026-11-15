// Procedural sound: every effect is synthesized with WebAudio, so the game
// ships no audio files and makes no network request. The context is created
// on the first user gesture; every call is a no-op until then, which keeps
// the headless screenshot runs silent and error-free.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const length = ctx.sampleRate;
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function noise(duration, filterFreq, gainValue, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(t);
    source.stop(t + duration + 0.02);
  }

  function tone(freq, duration, type, gainValue, slideTo = 0, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  // Distance attenuation: 1 at point blank, ~0.08 at 50 m.
  function attenuate(distance) {
    return Math.max(0.05, 1 / (1 + distance * distance * 0.004));
  }

  return {
    unlock() {
      if (ensure() && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    shot(kind, distance = 0) {
      const a = attenuate(distance);
      if (kind === 'rifle') { noise(0.12, 1800, 0.5 * a); tone(160, 0.09, 'square', 0.22 * a, 60); }
      else if (kind === 'smg') { noise(0.09, 2400, 0.38 * a); tone(210, 0.06, 'square', 0.16 * a, 90); }
      else if (kind === 'shotgun') { noise(0.22, 900, 0.65 * a); tone(110, 0.16, 'square', 0.3 * a, 45); }
      else if (kind === 'sniper') { noise(0.28, 1200, 0.7 * a); tone(90, 0.22, 'sawtooth', 0.3 * a, 40); }
      else { noise(0.1, 2000, 0.42 * a); tone(190, 0.07, 'square', 0.18 * a, 80); }
    },
    dryFire() { tone(1200, 0.03, 'square', 0.08); },
    reload() { tone(900, 0.04, 'square', 0.1); tone(600, 0.04, 'square', 0.12, 0, 0.45); },
    hit(kill) { tone(1400, 0.05, 'sine', 0.16); if (kill) tone(1800, 0.09, 'sine', 0.18, 0, 0.07); },
    hurt() { noise(0.12, 500, 0.3); tone(140, 0.12, 'sawtooth', 0.14, 70); },
    step() { noise(0.05, 700, 0.05); },
    grenadeThrow() { noise(0.08, 1200, 0.12); },
    bounce() { tone(300, 0.05, 'sine', 0.1, 180); },
    explosion(distance = 0) {
      const a = attenuate(distance);
      noise(0.9, 300, 0.9 * a);
      tone(70, 0.7, 'sine', 0.5 * a, 28);
    },
    plantBeep() { tone(880, 0.09, 'square', 0.12); },
    bombTick() { tone(1100, 0.05, 'square', 0.1); },
    buy() { tone(660, 0.06, 'sine', 0.14); tone(990, 0.08, 'sine', 0.14, 0, 0.07); },
    denied() { tone(220, 0.12, 'square', 0.12); },
    roundWin() { tone(523, 0.14, 'sine', 0.16); tone(659, 0.14, 'sine', 0.16, 0, 0.13); tone(784, 0.22, 'sine', 0.18, 0, 0.26); },
    roundLose() { tone(392, 0.16, 'sine', 0.16); tone(330, 0.16, 'sine', 0.16, 0, 0.15); tone(262, 0.26, 'sine', 0.18, 0, 0.3); },
    plantStart() { tone(440, 0.1, 'square', 0.12); tone(440, 0.1, 'square', 0.12, 0, 0.15); },
  };
}
