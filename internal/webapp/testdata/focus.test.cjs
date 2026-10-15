"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { frontend } = require("./frontend.cjs");

function focus() {
  const root = { dataset: {} },
    events = new Map();
  frontend({
    document: {
      documentElement: root,
      addEventListener: (name, callback, options) => events.set(name, { callback, options }),
    },
  }).load("focus");
  return {
    root,
    events,
    key: (key, properties = {}) => events.get("keydown").callback({ key, ...properties }),
    pointer: () => events.get("pointerdown").callback(),
  };
}

test("initial and pointer interaction stay quiet, while keyboard navigation enables focus cues", () => {
  const h = focus();
  assert.equal(h.root.dataset.focusInput, "pointer");
  for (const key of ["Tab", "Enter", " ", "ArrowDown", "Escape"]) {
    h.key(key);
    assert.equal(h.root.dataset.focusInput, "keyboard");
    h.pointer();
    assert.equal(h.root.dataset.focusInput, "pointer");
  }
  assert.equal(h.events.get("keydown").options.capture, true);
  assert.equal(h.events.get("pointerdown").options.capture, true);
  assert.equal(h.events.get("pointerdown").options.passive, true);
});

test("typing, IME input, and browser shortcuts do not opt pointer users into keyboard outlines", () => {
  const h = focus();
  h.key("a");
  h.key("ArrowDown", { isComposing: true });
  h.key("Home", { altKey: true });
  h.key("Enter", { ctrlKey: true });
  h.key("ArrowLeft", { metaKey: true });
  assert.equal(h.root.dataset.focusInput, "pointer");
  h.key("Tab", { shiftKey: true });
  h.key("a");
  assert.equal(h.root.dataset.focusInput, "keyboard");
});
