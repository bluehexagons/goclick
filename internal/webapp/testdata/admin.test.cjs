"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { frontend } = require("./frontend.cjs");

// Run the shipped script with a small DOM adapter and controlled transport.
// These tests exercise request ordering and operation outcomes; browser checks
// cover real markup, input, and layout. No third-party packages are needed.
class Element {
  children = [];
  events = new Map();
  attributes = new Map();
  classes = new Set();
  hidden = false;
  value = "";
  files = [];
  text = "";
  classList = {
    toggle: (name, enabled) => (enabled ? this.classes.add(name) : this.classes.delete(name)),
  };
  set textContent(value) {
    this.text = String(value);
    this.children = [];
  }
  get textContent() {
    return this.text + this.children.map((child) => child.textContent).join(" ");
  }
  append(...children) {
    this.children.push(...children);
  }
  replaceChildren(...children) {
    this.text = "";
    this.children = children;
  }
  setAttribute(key, value) {
    this.attributes.set(key, value);
  }
  removeAttribute(key) {
    this.attributes.delete(key);
  }
  addEventListener(name, handler) {
    this.events.set(name, handler);
  }
  querySelector() {
    return (this.button ??= new Element());
  }
  querySelectorAll() {
    return [];
  }
  click() {}
  remove() {}
  close() {
    this.open = false;
    this.events.get("close")?.();
  }
  showModal() {
    this.open = true;
  }
  async submit() {
    await this.events.get("submit")({ preventDefault() {}, currentTarget: this });
  }
}

function response(data, status = 200) {
  return {
    ok: status < 400,
    status,
    headers: { get: () => null },
    json: async () => data,
    blob: async () => ({}),
  };
}

function harness(fetch) {
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector);
  };
  const runtime = frontend({
    console,
    URLSearchParams,
    Intl,
    AbortController,
    URL: { createObjectURL: () => "blob:fixture", revokeObjectURL() {} },
    FormData: class {
      append() {}
    },
    document: {
      querySelector: element,
      querySelectorAll: () => [],
      createElement: () => new Element(),
      body: new Element(),
    },
    window: { setTimeout() {}, clearTimeout() {} },
    fetch: (url, options) => (url === "/api/me" ? new Promise(() => {}) : fetch(url, options)),
  });
  return { context: runtime.load("admin"), element };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

for (const [load, control, rows, initial, latest] of [
  [
    "loadPlayers",
    "#search",
    "#players-rows",
    { items: [{ id: 1, username: "old_search", clicks: 1 }], total: 1 },
    { items: [{ id: 2, username: "new_search", clicks: 2 }], total: 1 },
  ],
  [
    "loadActivity",
    "#activity-user",
    "#activity-rows",
    { items: [{ user_id: 1, username: "old_player", action: "click" }], total: 1 },
    { items: [{ user_id: 2, username: "new_player", action: "click" }], total: 1 },
  ],
]) {
  test(`${load} keeps the newest filter when responses arrive out of order`, async () => {
    const pending = [];
    const { context, element } = harness(() => {
      const request = deferred();
      pending.push(request);
      return request.promise;
    });
    element(control).value = "first";
    const first = context[load]();
    element(control).value = "second";
    const second = context[load]();
    pending[1].resolve(response(latest));
    await second;
    const visible = element(rows).textContent;
    pending[0].resolve(response(initial));
    await first;
    assert.equal(element(rows).textContent, visible);
  });
}

test("an obsolete search failure does not become an unhandled current-page error", async () => {
  const pending = [];
  const { context } = harness(() => {
    const request = deferred();
    pending.push(request);
    return request.promise;
  });
  const first = context.loadPlayers();
  const second = context.loadPlayers();
  pending[1].resolve(response({ items: [], total: 0 }));
  await second;
  pending[0].reject(new Error("old connection failed"));
  await assert.doesNotReject(first);
});

test("a current search failure is still reported, and superseded requests are aborted", async () => {
  const pending = [];
  const { context } = harness((url, options) => {
    const request = deferred();
    pending.push({ ...request, signal: options.signal });
    return request.promise;
  });
  const first = context.loadPlayers();
  const second = context.loadPlayers();
  assert.equal(pending[0].signal.aborted, true);
  const rejected = assert.rejects(second, /Can’t reach Go Click/);
  pending[1].reject(new Error("current connection failed"));
  await rejected;
  pending[0].resolve(response({ items: [], total: 0 }));
  await first;
});

for (const operation of ["import", "export"]) {
  test(`a successful ${operation} remains successful when the following refresh fails`, async () => {
    let mutations = 0;
    const { element } = harness(async (url, options) => {
      if (options?.method === "POST") {
        mutations++;
        return response({
          users: 2,
          entities: 6,
          recovery_backup: "recovery.db",
          new_passwords_required: true,
        });
      }
      return response({ error: "Refresh unavailable" }, 503);
    });
    element("#import-file").files = [{ name: "rails.json", size: 100 }];
    element(`#${operation}-password`).value = "fixture-password";
    await element(`#${operation}-form`).submit();
    const status = element(`#${operation}-status`);
    assert.match(
      status.textContent,
      operation === "import" ? /players and .* entities imported/ : /Backup ready/,
    );
    assert.equal(status.classes.has("notice-error"), false);
    assert.match(element("#admin-error").textContent, /completed.*refresh/i);
    assert.equal(element(`#${operation}-password`).value, "");
    assert.equal(mutations, 1);
  });
}

test("invalid successful JSON is rejected as an uncertain outcome", async () => {
  for (const body of [null, [], "invalid", 0]) {
    const { context } = harness(async () => response(body));
    await assert.rejects(
      context.request("/api/admin/overview"),
      (error) => error.uncertain === true,
    );
  }
});

test("authentication capacity rejection is a definite non-mutation", async () => {
  const { context } = harness(async () =>
    response({ error: "Busy", code: "authentication_busy" }, 503),
  );
  await assert.rejects(
    context.request("/api/admin/backups/export", { method: "POST" }),
    (error) => error.uncertain === false,
  );
});
