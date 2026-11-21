"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { frontend } = require("./frontend.cjs");
const design = () => frontend({}).load("sound-design");
const cues = ["press", "release", "saved", "slow", "error", "limited"];
function noise(seed = 17) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
const peak = (samples) => samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);

test("the hardware cues have clean envelopes, and TEST hits harder than RESET", () => {
  const { renderHardwareSound } = design();
  const cues = [
    "boot",
    "test",
    "reset",
    "plug-loose",
    "unplug",
    "plug-in",
    "cord-slack",
    "cord-tension",
  ];
  for (const rate of [44100, 48000, 96000]) {
    const rendered = cues.map((cue) => renderHardwareSound(cue, rate, noise()));
    for (const signal of rendered) {
      assert.ok(signal.length >= rate * 0.1 && signal.length <= rate * 0.351);
      assert.equal(signal[0], 0);
      assert.equal(signal.at(-1), 0);
      assert.ok(peak(signal) > 0.06 && peak(signal) < 0.98);
    }
    assert.ok(peak(rendered[1]) > 1.4 * peak(rendered[2]));
    assert.notDeepEqual(rendered[6], rendered[7]);
  }
});

test("profile catalog has stable unique IDs and rejects unknown settings", () => {
  const { soundProfiles, isSoundProfile } = design();
  assert.equal(new Set(soundProfiles.map((p) => p.id)).size, 6);
  for (const profile of soundProfiles) {
    assert.ok(isSoundProfile(profile.id));
    assert.ok(profile.name && profile.description);
  }
  for (const invalid of [null, true, {}, "__proto__", "unknown"])
    assert.equal(isSoundProfile(invalid), false);
});

test("idle variation follows continuous time curves without drawing fresh randomness", () => {
  const { createSoundMotion } = design();
  let draws = 0;
  const motion = createSoundMotion(() => {
    draws++;
    return 0.5;
  });
  const a = motion.sample(1000),
    b = motion.sample(1001),
    later = motion.sample(5000);
  assert.equal(draws, 2);
  for (const key of Object.keys(a)) assert.ok(Math.abs(a[key] - b[key]) < 0.001, key);
  assert.notDeepEqual(a, later);
  const direct = createSoundMotion(() => 0.5),
    stepped = createSoundMotion(() => 0.5);
  direct.sample(0);
  for (let time = 0; time < 1500; time += 10) stepped.sample(time);
  assert.deepEqual(direct.sample(1500), stepped.sample(1500));
});

test("press activity rises gently, stays bounded, and decays after a pause; replies share the curve", () => {
  const { createSoundMotion } = design();
  const active = createSoundMotion(() => 0.5),
    idle = createSoundMotion(() => 0.5);
  for (let time = 0; time <= 5000; time += 50) active.sample(time, true);
  const held = active.sample(5000),
    baseline = idle.sample(5000),
    released = active.sample(5010);
  assert.ok(held.pitch > baseline.pitch && held.pitch - baseline.pitch <= 0.036);
  assert.ok(Math.abs(held.pitch - released.pitch) < 0.001);
  const rested = active.sample(15000),
    restingBaseline = idle.sample(15000);
  assert.ok(Math.abs(rested.pitch - restingBaseline.pitch) < 0.0001);
  for (let time = 15000; time < 100000; time += 50) {
    const value = active.sample(time, true);
    assert.ok(value.pitch > 0.95 && value.pitch < 1.09);
    assert.ok(value.texture >= 0.75 && value.texture <= 1.13);
    assert.ok(value.strength > 0.9 && value.strength < 1);
  }
});

for (const rate of [44100, 48000, 96000])
  test(`every profile varies all cues, fades cleanly, and keeps replies quiet at ${rate} Hz`, () => {
    const { soundProfiles, createSoundMotion, renderSound } = design();
    for (const { id } of soundProfiles) {
      const motion = createSoundMotion(() => 0.5),
        peaks = new Map();
      let time = 1000;
      for (const cue of cues) {
        const a = renderSound(id, cue, rate, motion.sample(time, cue === "press"), noise());
        const b = renderSound(id, cue, rate, motion.sample(time + 250, cue === "press"), noise());
        time += 500;
        assert.notDeepEqual(a, b, `${id}.${cue} must vary even with the same noise seed`);
        assert.ok(a.length > rate * 0.04 && a.length < rate * 0.18);
        assert.equal(Math.abs(a[0]), 0);
        assert.equal(Math.abs(a.at(-1)), 0);
        for (const sample of a)
          assert.ok(Number.isFinite(sample) && Math.abs(sample) < 0.98, `${id}.${cue}`);
        peaks.set(cue, peak(a));
        assert.ok(peaks.get(cue) > 0.01, `${id}.${cue} must be audible`);
      }
      for (const cue of cues.slice(2))
        assert.ok(peaks.get(cue) < peaks.get("press") * 0.5, `${id}.${cue}`);
    }
  });

