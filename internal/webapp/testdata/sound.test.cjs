"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { frontend } = require("./frontend.cjs");
const settle = () => new Promise((resolve) => setImmediate(resolve));

function harness({
  state = "running",
  sampleRate = 48000,
  unavailable = false,
  fail = "",
  delayedSuspend = false,
  bufferDelay = 0,
} = {}) {
  const events = new Map(),
    contexts = [],
    buffers = [],
    sources = [];
  let resume;
  let resumes = 0;
  let suspends = 0;
  let now = 0;
  const pendingSuspends = [];
  class AudioContext {
    constructor() {
      if (fail === "constructor") throw new Error("Audio unavailable");
      this.state = state;
      this.sampleRate = sampleRate;
      this.currentTime = 10;
      this.pendingResumes = [];
      contexts.push(this);
    }
    createGain() {
      if (fail === "gain") throw new Error("Gain unavailable");
      return (this.output = {
        gain: { value: 1 },
        connect() {
          if (fail === "output-connect") throw new Error("Output unavailable");
        },
        disconnect() {
          this.disconnected = true;
        },
      });
    }
    createBuffer(channels, length, rate) {
      if (fail === "buffer") throw new Error("Allocation failed");
      assert.equal(channels, 1);
      assert.equal(rate, sampleRate);
      this.currentTime += bufferDelay;
      const samples = new Float32Array(length);
      const buffer = { samples, getChannelData: () => samples };
      buffers.push(buffer);
      return buffer;
    }
    createBufferSource() {
      const source = {
        connect() {
          if (fail === "source-connect") throw new Error("Connection unavailable");
        },
        disconnect() {
          this.disconnected = true;
        },
        start(time) {
          if (fail === "start") throw new Error("Source unavailable");
          this.started = true;
          this.startTime = time;
        },
        stop() {
          if (fail === "stop" || (fail === "start" && !this.started))
            throw new Error("Source cannot stop");
          this.stopped = true;
        },
      };
      sources.push(source);
      return source;
    }
    resume() {
      resumes++;
      if (fail === "resume") return Promise.reject(new Error("Blocked"));
      return new Promise((resolve) => {
        this.pendingResumes.push(resolve);
        resume = () => {
          this.state = "running";
          this.onstatechange?.();
          for (const finish of this.pendingResumes.splice(0)) finish();
        };
      });
    }
    suspend() {
      suspends++;
      if (fail === "suspend-throw") throw new Error("Suspend unavailable");
      if (fail === "suspend") return Promise.reject(new Error("Suspend blocked"));
      const finish = () => {
        this.state = "suspended";
        this.onstatechange?.();
      };
      if (!delayedSuspend) {
        finish();
        return Promise.resolve();
      }
      return new Promise((resolve) =>
        pendingSuspends.push(() => {
          finish();
          resolve();
        }),
      );
    }
    close() {
      this.state = "closed";
      return Promise.resolve();
    }
  }
  const document = {
    hidden: false,
    addEventListener: (name, callback) => events.set(name, callback),
  };
  const sound = frontend({
    document,
    window: { AudioContext: unavailable ? undefined : AudioContext },
    performance: { now: () => now },
  }).load("sound").clickSound;
  return {
    sound,
    contexts,
    buffers,
    sources,
    resume: () => resume(),
    captureResume: () => resume,
    resumes: () => resumes,
    suspends: () => suspends,
    suspend: () => pendingSuspends.shift()(),
    transition(value, audio = contexts.at(-1)) {
      audio.state = value;
      audio.onstatechange?.();
    },
    advance: (milliseconds) => {
      now += milliseconds;
    },
    fail: (value) => {
      fail = value;
    },
    hide() {
      document.hidden = true;
      events.get("visibilitychange")();
    },
    show() {
      document.hidden = false;
      events.get("visibilitychange")();
    },
  };
}

test("sound defaults off and neither enabling nor responses allocate audio", () => {
  const h = harness();
  for (const kind of ["press", "release", "saved", "slow", "error", "limited"]) h.sound.play(kind);
  h.sound.hardware("boot");
  assert.equal(h.contexts.length, 0);
  h.sound.setEnabled(true);
  h.sound.play("saved");
  assert.equal(h.contexts.length, 0);
  h.sound.play("press");
  h.sound.play("release");
  assert.equal(h.contexts.length, 1);
  assert.equal(h.sources.length, 2);
});

