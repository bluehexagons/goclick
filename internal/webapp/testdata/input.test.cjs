"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { frontend } = require("./frontend.cjs");

function harness(reducedMotion = true, withPower = false, withReadout = false) {
  class Event {
    constructor(type, values = {}) {
      Object.assign(this, { type, detail: 0, button: 0 }, values);
    }
    preventDefault() {
      this.defaultPrevented = true;
    }
    stopImmediatePropagation() {
      this.stopped = true;
    }
  }
  class Element {
    dataset = {};
    events = new Map();
    classes = new Set();
    captures = new Set();
    props = new Map();
    children = [];
    animations = [];
    replaceChildren() {
      this.children.length = 0;
    }
    get childElementCount() {
      return this.children.length;
    }
    get firstElementChild() {
      return this.children[0];
    }
    remove() {
      if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    }
    disabled = false;
    offsetWidth = 260;
    offsetHeight = 144;
    style = { setProperty: (key, value) => this.props.set(key, value) };
    classList = { toggle: (name, on) => (on ? this.classes.add(name) : this.classes.delete(name)) };
    addEventListener(name, callback) {
      if (!this.events.has(name)) this.events.set(name, []);
      this.events.get(name).push(callback);
    }
    dispatchEvent(event) {
      for (const callback of this.events.get(event.type) || []) {
        callback(event);
        if (event.stopped) break;
      }
      return !event.defaultPrevented;
    }
    fire(type, values) {
      return this.dispatchEvent(new Event(type, values));
    }
    append(child) {
      child.parent = this;
      this.children.push(child);
    }
    attributes = new Map();
    setAttribute(name, value) {
      this.attributes.set(name, value);
    }
    animate(keyframes, options) {
      this.animations.push({ keyframes, options });
      return { finished: new Promise(() => {}) };
    }
    getBoundingClientRect() {
      return { left: 100, top: 100, right: 360, bottom: 244, width: 260, height: 144 };
    }
    setPointerCapture(id) {
      this.captures.add(id);
    }
    hasPointerCapture(id) {
      return this.captures.has(id);
    }
    releasePointerCapture(id) {
      this.captures.delete(id);
      this.fire("lostpointercapture", { pointerId: id });
    }
    focus() {}
    click() {
      this.fire("click");
    }
  }
  const button = new Element(),
    stage = new Element(),
    rig = new Element();
  button.id = "click-button";
  button.closest = () => stage;
  button.querySelector = () => ({ textContent: "Click!", dir: "ltr" });
  const power = new Element();
  const cords = [new Element(), new Element(), new Element()];
  const outlet = [new Element(), new Element()];
  power.querySelectorAll = () => cords;
  power.querySelector = (selector) => (selector === ".power-outlet" ? outlet[0] : outlet[1]);
  const outletControl = new Element();
  stage.clientWidth = 680;
  stage.clientHeight = 290;
  stage.querySelector = (selector) => {
    if (selector === ".button-rig") return rig;
    if (selector === ".button-power" && withPower) return power;
    return selector === ".outlet-control" && withPower ? outletControl : null;
  };
  const readout = withReadout ? new Element() : null;
  if (readout) {
    const bounds = button.getBoundingClientRect();
    button.getBoundingClientRect = () => {
      const y = parseFloat(rig.props.get("--shift-y")) || 0;
      return { ...bounds, top: bounds.top + y, bottom: bounds.bottom + y };
    };
    readout.getBoundingClientRect = () => {
      const y = parseFloat(readout.props.get("--readout-offset")) || 0;
      return { top: 380 + y, bottom: 440 + y };
    };
  }
  const document = Object.assign(new Element(), {
    hidden: false,
    querySelector: (selector) => (selector === ".game-readout" ? readout : null),
    querySelectorAll: () => [button],
    createElement: () => new Element(),
  });
  let clearedSelections = 0;
  let timerID = 0;
  const timers = new Map();
  const window = Object.assign(new Element(), {
    innerWidth: 960,
    innerHeight: 720,
    clearTimeout(id) {
      timers.delete(id);
    },
    setTimeout(callback, delay) {
      timers.set(++timerID, { callback, delay });
      return timerID;
    },
    getSelection: () => ({
      removeAllRanges() {
        clearedSelections++;
      },
    }),
  });
  let frameCallback = null,
    now = 0;
  const sounds = [];
  let powered = true;
  let soundCancellations = 0;
  const runtime = frontend(
    {
      document,
      window,
      MouseEvent: Event,
      CustomEvent: Event,
      MutationObserver: class {
        observe() {}
      },
      ResizeObserver: class {
        observe() {}
      },
      performance: { now: () => now },
      requestAnimationFrame(callback) {
        frameCallback = callback;
        return 1;
      },
    },
    {
      preferences: { motionPreference: { matches: reducedMotion, addEventListener() {} } },
      sound: {
        clickSound: {
          play(kind) {
            if (powered) sounds.push(kind);
          },
          setPowered(value) {
            powered = value;
          },
          cancelPending: () => {
            soundCancellations++;
          },
        },
      },
    },
  );
  const controller = runtime.load("button").tactileButtons.get(button);
  const clicks = [];
  button.addEventListener("click", (event) => clicks.push({ x: event.clientX, y: event.clientY }));
  const pointer = (type, id, values = {}) =>
    button.fire(type, {
      pointerId: id,
      pointerType: "touch",
      isPrimary: id === 1,
      clientX: 170,
      clientY: 150,
      ...values,
    });
  return {
    button,
    stage,
    rig,
    readout,
    controller,
    power,
    cords,
    outlet,
    outletControl,
    // Project the native hit surface's face center back to screen pixels.
    // Raw CSS translation alone is magnified by the 850px perspective.
    position: () => {
      const value = (name) => parseFloat(rig.props.get(name)) || 0;
      const rx = (value("--tilt-x") * Math.PI) / 180,
        ry = (value("--tilt-y") * Math.PI) / 180;
      const front = 18 - value("--press") * 24;
      const factor = 850 / (850 - value("--lift") - Math.cos(rx) * Math.cos(ry) * front);
      return {
        x: (value("--shift-x") + Math.sin(ry) * front) * factor,
        y: (value("--shift-y") - Math.sin(rx) * Math.cos(ry) * front) * factor,
      };
    },
    frame: (time) => {
      const next = frameCallback;
      frameCallback = null;
      next?.(time);
    },
    setTime: (time) => {
      now = time;
    },
    hasFrame: () => !!frameCallback,
    clicks,
    runTimer(delay) {
      const scheduled = [...timers];
      for (const [id, timer] of scheduled) {
        if (timer.delay === delay) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
    hasTrick: runtime.load("button-tricks").hasTrick,
    sounds,
    soundCancellations: () => soundCancellations,
    pointer,
    window,
    selectionCleared: () => clearedSelections,
  };
}

test("independent fingers each activate once and preserve their release coordinates", () => {
  const h = harness();
  h.pointer("pointerdown", 1);
  h.pointer("pointerdown", 2, { clientX: 290, clientY: 180 });
  h.pointer("pointerup", 2, { clientX: 300, clientY: 190 });
  assert.equal(h.stage.classes.has("is-pressed"), true);
  assert.equal(h.button.hasPointerCapture(1), true);
  h.button.fire("click", { detail: 1, pointerType: "touch" });
  h.pointer("pointerup", 1);
  assert.deepEqual(h.clicks, [
    { x: 300, y: 190 },
    { x: 170, y: 150 },
  ]);
  assert.equal(h.stage.classes.has("is-pressed"), false);
  assert.equal(h.button.captures.size, 0);
  assert.equal(h.selectionCleared(), 2);
  assert.deepEqual(h.sounds, ["press", "press", "release", "release"]);
});

test("cancelling one finger keeps the other held; outside releases never count", () => {
  const h = harness();
  h.pointer("pointerdown", 1);
  h.pointer("pointerdown", 2);
  h.pointer("pointercancel", 2);
  assert.ok(h.soundCancellations() > 0);
  const cancelled = h.soundCancellations();
  assert.equal(h.stage.classes.has("is-pressed"), true);
  h.pointer("pointerup", 1, { clientX: 500 });
  assert.equal(h.clicks.length, 0);
  assert.equal(h.stage.classes.has("is-pressed"), false);
  assert.deepEqual(h.sounds, ["press", "press"]);
  assert.ok(h.soundCancellations() > cancelled);
});

test("mouse release plus its native click counts only once", () => {
  const h = harness();
  h.pointer("pointerdown", 1, { pointerType: "mouse" });
  h.pointer("pointerup", 1, { pointerType: "mouse" });
  h.button.fire("click", { detail: 1, pointerType: "mouse" });
  assert.equal(h.clicks.length, 1);
  assert.deepEqual(h.sounds, ["press", "release"]);
});

test("keyboard repeats and a second key cannot create extra clicks", () => {
  const h = harness();
  h.button.fire("keydown", { key: "Enter" });
  h.button.fire("keydown", { key: "Enter", repeat: true });
  h.button.fire("keydown", { key: " " });
  h.button.fire("keyup", { key: " " });
  assert.equal(h.clicks.length, 0);
  h.button.fire("keyup", { key: "Enter" });
  assert.equal(h.clicks.length, 1);
  h.button.fire("keydown", { key: " " });
  h.button.fire("blur");
  h.button.fire("keyup", { key: " " });
  assert.equal(h.clicks.length, 1);
  assert.deepEqual(h.sounds, ["press", "release", "press"]);
});

test("losing focus cancels every captured pointer without ghost clicks", () => {
  const h = harness();
  h.pointer("pointerdown", 1);
  h.pointer("pointerdown", 2);
  h.window.fire("blur");
  h.pointer("pointerup", 1);
  h.pointer("pointerup", 2);
  assert.equal(h.clicks.length, 0);
  assert.equal(h.button.captures.size, 0);
  assert.equal(h.stage.classes.has("is-pressed"), false);
  assert.ok(h.soundCancellations() > 0);
});

test("press-down compresses immediately before any animation frame or saved click", () => {
  const h = harness(false);
  h.pointer("pointerdown", 1);
  assert.equal(h.rig.props.get("--press"), "1");
  assert.equal(h.rig.props.get("--button-pop"), "0.955");
  const cloud = h.stage.children[0];
  assert.equal(cloud.childElementCount, 8);
  assert.ok(cloud.children.every((p) => p.animations[0].options.duration >= 520));
  assert.ok(parseFloat(h.rig.props.get("--glow-intensity")) > 0.8);
  assert.equal(h.stage.classes.has("is-pressed"), true);
  assert.equal(h.clicks.length, 0);
});

test("response glows finish without releasing another held pointer", () => {
  const h = harness(false);
  h.pointer("pointerdown", 1);
  h.controller.respond("slow", 700);
  assert.equal(h.stage.dataset.response, "slow");
  assert.equal(h.rig.props.get("--glow-color"), "rgb(163 138 255)");
  assert.equal(h.stage.classes.has("is-pressed"), true);
  assert.equal(h.button.hasPointerCapture(1), true);
  h.frame(300);
  assert.equal(h.rig.props.get("--glow-color"), "rgb(163 138 255)");
  h.frame(1000);
  assert.equal(h.rig.props.get("--glow-color"), "rgb(56 184 117)");
  assert.ok(parseFloat(h.rig.props.get("--glow-intensity")) < 0.6);
  assert.equal(h.stage.classes.has("is-pressed"), true);
  assert.equal(h.clicks.length, 0);
});

test("reduced motion acknowledges with static color and reset clears stale responses", () => {
  const h = harness();
  h.controller.respond("error");
  assert.equal(h.hasFrame(), false);
  assert.equal(h.rig.props.get("--glow-intensity"), "0.176");
  assert.equal(h.rig.props.get("--glow-color"), "rgb(255 125 120)");
  h.controller.reset();
  assert.equal(h.stage.dataset.response, undefined);
  assert.equal(h.rig.props.get("--glow-intensity"), "0.000");
});

test("dragging follows the pointer beyond the old stage cap and returns after release", () => {
  const h = harness(false);
  h.stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 680, height: 350 });
  h.pointer("pointerdown", 1, { pointerType: "mouse", clientX: 230, clientY: 172 });
  h.stage.fire("pointermove", { pointerId: 1, pointerType: "mouse", clientX: 310, clientY: 172 });
  for (let i = 1; i <= 90; i++) h.frame(i * 17);
  const pull = h.position().x;
  assert.ok(pull > 70 && pull < 85, `Expected a substantial pull, got ${pull}`);
  h.stage.fire("pointermove", { pointerId: 1, pointerType: "mouse", clientX: 1000, clientY: 172 });
  for (let i = 91; i <= 180; i++) h.frame(i * 17);
  assert.ok(h.position().x > 700);
  // Release outside the button and stage cancels scoring and returns to origin.
  h.pointer("pointerup", 1, { pointerType: "mouse", clientX: 1000, clientY: 172 });
  for (let i = 181; i <= 270; i++) h.frame(i * 17);
  assert.equal(h.rig.props.get("--shift-x"), "0.000px");
  assert.equal(h.clicks.length, 0);
});

