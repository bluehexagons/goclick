"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { frontend } = require("./frontend.cjs");

const player = { id: 1, username: "player", admin: false };
const counters = (count) => ({ click_count: { count } });
const response = (body, status = 200) => ({
  ok: status < 400,
  status,
  headers: { get: () => null },
  json: async () => body,
});
const settle = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

// Exercise the shipped game script and transport ordering without browser or
// third-party dependencies. Real browser checks cover markup, focus and layout.
async function harness(options = {}) {
  let document;
  class Element {
    events = new Map();
    attributes = new Map();
    classes = new Set();
    dataset = {};
    textContent = "";
    hidden = false;
    disabled = false;
    classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      contains: (name) => this.classes.has(name),
      toggle: (name, enabled) => (enabled ? this.classes.add(name) : this.classes.delete(name)),
    };
    addEventListener(name, handler) {
      const previous = this.events.get(name);
      this.events.set(
        name,
        previous
          ? (event) => {
              previous(event);
              return handler(event);
            }
          : handler,
      );
    }
    setAttribute(key, value) {
      this.attributes.set(key, value);
    }
    querySelector() {
      return (this.button ??= new Element());
    }
    querySelectorAll() {
      return [];
    }
    focus() {
      document.activeElement = this;
    }
    reset() {}
    showModal() {
      this.open = true;
    }
    close() {
      this.open = false;
    }
    fire(name, event = {}) {
      return this.events.get(name)?.({ preventDefault() {}, ...event });
    }
  }
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector);
  };
  document = Object.assign(new Element(), {
    documentElement: new Element(),
    hidden: false,
    querySelector: element,
    querySelectorAll: () => [],
  });
  const window = Object.assign(new Element(), {
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    scrollTo() {},
    clearTimeout() {},
    setTimeout() {
      return 1;
    },
  });
  let handler = async (url) => response(url === "/api/me" ? player : counters(10));
  const requests = [];
  const storage = new Map(options.storage);
  let failStorage = false;
  const feedback = [];
  let now = 1;
  const globals = {
    console,
    Headers,
    FormData: class {
      get() {
        return "password";
      }
      entries() {
        return [];
      }
    },
    document,
    window,
    navigator: { onLine: true },
    performance: { now: () => now },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        if (failStorage) throw new Error("Storage full");
        storage.set(key, value);
      },
    },
    clickFeedback: {
      reset() {},
      start: () => {
        const item = {
          success(ms) {
            this.ms = ms;
          },
          fail(uncertain) {
            this.failed = true;
            this.uncertain = uncertain;
          },
        };
        feedback.push(item);
        return item;
      },
    },
    tactileButtons: { values: () => [], get: () => ({ reset() {} }) },
    fetch: (url, options) => {
      requests.push({ url, method: options.method || "GET" });
      return handler(url, options);
    },
  };
  const runtime = frontend(globals, {
    button: { tactileButtons: globals.tactileButtons },
    "click-feedback": { clickFeedback: globals.clickFeedback },
  });
  const context = options.production ? runtime.bundle("app") : runtime.load("app");
  await settle();
  assert.equal(
    element("#click-count").textContent,
    options.storage?.some(([key, value]) => key === "goclick.mode" && value === "local")
      ? "0"
      : "10",
  );
  const startupRequests = requests.slice();
  requests.length = 0;
  return {
    context,
    element,
    document,
    window,
    requests,
    startupRequests,
    storage,
    feedback,
    failStorage: () => {
      failStorage = true;
    },
    advance: (milliseconds) => {
      now += milliseconds;
    },
    fetch: (next) => {
      handler = next;
    },
  };
}

