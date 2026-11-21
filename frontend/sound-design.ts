import { powerBootDuration, powerBootSteps } from "./power-sequence.js";

export type SoundCue = "press" | "release" | "saved" | "slow" | "error" | "limited" | "hold";
export const typicalSaveDelayMs = 50;

// Keep the chooser and validation on the same small, dependency-free catalog.
export const soundProfiles = [
  {
    id: "classic",
    name: "profileClassic",
    description: "profileClassicDescription",
  },
  { id: "blip", name: "profileBlip", description: "profileBlipDescription" },
  { id: "clack", name: "profileClack", description: "profileClackDescription" },
  {
    id: "clunk",
    name: "profileClunk",
    description: "profileClunkDescription",
  },
  {
    id: "low-beep",
    name: "profileLowBeep",
    description: "profileLowBeepDescription",
  },
  {
    id: "soft-chime",
    name: "profileSoftChime",
    description: "profileSoftChimeDescription",
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
    release: { pitch: 1.5, duration: 0.034, decay: 0.007 },
    save: { pitch: 820, end: 950, attack: 0.0007, decay: 0.0045 },
    ring: 1450,
    duration: 0.095,
    decay: 0.018,
    attack: 0.0007,
  },
  blip: {
    pitch: 620,
    end: 830,
    release: { pitch: 1.35, duration: 0.036, decay: 0.008 },
    save: { pitch: 1100, end: 1390, attack: 0.0015, decay: 0.006 },
    ring: 1240,
    duration: 0.075,
    decay: 0.021,
    attack: 0.0015,
  },
  clack: {
    release: { duration: 0.028, decay: 0.005 },
    save: { decay: 0.003, brightness: 0.76 },
    duration: 0.065,
    decay: 0.009,
    attack: 0.0005,
  },
  clunk: {
    release: { duration: 0.038, decay: 0.009 },
    save: { decay: 0.006, brightness: 1.1 },
    duration: 0.13,
    decay: 0.02,
    attack: 0.0015,
  },
  "low-beep": {
    pitch: 170,
    end: 160,
    release: { pitch: 1.3, duration: 0.04, decay: 0.009 },
    save: { pitch: 275, end: 310, attack: 0.003, decay: 0.008 },
    ring: 340,
    duration: 0.11,
    decay: 0.023,
    attack: 0.005,
  },
  "soft-chime": {
    pitch: 440,
    end: 440,
    release: { pitch: 1.25, duration: 0.043, decay: 0.01 },
    save: { pitch: 660, end: 660, attack: 0.0025, decay: 0.009 },
    ring: 1214,
    duration: 0.16,
    decay: 0.024,
    attack: 0.004,
  },
} satisfies Record<SoundProfile, object>;
const responses = {
  saved: { level: 0.015, duration: 0.03 },
  slow: { pitch: 0.64, end: 0.77, level: 0.014, duration: 0.052, decay: 0.012 },
  error: { pitch: 0.25, end: 0.16, level: 0.019, duration: 0.069, decay: 0.017 },
  limited: { pitch: 0.35, end: 0.28, level: 0.016, duration: 0.062, decay: 0.014 },
  hold: { pitch: 0.56, end: 0.58, level: 0.007, duration: 0.04, decay: 0.009 },
};
// Mechanical replies use short noise envelopes. Rejections have a second tap.
const impactResponses = {
  slow: { decay: 0.01, brightness: 0.75 },
  error: { decay: 0.006, brightness: 0.65, repeatAt: 0.022 },
  limited: { decay: 0.005, brightness: 0.55, repeatAt: 0.034 },
  hold: { decay: 0.008, brightness: 0.72 },
} satisfies Record<Exclude<keyof typeof responses, "saved">, ImpactEnvelope>;

interface ImpactEnvelope {
  decay: number;
  brightness?: number;
  repeatAt?: number;
}

function filterWeight(frequency: number, sampleRate: number) {
  return 1 - Math.exp((-2 * Math.PI * frequency) / sampleRate);
}

function matchCueLevel(samples: Float32Array, sampleRate: number, level: number) {
  // Measure the whole transient against the same time window. De-emphasize
  // deep bass and high hiss so they don't dominate the gain calculation.
  const lowWeight = filterWeight(160, sampleRate);
  const midWeight = filterWeight(4800, sampleRate);
  let low = 0;
  let mid = 0;
  let energy = 0;
  let peak = 0;
  for (const sample of samples) {
    low += (sample - low) * lowWeight;
    mid += (sample - low - mid) * midWeight;
    energy += mid * mid;
    peak = Math.max(peak, Math.abs(sample));
  }
  if (peak === 0) return samples;
  // Apply one gain to the entire cue and reserve peak headroom for the mixer.
  const gain = Math.min(level / Math.sqrt(energy / (sampleRate * 0.1)), 0.9 / peak);
  for (let i = 0; i < samples.length; i++) samples[i] = samples[i]! * gain;
  return samples;
}

