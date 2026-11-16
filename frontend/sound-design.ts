export type SoundCue = "press" | "release" | "saved" | "slow" | "error" | "limited";

// Keep the chooser and validation on the same small, dependency-free catalog.
export const soundProfiles = [
  {
    id: "classic",
    name: "Classic",
    description: "A metal switch: a low thock with a bright tick.",
  },
  { id: "blip", name: "Blip", description: "Playful arcade pulses with a bouncy pitch step." },
  { id: "clack", name: "Clack", description: "Crisp, dry key clicks with a short, woody ring." },
  {
    id: "clunk",
    name: "Clunk",
    description: "A heavier, rounded impact with a deep resonant body.",
  },
  {
    id: "low-beep",
    name: "Low beep",
    description: "Low, rounded electronic tones without a sharp click.",
  },
  {
    id: "soft-chime",
    name: "Soft chime",
    description: "Gentle glassy notes with a soft attack and a short tail.",
  },
] as const;
export type SoundProfile = (typeof soundProfiles)[number]["id"];
export function isSoundProfile(value: unknown): value is SoundProfile {
  return soundProfiles.some((profile) => profile.id === value);
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
    release: 1.5,
    reply: 1100,
    ring: 1450,
    duration: 0.095,
    decay: 0.018,
    attack: 0.0007,
  },
  blip: {
    pitch: 620,
    end: 830,
    release: 1.35,
    reply: 1400,
    ring: 1240,
    duration: 0.075,
    decay: 0.021,
    attack: 0.0015,
  },
  clack: {
    pitch: 430,
    end: 250,
    release: 1.25,
    reply: 1250,
    ring: 2800,
    duration: 0.065,
    decay: 0.009,
    attack: 0.0005,
  },
  clunk: {
    pitch: 115,
    end: 52,
    release: 1.4,
    reply: 560,
    ring: 290,
    duration: 0.13,
    decay: 0.027,
    attack: 0.0015,
  },
  "low-beep": {
    pitch: 170,
    end: 160,
    release: 1.3,
    reply: 340,
    ring: 340,
    duration: 0.11,
    decay: 0.03,
    attack: 0.005,
  },
  "soft-chime": {
    pitch: 440,
    end: 440,
    release: 1.25,
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
  const multiplier = cue === "release" ? recipe.release : 1;
  const pitch = response ? recipe.reply * response.pitch : recipe.pitch * multiplier;
  const end = response ? recipe.reply * response.end : recipe.end * multiplier;
  const gain = (response?.gain ?? (cue === "release" ? 0.8 : 1)) * variation.strength;
  const decay = physical ? recipe.decay : 0.025;
  const duration = recipe.duration * variation.duration;
  const samples = new Float32Array(Math.ceil(sampleRate * duration));
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
    const noise = random() * 2 - 1;
    lowNoise += (noise - lowNoise) * 0.18;
    const highNoise = noise - previousNoise;
    previousNoise = noise;
    const texture = variation.texture * (physical ? 1 : 0.25);
    let wave: number;
    switch (profile) {
      case "classic":
        wave =
          0.6 * Math.sin(phase) * envelope +
          0.14 * ring * Math.exp(-time / 0.008) +
          0.1 * highNoise * texture * Math.exp(-time / 0.003);
        break;
      case "blip": {
        // A pitch step and rounded pulse evoke a tiny arcade voice.
        const stepPhase = phase + Math.max(0, time - 0.018) * pitch * 0.35 * Math.PI * 2;
        const triangle = (2 * Math.asin(Math.sin(stepPhase))) / Math.PI;
        const pulse = Math.tanh(Math.sin(stepPhase) * (2.2 + variation.texture));
        wave = (0.5 * triangle + 0.18 * pulse) * envelope;
        break;
      }
      case "clack":
        wave =
          0.3 * Math.sin(phase) * envelope +
          0.12 * ring * Math.exp(-time / 0.006) +
          0.22 * highNoise * texture * Math.exp(-time / 0.0025);
        break;
      case "clunk":
        // Decaying phase modulation gives the impact a thick, resonant body.
        wave =
          0.6 *
            Math.sin(phase + 0.85 * Math.sin(phase * 1.7) * Math.exp(-time / 0.012)) *
            envelope +
          0.14 * ring * Math.exp(-time / 0.014) +
          0.08 * lowNoise * texture * Math.exp(-time / 0.005);
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
