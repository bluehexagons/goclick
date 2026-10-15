"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { frontend } = require("./frontend.cjs");

function renderer(failure) {
  const allocated = new Set(),
    deleted = new Set(),
    events = new Map(),
    classes = new Set();
  let shaderCount = 0,
    draws = 0,
    uploads = 0;
  const images = [],
    paintedImages = [];
  const resource = (kind) => {
    if (failure === kind) return null;
    const item = { kind };
    allocated.add(item);
    return item;
  };
  const gl = new Proxy(
    {
      NO_ERROR: 0,
      createProgram: () => resource("program"),
      createShader: () => resource(++shaderCount % 2 ? "vertex" : "fragment"),
      createBuffer: () => resource("buffer"),
      createTexture: () => resource("texture"),
      deleteProgram: (item) => deleted.add(item),
      deleteShader: (item) => deleted.add(item),
      deleteBuffer: (item) => deleted.add(item),
      deleteTexture: (item) => deleted.add(item),
      getShaderParameter: () => failure !== "compile",
      getProgramParameter: () => failure !== "link",
      getAttribLocation: () => (failure === "attribute" ? -1 : 0),
      getUniformLocation: () => ({}),
      getError: () => (failure === "upload" ? 1285 : 0),
      texImage2D: () => {
        uploads++;
        if (failure === "exception") throw new Error("GPU unavailable");
      },
      drawArrays: () => {
        draws++;
      },
    },
    { get: (target, key) => (key in target ? target[key] : () => {}) },
  );
  const style = { setProperty() {}, removeProperty() {} };
  const canvas = {
    clientWidth: 400,
    clientHeight: 280,
    getContext: () => (failure === "context" ? null : gl),
    addEventListener: (name, callback) => events.set(name, callback),
  };
  const stage = {
    clientWidth: 400,
    clientHeight: 280,
    style,
    getBoundingClientRect: () => ({ left: 100, right: 500 }),
    querySelector: (selector) => (selector === ".button-scene" ? canvas : { style }),
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
  };
  const button = { offsetWidth: 260, querySelector: () => ({ textContent: "Click!" }) };
  const runtime = frontend({
    document: {
      documentElement: { clientWidth: 800 },
      createElement: () => ({
        getContext: () => ({
          fillText() {},
          clearRect() {},
          drawImage(image) {
            paintedImages.push(image);
          },
        }),
      }),
    },
    window: { devicePixelRatio: 1 },
    Image: class {
      constructor() {
        images.push(this);
      }
    },
  });
  const view = runtime.load("button-3d").createButtonRenderer(stage, button);
  return {
    view,
    images,
    paintedImages,
    uploads: () => uploads,
    events,
    allocated,
    deleted,
    classes,
    draws: () => draws,
    fail: (next) => {
      failure = next;
    },
  };
}

for (const failure of [
  "context",
  "program",
  "vertex",
  "fragment",
  "compile",
  "link",
  "buffer",
  "texture",
  "attribute",
  "upload",
  "exception",
]) {
  test(`graphics failure at ${failure} keeps the native button visible and frees partial resources`, () => {
    const h = renderer(failure);
    assert.doesNotThrow(() => h.view.draw());
    assert.equal(h.classes.has("is-rendered"), false);
    assert.equal(h.draws(), 0);
    assert.deepEqual(h.deleted, h.allocated);
  });
}

test("context loss restores the native button, and failed GPU recovery remains usable", () => {
  const h = renderer();
  assert.equal(h.classes.has("is-rendered"), true);
  assert.equal(h.draws(), 2);
  let prevented = false;
  h.events.get("webglcontextlost")({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(h.classes.has("is-rendered"), false);
  h.view.draw();
  assert.equal(h.draws(), 2);
  h.fail("texture");
  h.events.get("webglcontextrestored")();
  assert.equal(h.classes.has("is-rendered"), false);
  h.view.draw();
  assert.equal(h.draws(), 2);
  h.fail(undefined);
  h.events.get("webglcontextrestored")();
  assert.equal(h.classes.has("is-rendered"), true);
  assert.equal(h.draws(), 4);
});

test("the designed patina loads after the first usable frame into the existing atlas", () => {
  const h = renderer();
  assert.equal(h.classes.has("is-rendered"), true);
  assert.equal(h.draws(), 2);
  assert.equal(h.images[0].src, "/button-patina.svg");
  h.images[0].onload();
  assert.equal(h.paintedImages[0], h.images[0]);
  assert.equal(h.uploads(), 2);
  assert.equal(h.draws(), 4);
});

test("patina loading during context loss waits for restoration to upload", () => {
  const h = renderer();
  h.events.get("webglcontextlost")({ preventDefault() {} });
  h.images[0].onload();
  assert.equal(h.uploads(), 1);
  assert.equal(h.paintedImages.length, 1);
  h.events.get("webglcontextrestored")();
  assert.equal(h.uploads(), 2);
  assert.equal(h.classes.has("is-rendered"), true);
});

test("a failed asynchronous texture upload restores the CSS button", () => {
  const h = renderer();
  h.fail("exception");
  assert.doesNotThrow(() => h.images[0].onload());
  assert.equal(h.classes.has("is-rendered"), false);
});
