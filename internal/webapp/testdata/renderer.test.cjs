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
    uploads = 0,
    textureUploads = 0,
    attempts = 0,
    contextLost = false;
  const images = [],
    paintedImages = [],
    viewports = [];
  function upload() {
    uploads++;
    if (failure === "exception") throw new Error("GPU unavailable");
  }
  const resource = (kind) => {
    if (failure === kind) return null;
    const item = { kind };
    allocated.add(item);
    return item;
  };
  const gl = new Proxy(
    {
      NO_ERROR: 0,
      isContextLost: () => contextLost,
      get drawingBufferWidth() {
        return failure === "framebuffer" ? 0 : failure === "small-buffer" ? 64 : canvas.width;
      },
      get drawingBufferHeight() {
        return failure === "framebuffer" ? 0 : failure === "small-buffer" ? 32 : canvas.height;
      },
      viewport: (...size) => viewports.push(size),
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
        textureUploads++;
        upload();
      },
      texSubImage2D: upload,
      drawArrays: () => {
        draws++;
      },
    },
    { get: (target, key) => (key in target ? target[key] : () => {}) },
  );
  const style = { setProperty() {}, removeProperty() {} };
  const canvas = {
    width: 300,
    height: 150,
    style: {},
    getContext: () => {
      attempts++;
      if (failure === "context-exception") throw new Error("GPU unavailable");
      return failure === "context" ? null : gl;
    },
    addEventListener: (name, callback) => events.set(name, callback),
  };
  const stage = {
    clientWidth: 400,
    clientHeight: 280,
    style,
    getBoundingClientRect: () => ({ left: 100, top: 100, width: 400, height: 280 }),
    querySelector: (selector) => (selector === ".button-scene" ? canvas : { style }),
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
  };
  const lettering = { textContent: "Click!", dir: "ltr" };
  const paintedText = [];
  const button = { offsetWidth: 260, querySelector: () => lettering };
  const atlas = {
    width: 300,
    height: 150,
    getContext: () => ({
      measureText: (text) => ({ width: text.length * 70 }),
      fillText(text) {
        paintedText.push({ text, direction: this.direction, font: this.font });
      },
      clearRect() {},
      fillRect() {},
      drawImage(image) {
        paintedImages.push(image);
      },
    }),
  };
  const document = {
    hidden: false,
    documentElement: { clientWidth: 800, clientHeight: 700 },
    createElement: () => atlas,
  };
  const runtime = frontend({
    document,
    window: { devicePixelRatio: 1, addEventListener() {} },
    Image: class {
      constructor() {
        images.push(this);
      }
    },
  });
  const view = runtime.load("button-3d").createButtonRenderer(stage, button);
  view.resume();
  return {
    view,
    canvas,
    atlas,
    document,
    viewports,
    images,
    paintedImages,
    lettering,
    paintedText,
    uploads: () => uploads,
    textureUploads: () => textureUploads,
    attempts: () => attempts,
    lose() {
      contextLost = true;
      let prevented = false;
      events.get("webglcontextlost")({
        preventDefault() {
          prevented = true;
        },
      });
      assert.ok(prevented);
    },
    restore() {
      contextLost = false;
      events.get("webglcontextrestored")();
    },
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
  "context-exception",
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
  "framebuffer",
]) {
  test(`graphics failure at ${failure} keeps the native button visible and frees partial resources`, () => {
    const h = renderer(failure);
    assert.doesNotThrow(() => h.view.draw());
    assert.equal(h.classes.has("is-rendered"), false);
    assert.equal(h.draws(), 0);
    assert.deepEqual(h.deleted, h.allocated);
    h.fail(undefined);
    h.view.draw();
    assert.equal(h.draws(), 0, "Ordinary draws do not retry setup");
    h.view.resume();
    assert.equal(h.classes.has("is-rendered"), true);
  });
}

test("context loss restores the native button, and failed GPU recovery remains usable", () => {
  const h = renderer();
  assert.equal(h.classes.has("is-rendered"), true);
  assert.equal(h.draws(), 2);
  h.lose();
  assert.equal(h.classes.has("is-rendered"), false);
  h.view.draw();
  h.view.resume();
  assert.equal(h.draws(), 2);
  assert.equal(h.attempts(), 1, "Keep the existing context during browser restoration");
  h.fail("texture");
  h.restore();
  assert.equal(h.classes.has("is-rendered"), false);
  h.view.draw();
  assert.equal(h.draws(), 2);
  h.fail(undefined);
  h.view.resume();
  assert.equal(h.classes.has("is-rendered"), true);
  assert.equal(h.draws(), 4);
});