function renderImpact(
  samples: Float32Array,
  profile: "clack" | "clunk",
  sampleRate: number,
  attack: number,
  { decay, brightness = 1, repeatAt = Infinity }: ImpactEnvelope,
  variation: Variation,
  random: () => number,
) {
  const bright = profile === "clack";
  const lowWeight = filterWeight((bright ? 1300 : 95) * variation.pitch * brightness, sampleRate);
  const highWeight = filterWeight(
    (bright ? 5200 : 780) * variation.texture * brightness,
    sampleRate,
  );
  let low = 0;
  let high = 0;
  let band = 0;
  for (let i = 0; i < samples.length; i++) {
    const time = i / sampleRate;
    const noise = whiteNoise(random);
    low += (noise - low) * lowWeight;
    high += (noise - high) * highWeight;
    band += (high - low - band) * highWeight;
    let envelope = Math.min(1, time / attack) * Math.exp(-time / decay);
    if (time >= repeatAt) {
      const sinceRepeat = time - repeatAt;
      envelope += 0.65 * Math.min(1, sinceRepeat / attack) * Math.exp(-sinceRepeat / decay);
    }
    const fadeOut = Math.min(1, (samples.length - 1 - i) / (sampleRate * 0.008));
    samples[i] = band * envelope * fadeOut;
  }
}

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
  const saved = cue === "saved";
  // The return stroke is a smaller, quicker movement than pressing down.
  // Give it its own envelope so rapid clicks retain two distinct transients.
  const release = cue === "release" ? recipe.release : null;
  const level = (response?.level ?? (release ? 0.027 : 0.056)) * variation.strength;
  const duration =
    (response?.duration ?? release?.duration ?? recipe.duration) * variation.duration;
  const samples = new Float32Array(Math.ceil(sampleRate * duration));
  if (profile === "clack" || profile === "clunk") {
    const envelope = saved
      ? recipes[profile].save
      : physical
        ? { decay: release?.decay ?? recipe.decay }
        : impactResponses[cue];
    renderImpact(samples, profile, sampleRate, recipe.attack, envelope, variation, random);
    return matchCueLevel(samples, sampleRate, level);
  }
  const oscillator = recipes[profile];
  const multiplier = cue === "release" ? oscillator.release.pitch : 1;
  const relative = physical || saved ? null : responses[cue];
  const pitch = physical
    ? oscillator.pitch * multiplier
    : oscillator.save.pitch * (relative?.pitch ?? 1);
  const end = physical
    ? oscillator.end * multiplier
    : relative
      ? oscillator.save.pitch * relative.end
      : oscillator.save.end;
  const attack = saved ? oscillator.save.attack : oscillator.attack;
  const decay = physical
    ? (release?.decay ?? oscillator.decay)
    : (relative?.decay ?? oscillator.save.decay);
  const stepPitch = end < pitch ? -pitch : pitch;
  const stepAt = saved ? 0.007 : 0.018;
  let previousNoise = 0;
  for (let i = 0; i < samples.length; i++) {
    const time = i / sampleRate;
    const phase =
      2 *
      Math.PI *
      variation.pitch *
      (end * time + (pitch - end) * 0.012 * (1 - Math.exp(-time / 0.012)));
    const envelope = Math.exp(-time / decay);
    const ring = Math.sin(2 * Math.PI * oscillator.ring * variation.pitch * time);
    let wave: number;
    switch (profile) {
      case "classic": {
        const noise = physical || saved ? whiteNoise(random) : 0;
        const highNoise = noise - previousNoise;
        previousNoise = noise;
        wave =
          (saved ? 0.23 : physical ? 0.46 : 0.6) * Math.sin(phase) * envelope +
          0.1 * ring * Math.exp(-time / 0.006) +
          (0.23 * noise + 0.1 * highNoise) * variation.texture * Math.exp(-time / 0.003);
        break;
      }
      case "blip": {
        // A pitch step and rounded pulse evoke a tiny arcade voice.
        const stepPhase = phase + Math.max(0, time - stepAt) * stepPitch * 0.35 * Math.PI * 2;
        const triangle = (2 * Math.asin(Math.sin(stepPhase))) / Math.PI;
        const pulse = Math.tanh(Math.sin(stepPhase) * (2.2 + variation.texture));
        wave = (0.5 * triangle + 0.18 * pulse) * envelope;
        break;
      }
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
    const fade = Math.min(1, time / attack, (samples.length - 1 - i) / (sampleRate * 0.008));
    samples[i] = wave * fade;
  }
  return matchCueLevel(samples, sampleRate, level);
}

const hardwareSounds = {
  boot: {
    level: 0.052,
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
    level: 0.054,
    duration: 165,
    hits: [
      { at: 0, pitch: 83, gain: 0.57, decay: 32, noise: 0.32 },
      { at: 25, pitch: 164, gain: 0.25, decay: 19, noise: 0.23 },
    ],
  },
  reset: {
    level: 0.034,
    duration: 100,
    hits: [
      { at: 0, pitch: 214, gain: 0.33, decay: 16, noise: 0.24 },
      { at: 12, pitch: 420, gain: 0.13, decay: 12, noise: 0.13 },
    ],
  },
  "plug-loose": {
    level: 0.028,
    duration: 215,
    hits: [
      { at: 0, pitch: 155, gain: 0.16, decay: 24, noise: 0.55 },
      { at: 55, pitch: 230, gain: 0.12, decay: 19, noise: 0.37 },
    ],
  },
  unplug: {
    level: 0.033,
    duration: 225,
    hits: [
      { at: 0, pitch: 126, gain: 0.44, decay: 25, noise: 0.48 },
      { at: 97, pitch: 178, gain: 0.13, decay: 23, noise: 0.42 },
    ],
  },
  "plug-in": {
    level: 0.033,
    duration: 195,
    hits: [
      { at: 0, pitch: 255, gain: 0.15, decay: 16, noise: 0.5 },
      { at: 115, pitch: 113, gain: 0.35, decay: 20, noise: 0.28 },
    ],
  },
  "cord-slack": {
    level: 0.025,
    duration: 135,
    hits: [
      { at: 0, pitch: 294, gain: 0.19, decay: 15, noise: 0.27 },
      { at: 36, pitch: 171, gain: 0.13, decay: 20, noise: 0.35 },
    ],
  },
  "cord-tension": {
    level: 0.025,
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
  const { duration, hits, level } = hardwareSounds[cue];
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
  return matchCueLevel(samples, sampleRate, level);
}
