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

for (const rate of [44100, 48000])
  test(`every profile varies all cues, fades cleanly, and keeps replies quiet at ${rate} Hz`, () => {
    const { soundProfiles, createSoundMotion, renderSound } = design();
    for (const { id } of soundProfiles) {
      const motion = createSoundMotion(() => 0.5),
        peaks = new Map();
      for (const cue of cues) {
        const a = renderSound(id, cue, rate, motion.sample(1000, true), noise());
        const b = renderSound(id, cue, rate, motion.sample(1250, true), noise());
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
