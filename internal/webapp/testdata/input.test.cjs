"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function harness(reducedMotion = true) {
  class Event {
    constructor(type, values = {}) { Object.assign(this, { type, detail: 0, button: 0 }, values); }
    preventDefault() { this.defaultPrevented = true; }
    stopImmediatePropagation() { this.stopped = true; }
  }
  class Element {
    dataset = {}; events = new Map(); classes = new Set(); captures = new Set(); props = new Map(); children = [];
    disabled = false; offsetWidth = 260;
    style = { setProperty: (key, value) => this.props.set(key, value) };
    classList = { toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) };
    addEventListener(name, callback) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(callback); }
    dispatchEvent(event) { for (const callback of this.events.get(event.type) || []) { callback(event); if (event.stopped) break; } return !event.defaultPrevented; }
    fire(type, values) { return this.dispatchEvent(new Event(type, values)); }
    append(child) { this.children.push(child); }
    setAttribute() {}
    getBoundingClientRect() { return { left: 100, top: 100, right: 360, bottom: 244, width: 260, height: 144 }; }
    setPointerCapture(id) { this.captures.add(id); }
    hasPointerCapture(id) { return this.captures.has(id); }
    releasePointerCapture(id) { this.captures.delete(id); this.fire("lostpointercapture", { pointerId: id }); }
    focus() {}
    click() { this.fire("click"); }
  }
  const button = new Element(), stage = new Element(), rig = new Element();
  button.closest = () => stage; stage.querySelector = () => rig;
  const document = Object.assign(new Element(), { hidden: false, querySelectorAll: () => [button], createElement: () => new Element() });
  let clearedSelections = 0;
  const window = Object.assign(new Element(), { clearTimeout() {}, setTimeout() { return 1; }, getSelection: () => ({ removeAllRanges() { clearedSelections++; } }) });
  let frameCallback = null;
  const context = vm.createContext({
    document, window, MouseEvent: Event, CustomEvent: Event,
    motionPreference: { matches: reducedMotion, addEventListener() {} },
    MutationObserver: class { observe() {} }, ResizeObserver: class { observe() {} }, performance: { now: () => 0 }, requestAnimationFrame(callback) { frameCallback = callback; return 1; },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../web/button.js"), "utf8"), context);
  const controller = vm.runInContext("tactileButtons.get(document.querySelectorAll()[0])", context);
  const clicks = [];
  button.addEventListener("click", event => clicks.push({ x: event.clientX, y: event.clientY }));
  const pointer = (type, id, values = {}) => button.fire(type, { pointerId: id, pointerType: "touch", isPrimary: id === 1, clientX: 170, clientY: 150, ...values });
  return { button, stage, rig, controller, frame: time => { const next = frameCallback; frameCallback = null; next?.(time); }, hasFrame: () => !!frameCallback, clicks, pointer, window, selectionCleared: () => clearedSelections };
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
  assert.deepEqual(h.clicks, [{ x: 300, y: 190 }, { x: 170, y: 150 }]);
  assert.equal(h.stage.classes.has("is-pressed"), false);
  assert.equal(h.button.captures.size, 0);
  assert.equal(h.selectionCleared(), 2);
});

test("cancelling one finger keeps the other held; outside releases never count", () => {
  const h = harness();
  h.pointer("pointerdown", 1); h.pointer("pointerdown", 2);
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
  h.button.fire("keydown", { key: " " }); h.button.fire("blur"); h.button.fire("keyup", { key: " " });
  assert.equal(h.clicks.length, 1);
});

test("losing focus cancels every captured pointer without ghost clicks", () => {
  const h = harness();
  h.pointer("pointerdown", 1); h.pointer("pointerdown", 2);
  h.window.fire("blur");
  h.pointer("pointerup", 1); h.pointer("pointerup", 2);
  assert.equal(h.clicks.length, 0);
  assert.equal(h.button.captures.size, 0);
  assert.equal(h.stage.classes.has("is-pressed"), false);
});

test("press-down compresses immediately before any animation frame or saved click", () => {
  const h = harness(false);
  h.pointer("pointerdown", 1);
  assert.equal(h.rig.props.get("--press"), "1.000");
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