test("an allowed startup sounds once, and delayed autoplay does not replay on a later gesture", async () => {
  const allowed = harness();
  allowed.sound.setEnabled(true);
  allowed.sound.hardware("boot");
  assert.equal(allowed.sources.length, 1);

  const blocked = harness({ state: "suspended" });
  blocked.sound.setEnabled(true);
  blocked.sound.hardware("boot");
  assert.equal(blocked.sources.length, 0);
  blocked.advance(500);
  blocked.sound.play("press");
  blocked.resume();
  await settle();
  assert.equal(blocked.sources.length, 1);
  assert.ok(blocked.buffers[0].samples.length < 48000 * 0.15);
});

test("mechanical sounds work with power off and a scheduled reboot stops on another trip", () => {
  const h = harness({ bufferDelay: 0.01 });
  h.sound.setEnabled(true);
  h.sound.setPowered(false);
  h.sound.play("press");
  h.sound.hardware("test", { gesture: true });
  assert.equal(h.sources.length, 1);
  h.sound.setPowered(true);
  h.sound.hardware("reset", { gesture: true, bootDelay: 46 });
  const [, reset, boot] = h.sources;
  assert.ok(Math.abs(boot.startTime - reset.startTime - 0.046) < 0.001);
  h.sound.setPowered(false);
  assert.equal(boot.stopped, true);
  h.sound.hardware("cord-slack", { gesture: true });
  h.sound.play("release");
  assert.equal(h.sources.length, 4);
});

for (const sampleRate of [44100, 48000])
  test(`synthesized cues vary and have bounded, faded samples at ${sampleRate} Hz`, () => {
    const h = harness({ sampleRate });
    h.sound.setEnabled(true);
    const peaks = new Map();
    for (const kind of ["press", "release", "saved", "slow", "error", "limited"]) {
      h.sound.play(kind);
      h.advance(100);
      h.sound.play(kind);
      h.advance(100);
      const first = h.buffers.at(-2).samples,
        second = h.buffers.at(-1).samples;
      assert.notDeepEqual(first, second, kind);
      assert.ok(first.length > sampleRate * 0.04 && first.length < sampleRate * 0.18);
      assert.equal(Math.abs(first[0]), 0);
      assert.ok(Math.abs(first.at(-1)) === 0);
      let peak = 0;
      for (const sample of first) {
        assert.ok(Number.isFinite(sample) && Math.abs(sample) <= 0.98);
        peak = Math.max(peak, Math.abs(sample));
      }
      assert.ok(peak > 0.02);
      peaks.set(kind, peak);
    }
    for (const kind of ["saved", "slow", "error", "limited"])
      assert.ok(peaks.get(kind) < peaks.get("press") * 0.5, kind);
    assert.ok(8 * 0.98 * h.contexts[0].output.gain.value < 1, "Combined peak cannot clip");
  });

test("explicit opt-in prepares audio silently and the first press reuses it", async () => {
  const h = harness({ state: "suspended" });
  h.sound.prepare();
  assert.equal(h.contexts.length, 0);
  h.sound.setEnabled(true);
  h.sound.prepare();
  assert.equal(h.contexts.length, 1);
  assert.equal(h.sources.length, 0);
  assert.equal(h.resumes(), 1);
  h.resume();
  await settle();
  assert.equal(h.sources.length, 0);
  h.sound.play("press");
  assert.equal(h.contexts.length, 1);
  assert.equal(h.sources.length, 1);
});

test("blocked preparation remains silent and a later gesture retries", async () => {
  const h = harness({ state: "suspended", fail: "resume" });
  h.sound.setEnabled(true);
  h.sound.prepare();
  await settle();
  assert.equal(h.sources.length, 0);
  h.fail("");
  h.sound.play("release");
  assert.equal(h.resumes(), 2);
  h.resume();
  await settle();
  assert.equal(h.sources.length, 1);
});

