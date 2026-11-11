"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { frontend } = require("./frontend.cjs");
const { projectButtonScene: project } = frontend({}).load("button-geometry");
const idle = { x: 0, y: 0, rx: 0, ry: 0, press: 0, pop: 0 };
const stage = { left: 300, top: 200, width: 680, height: 290 };
const viewport = { width: 1600, height: 1000 };

test("the wall outlet stays fixed while the cable follows the button's rear attachment", () => {
  const { projectButtonPower } = frontend({}).load("button-geometry");
  const rest = projectButtonPower(idle, 420);
  const dragged = projectButtonPower({ ...idle, x: 180, y: 90, rx: 16, ry: 22 }, 420);
  assert.equal(dragged.outletX, rest.outletX);
  assert.equal(dragged.outletY, rest.outletY);
  assert.ok(dragged.endX > rest.endX + 100);
  assert.ok(dragged.endY > rest.endY + 50);
  assert.ok(dragged.cord.endsWith(`${dragged.endX} ${dragged.endY}`));
  const pressed = projectButtonPower({ ...idle, press: 1 }, 420);
  assert.notEqual(pressed.endX, rest.endX, "Press depth changes the rear projection");
  const mobile = projectButtonPower(idle, 228);
  for (const [width, cable] of [
    [228, mobile],
    [420, rest],
  ]) {
    assert.ok(Math.abs(cable.outletX) + 29 < width / 2 - 20);
    assert.ok(Math.abs(cable.outletY) + 42 < (width * 144) / 260 / 2);
    assert.ok(
      cable.endY + cable.sag + 6 < (width * 144) / 260 / 2,
      "The relaxed cable stays hidden underneath the face",
    );
  }
});

test("pulling takes up cable slack before stretching and thinning its jacket", () => {
  const { projectButtonPower } = frontend({}).load("button-geometry");
  for (const width of [228, 260, 420]) {
    const rest = projectButtonPower(idle, width);
    const pulled = projectButtonPower({ ...idle, x: width * 0.4 }, width);
    const far = projectButtonPower({ ...idle, x: width * 1.5 }, width);
    assert.ok(rest.sag > pulled.sag);
    assert.equal(rest.thickness, 1);
    assert.equal(far.sag, 0, "The cable becomes straight beyond its natural length");
    assert.ok(far.thickness < pulled.thickness && far.thickness >= 0.55);
    assert.ok(Number.isFinite(far.endX) && Number.isFinite(far.endY));
  }
});

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

test("lettering grows while held and never undershoots its normal size during release", () => {
  const { projectButtonLettering } = frontend({}).load("button-geometry");
  const state = { ...idle, flash: 0, response: 0, labelCharge: 0 };
  const resting = projectButtonLettering(state);
  assert.equal(resting.scaleX, 1);
  assert.equal(resting.scaleY, 1);
  const held = projectButtonLettering({ ...state, press: 1, pop: -0.045, labelCharge: 1 });
  // Growth remains visible even with the solid's 4.5% press compression.
  assert.ok(held.scaleX * 0.955 > 1.15);
  assert.equal(held.scaleY, held.scaleX);
  assert.ok(held.ink > 0 && held.charge === 1);
  for (const charge of [1, 0.8, 0.2, 0]) {
    const released = projectButtonLettering({ ...state, pop: -0.02, labelCharge: charge });
    assert.ok(released.scaleX >= 1 && released.scaleX <= held.scaleX);
    assert.equal(released.scaleY, released.scaleX);
  }
  const peak = projectButtonLettering({ ...state, labelCharge: 10, response: 1 });
  assert.ok(peak.scaleX <= 1.22 && peak.ink <= 0.55);
});

test("reduced motion keeps lettering still while retaining a quiet acknowledgement tint", () => {
  const { projectButtonLettering } = frontend({}).load("button-geometry");
  const state = { ...idle, reducedMotion: true, press: 1, pop: 0.1, flash: 1, response: 0 };
  assert.deepEqual(
    { ...projectButtonLettering(state) },
    { scaleX: 1, scaleY: 1, shiftY: 0, ink: 0, light: 0.3, charge: 0, sheen: 1.35 },
  );
  const acknowledged = projectButtonLettering({ ...state, response: 0.22 });
  assert.equal(acknowledged.scaleX, 1);
  assert.equal(acknowledged.scaleY, 1);
  assert.equal(acknowledged.shiftY, 0);
  assert.ok(acknowledged.ink > 0 && acknowledged.ink < 0.15);
});

test("held reflections keep moving without changing text size, and reduced motion freezes the reflection", () => {
  const { projectButtonLettering } = frontend({}).load("button-geometry");
  const state = { ...idle, press: 1, labelCharge: 1, response: 0, flash: 0 };
  const first = projectButtonLettering({ ...state, labelPhase: 0 });
  const later = projectButtonLettering({ ...state, labelPhase: 0.5 });
  assert.notEqual(first.sheen, later.sheen);
  assert.equal(first.scaleX, later.scaleX);
  assert.equal(first.scaleY, later.scaleY);
  assert.equal(
    projectButtonLettering({ ...state, reducedMotion: true, labelPhase: 0 }).sheen,
    projectButtonLettering({ ...state, reducedMotion: true, labelPhase: 0.5 }).sheen,
  );
});

test("the lettering lights immediately on press, stays lit through a hold, and fades with release", () => {
  const { projectButtonLettering } = frontend({}).load("button-geometry");
  const state = { ...idle, response: 0, flash: 0, labelCharge: 0 };
  assert.equal(projectButtonLettering(state).light, 0);
  const held = { ...state, press: 1, labelCharge: 1 };
  assert.equal(projectButtonLettering(held).light, 1);
  assert.equal(projectButtonLettering({ ...held, labelPhase: 5 }).light, 1);
  assert.equal(projectButtonLettering({ ...state, labelCharge: 0.25 }).light, 0.25);
  assert.ok(projectButtonLettering({ ...state, response: 1 }).light > 0.5);
  const reduced = projectButtonLettering({ ...held, reducedMotion: true });
  assert.ok(reduced.light > 0 && reduced.light <= 0.3);
  assert.equal(reduced.scaleX, 1);
});
