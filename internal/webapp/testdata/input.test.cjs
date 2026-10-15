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
  assert.equal(h.stage.classes.has("is-pressed"), true);
  assert.equal(h.clicks.length, 0);
});

test("response sweeps finish without releasing another held pointer", () => {
  const h = harness(false);
  h.pointer("pointerdown", 1);
  h.controller.respond("slow", 700);
  assert.equal(h.stage.dataset.response, "slow");
  assert.match(h.rig.props.get("--response-wash"), /163,138,255/);
  assert.equal(h.stage.classes.has("is-pressed"), true);
  assert.equal(h.button.hasPointerCapture(1), true);
  h.frame(1000);
  assert.match(h.rig.props.get("--response-wash"), /,0\.000\)/);
  assert.equal(h.stage.classes.has("is-pressed"), true);
  assert.equal(h.clicks.length, 0);
});

test("reduced motion acknowledges with static color and reset clears stale responses", () => {
  const h = harness();
  h.controller.respond("error");
  assert.equal(h.hasFrame(), false);
  assert.match(h.rig.props.get("--response-wash"), /255,125,120,0\.110/);
  h.controller.reset();
  assert.equal(h.stage.dataset.response, undefined);
  assert.match(h.rig.props.get("--response-wash"), /,0\.000\)/);
});

test("drag travel grows with the stage, stays bounded, and returns on mouse release", () => {
  const h = harness(false);
  h.stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 680, height: 350 });
  h.pointer("pointerdown", 1, { pointerType: "mouse", clientX: 230, clientY: 172 });
  h.stage.fire("pointermove", { pointerId: 1, pointerType: "mouse", clientX: 310, clientY: 172 });
  for (let i = 1; i <= 90; i++) h.frame(i * 17);
  const pull = parseFloat(h.rig.props.get("--shift-x"));
  assert.ok(pull > 45 && pull < 60, `Expected a substantial pull, got ${pull}`);
  h.stage.fire("pointermove", { pointerId: 1, pointerType: "mouse", clientX: 1000, clientY: 172 });
  for (let i = 91; i <= 180; i++) h.frame(i * 17);
  assert.ok(parseFloat(h.rig.props.get("--shift-x")) <= 88.01);
  // Release outside cancels scoring and returns to the small hover displacement.
  h.pointer("pointerup", 1, { pointerType: "mouse", clientX: 1000, clientY: 172 });
  for (let i = 181; i <= 270; i++) h.frame(i * 17);
  assert.equal(h.rig.props.get("--shift-x"), "4.000px");
  assert.equal(h.clicks.length, 0);
});

test("narrow stages limit dragging and cancellation returns to the origin", () => {
  const h = harness(false);
  h.pointer("pointerdown", 1);
  h.stage.fire("pointermove", { pointerId: 1, pointerType: "touch", clientX: 1000, clientY: 1000 });
  for (let i = 1; i <= 90; i++) h.frame(i * 17);
  assert.ok(parseFloat(h.rig.props.get("--shift-x")) <= 24.01);
  assert.ok(parseFloat(h.rig.props.get("--shift-y")) <= 28.01);
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
  h.pointer("pointerup", 1);
  assert.ok(parseFloat(h.rig.props.get("--button-pop")) >= 1.06);
  const cloud = h.stage.children[0];
  assert.equal(cloud.childElementCount, 12);
  assert.ok(cloud.children.every((p) => p.animations[0].options.duration >= 850));
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
    const before = parseFloat(h.rig.props.get("--shift-x"));
    h.setTime(32 + wait);
    h.pointer("pointerup", 1, { clientX: 170 + distance });
    h.frame(48 + wait);
    return { before, after: parseFloat(h.rig.props.get("--shift-x")), clicks: h.clicks.length };
  };
  const deliberate = run(80, 0),
    jitter = run(6, 0),
    stopped = run(80, 100);
  assert.ok(deliberate.after > deliberate.before + 5);
  assert.ok(Math.abs(jitter.after - jitter.before) < 2);
  assert.ok(stopped.after < stopped.before + 5);
  assert.equal(deliberate.clicks, 1);
});