test("focus and visibility refresh stale progress without interrupting brief tab switches", async () => {
  const h = await harness();
  h.window.fire("focus");
  h.document.fire("visibilitychange");
  assert.equal(h.requests.length, 0);
  h.advance(16000);
  h.document.hidden = true;
  h.document.fire("visibilitychange");
  assert.equal(h.requests.length, 0);
  h.document.hidden = false;
  h.document.fire("visibilitychange");
  h.window.fire("focus");
  await settle();
  assert.deepEqual(
    h.requests.map((r) => r.url),
    ["/api/me", "/api/clicks"],
  );
});

test("returning to the game coalesces refreshes and updates a switched account", async () => {
  const h = await harness();
  const identity = deferred(),
    progress = deferred();
  h.fetch((url) => (url === "/api/me" ? identity.promise : progress.promise));
  const first = h.context.refreshGame();
  assert.equal(h.context.refreshGame(), first);
  assert.equal(h.element("#click-button").disabled, true);
  assert.equal(h.element("#refresh-counter").attributes.get("aria-busy"), "true");
  assert.equal(h.element("#counter-card").attributes.get("aria-busy"), "false");
  identity.resolve(response({ id: 2, username: "other_player", admin: true }));
  progress.resolve(response(counters(3)));
  await first;
  assert.equal(h.element("#game-username").textContent, "other_player");
  assert.equal(h.element("#click-count").textContent, "3");
  assert.equal(h.element("#click-button").disabled, false);
  assert.equal(h.element("#admin-link").hidden, false);
  assert.deepEqual(
    h.requests.map((r) => r.method),
    ["GET", "GET"],
  );
});

test("a refresh waits for pending clicks instead of replacing their results", async () => {
  const h = await harness();
  const click = deferred();
  h.fetch((url, options) =>
    options.method === "POST"
      ? click.promise
      : Promise.resolve(response(url === "/api/me" ? player : counters(25))),
  );
  const saving = h.element("#click-button").fire("click");
  h.context.refreshGame();
  assert.deepEqual(
    h.requests.map((r) => r.method),
    ["POST"],
  );
  assert.equal(h.element("#refresh-counter").disabled, true);
  click.resolve(response(counters(11)));
  await saving;
  await settle();
  assert.equal(h.element("#click-count").textContent, "25");
  assert.deepEqual(
    h.requests.map((r) => r.method),
    ["POST", "GET", "GET"],
  );
});

test("offline clicks are paused and reconnection reads progress without replaying", async () => {
  const h = await harness();
  h.window.fire("offline");
  assert.equal(h.element("#click-button").disabled, true);
  assert.equal(h.element("#network-notice").hidden, false);
  await h.element("#click-button").fire("click");
  assert.deepEqual(h.requests, []);
  h.fetch(async (url) => response(url === "/api/me" ? player : counters(18)));
  h.window.fire("online");
  await settle();
  assert.equal(h.element("#click-count").textContent, "18");
  assert.equal(h.element("#click-button").disabled, false);
  assert.equal(h.element("#network-notice").hidden, true);
  assert.deepEqual(
    h.requests.map((r) => r.method),
    ["GET", "GET"],
  );
});

test("a click finishing while offline does not re-enable the button", async () => {
  const h = await harness();
  const click = deferred();
  h.fetch(() => click.promise);
  const saving = h.element("#click-button").fire("click");
  h.window.fire("offline");
  click.resolve(response(counters(11)));
  await saving;
  assert.equal(h.element("#click-button").disabled, true);
  assert.equal(h.element("#network-notice").hidden, false);
  assert.match(h.element("#connection").attributes.get("aria-label"), /Offline/);
});

test("failed refresh preserves saved values and offers a read-only retry", async () => {
  const h = await harness();
  h.fetch(async () => {
    throw new Error("connection lost");
  });
  await h.context.refreshGame();
  assert.equal(h.element("#click-count").textContent, "10");
  assert.equal(h.element("#retry-game-button").hidden, false);
  assert.equal(h.element("#click-button").disabled, true);
  h.fetch(async (url) => response(url === "/api/me" ? player : counters(15)));
  await h.element("#retry-game-button").fire("click");
  assert.equal(h.element("#click-count").textContent, "15");
  assert.equal(h.element("#game-error").hidden, true);
  assert.equal(h.element("#retry-game-button").hidden, true);
  assert.equal(
    h.requests.every((r) => r.method === "GET"),
    true,
  );
});