test("the full-surface material loads after the first usable frame into the existing atlas", () => {
  const h = renderer();
  assert.equal(h.classes.has("is-rendered"), true);
  assert.equal(h.draws(), 2);
  assert.equal(h.images[0].src, "/button-material.svg");
  h.images[0].onload();
  assert.equal(h.paintedImages[0], h.images[0]);
  assert.equal(h.uploads(), 2);
  assert.equal(h.textureUploads(), 1);
  assert.equal(h.draws(), 4);
});

test("material loading during context loss waits for restoration to upload", () => {
  const h = renderer();
  h.lose();
  h.images[0].onload();
  assert.equal(h.uploads(), 1);
  assert.equal(h.paintedImages.length, 0);
  h.restore();
  assert.equal(h.uploads(), 2);
  assert.equal(h.paintedImages[0], h.images[0]);
  assert.equal(h.classes.has("is-rendered"), true);
});

test("a failed asynchronous texture upload restores the CSS button", () => {
  const h = renderer();
  h.fail("exception");
  assert.doesNotThrow(() => h.images[0].onload());
  assert.equal(h.classes.has("is-rendered"), false);
  assert.deepEqual(h.deleted, h.allocated);
});

test("material and glow assets can arrive in either order without losing a layer", () => {
  for (const order of [
    [0, 1],
    [1, 0],
  ]) {
    const h = renderer();
    assert.equal(h.images[1].src, "/button-glow.svg");
    h.images[order[0]].onload();
    h.images[order[1]].onload();
    assert.deepEqual(h.paintedImages.slice(-2), h.images);
    assert.equal(h.uploads(), 3);
    assert.equal(h.classes.has("is-rendered"), true);
  }
});

test("changing lettering refreshes the GPU atlas with direction and fitted text", () => {
  const h = renderer();
  const before = h.uploads();
  h.lettering.textContent = "Long translated label";
  h.lettering.dir = "rtl";
  h.view.draw();
  assert.equal(h.uploads(), before + 1);
  const painted = h.paintedText.at(-1);
  assert.equal(painted.text, h.lettering.textContent);
  assert.equal(painted.direction, "rtl");
  assert.ok(parseFloat(painted.font.split(" ")[1]) < 114);
  h.view.draw();
  assert.equal(h.uploads(), before + 1);
});

test("lettering changes during context loss are uploaded on recovery", () => {
  const h = renderer();
  h.lose();
  h.lettering.textContent = "クリック！";
  h.view.draw();
  h.restore();
  assert.equal(h.paintedText.at(-1).text, "クリック！");
  assert.equal(h.classes.has("is-rendered"), true);
});

test("a failed lettering upload restores the CSS button with its current label", () => {
  const h = renderer();
  h.fail("upload");
  h.lettering.textContent = "انقر!";
  h.view.draw();
  assert.equal(h.classes.has("is-rendered"), false);
  assert.equal(h.lettering.textContent, "انقر!");
});

test("suspending releases graphics resources and reopening reuses the context", () => {
  const h = renderer();
  h.view.suspend();
  assert.equal(h.classes.has("is-rendered"), false);
  assert.deepEqual(h.deleted, h.allocated);
  assert.deepEqual([h.canvas.width, h.canvas.height, h.atlas.width, h.atlas.height], [1, 1, 1, 1]);
  h.view.resume();
  assert.equal(h.attempts(), 1);
  assert.equal(h.classes.has("is-rendered"), true);
});

test("restoration in a background tab defers allocation until the page is visible", () => {
  const h = renderer();
  h.lose();
  h.document.hidden = true;
  h.restore();
  assert.equal(h.textureUploads(), 1);
  assert.equal(h.classes.has("is-rendered"), false);
  h.document.hidden = false;
  h.view.resume();
  assert.equal(h.textureUploads(), 2);
  assert.equal(h.classes.has("is-rendered"), true);
});

test("drawing respects the framebuffer size the browser actually allocated", () => {
  const h = renderer("small-buffer");
  assert.deepEqual(h.viewports.at(-1), [0, 0, 64, 32]);
  assert.equal(h.classes.has("is-rendered"), true);
  h.fail("framebuffer");
  h.view.draw();
  assert.equal(h.classes.has("is-rendered"), false);
});
