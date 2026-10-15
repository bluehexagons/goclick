"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { frontend } = require("./frontend.cjs");

function interactions() {
  let handler;
  class Node {
    constructor(parentElement = null) {
      this.parentElement = parentElement;
    }
  }
  class Element extends Node {
    constructor(editor = null, field = false) {
      super();
      this.editor = editor;
      this.field = field;
    }
    closest() {
      return this.editor;
    }
    matches() {
      return this.field;
    }
  }
  frontend({
    Element,
    Node,
    document: {
      addEventListener(name, callback, options) {
        assert.equal(name, "dragstart");
        assert.equal(options.capture, true);
        handler = callback;
      },
    },
  }).load("interaction");
  return {
    Element,
    Node,
    drag(target) {
      let prevented = false;
      handler({
        target,
        preventDefault() {
          prevented = true;
        },
      });
      return prevented;
    },
  };
}

test("page links, images, labels, and selected data cannot start a native drag", () => {
  const h = interactions();
  assert.equal(h.drag(new h.Element()), true);
  assert.equal(h.drag({}), true);
  assert.equal(h.drag(null), true);
});

test("native editing drags remain available, while readonly and disabled fields stay protected", () => {
  const h = interactions();
  const field = new h.Element(null, true);
  assert.equal(h.drag(new h.Element(field)), false);
  field.readOnly = true;
  assert.equal(h.drag(new h.Element(field)), true);
  field.readOnly = false;
  field.disabled = true;
  assert.equal(h.drag(new h.Element(field)), true);
  const editable = new h.Element();
  editable.isContentEditable = true;
  assert.equal(h.drag(new h.Element(editable)), false);
});

test("a dragged text node inside an editable field uses its parent editor", () => {
  const h = interactions();
  const editor = new h.Element();
  editor.isContentEditable = true;
  assert.equal(h.drag(new h.Node(new h.Element(editor))), false);
  assert.equal(h.drag(new h.Node(new h.Element())), true);
});
