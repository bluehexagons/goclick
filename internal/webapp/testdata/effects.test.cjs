"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const script = name => fs.readFileSync(path.join(__dirname, "../web/" + name + ".js"), "utf8");

test("motion Auto follows the browser and both manual overrides survive preference changes", () => {
  const root = { dataset: {} }, storage = new Map(), changes = new Map();
  const browser = { matches: true, addEventListener: (name, fn) => changes.set("browser-" + name, fn) };
  const context = vm.createContext({
    document: { documentElement: root },
    window: { matchMedia: () => browser, addEventListener: (name, fn) => changes.set(name, fn) },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  });
  vm.runInContext(script("preferences") + "\nglobalThis.settings = gameSettings;", context);
  assert.equal(root.dataset.reducedMotion, "true");
  context.settings.update({ motion: "off" });
  browser.matches = false; changes.get("browser-change")();
  browser.matches = true; changes.get("browser-change")();
  assert.equal(root.dataset.reducedMotion, "false");
  assert.equal(JSON.parse(storage.get("goclick.settings.v1")).motion, "off");
  context.settings.update({ motion: "on" });
  browser.matches = false; changes.get("browser-change")();
  assert.equal(root.dataset.reducedMotion, "true");
  context.settings.update({ motion: "auto" });
  assert.equal(root.dataset.reducedMotion, "false");
  changes.get("storage")({ key: "goclick.settings.v1", newValue: '{"motion":"on"}' });
  assert.equal(root.dataset.reducedMotion, "true");
});

function effects() {
  let id = 0;
  const timers = new Map(), layer = { children: [], append(item) { this.children.push(item); } };
  const motion = { matches: false, addEventListener() {} };
  class Element {
    dataset = {}; style = {}; children = []; textContent = ""; animations = [];
    setAttribute() {} append(...children) { this.children.push(...children); }
    remove() { this.removed = true; }
    animate(frames, options) { const animation = { frames, options, cancel() {} }; this.animations.push(animation); return animation; }
  }
  const responses = [];
  const context = vm.createContext({
    tactileButtons: { get: () => ({ respond: (...response) => responses.push(response) }) },
    document: { createElement: () => new Element() }, motionPreference: motion, performance: { now: () => 0 },
    window: { setTimeout: (callback, delay) => { timers.set(++id, { callback, delay }); return id; }, clearTimeout: id => timers.delete(id) },
  });
  const button = { closest: () => ({ getBoundingClientRect: () => ({ left: 20, top: 40, width: 340, height: 240 }), querySelector: () => layer }),
    getBoundingClientRect: () => ({ left: 60, top: 80, width: 260, height: 144 }) };
  vm.runInContext(script("click-feedback") + "\nglobalThis.feedback = clickFeedback;", context);
  return { feedback: context.feedback, button, layer, timers, motion, responses };
}

test("+1 anchors to its pointer, stays pending, and shows measured slow or failed outcomes", () => {
  const h = effects();
  const first = h.feedback.start(h.button, { detail: 1, clientX: 110, clientY: 160 });
  let popup = h.layer.children.at(-1);
  assert.equal(popup.style.left, "90px");
  assert.equal(popup.style.top, "120px");
  assert.equal(popup.dataset.state, "pending");
  assert.equal(popup.animations.length, 0);
  first.success(50);
  assert.equal(popup.dataset.state, "fast");
  assert.match(popup.children[1].textContent, /50 ms/);
  const slow = h.feedback.start(h.button, { detail: 0 });
  popup = h.layer.children.at(-1);
  assert.equal(popup.style.left, "170px");
  slow.success(900);
  assert.equal(popup.dataset.state, "slow");
  const failed = h.feedback.start(h.button, { detail: 0 });
  popup = h.layer.children.at(-1);
  failed.fail(true);
  assert.equal(popup.dataset.state, "error");
  assert.equal(popup.children[0].textContent, "?");
  assert.equal(popup.children[1].textContent, "unconfirmed");
  assert.deepEqual(h.responses, [["fast", 50], ["slow", 900], ["error"]]);
});

test("reduced motion uses static acknowledgement and resets clear every pending effect", () => {
  const h = effects(); h.motion.matches = true;
  const saved = h.feedback.start(h.button, { detail: 0 }, true);
  saved.success(80);
  assert.equal(h.layer.children[0].animations.length, 0);
  assert.match(h.layer.children[0].children[1].textContent, /sim/);
  h.feedback.start(h.button, { detail: 0 });
  h.feedback.reset();
  assert.equal(h.timers.size, 0);
  assert.equal(h.layer.children.every(popup => popup.removed), true);
});