test("muting while preparation is pending cannot play an opt-in tone", async () => {
  const h = harness({ state: "suspended" });
  h.sound.setEnabled(true);
  h.sound.prepare();
  h.sound.setEnabled(false);
  h.resume();
  await settle();
  h.sound.play("release");
  assert.equal(h.sources.length, 0);
});

test("rapid input bounds voices, ended sources disconnect, and mute stops all audio immediately", () => {
  const h = harness();
  h.sound.setEnabled(true);
  for (let i = 0; i < 100; i++) h.sound.play("press");
  assert.equal(h.sources.filter((source) => !source.stopped).length, 8);
  const ended = h.sources.at(-1);
  ended.onended();
  assert.equal(ended.disconnected, true);
  h.sound.setEnabled(false);
  assert.ok(h.sources.every((source) => source.disconnected));
  h.sound.play("release");
  assert.equal(h.sources.length, 100);
});

test("suspended audio retries on release, coalesces playback, and never queues response pings", async () => {
  const h = harness({ state: "suspended" });
  h.sound.setEnabled(true);
  for (let i = 0; i < 20; i++) h.sound.play("press");
  h.sound.play("release");
  h.sound.play("saved");
  assert.equal(h.resumes(), 21);
  assert.equal(h.sources.length, 0);
  h.resume();
  await settle();
  assert.equal(h.sources.length, 1);
  h.sound.play("saved");
  assert.equal(h.sources.length, 2);
});

for (const action of ["mute", "hide"])
  test(`${action} cancels pending unlocks and active voices`, async () => {
    const h = harness({ state: "suspended" });
    h.sound.setEnabled(true);
    h.sound.play("press");
    if (action === "mute") {
      h.sound.setEnabled(false);
      h.sound.setEnabled(true);
    } else {
      h.hide();
      h.show();
    }
    h.resume();
    await settle();
    assert.equal(h.sources.length, 0);
    h.sound.play("release");
    assert.equal(h.sources.length, 1);
    h.hide();
    assert.equal(h.sources[0].stopped, true);
    h.sound.play("saved");
    assert.equal(h.sources.length, 1);
  });

test("missing, failed and blocked audio remain harmless and retryable", async () => {
  for (const options of [
    { unavailable: true },
    { fail: "constructor" },
    { fail: "buffer" },
    { fail: "resume", state: "suspended" },
  ]) {
    const h = harness(options);
    h.sound.setEnabled(true);
    assert.doesNotThrow(() => h.sound.play("release"));
    await settle();
    assert.doesNotThrow(() => h.sound.play("press"));
    await settle();
    assert.equal(h.sources.length, 0);
    if (options.fail === "resume") assert.equal(h.resumes(), 2);
  }
});

test("a delayed unlock never replays an old gesture", async () => {
  const h = harness({ state: "suspended" });
  h.sound.setEnabled(true);
  h.sound.play("press");
  h.advance(2000);
  h.resume();
  await settle();
  assert.equal(h.sources.length, 0);
  h.sound.play("release");
  assert.equal(h.sources.length, 1);
});

test("cancelled gestures discard pending audio without cutting off a saved-response cue", async () => {
  const h = harness({ state: "suspended" });
  h.sound.setEnabled(true);
  h.sound.play("press");
  h.sound.cancelPending();
  h.resume();
  await settle();
  assert.equal(h.sources.length, 0);
  h.sound.play("saved");
  h.sound.cancelPending();
  assert.equal(h.sources.length, 1);
  assert.equal(h.sources[0].stopped, undefined);
});

test("a newer running gesture supersedes a still-pending unlock callback", async () => {
  const h = harness({ state: "suspended" });
  h.sound.setEnabled(true);
  h.sound.play("press");
  h.resume();
  h.sound.play("release");
  await settle();
  assert.equal(h.sources.length, 1);
});