test("narrow stages do not constrain the gesture and cancellation returns to the origin", () => {
  const h = harness(false);
  h.pointer("pointerdown", 1);
  h.stage.fire("pointermove", { pointerId: 1, pointerType: "touch", clientX: 1000, clientY: 1000 });
  for (let i = 1; i <= 90; i++) h.frame(i * 17);
  assert.ok(h.position().x > 700);
  assert.ok(h.position().y > 700);
  h.pointer("pointercancel", 1);
  for (let i = 91; i <= 180; i++) h.frame(i * 17);
  assert.equal(h.rig.props.get("--shift-x"), "0.000px");
  assert.equal(h.rig.props.get("--shift-y"), "0.000px");
  assert.equal(h.clicks.length, 0);
});

test("a tap between frames releases depth immediately and fades copper within 70 ms", () => {
  const h = harness(false);
  h.pointer("pointerdown", 1);
  h.setTime(8);
  h.pointer("pointerup", 1);
  assert.equal(h.rig.props.get("--press"), "0");
  assert.equal(h.stage.classes.has("is-pressed"), false);
  assert.equal(h.rig.props.get("--copper"), "0.720");
  assert.equal(h.clicks.length, 1);
  h.frame(43);
  assert.ok(parseFloat(h.rig.props.get("--copper")) < 0.2);
  h.frame(78);
  assert.equal(h.rig.props.get("--copper"), "0.000");
  assert.equal(h.rig.props.get("--press"), "0");
});

