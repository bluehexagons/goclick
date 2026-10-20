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
    checked = false;
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
    select() {
      this.selected = true;
    }
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
    if (!elements.has(selector)) {
      const next = new Element();
      if (
        selector === "#include-share-link" ||
        selector === "#include-share-clicks" ||
        selector === "#include-share-streaks"
      )
        next.checked = true;
      elements.set(selector, next);
    }
    return elements.get(selector);
  };
  document = Object.assign(new Element(), {
    documentElement: new Element(),
    hidden: false,
    querySelector: element,
    querySelectorAll: () => [],
  });
  const timers = new Map();
  let timerID = 0;
  const window = Object.assign(new Element(), {
    location: { origin: "https://goclick.example" },
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    scrollTo() {},
    clearTimeout(id) {
      timers.delete(id);
    },
    setTimeout(callback) {
      timers.set(++timerID, callback);
      return timerID;
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
    AbortController,
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
    navigator: {
      onLine: true,
      locks: options.locks ?? { request: (_, operation) => Promise.resolve().then(operation) },
      clipboard: options.clipboard,
    },
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
    tactileButtons: { values: () => [], get: () => ({ reset() {}, respond() {} }) },
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
    runTimers() {
      while (timers.size) {
        const [id, callback] = timers.entries().next().value;
        timers.delete(id);
        callback();
      }
    },
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
  assert.equal(h.element("#nav-username").textContent, "other_player");
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
  assert.equal(h.element("#nav-username").textContent, "player");
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
  test(`${kind} focuses the enabled game button after authentication completes`, async () => {
    const h = await harness();
    h.context.show(kind);
    h.fetch((url) =>
      Promise.resolve(response(url.startsWith("/api/auth/") ? { user: player } : counters(12))),
    );
    await h.element(`#${kind}-form`).fire("submit");
    assert.equal(h.element("#click-button").disabled, false);
    assert.equal(h.document.activeElement, h.element("#click-button"));
  });

  test(`${kind} serializes both authentication forms until its session cookie settles`, async () => {
    const h = await harness();
    const auth = deferred();
    h.context.show(kind);
    h.fetch((url) =>
      url.startsWith("/api/auth/")
        ? auth.promise
        : Promise.resolve(response(url === "/api/me" ? player : counters(12))),
    );
    const signingIn = h.element(`#${kind}-form`).fire("submit");
    const other = kind === "login" ? "signup" : "login";
    h.context.show(other);
    assert.equal(h.element(`#${other}-form`).querySelector().disabled, true);
    await h.element(`#${other}-form`).fire("submit");
    await h.element(`#${kind}-form`).fire("submit");
    assert.equal(h.requests.length, 1);
    auth.resolve(response({ user: player }));
    await signingIn;
    assert.equal(h.element("#nav-username").textContent, player.username);
    assert.equal(h.element("#click-count").textContent, "12");
    assert.equal(h.element(`#${other}-form`).querySelector().disabled, false);
  });

  test(`late ${kind} success cannot reset a local game or request account counters`, async () => {
    const h = await harness();
    const auth = deferred();
    h.context.show(kind);
    h.fetch(() => auth.promise);
    const signingIn = h.element(`#${kind}-form`).fire("submit");
    h.context.startLocalGame();
    assert.equal(h.element("#leave-local").disabled, true);
    await h.element("#leave-local").fire("click");
    await h.element("#click-button").fire("click");
    auth.resolve(response({ user: { ...player, id: 2 } }));
    await signingIn;
    assert.equal(h.element("#click-count").textContent, "1");
    assert.equal(h.element("#local-nav").hidden, false);
    assert.equal(h.feedback.length, 1);
    assert.equal(h.requests.length, 1);
    assert.equal(h.element("#leave-local").disabled, false);
  });
}

test("leaving local play still checks the account when the mode cannot be persisted", async () => {
  const h = await harness({ storage: [["goclick.mode", "local"]] });
  h.failStorage();
  await h.element("#leave-local").fire("click");
  assert.equal(h.element("#local-nav").hidden, true);
  assert.equal(h.element("#nav-username").textContent, player.username);
  assert.equal(h.element("#click-count").textContent, "10");
  assert.equal(h.element("#options-dialog").open, true);
  assert.match(h.element("#options-status").textContent, /Back online for this visit/);
  assert.equal(h.storage.get("goclick.mode"), "local");
});

test("a queued local replacement pauses play, mode changes, and duplicate replacements", async () => {
  const gate = deferred();
  let operations = 0;
  const h = await harness({
    storage: [["goclick.mode", "local"]],
    locks: {
      request: async (_key, operation) => {
        operations++;
        await gate.promise;
        return operation();
      },
    },
  });
  h.element("#replace-local").checked = true;
  const replacing = h.element("#restart-local").fire("click");
  assert.equal(h.element("#click-button").disabled, true);
  assert.equal(h.element("#leave-local").disabled, true);
  assert.equal(h.element("#import-local").disabled, true);
  await h.element("#click-button").fire("click");
  h.element("#leave-local").fire("click");
  await h.element("#restart-local").fire("click");
  assert.equal(operations, 1);
  assert.equal(h.storage.get("goclick.mode"), "local");
  assert.deepEqual(h.requests, []);
  gate.resolve();
  await replacing;
  assert.equal(h.element("#click-button").disabled, false);
  assert.equal(h.element("#leave-local").disabled, false);
  assert.equal(h.element("#import-local").disabled, false);
  assert.equal(h.element("#replace-local").checked, false);
});

test("a failed local replacement releases the controls without erasing the saved slot", async () => {
  const h = await harness({ storage: [["goclick.mode", "local"]] });
  await h.element("#click-button").fire("click");
  const saved = h.storage.get("goclick.local.v1");
  h.failStorage();
  h.element("#replace-local").checked = true;
  await h.element("#restart-local").fire("click");
  assert.equal(h.storage.get("goclick.local.v1"), saved);
  assert.equal(h.element("#click-button").disabled, false);
  assert.match(h.element("#options-status").textContent, /was not replaced/);
});

test("an older simulated response cannot hide a more recent local save failure", async () => {
  const h = await harness({ storage: [["goclick.mode", "local"]] });
  await h.element("#click-button").fire("click");
  h.failStorage();
  await h.element("#click-button").fire("click");
  h.runTimers();
  assert.equal(h.element("#connection").classList.contains("is-error"), true);
  assert.match(h.element("#game-error").textContent, /wasn’t saved/);
  assert.equal(h.feedback[0].failed, undefined);
  assert.equal(h.feedback[1].failed, true);
});

test("external local-save changes received during a write are reconciled after it finishes", async () => {
  const gate = deferred();
  const h = await harness({
    storage: [["goclick.mode", "local"]],
    locks: {
      request: async (_key, operation) => {
        const saved = operation();
        await gate.promise;
        return saved;
      },
    },
  });
  const click = h.element("#click-button").fire("click");
  const external = JSON.parse(h.storage.get("goclick.local.v1"));
  external.counters.click_count.count = 42;
  h.storage.set("goclick.local.v1", JSON.stringify(external));
  h.window.fire("storage", { key: "goclick.local.v1" });
  gate.resolve();
  await click;
  assert.equal(h.element("#click-count").textContent, "42");
  h.storage.delete("goclick.local.v1");
  h.window.fire("storage", { key: null });
  assert.equal(h.element("#click-count").textContent, "0");
  assert.deepEqual(h.requests, []);
});

test("a timed-out click releases pending controls without replaying an uncertain save", async () => {
  const h = await harness();
  h.fetch(
    (_url, options) =>
      new Promise((_resolve, reject) =>
        options.signal.addEventListener("abort", () => reject(new Error("Aborted"))),
      ),
  );
  const click = h.element("#click-button").fire("click");
  assert.equal(h.element("#refresh-counter").disabled, true);
  h.runTimers();
  await click;
  assert.equal(h.element("#refresh-counter").disabled, false);
  assert.equal(h.element("#click-button").disabled, false);
  assert.equal(h.element("#retry-game-button").hidden, false);
  assert.match(h.element("#game-error").textContent, /Couldn’t confirm.*took too long/);
  assert.equal(h.feedback[0].uncertain, true);
  assert.equal(h.requests.length, 1);
});

test("Share copies confirmed progress without account requests or private identifiers", async () => {
  const copies = [];
  const h = await harness({ clipboard: { writeText: async (text) => copies.push(text) } });
  assert.equal(h.element("#share-stats").disabled, false);
  await h.element("#share-stats").fire("click");
  assert.equal(copies.length, 1);
  assert.match(copies[0], /Go Click\n10 saved clicks\nUTC streaks: 0 days · 0 months · 0 years/);
  assert.match(copies[0], /Play: https:\/\/goclick\.example/);
  assert.equal(copies[0].includes(player.username), false);
  assert.equal(h.element("#share-status").textContent, "Stats copied.");
  assert.deepEqual(h.requests, []);
  const save = deferred();
  h.fetch(() => save.promise);
  const clicking = h.element("#click-button").fire("click");
  assert.equal(h.element("#share-stats").disabled, true);
  await h.element("#share-stats").fire("click");
  assert.equal(copies.length, 1);
  save.resolve(response(counters(11)));
  await clicking;
  await h.element("#share-stats").fire("click");
  assert.match(copies[1], /11 saved clicks/);
});

test("local Share uses the displayed local save and labels its separate progress", async () => {
  const copies = [];
  const h = await harness({ clipboard: { writeText: async (text) => copies.push(text) } });
  h.context.startLocalGame();
  await h.element("#click-button").fire("click");
  await h.element("#share-stats").fire("click");
  assert.equal(
    copies[0],
    "Go Click · offline\n1 local click\nUTC streaks: 1 day · 1 month · 1 year\nPlay: https://goclick.example",
  );
  assert.deepEqual(h.requests, []);
});

for (const clipboard of [
  undefined,
  {
    writeText: async () => {
      throw new Error("Denied");
    },
  },
]) {
  test(`clipboard ${clipboard ? "rejection" : "unavailability"} offers selectable stats for manual copying`, async () => {
    const h = await harness({ clipboard });
    await h.element("#share-stats").fire("click");
    assert.equal(h.element("#share-dialog").open, true);
    assert.match(h.element("#share-text").value, /10 saved clicks/);
    assert.equal(h.element("#share-text").selected, true);
    assert.equal(h.document.activeElement, h.element("#share-text"));
    assert.equal(h.element("#share-stats").attributes.get("aria-busy"), "false");
    assert.notEqual(h.element("#share-status").textContent, "Stats copied.");
    h.element("#close-share").fire("click");
    assert.equal(h.element("#share-dialog").open, false);
    assert.deepEqual(h.requests, []);
  });
}

test("a stale clipboard failure cannot interrupt a different mode and duplicate shares coalesce", async () => {
  const copy = deferred();
  let requests = 0;
  const h = await harness({
    clipboard: {
      writeText: () => {
        requests++;
        return copy.promise.then(() => {
          throw new Error("Denied");
        });
      },
    },
  });
  const sharing = h.element("#share-stats").fire("click");
  await h.element("#share-stats").fire("click");
  assert.equal(requests, 1);
  h.context.startLocalGame();
  copy.resolve();
  await sharing;
  assert.equal(h.element("#share-status").textContent, "");
  assert.equal(h.element("#share-dialog").open, false);
});

test("429s start a calm cooldown, suppress requests, and resume without replaying clicks", async () => {
  const h = await harness();
  h.fetch(async () => ({ ...response({ error: "Slow down" }, 429), headers: { get: () => "5" } }));
  await h.element("#click-button").fire("click");
  assert.equal(h.element("#play-status").hidden, false);
  assert.match(h.element("#cooldown-time").textContent, /5s/);
  assert.equal(h.element("#click-button").attributes.get("aria-disabled"), "true");
  assert.equal(h.element("#game-error").hidden, true);
  const requests = h.requests.length;
  await h.element("#click-button").fire("click");
  assert.equal(h.requests.length, requests);
  assert.equal(h.element("#click-count").textContent, "10");
  h.advance(5000);
  h.runTimers();
  assert.equal(h.element("#play-status").hidden, true);
  assert.equal(h.element("#click-button").attributes.get("aria-disabled"), "false");
  assert.equal(h.requests.length, requests);
  h.fetch(async () => response(counters(11)));
  await h.element("#click-button").fire("click");
  assert.equal(h.element("#click-count").textContent, "11");
});

test("overlapping cooldowns never shorten a deadline and switching to local play clears it", async () => {
  const h = await harness();
  const first = deferred(),
    second = deferred();
  let calls = 0;
  h.fetch(() => (++calls === 1 ? first.promise : second.promise));
  const a = h.element("#click-button").fire("click"),
    b = h.element("#click-button").fire("click");
  first.resolve({ ...response({}, 429), headers: { get: () => "10" } });
  await a;
  second.resolve({ ...response({}, 429), headers: { get: () => "2" } });
  await b;
  h.advance(3000);
  await h.element("#click-button").fire("click");
  assert.equal(calls, 2);
  await h.context.startLocalGame();
  assert.equal(h.element("#play-status").hidden, true);
  await h.element("#click-button").fire("click");
  assert.equal(calls, 2);
  assert.equal(h.element("#click-count").textContent, "1");
});

test("accepted clicks already in flight still count when another request starts a cooldown", async () => {
  const h = await harness(),
    limited = deferred(),
    saved = deferred();
  let calls = 0;
  h.fetch(() => (++calls === 1 ? limited.promise : saved.promise));
  const a = h.element("#click-button").fire("click"),
    b = h.element("#click-button").fire("click");
  limited.resolve({ ...response({}, 429), headers: { get: () => "5" } });
  await a;
  saved.resolve(response(counters(11)));
  await b;
  assert.equal(h.element("#click-count").textContent, "11");
  assert.equal(h.element("#play-status").hidden, false);
  assert.equal(h.element("#click-button").attributes.get("aria-disabled"), "true");
  assert.equal(h.element("#pending-clicks").hidden, true);
  assert.equal(h.element("#game-error").hidden, true);
});