for (const failure of ["gain", "output-connect", "source-connect", "start"])
  test(`partial ${failure} failure cleans up and the next gesture retries`, async () => {
    const h = harness({ fail: failure });
    h.sound.setEnabled(true);
    assert.doesNotThrow(() => h.sound.play("press"));
    if (failure === "gain" || failure === "output-connect")
      assert.equal(h.contexts[0].state, "closed");
    else assert.equal(h.sources[0].disconnected, true);
    assert.doesNotThrow(() => h.sound.setEnabled(false));
    h.fail("");
    h.sound.setEnabled(true);
    h.sound.play("release");
    if (h.resumes()) h.resume();
    await settle();
    assert.equal(h.sources.at(-1).started, true);
  });

test("a failed source stop cannot interrupt muting or leave the other voices connected", () => {
  const h = harness();
  h.sound.setEnabled(true);
  for (let i = 0; i < 3; i++) h.sound.play("press");
  h.fail("stop");
  assert.doesNotThrow(() => h.sound.setEnabled(false));
  assert.ok(h.sources.every((source) => source.disconnected));
});

test("preview stays muted by default, schedules a sample sequence, and can be stopped before replies", () => {
  const h = harness();
  h.sound.preview();
  assert.equal(h.contexts.length, 0);
  h.sound.setEnabled(true);
  h.sound.setProfile("blip");
  h.sound.preview();
  assert.equal(h.sources.length, 3);
  assert.deepEqual(
    h.sources.map((source) => source.startTime),
    [10, 10.06, 10.18],
  );
  h.sound.setEnabled(false);
  assert.ok(h.sources.every((source) => source.stopped && source.disconnected));
});

test("a new preview replaces the previous sequence and hiding stops scheduled voices", () => {
  const h = harness();
  h.sound.setEnabled(true);
  h.sound.preview();
  const first = h.sources.slice();
  h.sound.preview();
  assert.ok(first.every((source) => source.stopped));
  assert.equal(h.sources.length, 6);
  h.hide();
  assert.ok(h.sources.every((source) => source.stopped));
});

test("changing profile stops old voices, uses a different recipe, and leaves the same profile alone", () => {
  const h = harness();
  h.sound.setEnabled(true);
  h.sound.play("press");
  const classicLength = h.buffers[0].samples.length;
  h.sound.setProfile("classic");
  assert.equal(h.sources[0].stopped, undefined);
  h.sound.setProfile("clunk");
  assert.equal(h.sources[0].stopped, true);
  h.sound.play("press");
  assert.ok(h.buffers[1].samples.length > classicLength);
});

test("a profile change invalidates a preview awaiting audio unlock", async () => {
  const h = harness({ state: "suspended" });
  h.sound.setEnabled(true);
  h.sound.preview();
  h.sound.setProfile("soft-chime");
  h.resume();
  await settle();
  assert.equal(h.sources.length, 0);
  h.sound.preview();
  assert.equal(h.sources.length, 3);
});

test("a real game press cancels all remaining preview voices", () => {
  const h = harness();
  h.sound.setEnabled(true);
  h.sound.preview();
  const preview = h.sources.slice();
  h.sound.play("press");
  assert.ok(preview.every((source) => source.stopped && source.disconnected));
  assert.equal(h.sources.length, 4);
  assert.equal(h.sources[3].stopped, undefined);
});

test("focus or gesture cancellation stops previews while preserving real response sounds", () => {
  const h = harness();
  h.sound.setEnabled(true);
  h.sound.preview();
  const preview = h.sources.slice();
  h.sound.play("saved");
  h.sound.cancelPending();
  assert.ok(preview.every((source) => source.stopped));
  assert.equal(h.sources[3].stopped, undefined);
});

test("closing a preview cancels scheduled cues without cancelling a real gesture", async () => {
  const h = harness({ state: "suspended" });
  h.sound.setEnabled(true);
  h.sound.preview();
  h.sound.cancelPreview();
  h.resume();
  await settle();
  assert.equal(h.sources.length, 0);
  h.contexts[0].state = "suspended";
  h.sound.play("press");
  h.sound.cancelPreview();
  h.resume();
  await settle();
  assert.equal(h.sources.length, 1);
  h.sound.preview();
  const preview = h.sources.slice(1);
  h.sound.cancelPreview();
  assert.ok(preview.every((source) => source.stopped));
});