test("a new press immediately replaces the previous tap's return to gold", () => {
  const h = harness(false);
  h.pointer("pointerdown", 1);
  h.pointer("pointerup", 1);
  h.frame(30);
  h.setTime(35);
  h.pointer("pointerdown", 2);
  assert.equal(h.rig.props.get("--press"), "1");
  assert.equal(h.rig.props.get("--copper"), "1.000");
  h.frame(90);
  assert.equal(h.rig.props.get("--copper"), "1.000");
  assert.equal(h.clicks.length, 1);
  h.setTime(95);
  h.pointer("pointerup", 2);
  assert.equal(h.clicks.length, 2);
  assert.equal(h.rig.props.get("--press"), "0");
});

test("held keys release depth immediately with a slightly longer material fade", () => {
  const h = harness(false);
  h.button.fire("keydown", { key: "Enter" });
  h.setTime(500);
  h.button.fire("keyup", { key: "Enter" });
  assert.equal(h.rig.props.get("--press"), "0");
  assert.equal(h.clicks.length, 1);
  h.frame(570);
  assert.ok(parseFloat(h.rig.props.get("--copper")) > 0);
  h.frame(610);
  assert.equal(h.rig.props.get("--copper"), "0.000");
});

test("cancelled, reduced-motion, and simulated activations never impose a hold", () => {
  const cancelled = harness(false);
  cancelled.pointer("pointerdown", 1);
  cancelled.pointer("pointercancel", 1);
  assert.equal(cancelled.rig.props.get("--press"), "0");
  assert.equal(cancelled.rig.props.get("--copper"), "0.000");
  assert.equal(cancelled.clicks.length, 0);
  const reduced = harness();
  reduced.pointer("pointerdown", 1);
  reduced.pointer("pointerup", 1);
  assert.equal(reduced.rig.props.get("--copper"), "0.000");
  assert.equal(reduced.rig.props.get("--press"), "0");
  const simulated = harness(false);
  simulated.button.click();
  assert.equal(simulated.rig.props.get("--press"), "0");
  assert.equal(simulated.stage.classes.has("is-pressed"), false);
  assert.equal(simulated.clicks.length, 1);
});

