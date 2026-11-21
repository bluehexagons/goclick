import { powerBootDuration, powerBootSteps } from "./power-sequence.js";

export type SoundCue = "press" | "release" | "saved" | "slow" | "error" | "limited" | "hold";

// Keep the chooser and validation on the same small, dependency-free catalog.
export const soundProfiles = [
  {
    id: "classic",
    name: "Classic",
    description: "A metal switch with a low press and a lighter return.",
  },
  { id: "blip", name: "Blip", description: "Short electronic tones that rise in pitch." },
  { id: "clack", name: "Clack", description: "A short, dry key click." },
  {
    id: "clunk",
    name: "Clunk",
    description: "A muffled impact with a short, low resonance.",
  },
  {
    id: "low-beep",
    name: "Low beep",
    description: "A low tone with a soft attack.",
  },
  {
    id: "soft-chime",
    name: "Soft chime",
    description: "A soft chime with a short decay.",
  },
] as const;
export type SoundProfile = (typeof soundProfiles)[number]["id"];
export function isSoundProfile(value: unknown): value is SoundProfile {
  return soundProfiles.some((profile) => profile.id === value);
}

function whiteNoise(random: () => number) {
  return random() * 2 - 1;
}

// Reflections begin after the dry hit, then get closer together and decay.
// Cap the sum of their magnitudes so the mixer can reserve fixed headroom.
export function renderRoomImpulse(sampleRate: number, random = Math.random) {
  const impulse = new Float32Array(Math.ceil(sampleRate * 0.13));
  for (const [ms, gain] of [
    [7, 0.15],
    [12, -0.075],
    [19, 0.055],
    [27, 0.035],
    [33, -0.02],
  ] as const)
    impulse[Math.round((sampleRate * ms) / 1000)] = gain;

  let tailMagnitude = 0;
  const tailStart = Math.ceil(sampleRate * 0.036);
  for (let i = tailStart; i < impulse.length; i++) {
    const time = (i - tailStart) / sampleRate;
    const reflection = whiteNoise(random) * Math.exp(-time / 0.021);
    impulse[i] = reflection;
    tailMagnitude += Math.abs(reflection);
  }
  const tailGain = tailMagnitude > 0 ? 0.12 / tailMagnitude : 0;
  for (let i = tailStart; i < impulse.length; i++) impulse[i] = impulse[i]! * tailGain;
  return impulse;
}

interface Variation {
  pitch: number;
  texture: number;
  duration: number;
  strength: number;
}

// Randomness chooses the initial phases and a tiny accent per press. Most
// variation follows continuous, overlapping waves and a decaying activity curve.
// Release and reply share that movement rather than rolling unrelated pitches.
export function createSoundMotion(random = Math.random) {
  const phase = random() * Math.PI * 2;
  const texturePhase = random() * Math.PI * 2;
  let previous: number | null = null;
  let activity = 0;
  let accent = 0;
  return {
    sample(milliseconds: number, press = false): Variation {
      if (previous !== null) activity *= Math.exp(-Math.max(0, milliseconds - previous) / 900);
      previous = milliseconds;
      if (press) {
        activity = Math.min(1, activity + 0.1);
        accent = (random() - 0.5) * 0.008;
      }
      const time = milliseconds / 1000;
      const drift = 0.65 * Math.sin(time * 0.73 + phase) + 0.35 * Math.sin(time * 0.23 + phase);
      const breath = Math.sin(time * 1.13 + texturePhase);
      return {
        pitch: 1 + drift * 0.045 + activity * 0.035 + accent,
        texture: 0.9 + breath * 0.15 + activity * 0.08,
        duration: 1 + breath * 0.035 - activity * 0.025,
        strength: 0.94 + drift * 0.035 + activity * 0.015,
      };
    },
  };
}