test("response bursts coalesce without queuing or suppressing physical input", () => {
  const h = harness();
  h.sound.setEnabled(true);
  h.sound.prepare();
  for (let i = 0; i < 50; i++) h.sound.play(i % 2 ? "saved" : "slow");
  assert.equal(h.sources.length, 1);
  for (let i = 0; i < 5; i++) {
    h.sound.play("press");
    h.sound.play("release");
    h.sound.play("saved");
  }
  assert.equal(h.sources.length, 11);
  h.advance(79);
  h.sound.play("saved");
  assert.equal(h.sources.length, 11);
  h.advance(1);
  h.sound.play("saved");
  assert.equal(h.sources.length, 12);
});

test("failure cues take priority over success bursts and briefly hold back success pings", () => {
  const h = harness();
  h.sound.setEnabled(true);
  h.sound.prepare();
  h.sound.play("saved");
  h.sound.play("error");
  assert.equal(h.sources.length, 2);
  for (const cue of ["saved", "slow", "error", "limited"]) h.sound.play(cue);
  assert.equal(h.sources.length, 2);
  h.advance(80);
  h.sound.play("limited");
  assert.equal(h.sources.length, 3);
  h.sound.play("saved");
  assert.equal(h.sources.length, 3);
  h.advance(80);
  h.sound.play("saved");
  assert.equal(h.sources.length, 4);
});

test("a muted, hidden, or failed response does not consume the next audible reply", async () => {
  const h = harness();
  h.sound.setEnabled(true);
  h.sound.prepare();
  h.sound.play("saved");
  h.sound.setEnabled(false);
  h.sound.play("saved");
  h.sound.setEnabled(true);
  h.sound.prepare();
  h.resume();
  await settle();
  h.sound.play("saved");
  assert.equal(h.sources.length, 2);
  h.hide();
  h.sound.play("saved");
  h.show();
  h.sound.prepare();
  h.resume();
  await settle();
  h.sound.play("saved");
  assert.equal(h.sources.length, 3);
  h.advance(80);
  h.fail("buffer");
  h.sound.play("saved");
  h.fail("");
  h.sound.play("saved");
  assert.equal(h.sources.length, 4);
});

for (const action of ["mute", "hide"])
  test(`${action} suspends an existing device; returning waits for a fresh gesture`, async () => {
    const h = harness();
    h.sound.setEnabled(true);
    h.sound.play("press");
    if (action === "mute") h.sound.setEnabled(false);
    else h.hide();
    await settle();
    assert.equal(h.contexts[0].state, "suspended");
    assert.equal(h.suspends(), 1);
    assert.ok(h.sources[0].stopped && h.sources[0].disconnected);
    if (action === "mute") h.sound.setEnabled(true);
    else h.show();
    h.sound.play("saved");
    assert.equal(h.resumes(), 0);
    assert.equal(h.sources.length, 1);
    h.sound.play("release");
    h.resume();
    await settle();
    assert.equal(h.contexts.length, 1);
    assert.equal(h.sources.length, 2);
  });

test("a quick opt-in during pending suspension resumes inside the gesture", async () => {
  const h = harness({ delayedSuspend: true });
  h.sound.setEnabled(true);
  h.sound.prepare();
  h.sound.setEnabled(false);
  h.sound.setEnabled(true);
  h.sound.play("saved");
  assert.equal(h.resumes(), 0);
  h.sound.prepare();
  assert.equal(
    h.resumes(),
    1,
    "A pending suspend needs resume even while state still says running",
  );
  h.suspend();
  await settle();
  h.resume();
  await settle();
  assert.equal(h.sources.length, 0);
  h.sound.play("press");
  assert.equal(h.sources.length, 1);
});

test("suspension completing after a fresh press does not cancel that press's unlock", async () => {
  const h = harness({ delayedSuspend: true });
  h.sound.setEnabled(true);
  h.sound.play("press");
  h.hide();
  h.show();
  h.sound.play("press");
  assert.equal(h.sources.length, 1);
  h.suspend();
  await settle();
  h.resume();
  await settle();
  assert.equal(h.sources.length, 2);
});