test("quick taps kick harder and leave bounded sparks alive across presses", () => {
  const h = harness(false);
  h.pointer("pointerdown", 1);
  const cloud = h.stage.children[0];
  assert.equal(cloud.childElementCount, 8);
  assert.ok(cloud.children.every((p) => p.animations[0].options.duration < 780));
  h.pointer("pointerup", 1);
  assert.ok(parseFloat(h.rig.props.get("--button-pop")) >= 1.06);
  assert.equal(cloud.childElementCount, 20);
  assert.ok(cloud.children.slice(8).every((p) => p.animations[0].options.duration >= 850));
  const first = cloud.children[0];
  h.pointer("pointerdown", 2);
  h.pointer("pointerup", 2);
  assert.equal(cloud.children.includes(first), true);
  for (let i = 3; i < 20; i++) {
    h.pointer("pointerdown", i);
    h.pointer("pointerup", i);
  }
  assert.ok(cloud.childElementCount <= 64);
});

test("a deliberate fresh drag coasts on release while tiny movements and stale drags do not", () => {
  const run = (distance, wait) => {
    const h = harness(false);
    h.stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 680, height: 350 });
    h.pointer("pointerdown", 1, { clientX: 170 });
    h.setTime(16);
    h.stage.fire("pointermove", {
      pointerId: 1,
      pointerType: "touch",
      clientX: 170 + distance,
      clientY: 150,
    });
    h.frame(16);
    h.frame(32);
    const before = h.position().x;
    h.setTime(32 + wait);
    h.pointer("pointerup", 1, { clientX: 170 + distance });
    h.frame(48 + wait);
    return { before, after: h.position().x, clicks: h.clicks.length };
  };
  const deliberate = run(80, 0),
    jitter = run(6, 0),
    stopped = run(80, 100);
  assert.ok(deliberate.after > deliberate.before + 5);
  assert.ok(Math.abs(jitter.after - jitter.before) < 2);
  assert.ok(stopped.after < stopped.before + 5);
  assert.equal(deliberate.clicks, 1);
});

test("release momentum remains smooth outside a narrow stage without snapping to its old bounds", () => {
  const h = harness(false);
  h.pointer("pointerdown", 1, { clientX: 170 });
  h.setTime(16);
  h.stage.fire("pointermove", { pointerId: 1, pointerType: "touch", clientX: 330, clientY: 150 });
  for (let i = 1; i <= 8; i++) h.frame(i * 16);
  h.setTime(130);
  h.stage.fire("pointermove", { pointerId: 1, pointerType: "touch", clientX: 345, clientY: 150 });
  h.setTime(138);
  h.stage.fire("pointermove", { pointerId: 1, pointerType: "touch", clientX: 355, clientY: 150 });
  h.setTime(140);
  const before = h.position().x;
  h.pointer("pointerup", 1, { clientX: 355 });
  h.frame(156);
  const after = h.position().x;
  assert.ok(before > 100);
  assert.ok(Math.abs(after - before) < 20, `Release snapped from ${before} to ${after}`);
  assert.equal(h.clicks.length, 1);
});

test("held mouse and touch drags trail their screen destination without overshooting or crossing it on reversal", () => {
  for (const pointerType of ["mouse", "touch"])
    for (const interval of [8, 16, 33]) {
      const h = harness(false);
      h.pointer("pointerdown", 1, { pointerType, clientX: 230, clientY: 172 });
      h.stage.fire("pointermove", { pointerId: 1, pointerType, clientX: 430, clientY: 292 });
      let last = { x: 0, y: 0 };
      for (let i = 1; i <= 60; i++) {
        h.frame(i * interval);
        const position = h.position();
        assert.ok(
          position.x >= last.x - 0.003 && position.x <= 200.003,
          `Forward x: ${position.x}`,
        );
        assert.ok(
          position.y >= last.y - 0.003 && position.y <= 120.003,
          `Forward y: ${position.y}`,
        );
        if (i === 1) assert.ok(position.x > 0 && position.x < 150);
        last = position;
      }
      assert.ok(Math.abs(last.x - 200) < 0.003 && Math.abs(last.y - 120) < 0.003);
      h.stage.fire("pointermove", { pointerId: 1, pointerType, clientX: 270, clientY: 202 });
      for (let i = 61; i <= 120; i++) {
        h.frame(i * interval);
        const position = h.position();
        assert.ok(position.x <= last.x + 0.003 && position.x >= 39.997, `Reverse x: ${position.x}`);
        assert.ok(position.y <= last.y + 0.003 && position.y >= 29.997, `Reverse y: ${position.y}`);
        last = position;
      }
      assert.ok(Math.abs(last.x - 40) < 0.003 && Math.abs(last.y - 30) < 0.003);
    }
});

