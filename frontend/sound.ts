import {
  createSoundMotion,
  renderHardwareSound,
  renderRoomImpulse,
  renderSound,
  typicalSaveDelayMs,
} from "./sound-design.js";
import type { HardwareCue, SoundCue, SoundProfile } from "./sound-design.js";

// Boot requests playback for remembered opt-ins. The browser still decides
// whether sound can start before a gesture.
const motion = createSoundMotion();
let profile: SoundProfile = "classic";
let enabled = false;
let powered = true;
let volume = 1;
let reverb = true;
let context: AudioContext | null = null;
let output: GainNode | null = null;
let roomImpulse: AudioBuffer | null = null;
let room: ConvolverNode | null = null;
let previewRoom: ConvolverNode | null = null;
let suspending: Promise<void> | null = null;
type ResumeSource = "boot" | "prepare" | "press" | "gesture";
const pendingResumes = new Set<ResumeSource>();
let pendingCue: { emit: (audio: AudioContext) => void; requestedAt: number } | null = null;
const voices = new Set<AudioBufferSourceNode>();
const previewVoices = new Set<AudioBufferSourceNode>();
let previewPending = false;
const maxVoices = 8;
// Leave headroom for the peak sum of eight voices and their room reflections.
const maxOutputGain = 0.085;
const maxUnlockDelay = 150;
const responseInterval = 80;
let responseAt = -Infinity;
let responseWasFailure = false;

function cancelPending() {
  pendingCue = null;
  previewPending = false;
  for (const voice of previewVoices) removeVoice(voice, true);
  clearRoom(true);
}

function clearRoom(preview: boolean) {
  const convolver = preview ? previewRoom : room;
  if (preview) previewRoom = null;
  else room = null;
  try {
    convolver?.disconnect();
  } catch {
    // The device may already have torn down its graph.
  }
}