test("returning after another tab signed out opens sign-in without stale clicks", async () => {
  const h = await harness();
  h.fetch(async () => response({ error: "Invalid session" }, 401));
  await h.context.refreshGame();
  assert.equal(h.element("#login-form").hidden, false);
  assert.equal(h.element("#game-view").hidden, true);
  assert.equal(h.element("#click-button").disabled, true);
  assert.equal(h.element("#click-count").textContent, "0");
});

test("keyboard users land on the game button after sign-in, without refresh stealing focus", async () => {
  const h = await harness();
  h.context.show("login");
  await h.context.openGame();
  assert.equal(h.document.activeElement, h.element("#click-button"));
  h.element("#refresh-counter").focus();
  await h.context.refreshGame();
  assert.equal(h.document.activeElement, h.element("#refresh-counter"));
});

test("a late refresh response cannot reopen the game after signing out", async () => {
  const h = await harness();
  const progress = deferred();
  h.fetch((url) => (url === "/api/clicks" ? progress.promise : Promise.resolve(response(player))));
  const refreshing = h.context.refreshGame();
  await h.element("#logout-button").fire("click");
  progress.resolve(response(counters(99)));
  await refreshing;
  assert.equal(h.element("#home-view").hidden, false);
  assert.equal(h.element("#game-view").hidden, true);
  assert.equal(h.element("#click-count").textContent, "0");
});

test("remembered local play starts and runs without any account API calls", async () => {
  const h = await harness({ storage: [["goclick.mode", "local"]] });
  assert.deepEqual(h.startupRequests, []);
  h.window.fire("offline");
  assert.equal(h.element("#click-button").disabled, false);
  for (let i = 0; i < 12; i++) await h.element("#click-button").fire("click");
  h.window.fire("focus");
  h.window.fire("online");
  h.document.fire("visibilitychange");
  assert.deepEqual(h.requests, []);
  assert.equal(h.element("#click-count").textContent, "12");
  assert.equal(JSON.parse(h.storage.get("goclick.local.v1")).counters.click_count.count, 12);
  assert.equal(h.element("#local-mode-note").hidden, false);
});

test("entering local mode isolates account progress and returning rechecks the account", async () => {
  const h = await harness();
  h.context.startLocalGame();
  await h.element("#click-button").fire("click");
  assert.equal(h.element("#click-count").textContent, "1");
  assert.deepEqual(h.requests, []);
  h.element("#leave-local").fire("click");
  await settle();
  assert.equal(h.element("#click-count").textContent, "10");
  assert.deepEqual(
    h.requests.map((r) => r.method),
    ["GET", "GET"],
  );
  assert.equal(JSON.parse(h.storage.get("goclick.local.v1")).counters.click_count.count, 1);
});

test("copy and restart require explicit replacement and never mutate account data", async () => {
  const h = await harness();
  h.element("#copy-online-local").fire("click");
  await settle();
  assert.equal(h.storage.has("goclick.local.v1"), false);
  h.element("#replace-local").checked = true;
  h.element("#copy-online-local").fire("click");
  await settle();
  assert.equal(JSON.parse(h.storage.get("goclick.local.v1")).counters.click_count.count, 10);
  assert.equal(h.element("#replace-local").checked, false);
  h.context.startLocalGame();
  await h.element("#click-button").fire("click");
  assert.equal(h.element("#click-count").textContent, "11");
  h.element("#replace-local").checked = true;
  await h.element("#restart-local").fire("click");
  assert.equal(h.element("#click-count").textContent, "0");
  assert.deepEqual(h.requests, []);
});