test("grabbing an offset button keeps its position, without adding hover movement to a short drag", () => {
  const h = harness(false);
  h.stage.fire("pointermove", { pointerId: 1, pointerType: "mouse", clientX: 320, clientY: 200 });
  for (let i = 1; i <= 90; i++) h.frame(i * 16);
  const before = h.position();
  h.pointer("pointerdown", 1, { pointerType: "mouse", clientX: 320, clientY: 200 });
  for (let i = 91; i <= 120; i++) h.frame(i * 16);
  assert.ok(Math.abs(h.position().x - before.x) < 0.003);
  assert.ok(Math.abs(h.position().y - before.y) < 0.003);
  h.stage.fire("pointermove", { pointerId: 1, pointerType: "mouse", clientX: 340, clientY: 210 });
  for (let i = 121; i <= 180; i++) {
    h.frame(i * 16);
    assert.ok(h.position().x - before.x <= 20.003);
    assert.ok(h.position().y - before.y <= 10.003);
  }
  assert.ok(Math.abs(h.position().x - before.x - 20) < 0.003);
});

test("text stays enlarged throughout a hold and shrinks smoothly only after release", () => {
  const h = harness(false);
  const size = () => parseFloat(h.rig.props.get("--label-scale-x"));
  h.button.fire("keydown", { key: "Enter" });
  const held = size();
  assert.ok(held > 1.2);
  for (const time of [50, 200, 500, 1000]) {
    h.frame(time);
    assert.equal(size(), held);
    assert.equal(h.hasFrame(), true, "Held lighting must continue after the press flash fades");
  }
  h.setTime(1000);
  h.button.fire("keyup", { key: "Enter" });
  assert.equal(size(), held);
  let previous = held;
  for (let time = 1016; time <= 1112; time += 16) {
    h.frame(time);
    assert.ok(size() >= 1 && size() <= previous);
    previous = size();
  }
  assert.equal(size(), 1);
  assert.equal(h.clicks.length, 1);
});

test("lettering returns on the same 70/110 ms clock as the press material, even across dropped frames", () => {
  for (const [hold, duration] of [
    [20, 70],
    [500, 110],
  ]) {
    const h = harness(false);
    const size = () => parseFloat(h.rig.props.get("--label-scale-x"));
    h.button.fire("keydown", { key: "Enter" });
    h.setTime(hold);
    h.button.fire("keyup", { key: "Enter" });
    assert.ok(size() > 1.2);
    h.frame(hold + duration / 2);
    assert.ok(size() > 1 && size() < 1.1, "Most of the return should happen immediately");
    h.frame(hold + duration);
    assert.equal(size(), 1);
    assert.equal(h.rig.props.get("--copper"), "0.000");
    assert.equal(h.clicks.length, 1);
  }
});

test("leaving the stage during a release resets the lettering instead of freezing it enlarged", () => {
  const h = harness(false);
  h.pointer("pointerdown", 1, { pointerType: "mouse" });
  h.setTime(20);
  h.pointer("pointerup", 1, { pointerType: "mouse" });
  assert.ok(parseFloat(h.rig.props.get("--label-scale-x")) > 1.2);
  h.stage.fire("pointerleave");
  h.frame(200);
  assert.equal(h.rig.props.get("--label-scale-x"), "1.000");
  assert.equal(h.rig.props.get("--label-charge"), "0.000");
  assert.equal(h.rig.props.get("--label-light"), "0.000");
  assert.equal(h.rig.props.get("--copper"), "0.000");
  assert.equal(h.clicks.length, 1);
});

test("the cable SVG follows dragging and resizing while the wall outlet stays fixed", () => {
  const h = harness(false, true);
  h.controller.reset();
  h.frame(0);
  const rest = h.cords[0].attributes.get("d");
  const outlet = h.outlet.map((part) => part.attributes.get("transform"));
  assert.ok(rest?.startsWith("M "));
  assert.equal(h.power.attributes.get("viewBox"), "-340 -145 680 290");
  h.pointer("pointerdown", 1);
  h.pointer("pointermove", 1, { clientX: 500, clientY: 240 });
  for (let time = 16; time <= 320; time += 16) h.frame(time);
  const dragged = h.cords[0].attributes.get("d");
  assert.notEqual(dragged, rest);
  assert.ok(h.cords.every((cord) => cord.attributes.get("d") === dragged));
  assert.deepEqual(
    h.outlet.map((part) => part.attributes.get("transform")),
    outlet,
  );
  h.stage.clientWidth = 320;
  h.stage.clientHeight = 240;
  h.window.fire("resize");
  h.frame(336);
  assert.equal(h.power.attributes.get("viewBox"), "-160 -120 320 240");
  assert.ok(Number.isFinite(Number(h.power.props.get("--cord-scale"))));
});