function removeVoice(voice: AudioBufferSourceNode, stop = false) {
  voices.delete(voice);
  if (previewVoices.delete(voice) && previewVoices.size === 0) previewPending = false;
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

function clearVoices() {
  responseAt = -Infinity;
  responseWasFailure = false;
  for (const voice of voices) removeVoice(voice, true);
  clearRoom(false);
  clearRoom(true);
}

function stop() {
  cancelPending();
  clearVoices();
}

function discardContext() {
  stop();
  if (context) context.onstatechange = null;
  context = null;
  suspending = null;
  pendingResumes.clear();
  try {
    output?.disconnect();
  } catch {
    // A device that has closed may already have torn down its graph.
  }
  output = null;
  roomImpulse = null;
}

function suspend() {
  stop();
  if (!context || context.state === "closed" || suspending) return;
  try {
    const pending = context.suspend();
    suspending = pending;
    const settled = () => {
      if (suspending === pending) suspending = null;
    };
    void pending.then(settled, settled);
  } catch {
    // Stopping sounds still works if the device cannot be suspended.
  }
}

function requestResume(audio: AudioContext, source: ResumeSource) {
  if (pendingResumes.has(source)) return;
  const request = audio.resume();
  pendingResumes.add(source);
  function settled(resumed: boolean) {
    if (audio !== context) return;
    pendingResumes.delete(source);
    if (!resumed || audio.state !== "running") {
      if (!pendingResumes.size) pendingCue = null;
      return;
    }
    if (!enabled || document.hidden) {
      suspend();
      return;
    }
    const cue = pendingCue;
    pendingCue = null;
    if (cue && performance.now() - cue.requestedAt <= maxUnlockDelay) cue.emit(audio);
  }
  void request
    .then(
      () => settled(true),
      () => settled(false),
    )
    .catch(() => {
      // Audio is optional; a failed device must never affect gameplay.
    });
}

function synthesize(audio: AudioContext, kind: SoundCue, preview = false, when?: number) {
  const variation = motion.sample(performance.now(), kind === "press");
  return startVoice(audio, renderSound(profile, kind, audio.sampleRate, variation), preview, when);
}

function connectRoom(audio: AudioContext, voice: AudioBufferSourceNode, preview: boolean) {
  if (!reverb) return;
  try {
    // A separate preview path lets closing Options cut its tail immediately.
    let convolver = preview ? previewRoom : room;
    if (!convolver) {
      convolver = audio.createConvolver();
      if (!roomImpulse) {
        const samples = renderRoomImpulse(audio.sampleRate);
        roomImpulse = audio.createBuffer(1, samples.length, audio.sampleRate);
        roomImpulse.getChannelData(0).set(samples);
      }
      convolver.normalize = false;
      convolver.buffer = roomImpulse;
      convolver.connect(output!);
      if (preview) previewRoom = convolver;
      else room = convolver;
    }
    voice.connect(convolver);
  } catch {
    // The dry connection still plays if the room effect is unavailable.
  }
}

function startVoice(audio: AudioContext, samples: Float32Array, preview = false, when?: number) {
  const buffer = audio.createBuffer(1, samples.length, audio.sampleRate);
  buffer.getChannelData(0).set(samples);
  // Bound overlapping voices even with rapid multi-finger input.
  if (voices.size >= maxVoices) {
    const oldest = voices.values().next().value!;
    removeVoice(oldest, true);
  }
  const voice = audio.createBufferSource();
  try {
    voice.buffer = buffer;
    voice.connect(output!);
    connectRoom(audio, voice, preview);
    voice.onended = () => removeVoice(voice);
    voices.add(voice);
    if (preview) previewVoices.add(voice);
    const start = when ?? audio.currentTime;
    voice.start(start);
    return start;
  } catch (error) {
    removeVoice(voice, true);
    throw error;
  }
}

function audioContext(allowCreate: boolean) {
  if (context?.state === "closed") discardContext();
  if (!context) {
    if (!allowCreate || typeof window.AudioContext !== "function") return null;
    const next = new window.AudioContext({ latencyHint: "interactive" });
    try {
      const gain = next.createGain();
      gain.gain.value = maxOutputGain * volume;
      gain.connect(next.destination);
      output = gain;
      context = next;
      next.onstatechange = () => {
        if (context !== next) return;
        if (next.state === "closed") discardContext();
        else if (next.state !== "running") {
          // The audio clock freezes during interruptions. Discard voices so
          // their remaining press/release/ping cannot replay on recovery.
          // Keep a fresh gesture's unlock: a prior suspend may finish later.
          clearVoices();
        } else if (!enabled || document.hidden) suspend();
      };
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
    if (audio && (audio.state !== "running" || suspending)) requestResume(audio, "prepare");
  } catch {
    // Enabling sound must stay usable when the audio device is unavailable.
  }
}

function withAudio(
  gesture: boolean,
  emit: (audio: AudioContext) => void,
  {
    preview = false,
    allowCreate = gesture,
    source = gesture ? "gesture" : "boot",
  }: { preview?: boolean; allowCreate?: boolean; source?: ResumeSource } = {},
) {
  if (!enabled || document.hidden) return;
  try {
    const audio = audioContext(allowCreate);
    if (!audio) return;
    if (gesture) {
      cancelPending();
      previewPending = preview;
    }
    if (audio.state === "running" && !suspending) emit(audio);
    else if (allowCreate) {
      // Autoplay and pointer-down can both be blocked while a release is
      // allowed. Keep their requests independent, and keep only the latest cue.
      pendingCue = { emit, requestedAt: performance.now() };
      requestResume(audio, source);
    }
  } catch {
    // Unsupported or unavailable audio must never prevent a click from saving.
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) suspend();
});

export const clickSound = {
  play(kind: SoundCue) {
    if (!powered) return;
    if (kind === "hold") {
      withAudio(false, (audio) => synthesize(audio, kind));
      return;
    }
    const physical = kind === "press" || kind === "release";
    withAudio(
      physical,
      (audio) => {
        const now = performance.now();
        const failure = kind === "error" || kind === "limited";
        // Replies can arrive together after network or event-loop delays. Keep
        // them quiet by sounding one per short window, without queuing a burst.
        // A failure can always interrupt a window started by a success cue.
        if (!physical && now - responseAt < responseInterval && (!failure || responseWasFailure))
          return;
        synthesize(audio, kind);
        if (!physical) {
          responseAt = now;
          responseWasFailure = failure;
        }
      },
      { source: kind === "press" ? "press" : "gesture" },
    );
  },
  setPowered(value: boolean) {
    powered = value;
    if (!powered) stop();
  },
  hardware(
    kind: HardwareCue,
    { gesture = false, bootDelay }: { gesture?: boolean; bootDelay?: number } = {},
  ) {
    withAudio(
      gesture,
      (audio) => {
        // Mechanical sounds can play without game power. Pair the boot tone
        // with the event that restored it on the same audio-clock origin.
        const start = startVoice(audio, renderHardwareSound(kind, audio.sampleRate));
        if (bootDelay !== undefined)
          startVoice(
            audio,
            renderHardwareSound("boot", audio.sampleRate),
            false,
            start + bootDelay / 1000,
          );
      },
      { allowCreate: gesture || kind === "boot" },
    );
  },
  preview() {
    // Schedule on the audio clock; mute, hiding, and profile changes can stop
    // the entire sequence, including voices whose start time is still ahead.
    stop();
    withAudio(
      true,
      (audio) => {
        const start = synthesize(audio, "press", true);
        const release = start + 0.06;
        synthesize(audio, "release", true, release);
        synthesize(audio, "saved", true, release + typicalSaveDelayMs / 1000);
      },
      { preview: true },
    );
  },
  cancelPreview() {
    if (previewPending) cancelPending();
    else clearRoom(true);
  },
  setProfile(value: SoundProfile) {
    if (profile === value) return;
    stop();
    profile = value;
  },
  setVolume(value: number) {
    if (volume === value) return;
    volume = value;
    if (output && context && context.state !== "closed")
      output.gain.setTargetAtTime(maxOutputGain * volume, context.currentTime, 0.01);
  },
  setReverb(value: boolean) {
    if (reverb === value) return;
    reverb = value;
    if (!reverb) {
      clearRoom(false);
      clearRoom(true);
    }
  },
  prepare,
  cancelPending,
  setEnabled(value: boolean) {
    if (enabled === value) return;
    enabled = value;
    if (!enabled) suspend();
  },
};