test("recipes have distinct tails and pitch ranges for different preferences", () => {
  const { createSoundMotion, renderSound } = design();
  const variation = createSoundMotion(() => 0.5).sample(0);
  const render = (id) => renderSound(id, "press", 48000, variation, noise());
  const lateEnergy = (samples) => samples.slice(1920).reduce((sum, x) => sum + x * x, 0);
  assert.ok(lateEnergy(render("clack")) < lateEnergy(render("soft-chime")) * 0.05);
  const crossings = (samples) => {
    let count = 0;
    for (let i = 1; i < 1920; i++) if (samples[i - 1] < 0 && samples[i] >= 0) count++;
    return count;
  };
  assert.ok(crossings(render("low-beep")) < crossings(render("blip")) * 0.5);
});

test("key clicks and connector cues get most of their attack energy from noise", () => {
  const { createSoundMotion, renderSound, renderHardwareSound } = design();
  const variation = createSoundMotion(() => 0.5).sample(0);
  for (const rate of [44100, 48000, 96000]) {
    const renderers = [
      ...["press", "release"].map(
        (cue) => (random) => renderSound("clack", cue, rate, variation, random),
      ),
      ...["plug-loose", "unplug", "plug-in", "cord-slack", "cord-tension"].map(
        (cue) => (random) => renderHardwareSound(cue, rate, random),
      ),
    ];
    for (const render of renderers) {
      const tone = render(() => 0.5);
      const samples = render(noise());
      let noiseEnergy = 0;
      let toneEnergy = 0;
      for (let i = 0; i < rate * 0.008; i++) {
        noiseEnergy += (samples[i] - tone[i]) ** 2;
        toneEnergy += tone[i] ** 2;
      }
      assert.ok(noiseEnergy > toneEnergy, `attack at ${rate} Hz`);
    }
  }
});

test("room impulse has a short onset delay, decaying tail, and bounded gain", () => {
  const { renderRoomImpulse } = design();
  for (const rate of [44100, 48000, 96000]) {
    const impulse = renderRoomImpulse(rate, noise());
    assert.equal(impulse.length, Math.ceil(rate * 0.13));
    assert.equal(
      impulse.findIndex((sample) => sample !== 0),
      Math.round(rate * 0.007),
    );
    const sum = (from, to) =>
      impulse.slice(rate * from, rate * to).reduce((total, sample) => total + Math.abs(sample), 0);
    assert.ok(sum(0, 0.13) < 0.46);
    assert.ok(sum(0.036, 0.056) > 0.06);
    assert.ok(sum(0.11, 0.13) < 0.005);
  }
});

test("release envelopes stay shorter, lighter, and lower in energy than presses", () => {
  const { soundProfiles, createSoundMotion, renderSound } = design();
  const energy = (samples) => samples.reduce((sum, sample) => sum + sample * sample, 0);
  for (const rate of [44100, 48000]) {
    for (const { id } of soundProfiles) {
      const motion = createSoundMotion(() => 0.5);
      for (const time of [0, 500, 5000]) {
        const variation = motion.sample(time, true);
        const press = renderSound(id, "press", rate, variation, noise());
        const release = renderSound(id, "release", rate, variation, noise());
        assert.ok(release.length < press.length * 0.85, `${id} release duration`);
        assert.ok(peak(release) < peak(press) * 0.85, `${id} release peak`);
        assert.ok(energy(release) < energy(press) * 0.65, `${id} release energy`);
      }
    }
  }
});

test("Blip failure and cooldown cues step down while success cues step up", () => {
  const { createSoundMotion, renderSound } = design();
  const variation = createSoundMotion(() => 0.5).sample(0);
  const frequency = (samples, rate, from, until) => {
    let crossings = 0;
    for (let i = Math.ceil(from * rate); i < until * rate; i++)
      if (samples[i - 1] < 0 && samples[i] >= 0) crossings++;
    return crossings / (until - from);
  };
  for (const rate of [44100, 48000, 96000]) {
    for (const cue of ["saved", "slow", "error", "limited"]) {
      const samples = renderSound("blip", cue, rate, variation, noise());
      const early = frequency(samples, rate, 0.002, 0.017);
      const late = frequency(samples, rate, 0.035, 0.065);
      assert.ok(cue === "error" || cue === "limited" ? late < early : late > early, cue);
    }
  }
});

test("Clunk's noise decay follows elapsed time at different device sample rates", () => {
  const { createSoundMotion, renderSound } = design();
  const variation = createSoundMotion(() => 0.5).sample(0);
  const ratios = [48000, 96000].map((rate) => {
    let first = true;
    const impulse = renderSound("clunk", "press", rate, variation, () => {
      const value = first ? 1 : 0.5;
      first = false;
      return value;
    });
    const silent = renderSound("clunk", "press", rate, variation, () => 0.5);
    const a = rate / 4800,
      b = rate / 2400;
    // Both samples are in the linear attack. Remove its change to isolate decay.
    return (impulse[b] - silent[b]) / (impulse[a] - silent[a]) / 2;
  });
  assert.ok(Math.abs(ratios[0] - ratios[1]) < 0.002, ratios.join(", "));
});
