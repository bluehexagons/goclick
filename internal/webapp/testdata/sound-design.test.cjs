"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { frontend } = require("./frontend.cjs");
const design = () => frontend({}).load("sound-design");
const cues = ["press", "release", "saved", "slow", "error", "limited", "hold"];
function noise(seed = 17) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
const peak = (samples) => samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
function weightedEnergy(samples, rate) {
  const lowWeight = 1 - Math.exp((-2 * Math.PI * 160) / rate);
  const midWeight = 1 - Math.exp((-2 * Math.PI * 4800) / rate);
  let bass = 0;
  let mid = 0;
  let energy = 0;
  for (const sample of samples) {
    bass += (sample - bass) * lowWeight;
    mid += (sample - bass - mid) * midWeight;
    energy += mid * mid;
  }
  return energy / rate;
}

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
    for (const [a, b] of [
      [0, 1],
      [4, 5],
      [6, 7],
    ]) {
      const ratio = weightedEnergy(rendered[a], rate) / weightedEnergy(rendered[b], rate);
      assert.ok(ratio > 0.85 && ratio < 1.2, `${cues[a]} and ${cues[b]} levels`);
    }
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
  test(`cue levels match across profiles, with quieter replies at ${rate} Hz`, () => {
    const { soundProfiles, createSoundMotion, renderSound } = design();
    const profileLevels = new Map(cues.map((cue) => [cue, []]));
    for (const { id } of soundProfiles) {
      const motion = createSoundMotion(() => 0.5),
        levels = new Map();
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
        assert.ok(peak(a) > 0.01, `${id}.${cue} must be audible`);
        const level = weightedEnergy(a, rate);
        levels.set(cue, level);
        profileLevels.get(cue).push(level);
      }
      for (const cue of cues.slice(2))
        assert.ok(levels.get(cue) < levels.get("release") * 0.5, `${id}.${cue}`);
    }
    for (const [cue, levels] of profileLevels) {
      assert.ok(Math.max(...levels) < Math.min(...levels) * 1.4, `${cue} levels`);
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

test("connector cues get most of their attack energy from noise", () => {
  const { renderHardwareSound } = design();
  for (const rate of [44100, 48000, 96000]) {
    for (const cue of ["plug-loose", "unplug", "plug-in", "cord-slack", "cord-tension"]) {
      const tone = renderHardwareSound(cue, rate, () => 0.5);
      const samples = renderHardwareSound(cue, rate, noise());
      let energy = 0;
      let toneEnergy = 0;
      let crossEnergy = 0;
      for (let i = 0; i < rate * 0.008; i++) {
        energy += samples[i] ** 2;
        toneEnergy += tone[i] ** 2;
        crossEnergy += samples[i] * tone[i];
      }
      // Project onto the tone-only signal to account for its different gain.
      const tonalShare = crossEnergy ** 2 / (toneEnergy * energy);
      assert.ok(tonalShare < 0.5, `${cue} attack at ${rate} Hz`);
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

test("the full Clack and Clunk cue sets use filtered noise with distinct brightness", () => {
  const { createSoundMotion, renderSound } = design();
  const variation = createSoundMotion(() => 0.5).sample(0);
  const brightness = (samples) => {
    let energy = 0;
    let differences = 0;
    for (let i = 1; i < samples.length; i++) {
      energy += samples[i] ** 2;
      differences += (samples[i] - samples[i - 1]) ** 2;
    }
    return differences / energy;
  };
  for (const rate of [44100, 48000, 96000]) {
    for (const cue of cues) {
      const render = (profile, random) => renderSound(profile, cue, rate, variation, random);
      for (const profile of ["clack", "clunk"])
        assert.equal(peak(render(profile, () => 0.5)), 0, `${profile}.${cue} oscillator`);
      assert.ok(brightness(render("clack", noise())) > brightness(render("clunk", noise())) * 4);
    }
  }
});