test("a continuous hold unlocks after ten seconds while cancellation clears the timer", () => {
  const h = harness();
  h.pointer("pointerdown", 1);
  h.pointer("pointercancel", 1);
  h.runTimer(10_000);
  assert.equal(h.hasTrick("hold"), false);
  h.pointer("pointerdown", 1);
  assert.equal(h.hasTrick("hold"), false);
  h.runTimer(10_000);
  assert.equal(h.hasTrick("hold"), true);
  assert.equal(h.clicks.length, 0);
  h.pointer("pointerup", 1);
  assert.equal(h.clicks.length, 1);
});

test("long pulls in different directions unseat the plug without scoring a click", () => {
  const h = harness(true, true);
  const move = (x, y) =>
    h.stage.fire("pointermove", {
      pointerId: 1,
      pointerType: "touch",
      clientX: 170 + x,
      clientY: 150 + y,
    });
  h.pointer("pointerdown", 1);
  move(150, 0);
  for (const x of [180, 145, 160, 165, 185]) move(x, 0);
  move(-160, 0);
  move(0, -160);
  assert.equal(h.hasTrick("loose-plug"), false);
  move(0, 160);
  assert.equal(h.hasTrick("loose-plug"), true);
  assert.equal(h.power.dataset.plug, "loose");
  assert.equal(h.outlet[0].attributes.get("transform"), "translate(0 -12)");
  assert.notEqual(h.outlet[1].attributes.get("transform"), "translate(0 -12)");
  h.pointer("pointercancel", 1);
  assert.equal(h.clicks.length, 0);
  assert.equal(h.power.dataset.plug, "loose");
});

test("adding and lifting a finger preserves the drag and never counts as another plug pull", () => {
  const h = harness(true, true);
  const move = (x, y) =>
    h.stage.fire("pointermove", { pointerId: 1, clientX: 170 + x, clientY: 150 + y });
  h.pointer("pointerdown", 1);
  for (const [x, y] of [
    [-140, 0],
    [0, 140],
    [140, 0],
  ])
    move(x, y);
  const position = h.position();
  h.pointer("pointerdown", 2, { clientX: 335, clientY: 168 });
  assert.deepEqual(h.position(), position);
  h.pointer("pointerup", 2, { clientX: 335, clientY: 168 });
  assert.deepEqual(h.position(), position);
  assert.equal(h.clicks.length, 1);
  assert.equal(h.hasTrick("loose-plug"), false);

  move(0, 140);
  assert.equal(h.hasTrick("loose-plug"), true);
  assert.equal(h.power.dataset.plug, "loose");
});

test("continued pulls unplug the button, darkening it without disabling clicks", () => {
  const h = harness(true, true);
  h.pointer("pointerdown", 1);
  for (const [x, y] of [
    [190, 0],
    [-190, 0],
    [0, -190],
    [0, 190],
    [220, 0],
    [0, -220],
    [0, 220],
  ]) {
    h.stage.fire("pointermove", { pointerId: 1, clientX: 170 + x, clientY: 150 + y });
  }
  assert.equal(h.power.dataset.plug, "unplugged");
  assert.ok(h.outlet[1].attributes.get("transform").includes("rotate("));
  assert.equal(h.rig.props.get("--glow-intensity"), "0.000");
  const before = h.sounds.length;
  h.controller.respond("fast");
  assert.equal(h.rig.props.get("--glow-intensity"), "0.000");
  h.pointer("pointercancel", 1);
  h.pointer("pointerdown", 1);
  h.pointer("pointerup", 1);
  assert.equal(h.clicks.length, 1);
  assert.equal(h.sounds.length, before);
  assert.equal(h.power.dataset.plug, "unplugged");
});

test("the outlet's test and reset cycle power without scoring a click", () => {
  const h = harness(true, true);
  h.pointer("pointerdown", 1);
  assert.ok(Number(h.rig.props.get("--glow-intensity")) > 0);
  const tap = { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 230, clientY: 175 };
  h.outletControl.fire("pointerdown", tap);
  h.outletControl.fire("pointercancel", tap);
  h.outletControl.fire("pointerup", tap);
  assert.equal(h.outletControl.dataset.press, undefined);
  h.outletControl.fire("pointerdown", tap);
  h.outletControl.fire("pointerup", tap);
  h.outletControl.fire("click", { ...tap, detail: 1 });
  assert.equal(h.outletControl.attributes.get("aria-pressed"), "true");
  assert.equal(h.outletControl.dataset.press, "test");
  assert.equal(h.rig.props.get("--glow-intensity"), "0.000");
  assert.equal(h.clicks.length, 0);
  h.pointer("pointerup", 1);
  h.pointer("pointerdown", 1);
  h.pointer("pointerup", 1);
  assert.equal(h.clicks.length, 2);
  assert.deepEqual(h.sounds, ["press"]);

  h.outletControl.click();
  assert.equal(h.outletControl.attributes.get("aria-pressed"), "false");
  assert.equal(h.outletControl.dataset.press, "reset");
  assert.equal(h.clicks.length, 2);
  h.pointer("pointerdown", 1);
  assert.ok(Number(h.rig.props.get("--glow-intensity")) > 0);
  h.pointer("pointerup", 1);
  assert.deepEqual(h.sounds, ["press", "press", "release"]);
});

