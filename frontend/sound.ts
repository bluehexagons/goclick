// All sounds are synthesized locally; audio stays unallocated until an enabled
// press/release gesture. Responses never unlock audio or queue delayed pings.
type Sound = "press" | "release" | "saved" | "slow" | "error" | "limited";
const profiles = {
  press: { pitch: 175, end: 65, metal: 1450, noise: 0.12, decay: 0.018, gain: 1 },
  release: { pitch: 260, end: 125, metal: 1900, noise: 0.08, decay: 0.014, gain: 0.8 },
  saved: { pitch: 1100, end: 1280, metal: 1650, noise: 0, decay: 0.025, gain: 0.2 },
  slow: { pitch: 700, end: 850, metal: 1050, noise: 0, decay: 0.025, gain: 0.18 },
  error: { pitch: 240, end: 150, metal: 360, noise: 0, decay: 0.025, gain: 0.22 },
  limited: { pitch: 380, end: 300, metal: 570, noise: 0, decay: 0.025, gain: 0.18 },
} satisfies Record<Sound, object>;
let enabled = false;
let context: AudioContext | null = null;
let output: GainNode | null = null;
let generation = 0;
const voices = new Set<AudioBufferSourceNode>();
const maxVoices = 8;

function stop() {
  generation++;
  for (const voice of voices) {
    voice.stop();
    voice.disconnect();
  }
  voices.clear();
}

function synthesize(audio: AudioContext, kind: Sound) {
  const profile = profiles[kind];
  const duration = 0.095 * (0.95 + Math.random() * 0.1);
  const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * duration), audio.sampleRate);
  const samples = buffer.getChannelData(0);
  const pitch = 0.96 + Math.random() * 0.08;
  const strength = profile.gain * (0.9 + Math.random() * 0.1);
  let previousNoise = 0;
  for (let i = 0; i < samples.length; i++) {
    const time = i / audio.sampleRate;
    // Integrate a gliding pitch for the body; an overtone and filtered noise
    // give the switch its metallic tick. Fade both ends to avoid pops.
    const phase =
      2 *
      Math.PI *
      pitch *
      (profile.end * time + (profile.pitch - profile.end) * 0.012 * (1 - Math.exp(-time / 0.012)));
    const body = Math.sin(phase) * Math.exp(-time / profile.decay);
    const overtone = Math.sin(2 * Math.PI * profile.metal * pitch * time) * Math.exp(-time / 0.008);
    const noise = Math.random() * 2 - 1;
    const tick = (noise - previousNoise) * Math.exp(-time / 0.003);
    previousNoise = noise;
    const fade = Math.min(1, time / 0.0007, (samples.length - 1 - i) / (audio.sampleRate * 0.008));
    samples[i] = (0.6 * body + 0.14 * overtone + profile.noise * tick) * fade * strength;
  }
  // Bound overlapping voices even with rapid multi-finger input. At this gain
  // their combined peak stays below full scale without a compressor.
  if (voices.size >= maxVoices) {
    const oldest = voices.values().next().value!;
    oldest.stop();
    oldest.disconnect();
    voices.delete(oldest);
  }
  const voice = audio.createBufferSource();
  voice.buffer = buffer;
  voice.connect(output!);
  voice.onended = () => {
    voices.delete(voice);
    voice.disconnect();
  };
  voices.add(voice);
  voice.start();
}

function play(kind: Sound) {
  if (!enabled || document.hidden) return;
  const gesture = kind === "press" || kind === "release";
  const current = gesture ? ++generation : generation;
  try {
    if (!context || context.state === "closed") {
      if (!gesture || typeof window.AudioContext !== "function") return;
      context = new window.AudioContext({ latencyHint: "interactive" });
      output = context.createGain();
      output.gain.value = 0.12;
      output.connect(context.destination);
    }
    const audio = context;
    if (audio.state === "running") synthesize(audio, kind);
    else if (gesture) {
      // Retry inside every gesture: touch browsers may allow audio only on
      // release. Only the latest gesture can sound after an async unlock.
      void audio
        .resume()
        .then(() => {
          if (enabled && !document.hidden && current === generation && audio.state === "running")
            synthesize(audio, kind);
        })
        .catch(() => {
          // Audio is optional; a blocked device must never affect gameplay.
        });
    }
  } catch {
    // Unsupported or unavailable audio must never prevent a click from saving.
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop();
});

export const clickSound = {
  play,
  setEnabled(value: boolean) {
    if (enabled === value) return;
    enabled = value;
    if (!enabled) stop();
  },
};
