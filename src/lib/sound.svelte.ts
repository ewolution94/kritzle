// Sounds, made on the spot with Web Audio: no files, no third parties. On by default, switched per
// device in Settings (`kritzle:sound`). A browser only plays sound after a tap, so the context starts
// on the first pointer or key press. On a call each device plays its own.

const KEY = 'kritzle:sound';

function stored() {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export const sound = $state({ on: stored() });

export function setSound(on: boolean) {
  sound.on = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // not kept
  }
}

let ctx: AudioContext | null = null;

function context() {
  if (!sound.on) return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Unlocks audio on the first gesture (browsers start contexts suspended until then). */
export function unlockOnGesture() {
  const go = () => {
    context();
    removeEventListener('pointerdown', go);
    removeEventListener('keydown', go);
  };
  addEventListener('pointerdown', go);
  addEventListener('keydown', go);
}

/** One soft note: a sine with a quick attack and a decay. */
function note(freq: number, at: number, length: number, gain = 0.12, type: OscillatorType = 'sine') {
  const c = context();
  if (!c) return;
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  const amp = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(amp).connect(c.destination);
  osc.start(t);
  osc.stop(t + length + 0.05);
}

export const play = {
  /** Someone got the word. */
  guessed: () => {
    note(880, 0, 0.18);
    note(1318.5, 0.09, 0.28);
  },
  /** Your own right guess. */
  mine: () => {
    note(659.3, 0, 0.16);
    note(880, 0.08, 0.16);
    note(1318.5, 0.16, 0.34);
  },
  /** A turn starts. */
  start: () => note(523.3, 0, 0.22, 0.08, 'triangle'),
  /** It's your turn to draw (or to choose). */
  yourTurn: () => {
    note(587.3, 0, 0.14, 0.1, 'triangle');
    note(784, 0.12, 0.24, 0.1, 'triangle');
  },
  /** The last seconds. */
  tick: () => note(1200, 0, 0.05, 0.05, 'square'),
  /** The word is out. */
  reveal: () => {
    note(392, 0, 0.2, 0.08, 'triangle');
    note(523.3, 0.12, 0.3, 0.08, 'triangle');
  },
  /** The end of the game. */
  fanfare: () => [523.3, 659.3, 784, 1046.5].forEach((f, i) => note(f, i * 0.12, 0.4, 0.09, 'triangle')),
};