test("storage failure cannot pretend a local click was saved", async () => {
  const h = await harness({ storage: [["goclick.mode", "local"]] });
  h.failStorage();
  await h.element("#click-button").fire("click");
  assert.equal(h.element("#click-count").textContent, "0");
  assert.match(h.element("#game-error").textContent, /wasn’t saved/);
  assert.equal(h.feedback[0].failed, true);
  assert.deepEqual(h.requests, []);
});

test("an account refresh in flight cannot overwrite a newly opened local game", async () => {
  const h = await harness();
  const progress = deferred();
  h.fetch((url) => (url === "/api/clicks" ? progress.promise : Promise.resolve(response(player))));
  const refreshing = h.context.refreshGame();
  h.context.startLocalGame();
  await h.element("#click-button").fire("click");
  progress.resolve(response(counters(999)));
  await refreshing;
  assert.equal(h.element("#click-count").textContent, "1");
  assert.equal(h.element("#local-nav").hidden, false);
});

test("the production game bundle boots without leaking application functions", async () => {
  const h = await harness({ production: true });
  assert.equal(h.element("#game-username").textContent, "player");
  assert.equal(h.element("#click-button").disabled, false);
  assert.equal(h.context.openGame, undefined);
  assert.equal(h.context.gameSettings, undefined);
  assert.deepEqual(
    h.startupRequests.map((request) => request.url),
    ["/api/clicks", "/api/me"],
  );
});

test("the production local-mode bundle skips account requests on startup", async () => {
  const h = await harness({ production: true, storage: [["goclick.mode", "local"]] });
  assert.equal(h.element("#local-mode-note").hidden, false);
  assert.deepEqual(h.startupRequests, []);
});

test("known authentication capacity rejection does not suggest replaying an uncertain click", async () => {
  const h = await harness();
  h.fetch(async () => response({ error: "Busy", code: "authentication_busy" }, 503));
  await h.element("#click-button").fire("click");
  assert.match(h.element("#game-error").textContent, /wasn’t saved/);
  assert.equal(h.element("#retry-game-button").hidden, true);
  assert.equal(h.feedback[0].uncertain, false);
});

test("switching back online detaches an old read without losing the new read's ownership", async () => {
  const h = await harness();
  const oldProgress = deferred(),
    newProgress = deferred();
  let reads = 0;
  h.fetch((url) =>
    url === "/api/me"
      ? Promise.resolve(response(player))
      : ++reads === 1
        ? oldProgress.promise
        : newProgress.promise,
  );
  const stale = h.context.refreshGame();
  h.context.startLocalGame();
  h.element("#leave-local").fire("click");
  await settle();
  assert.equal(h.requests.filter((r) => r.url === "/api/clicks").length, 2);
  oldProgress.resolve(response(counters(999)));
  await stale;
  assert.equal(h.element("#refresh-counter").attributes.get("aria-busy"), "true");
  newProgress.resolve(response(counters(24)));
  await settle();
  assert.equal(h.element("#game-view").hidden, false);
  assert.equal(h.element("#click-count").textContent, "24");
  assert.equal(h.element("#click-button").disabled, false);
  assert.equal(h.element("#refresh-counter").attributes.get("aria-busy"), "false");
});

for (const kind of ["login", "signup"]) {
  test(`late ${kind} success cannot reset a local game or request account counters`, async () => {
    const h = await harness();
    const auth = deferred();
    h.context.show(kind);
    h.fetch(() => auth.promise);
    const signingIn = h.element(`#${kind}-form`).fire("submit");
    h.context.startLocalGame();
    await h.element("#click-button").fire("click");
    auth.resolve(response({ user: { ...player, id: 2 } }));
    await signingIn;
    assert.equal(h.element("#click-count").textContent, "1");
    assert.equal(h.element("#local-nav").hidden, false);
    assert.equal(h.feedback.length, 1);
    assert.equal(h.requests.length, 1);
  });
}