test("a long mouse drag lets the connected button return immediately", () => {
  const h = harness(true, true);
  const face = h.button.getBoundingClientRect();
  h.button.getBoundingClientRect = () => {
    const x = h.position().x;
    return { ...face, left: face.left + x, right: face.right + x };
  };
  h.outletControl.getBoundingClientRect = () => ({ left: 203, right: 257, top: 128, bottom: 224 });
  h.pointer("pointerdown", 1, { pointerType: "mouse" });
  h.stage.fire("pointermove", { pointerId: 1, pointerType: "mouse", clientX: 350, clientY: 150 });
  h.pointer("pointerup", 1, { pointerType: "mouse", clientX: 350 });
  assert.equal(h.clicks.length, 1);
  assert.equal(h.position().x, 0);
});

test("the unplugged button stays where it is released and remains reachable after resize", () => {
  for (const [pointerType, reduced] of [
    ["mouse", false],
    ["touch", true],
  ]) {
    const h = harness(reduced, true);
    const move = (x, y) =>
      h.stage.fire("pointermove", {
        pointerId: 1,
        pointerType,
        clientX: 170 + x,
        clientY: 150 + y,
      });
    let time = 0;
    const settle = () => {
      for (let i = 0; i < 130; i++) {
        time += 17;
        h.setTime(time);
        h.frame(time);
      }
    };
    const position = () => {
      const { x, y } = h.position();
      return [Math.round(x), Math.round(y)];
    };
    h.pointer("pointerdown", 1, { pointerType });
    for (const [x, y] of [
      [190, 0],
      [-190, 0],
      [0, -190],
      [0, 190],
      [220, 0],
      [0, -220],
      [185, 96],
    ])
      move(x, y);
    assert.equal(h.power.dataset.plug, "unplugged");
    h.pointer("pointerup", 1, { pointerType, clientX: 355, clientY: 246 });
    settle();
    assert.deepEqual(position(), [185, 96]);
    assert.equal(h.clicks.length, 1);

    h.stage.fire("pointermove", { pointerId: 1, pointerType: "mouse", clientX: 100, clientY: 150 });
    h.stage.fire("pointerleave");
    h.window.fire("blur");
    settle();
    assert.deepEqual(position(), [185, 96]);

    h.pointer("pointerdown", 1, { pointerType, clientX: 355, clientY: 246 });
    move(225, 110);
    h.pointer("pointerup", 1, { pointerType, clientX: 395, clientY: 260 });
    settle();
    assert.deepEqual(position(), [225, 110]);

    h.window.innerWidth = 400;
    h.window.fire("resize");
    settle();
    assert.deepEqual(position(), [154, 110]);
  }
});

test("the dangling plug can reconnect to either socket by holding or tapping", () => {
  const h = harness(true, true);
  const plug = h.outlet[1];
  const move = (x, y) =>
    h.stage.fire("pointermove", { pointerId: 1, clientX: 170 + x, clientY: 220 + y });
  const pullFree = () => {
    for (const [x, y] of [
      [190, 0],
      [-190, 0],
      [0, -190],
      [0, 190],
      [220, 0],
      [0, -220],
      [0, 220],
    ])
      move(x, y);
    assert.equal(h.power.dataset.plug, "unplugged");
  };
  const start = (x = 0, y = 0) =>
    h.pointer("pointerdown", 1, { clientX: 170 + x, clientY: 220 + y });
  start();
  pullFree();
  move(35, -125);
  assert.equal(h.power.dataset.dock, "bottom");
  move(80, -125);
  assert.equal(h.power.dataset.dock, undefined);
  h.runTimer(3000);
  assert.equal(h.power.dataset.plug, "unplugged");
  move(35, -125);
  h.pointer("pointercancel", 1);
  h.runTimer(3000);
  assert.equal(h.power.dataset.plug, "unplugged");

  start(35, -125);
  move(35, -125);
  const drag = h.position();
  h.runTimer(3000);
  assert.equal(h.power.dataset.plug, "seated");
  assert.equal(h.power.dataset.dock, undefined);
  assert.equal(plug.attributes.get("transform"), "translate(0 -12)");
  assert.deepEqual(h.position(), drag);
  assert.ok(Number(h.rig.props.get("--glow-intensity")) > 0);
  h.pointer("pointercancel", 1);

  h.outletControl.click();
  start();
  pullFree();
  assert.equal(h.outletControl.disabled, true);
  h.outletControl.click();
  assert.equal(h.outletControl.attributes.get("aria-pressed"), "true");
  move(35, -173);
  assert.equal(h.power.dataset.dock, "top");
  plug.fire("pointerdown", { pointerId: 2, clientX: 228, clientY: 150 });
  plug.fire("pointerup", { pointerId: 2, clientX: 248, clientY: 150 });
  assert.equal(h.power.dataset.plug, "unplugged");
  plug.fire("pointerdown", { pointerId: 2, clientX: 228, clientY: 150 });
  plug.fire("pointerup", { pointerId: 2, clientX: 228, clientY: 150 });
  assert.equal(h.power.dataset.plug, "seated");
  assert.equal(plug.attributes.get("transform"), "translate(0 -58)");
  assert.equal(h.outletControl.disabled, false);
  assert.equal(h.rig.props.get("--glow-intensity"), "0.000");
  h.outletControl.click();
  assert.ok(Number(h.rig.props.get("--glow-intensity")) > 0);
  assert.equal(h.clicks.length, 0);
  assert.equal(h.button.hasPointerCapture(1), true);
  h.pointer("pointercancel", 1);
  start();
  h.pointer("pointerup", 1, { clientY: 220 });
  assert.equal(h.clicks.length, 1);
  assert.deepEqual(h.sounds.slice(-2), ["press", "release"]);
});

