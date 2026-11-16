import { createSoundMotion, renderSound } from "./sound-design.js";
import type { SoundCue, SoundProfile } from "./sound-design.js";

// No audio allocation on page load. Only opt-in, preview, or an enabled game
// gesture can unlock audio; responses cannot queue delayed pings.
const motion = createSoundMotion();
let profile: SoundProfile = "classic";
let enabled = false;
let context: AudioContext | null = null;
let output: GainNode | null = null;
let generation = 0;
const voices = new Set<AudioBufferSourceNode>();
const maxVoices = 8;
const maxUnlockDelay = 150;

function cancelPending() {
  generation++;
}

function removeVoice(voice: AudioBufferSourceNode, stop = false) {
  voices.delete(voice);
  voice.onended = null;
  if (stop) {
    try {
      voice.stop();
    } catch {
      // A failed start can leave a source that cannot be stopped.
    }
  }
  try {
    voice.disconnect();
  } catch {
    // Device teardown must not interrupt cleanup of the remaining voices.
  }
}

function stop() {
  cancelPending();
  for (const voice of voices) removeVoice(voice, true);
}

function synthesize(audio: AudioContext, kind: SoundCue, offset = 0) {
  const variation = motion.sample(performance.now(), kind === "press");
  const samples = renderSound(profile, kind, audio.sampleRate, variation);
  const buffer = audio.createBuffer(1, samples.length, audio.sampleRate);
  buffer.getChannelData(0).set(samples);
  // Bound overlapping voices even with rapid multi-finger input. At this gain
  // their combined peak stays below full scale without a compressor.
  if (voices.size >= maxVoices) {
    const oldest = voices.values().next().value!;
    removeVoice(oldest, true);
  }
  const voice = audio.createBufferSource();
  try {
    voice.buffer = buffer;
    voice.connect(output!);
    voice.onended = () => removeVoice(voice);
    voices.add(voice);
    voice.start(audio.currentTime + offset);
  } catch (error) {
    removeVoice(voice, true);
    throw error;
  }
}

function audioContext(allowCreate: boolean) {
  if (!context || context.state === "closed") {
    if (!allowCreate || typeof window.AudioContext !== "function") return null;
    const next = new window.AudioContext({ latencyHint: "interactive" });
    try {
      const gain = next.createGain();
      gain.gain.value = 0.12;
      gain.connect(next.destination);
      output = gain;
      context = next;
    } catch (error) {
      void next.close().catch(() => {
        // A failed device may also reject closing its partial graph.
      });
      throw error;
    }
  }
  return context;
}

function prepare() {
  if (!enabled || document.hidden) return;
  try {
    const audio = audioContext(true);
    if (audio && audio.state !== "running")
      void audio.resume().catch(() => {
        // A later press/release can retry if the toggle gesture was blocked.
      });
  } catch {
    // Enabling sound must stay usable when the audio device is unavailable.
  }
}

function withAudio(gesture: boolean, emit: (audio: AudioContext) => void) {
  if (!enabled || document.hidden) return;
  const current = gesture ? ++generation : generation;
  try {
    const audio = audioContext(gesture);
    if (!audio) return;
    if (audio.state === "running") emit(audio);
    else if (gesture) {
      const requestedAt = performance.now();
      // Retry inside every gesture: touch browsers may allow audio only on
      // release. Only the latest gesture can sound after an async unlock.
      void audio
        .resume()
        .then(() => {
          if (
            enabled &&
            !document.hidden &&
            current === generation &&
            audio.state === "running" &&
            performance.now() - requestedAt <= maxUnlockDelay
          )
            emit(audio);
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
  play(kind: SoundCue) {
    withAudio(kind === "press" || kind === "release", (audio) => synthesize(audio, kind));
  },
  preview() {
    // Schedule on the audio clock; mute, hiding, and profile changes can stop
    // the entire sequence, including voices whose start time is still ahead.
    stop();
    withAudio(true, (audio) => {
      synthesize(audio, "press");
      synthesize(audio, "release", 0.06);
      synthesize(audio, "saved", 0.18);
    });
  },
  setProfile(value: SoundProfile) {
    if (profile === value) return;
    stop();
    profile = value;
  },
  prepare,
  cancelPending,
  setEnabled(value: boolean) {
    if (enabled === value) return;
    enabled = value;
    if (!enabled) stop();
  },
};