const recipes = {
  classic: {
    pitch: 175,
    end: 65,
    release: { pitch: 1.5, duration: 0.065, decay: 0.011, gain: 0.65 },
    reply: 1100,
    ring: 1450,
    duration: 0.095,
    decay: 0.018,
    attack: 0.0007,
  },
  blip: {
    pitch: 620,
    end: 830,
    release: { pitch: 1.35, duration: 0.06, decay: 0.015, gain: 0.64 },
    reply: 1400,
    ring: 1240,
    duration: 0.075,
    decay: 0.021,
    attack: 0.0015,
  },
  clack: {
    pitch: 430,
    end: 250,
    release: { pitch: 1.25, duration: 0.045, decay: 0.006, gain: 0.62 },
    reply: 1250,
    ring: 2800,
    duration: 0.065,
    decay: 0.009,
    attack: 0.0005,
  },
  clunk: {
    pitch: 115,
    end: 52,
    release: { pitch: 1.4, duration: 0.085, decay: 0.017, gain: 0.62 },
    reply: 560,
    ring: 290,
    duration: 0.13,
    decay: 0.027,
    attack: 0.0015,
  },
  "low-beep": {
    pitch: 170,
    end: 160,
    release: { pitch: 1.3, duration: 0.075, decay: 0.021, gain: 0.66 },
    reply: 340,
    ring: 340,
    duration: 0.11,
    decay: 0.03,
    attack: 0.005,
  },
  "soft-chime": {
    pitch: 440,
    end: 440,
    release: { pitch: 1.25, duration: 0.115, decay: 0.028, gain: 0.65 },
    reply: 880,
    ring: 1214,
    duration: 0.16,
    decay: 0.037,
    attack: 0.004,
  },
} satisfies Record<SoundProfile, object>;
const responses = {
  saved: { pitch: 1, end: 1.16, gain: 0.2 },
  slow: { pitch: 0.64, end: 0.77, gain: 0.18 },
  error: { pitch: 0.25, end: 0.16, gain: 0.22 },
  limited: { pitch: 0.35, end: 0.28, gain: 0.18 },
  hold: { pitch: 0.56, end: 0.58, gain: 0.065 },
};

// Pure PCM synthesis, also usable without an audio device in regression tests.
// Every recipe has its own waveform/texture and envelope, not just a pitch shift.
export function renderSound(
  profile: SoundProfile,
  cue: SoundCue,
  sampleRate: number,
  variation: Variation,
  random = Math.random,
): Float32Array {
  const recipe = recipes[profile];
  const physical = cue === "press" || cue === "release";
  const response = physical ? null : responses[cue];
  // The return stroke is a smaller, quicker movement than pressing down.
  // Give it its own envelope so rapid clicks retain two distinct transients.
  const release = cue === "release" ? recipe.release : null;
  const multiplier = release?.pitch ?? 1;
  const pitch = response ? recipe.reply * response.pitch : recipe.pitch * multiplier;
  const end = response ? recipe.reply * response.end : recipe.end * multiplier;
  const gain = (response?.gain ?? release?.gain ?? 1) * variation.strength;
  const decay = response ? 0.025 : (release?.decay ?? recipe.decay);
  const duration = (release?.duration ?? recipe.duration) * variation.duration;
  const samples = new Float32Array(Math.ceil(sampleRate * duration));
  const mechanical =
    physical && (profile === "classic" || profile === "clack" || profile === "clunk");
  // Keep the Clunk noise pole's decay time fixed across output devices.
  const noiseBlend = sampleRate === 48000 ? 0.18 : 1 - Math.pow(0.82, 48000 / sampleRate);
  const stepPitch = end < pitch ? -pitch : pitch;
  let previousNoise = 0;
  let lowNoise = 0;
  for (let i = 0; i < samples.length; i++) {
    const time = i / sampleRate;
    const phase =
      2 *
      Math.PI *
      variation.pitch *
      (end * time + (pitch - end) * 0.012 * (1 - Math.exp(-time / 0.012)));
    const envelope = Math.exp(-time / decay);
    const ring = Math.sin(2 * Math.PI * recipe.ring * variation.pitch * time);
    const noise = mechanical ? whiteNoise(random) : 0;
    lowNoise += (noise - lowNoise) * noiseBlend;
    const highNoise = noise - previousNoise;
    previousNoise = noise;
    const texture = variation.texture;
    let wave: number;
    switch (profile) {
      case "classic":
        wave =
          (physical ? 0.46 : 0.6) * Math.sin(phase) * envelope +
          0.1 * ring * Math.exp(-time / 0.006) +
          (0.23 * noise + 0.1 * highNoise) * texture * Math.exp(-time / 0.003);
        break;
      case "blip": {
        // A pitch step and rounded pulse evoke a tiny arcade voice.
        const stepPhase = phase + Math.max(0, time - 0.018) * stepPitch * 0.35 * Math.PI * 2;
        const triangle = (2 * Math.asin(Math.sin(stepPhase))) / Math.PI;
        const pulse = Math.tanh(Math.sin(stepPhase) * (2.2 + variation.texture));
        wave = (0.5 * triangle + 0.18 * pulse) * envelope;
        break;
      }
      case "clack":
        wave =
          (physical ? 0.09 : 0.3) * Math.sin(phase) * envelope +
          0.05 * ring * Math.exp(-time / 0.0025) +
          (0.48 * noise + 0.17 * highNoise) *
            texture *
            Math.exp(-time / (release ? 0.0025 : 0.004));
        break;
      case "clunk":
        // Decaying phase modulation gives the impact a thick, resonant body.
        wave =
          (physical ? 0.32 : 0.6) *
            Math.sin(phase + 0.85 * Math.sin(phase * 1.7) * Math.exp(-time / 0.012)) *
            envelope +
          0.1 * ring * Math.exp(-time / 0.014) +
          0.55 * lowNoise * texture * Math.exp(-time / 0.005);
        break;
      case "low-beep":
        wave =
          (0.6 * Math.sin(phase) + 0.1 * Math.sin(phase * 2) + 0.04 * Math.sin(phase / 2)) *
          envelope;
        break;
      case "soft-chime":
        // Inharmonic partials ring like small glass, with no noise transient.
        wave =
          (0.43 * Math.sin(phase) +
            0.17 * Math.sin(phase * (2.76 + variation.texture * 0.015)) +
            0.13 * Math.sin(phase * 4.07)) *
          envelope;
        break;
    }
    const fade = Math.min(1, time / recipe.attack, (samples.length - 1 - i) / (sampleRate * 0.008));
    samples[i] = wave * fade * gain;
  }
  return samples;
}