test("the plug rocks free and the drained lights stay dark after release and new clicks", () => {
  const h = harness(false, true);
  const move = (x, y) =>
    h.stage.fire("pointermove", { pointerId: 1, clientX: 170 + x, clientY: 150 + y });
  const frame = (time) => {
    h.setTime(time);
    h.frame(time);
    return Number(h.rig.props.get("--glow-intensity"));
  };
  const plugOrigin = () => h.cords[0].attributes.get("d").split(" ").slice(1, 3).map(Number);
  h.pointer("pointerdown", 1);
  for (const [x, y] of [
    [190, 0],
    [-190, 0],
    [0, -190],
    [0, 190],
  ])
    move(x, y);
  frame(0);
  assert.deepEqual(plugOrigin(), [0, 0]);
  frame(130);
  assert.ok(plugOrigin()[1] > 0);

  for (const [x, y] of [
    [220, 0],
    [0, -220],
    [0, 220],
  ])
    move(x, y);
  const initialLight = frame(130);
  assert.ok(initialLight >= 0.45);
  const dropout = frame(186);
  h.pointer("pointerup", 1);
  assert.ok(frame(230) > dropout);
  assert.ok(frame(460) < initialLight);
  assert.equal(frame(1050), 0);
  h.pointer("pointerdown", 1);
  h.pointer("pointerup", 1);
  h.controller.respond("fast");
  assert.equal(frame(1090), 0);
  assert.equal(h.clicks.length, 2);
  assert.deepEqual(h.sounds, ["press"]);
});

test("the stats slide and dim when they cross the button, then return to rest", () => {
  const h = harness(false, false, true);
  h.window.innerHeight = 520;
  const move = (y) => h.stage.fire("pointermove", { pointerId: 1, clientX: 170, clientY: 150 + y });
  const offset = () => parseFloat(h.readout.props.get("--readout-offset"));
  const opacity = () => Number(h.readout.props.get("--readout-opacity") ?? 1);
  let time = 0;
  const frame = () => {
    time += 17;
    h.setTime(time);
    h.frame(time);
  };
  h.pointer("pointerdown", 1);
  move(175);
  for (let i = 0; i < 55; i++) frame();
  assert.ok(offset() > 0);
  assert.equal(opacity(), 1);

  move(230);
  frame();
  const first = offset();
  assert.ok(first > 0);
  assert.ok(opacity() < 1);
  frame();
  assert.ok(offset() < first);
  assert.ok(offset() > -100);
  for (let i = 0; i < 55; i++) frame();
  assert.ok(offset() < -100);
  assert.equal(opacity(), 1);

  h.pointer("pointercancel", 1);
  for (let i = 0; i < 90; i++) frame();
  assert.equal(offset(), 0);
  assert.equal(opacity(), 1);
  assert.equal(h.hasFrame(), false);
});

test("with reduced motion the stats move out of the way at full opacity", () => {
  const h = harness(true, false, true);
  h.window.innerHeight = 520;
  h.pointer("pointerdown", 1);
  h.stage.fire("pointermove", { pointerId: 1, clientX: 170, clientY: 380 });
  assert.ok(parseFloat(h.readout.props.get("--readout-offset")) < -100);
  assert.equal(Number(h.readout.props.get("--readout-opacity") ?? 1), 1);
  h.pointer("pointercancel", 1);
  assert.equal(h.readout.props.get("--readout-offset"), "0px");
});

test("nearby releases count and fast drags can release ahead of the painted face", () => {
  for (const [pointerType, x] of [
    ["mouse", 370],
    ["touch", 381],
  ]) {
    const h = harness(false);
    h.pointer("pointerdown", 1, { pointerType, clientX: 349 });
    h.pointer("pointerup", 1, { pointerType, clientX: x });
    assert.equal(h.clicks.length, 1);
    h.pointer("pointerdown", 1, { pointerType });
    h.stage.fire("pointermove", { pointerId: 1, pointerType, clientX: 460, clientY: 150 });
    h.pointer("pointerup", 1, { pointerType, clientX: 460 });
    assert.equal(h.clicks.length, 2);
  }
});

test("hold glow and its audio beat repeat after the achievement has been earned", () => {
  const h = harness(false);
  h.pointer("pointerdown", 1);
  h.setTime(10_000);
  h.runTimer(10_000);
  h.frame(10_000);
  assert.equal(h.hasTrick("hold"), true);
  h.pointer("pointerup", 1);
  h.pointer("pointerdown", 1);
  h.setTime(12_000);
  h.runTimer(2000);
  h.frame(12_000);
  assert.equal(h.sounds.at(-1), "hold");
  assert.ok(Number(h.rig.props.get("--glow-intensity")) > 0.38);
  h.pointer("pointercancel", 1);
  h.setTime(14_000);
  h.runTimer(2000);
  assert.equal(h.sounds.filter((kind) => kind === "hold").length, 1);
});

test("an auxiliary mouse click earns Wrong Button without activating the button", () => {
  const h = harness();
  assert.equal(h.button.fire("auxclick", { button: 2 }), false);
  assert.equal(h.hasTrick("wrong-button"), true);
  assert.equal(h.clicks.length, 0);
});
