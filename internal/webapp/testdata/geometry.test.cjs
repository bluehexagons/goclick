"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { frontend } = require("./frontend.cjs");
const { projectButtonScene: project } = frontend({}).load("button-geometry");
const idle = { x: 0, y: 0, rx: 0, ry: 0, press: 0, pop: 0 };
const stage = { left: 300, top: 200, width: 680, height: 290 };
const viewport = { width: 1600, height: 1000 };

function containsShadow(scene, bounds, screen) {
  const factor = 850 / 892;
  const x = bounds.left + bounds.width / 2 + scene.shadow.x * factor;
  const y = bounds.top + bounds.height / 2 + scene.shadow.y * factor;
  const halfX = (scene.shadow.halfWidth + scene.shadow.blur) * factor;
  const halfY = (scene.shadow.halfHeight + scene.shadow.blur) * factor;
  assert.ok(scene.frame.left <= Math.max(0, x - halfX));
  assert.ok(scene.frame.top <= Math.max(0, y - halfY));
  assert.ok(scene.frame.left + scene.frame.width >= Math.min(screen.width, x + halfX));
  assert.ok(scene.frame.top + scene.frame.height >= Math.min(screen.height, y + halfY));
}

test("large tilted and dragged buttons retain the full soft shadow beyond the old fixed plane", () => {
  for (const pose of [
    idle,
    { ...idle, x: 230, y: 120, rx: -16, ry: 22, press: 1, pop: 0.065 },
    { ...idle, x: -280, y: -110, rx: 16, ry: -22, pop: 0.1 },
  ]) {
    for (const width of [260, 420, 620])
      containsShadow(project(pose, width, stage, viewport), stage, viewport);
  }
  const scene = project({ ...idle, x: 250, y: 160, rx: 16, ry: 22 }, 620, stage, viewport);
  assert.ok(scene.frame.height > stage.height);
  assert.ok(scene.shadow.x + scene.shadow.halfWidth + scene.shadow.blur > 230);
});

test("rendering clips only at the viewport and preserves the stage's camera origin", () => {
  const small = { left: 14, top: 130, width: 292, height: 290 },
    screen = { width: 320, height: 680 };
  for (const x of [-220, 0, 220]) {
    const scene = project({ ...idle, x, y: 100, rx: 16, ry: 22 }, 260, small, screen);
    containsShadow(scene, small, screen);
    assert.ok(scene.frame.left >= 0 && scene.frame.top >= 0);
    assert.ok(scene.frame.left + scene.frame.width <= screen.width);
    assert.ok(scene.frame.top + scene.frame.height <= screen.height);
    assert.equal(
      scene.frame.left + scene.frame.width / 2 + scene.originX,
      small.left + small.width / 2,
    );
    assert.equal(
      scene.frame.top + scene.frame.height / 2 + scene.originY,
      small.top + small.height / 2,
    );
  }
});

test("perspective never amplifies screen translation, even for large tilted pressed buttons", () => {
  for (const width of [260, 420, 620])
    for (const pose of [
      idle,
      { ...idle, rx: -16, ry: 22, press: 1, pop: -0.045 },
      { ...idle, rx: 16, ry: -22, press: 0, pop: 0.1 },
    ])
      for (const [x, y] of [
        [0, 0],
        [20, -10],
        [-400, 230],
        [700, 120],
      ]) {
        const scene = project({ ...pose, x, y }, width, stage, viewport);
        const front = 18 - scene.recession;
        const depth = scene.lift + scene.cx * scene.cy * front;
        const factor = 850 / (850 - depth);
        const screenX = (scene.x + scene.sy * front) * factor;
        const screenY = (scene.y - scene.sx * scene.cy * front) * factor;
        assert.ok(Math.abs(screenX - x) < 1e-9);
        assert.ok(Math.abs(screenY - y) < 1e-9);
        containsShadow(scene, stage, viewport);
      }
});
