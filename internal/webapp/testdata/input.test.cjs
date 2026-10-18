"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { frontend } = require("./frontend.cjs");

function harness(reducedMotion = true) {
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
    setAttribute() {}
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
  button.closest = () => stage;
  stage.querySelector = () => rig;
  const document = Object.assign(new Element(), {
    hidden: false,
    querySelectorAll: () => [button],
    createElement: () => new Element(),
  });
  let clearedSelections = 0;
  const window = Object.assign(new Element(), {
    clearTimeout() {},
    setTimeout() {
      return 1;
    },
    getSelection: () => ({
      removeAllRanges() {
        clearedSelections++;
      },
    }),
  });
  let frameCallback = null,
    now = 0;
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
    { preferences: { motionPreference: { matches: reducedMotion, addEventListener() {} } } },
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
    controller,
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
});

test("cancelling one finger keeps the other held; outside releases never count", () => {
  const h = harness();
  h.pointer("pointerdown", 1);
  h.pointer("pointerdown", 2);
  h.pointer("pointercancel", 2);
  assert.equal(h.stage.classes.has("is-pressed"), true);
  h.pointer("pointerup", 1, { clientX: 500 });
  assert.equal(h.clicks.length, 0);
  assert.equal(h.stage.classes.has("is-pressed"), false);
});

test("mouse release plus its native click counts only once", () => {
  const h = harness();
  h.pointer("pointerdown", 1, { pointerType: "mouse" });
  h.pointer("pointerup", 1, { pointerType: "mouse" });
  h.button.fire("click", { detail: 1, pointerType: "mouse" });
  assert.equal(h.clicks.length, 1);
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