const hardwareSounds = {
  boot: {
    duration: powerBootDuration,
    hits: powerBootSteps.map(({ at, pitch }, index) => ({
      at,
      pitch,
      gain: 0.14 + 0.04 * index,
      decay: 32 + 7 * index,
      noise: 0,
    })),
  },
  test: {
    duration: 165,
    hits: [
      { at: 0, pitch: 83, gain: 0.57, decay: 32, noise: 0.32 },
      { at: 25, pitch: 164, gain: 0.25, decay: 19, noise: 0.23 },
    ],
  },
  reset: {
    duration: 100,
    hits: [
      { at: 0, pitch: 214, gain: 0.33, decay: 16, noise: 0.24 },
      { at: 12, pitch: 420, gain: 0.13, decay: 12, noise: 0.13 },
    ],
  },
  "plug-loose": {
    duration: 215,
    hits: [
      { at: 0, pitch: 155, gain: 0.16, decay: 24, noise: 0.55 },
      { at: 55, pitch: 230, gain: 0.12, decay: 19, noise: 0.37 },
    ],
  },
  unplug: {
    duration: 225,
    hits: [
      { at: 0, pitch: 126, gain: 0.44, decay: 25, noise: 0.48 },
      { at: 97, pitch: 178, gain: 0.13, decay: 23, noise: 0.42 },
    ],
  },
  "plug-in": {
    duration: 195,
    hits: [
      { at: 0, pitch: 255, gain: 0.15, decay: 16, noise: 0.5 },
      { at: 115, pitch: 113, gain: 0.35, decay: 20, noise: 0.28 },
    ],
  },
  "cord-slack": {
    duration: 135,
    hits: [
      { at: 0, pitch: 294, gain: 0.19, decay: 15, noise: 0.27 },
      { at: 36, pitch: 171, gain: 0.13, decay: 20, noise: 0.35 },
    ],
  },
  "cord-tension": {
    duration: 130,
    hits: [
      { at: 0, pitch: 191, gain: 0.15, decay: 19, noise: 0.32 },
      { at: 26, pitch: 325, gain: 0.21, decay: 16, noise: 0.21 },
    ],
  },
};
export type HardwareCue = keyof typeof hardwareSounds;

// The outlet and plug have their own sounds across all button sound profiles.
export function renderHardwareSound(cue: HardwareCue, sampleRate: number, random = Math.random) {
  const { duration, hits } = hardwareSounds[cue];
  const samples = new Float32Array(Math.ceil((sampleRate * duration) / 1000));
  const connector = cue !== "boot" && cue !== "test" && cue !== "reset";
  for (const { at, pitch, gain, decay, noise } of hits) {
    const start = Math.round((sampleRate * at) / 1000);
    const bodyDecay = connector ? decay * 0.45 : decay;
    let previousNoise = 0;
    for (let i = start; i < samples.length; i++) {
      const ms = ((i - start) * 1000) / sampleRate;
      const phase = (2 * Math.PI * pitch * ms) / 1000;
      const body = Math.sin(phase) * Math.exp(-ms / bodyDecay);
      const ring = 0.24 * Math.sin(phase * (noise ? 3.1 : 2)) * Math.exp((-2 * ms) / bodyDecay);
      const sample = noise ? whiteNoise(random) : 0;
      const snap =
        (sample - 0.3 * previousNoise) * noise * (connector ? 1.7 : 1) * Math.exp(-ms / 5);
      previousNoise = sample;
      const fade = Math.min(
        1,
        ms / (noise ? 0.8 : 9),
        ((samples.length - 1 - i) * 1000) / (sampleRate * 12),
      );
      samples[i] = samples[i]! + gain * fade * ((body + ring) * (connector ? 0.32 : 1) + snap);
    }
  }
  return samples;
}
