/**
 * Retro sound effects using Web Audio API.
 * No external files needed — all synthesized.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  // Resume if suspended (browsers require user interaction first)
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/** Epic win fanfare — ascending arpeggiated chiptune */
export function playWinSound() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Main fanfare notes (C major arpeggio going up)
    const notes = [523, 659, 784, 1047, 1319, 1568, 2093];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.12);
      gain.gain.linearRampToValueAtTime(0.15, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.35);
    });

    // Victory chord at the end
    setTimeout(() => {
      const chordFreqs = [1047, 1319, 1568];
      chordFreqs.forEach(freq => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 1.5);
      });
    }, notes.length * 120 + 100);

    // Coin collect sound layered on top
    setTimeout(() => {
      for (let i = 0; i < 3; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1800 + i * 400, ctx.currentTime + i * 0.08);
        osc.frequency.exponentialRampToValueAtTime(3000 + i * 400, ctx.currentTime + i * 0.08 + 0.06);
        gain.gain.setValueAtTime(0.1, ctx.currentTime + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.08 + 0.15);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.08);
        osc.stop(ctx.currentTime + i * 0.08 + 0.2);
      }
    }, 200);
  } catch {
    // Audio not available, no-op
  }
}

/** Sad lose sound — descending minor notes */
export function playLoseSound() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Descending minor scale
    const notes = [440, 392, 349, 294, 262];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.25);
      gain.gain.linearRampToValueAtTime(0.12, now + i * 0.25 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.25 + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.25);
      osc.stop(now + i * 0.25 + 0.55);
    });

    // Low rumble at end
    const rumble = ctx.createOscillator();
    const rumbleGain = ctx.createGain();
    rumble.type = 'sawtooth';
    rumble.frequency.value = 80;
    rumbleGain.gain.setValueAtTime(0, now + 1.2);
    rumbleGain.gain.linearRampToValueAtTime(0.06, now + 1.3);
    rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + 2.5);
    rumble.connect(rumbleGain);
    rumbleGain.connect(ctx.destination);
    rumble.start(now + 1.2);
    rumble.stop(now + 2.5);
  } catch {
    // Audio not available, no-op
  }
}

/** Quick mining hit sound */
export function playMineSound(destroyed: boolean) {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(destroyed ? 600 : 200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(destroyed ? 1200 : 100, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch {
    // no-op
  }
}

/** Bitcoin found discovery sound — magical sparkle */
export function playBitcoinFoundSound() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Sparkle sweep
    for (let i = 0; i < 8; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const freq = 2000 + i * 300;
      osc.frequency.setValueAtTime(freq, now + i * 0.04);
      gain.gain.setValueAtTime(0.08, now + i * 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.04 + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.04);
      osc.stop(now + i * 0.04 + 0.25);
    }
  } catch {
    // no-op
  }
}