for (const state of ["suspended", "interrupted"])
  test(`device ${state} discards active and scheduled sounds before recovery`, async () => {
    const h = harness();
    h.sound.setEnabled(true);
    h.sound.preview();
    const preview = h.sources.slice();
    h.transition(state);
    assert.ok(preview.every((voice) => voice.stopped && voice.disconnected));
    h.sound.play("saved");
    assert.equal(h.sources.length, 3);
    assert.equal(h.resumes(), 0);
    h.sound.play("press");
    h.resume();
    await settle();
    assert.equal(h.sources.length, 4);
  });

test("a closed device releases its graph and only a gesture creates a replacement", () => {
  const h = harness();
  h.sound.setEnabled(true);
  h.sound.preview();
  const old = h.contexts[0];
  const oldChange = old.onstatechange;
  h.transition("closed");
  assert.ok(h.sources.every((voice) => voice.stopped && voice.disconnected));
  assert.equal(old.output.disconnected, true);
  h.sound.play("saved");
  assert.equal(h.contexts.length, 1);
  h.sound.play("press");
  assert.equal(h.contexts.length, 2);
  oldChange();
  assert.equal(h.sources.at(-1).stopped, undefined);
});

test("a late unlock for a closed context cannot sound through its replacement", async () => {
  const h = harness({ state: "suspended" });
  h.sound.setEnabled(true);
  h.sound.play("press");
  const oldResume = h.captureResume();
  const old = h.contexts[0];
  h.transition("closed");
  h.sound.play("press");
  h.resume();
  await settle();
  assert.equal(h.sources.length, 1);
  assert.equal(old.state, "closed");
  oldResume();
  await settle();
  assert.equal(h.sources.length, 1);
});

test("muting and hiding before first use never allocate an audio device", () => {
  const h = harness();
  h.hide();
  h.show();
  h.sound.setEnabled(true);
  h.sound.setEnabled(false);
  assert.equal(h.contexts.length, 0);
  assert.equal(h.suspends(), 0);
});

for (const action of ["mute", "hide"])
  test(`a late preparation resume after ${action} suspends the device again`, async () => {
    const h = harness({ state: "suspended" });
    h.sound.setEnabled(true);
    h.sound.prepare();
    if (action === "mute") h.sound.setEnabled(false);
    else h.hide();
    await settle();
    h.resume();
    await settle();
    assert.equal(h.contexts[0].state, "suspended");
    assert.ok(h.suspends() >= 2);
    assert.equal(h.sources.length, 0);
    if (action === "mute") h.sound.setEnabled(true);
    else h.show();
    h.sound.prepare();
    h.resume();
    await settle();
    h.sound.play("press");
    assert.equal(h.sources.length, 1);
  });

test("failed suspension still stops sounds and leaves controls and later playback usable", async () => {
  for (const failure of ["suspend", "suspend-throw"]) {
    const h = harness();
    h.sound.setEnabled(true);
    h.sound.play("press");
    h.fail(failure);
    assert.doesNotThrow(() => h.sound.setEnabled(false));
    await settle();
    assert.ok(h.sources[0].stopped && h.sources[0].disconnected);
    h.fail("");
    h.sound.setEnabled(true);
    h.sound.play("press");
    assert.equal(h.sources.length, 2);
  }
});

test("closed-context cleanup also works before its state event arrives", () => {
  const h = harness();
  h.sound.setEnabled(true);
  h.sound.preview();
  h.contexts[0].state = "closed";
  h.sound.play("saved");
  assert.ok(h.sources.every((voice) => voice.stopped && voice.disconnected));
  assert.equal(h.contexts[0].output.disconnected, true);
  assert.equal(h.contexts.length, 1);
  h.sound.play("press");
  assert.equal(h.contexts.length, 2);
  assert.equal(h.sources.length, 4);
});

test("preview timing uses a single audio-clock origin despite synthesis cost", () => {
  const h = harness({ bufferDelay: 0.01 });
  h.sound.setEnabled(true);
  h.sound.preview();
  const [press, release, reply] = h.sources.map((voice) => voice.startTime);
  assert.ok(Math.abs(release - press - 0.06) < 1e-8);
  assert.ok(Math.abs(reply - press - 0.18) < 1e-8);
});
