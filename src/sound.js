// Tiny synthesized sound effects, so the game needs no audio files.
let context = null;
let noise = null;

function audio() {
  if (!context) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    context = new AudioContext();
    noise = context.createBuffer(1, context.sampleRate * 0.3, context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (context.state === 'suspended') context.resume();
  return context;
}

// A punch landing: a low thump plus a short slap of noise. `pitch` > 1 sounds lighter.
export function playThud(volume = 1, pitch = 1) {
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime;

  const body = ctx.createOscillator();
  const bodyGain = ctx.createGain();
  body.frequency.setValueAtTime(140 * pitch, now);
  body.frequency.exponentialRampToValueAtTime(45 * pitch, now + 0.15);
  bodyGain.gain.setValueAtTime(0.7 * volume, now);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  body.connect(bodyGain).connect(ctx.destination);
  body.start(now);
  body.stop(now + 0.2);

  const slap = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const slapGain = ctx.createGain();
  slap.buffer = noise;
  filter.type = 'lowpass';
  filter.frequency.value = 1800 * pitch;
  slapGain.gain.setValueAtTime(0.5 * volume, now);
  slapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
  slap.connect(filter).connect(slapGain).connect(ctx.destination);
  slap.start(now);
  slap.stop(now + 0.1);
}

// Unlock audio from a click, since browsers only allow sound after the user interacts.
export function unlockAudio() {
  audio();
}
