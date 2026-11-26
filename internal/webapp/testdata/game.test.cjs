"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { frontend } = require("./frontend.cjs");

const player = { id: "1", username: "player", admin: false };
const counters = (count) => ({
  click_count: { count },
  earned_badges: ["gone-click", "sentence", "paragraph", "essay"].slice(
    0,
    [1, 25, 100, 500].filter((target) => count >= target).length,
  ),
});
const game = (count, user = player) => ({ user, counters: counters(count) });
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
    style = { setProperty: (key, value) => (this.style[key] = value) };
    textContent = "";
    hidden = false;
    disabled = false;
    checked = false;
    get valueAsNumber() {
      return Number(this.value);
    }
    contains(element) {
      return element === this;
    }
    closest() {
      return this;
    }
    getBoundingClientRect() {
      return { width: 100, height: 100, top: 0, left: 0 };
    }
    children = [];
    append(...children) {
      this.children.push(...children);
    }
    remove() {}
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
    createElement: () => new Element(),
    createElementNS: () => new Element(),
    querySelectorAll: (selector) =>
      selector === "[data-play-local]" ? [element("#play-local")] : [],
  });
  if (options.offlineOnly) document.documentElement.dataset.offlineOnly = "";
  const timers = new Map();
  let timerID = 0;
  const location = new URL(options.url ?? "https://goclick.example/");
  element("#open-achievements").href = new URL("./?view=achievements", location).href;
  element("#back-to-game").href = new URL("./", location).href;
  const window = Object.assign(new Element(), {
    location,
    history: {
      replaceState(_, __, href) {
        location.href = href;
      },
      pushState(_, __, href) {
        location.href = href;
      },
    },
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    scrollTo() {},
    setInterval() {
      return 1;
    },
    clearInterval() {},
    clearTimeout(id) {
      timers.delete(id);
    },
    setTimeout(callback, delay) {
      timers.set(++timerID, { callback, delay });
      return timerID;
    },
  });
  let handler = options.initialFetch ?? (async () => response(game(10)));
  const requests = [];
  const storage = new Map(options.storage);
  let failStorage = false;
  const feedback = [];
  let now = 1;
  const globals = {
    console,
    Headers,
    AbortController,
    URL,
    URLSearchParams,
    FormData: class {
      get(name) {
        return options.form?.[name] ?? (name === "identifier_type" ? "auto" : "password");
      }
      entries() {
        return [];
      }
    },
    document,
    window,
    navigator: {
      onLine: true,
      serviceWorker: options.serviceWorker,
      locks: options.locks ?? {
        request: (_, options, operation) => Promise.resolve().then(operation ?? options),
      },
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
    tactileButtons: {
      values: () => [],
      get: () => ({ clickAchievements: options.clickAchievements, reset() {}, respond() {} }),
    },
    fetch: (url, options) => {
      requests.push({ url, method: options.method || "GET" });
      return handler(url, options);
    },
  };
  const runtime = frontend(globals, {
    button: { tactileButtons: globals.tactileButtons },
    "click-feedback": { clickFeedback: globals.clickFeedback },
    ...(options.sound ? { sound: { clickSound: options.sound } } : {}),
  });
  const context = options.production ? runtime.bundle("app") : runtime.load("app");
  await settle();
  assert.equal(
    element("#click-count").textContent,
    options.offlineOnly ||
      options.storage?.some(([key, value]) => key === "goclick.mode" && value === "local")
      ? "0"
      : new Intl.NumberFormat(
          options.storage?.find(([key]) => key === "goclick.language.v1")?.[1] ?? "en",
        ).format(options.expectedCount ?? 10),
  );
  const startupRequests = requests.slice();
  requests.length = 0;
  return {
    context,
    element,
    chooseLanguage(code) {
      return element("#language-menu")
        .children.find((option) => option.value === code)
        .fire("click");
    },
    document,
    window,
    requests,
    startupRequests,
    storage,
    feedback,
    runTimers(maxDelay = Infinity) {
      for (;;) {
        const timer = [...timers].find(([, { delay }]) => (delay ?? 0) <= maxDelay);
        if (!timer) return;
        const [id, { callback }] = timer;
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

test("speaker defaults off, persists independently of motion, and survives unavailable audio", async () => {
  const h = await harness();
  const toggle = h.element("#sound-toggle");
  assert.equal(toggle.attributes.get("aria-pressed"), "false");
  assert.match(toggle.title, /Sound off/);
  toggle.fire("click");
  assert.equal(toggle.attributes.get("aria-pressed"), "true");
  assert.equal(JSON.parse(h.storage.get("goclick.settings.v1")).sound, true);
  assert.equal(JSON.parse(h.storage.get("goclick.settings.v1")).motion, "auto");
  assert.deepEqual(h.requests, []);
  h.fetch(async () => response(counters(11)));
  await h.element("#click-button").fire("click");
  assert.equal(h.element("#click-count").textContent, "11");
  const reloaded = await harness({ storage: [...h.storage] });
  assert.equal(reloaded.element("#sound-toggle").attributes.get("aria-pressed"), "true");
  reloaded.failStorage();
  reloaded.element("#sound-toggle").fire("click");
  assert.equal(reloaded.element("#sound-toggle").attributes.get("aria-pressed"), "false");
  reloaded.element("#sound-toggle").fire("click");
  assert.equal(reloaded.element("#sound-toggle").attributes.get("aria-pressed"), "true");
});

test("speaker follows cross-tab settings and language changes without account requests", async () => {
  const h = await harness({ storage: [["goclick.settings.v1", '{"motion":"on","sound":true}']] });
  const toggle = h.element("#sound-toggle");
  assert.equal(toggle.attributes.get("aria-pressed"), "true");
  h.window.fire("storage", { key: "goclick.settings.v1", newValue: '{"sound":false}' });
  assert.equal(toggle.attributes.get("aria-pressed"), "false");
  h.window.fire("storage", { key: "goclick.settings.v1", newValue: '{"sound":true}' });
  assert.equal(toggle.attributes.get("aria-pressed"), "true");
  h.chooseLanguage("es");
  assert.equal(toggle.attributes.get("aria-label"), "Efectos de sonido");
  assert.match(toggle.title, /Sonido activado/);
  assert.equal(toggle.attributes.get("aria-pressed"), "true");
  h.window.fire("storage", { key: null, newValue: null });
  assert.equal(toggle.attributes.get("aria-pressed"), "false");
  assert.deepEqual(h.requests, []);
});

test("legacy, malformed, and non-boolean sound settings stay muted", async () => {
  for (const value of ['{"motion":"on"}', '{"sound":"true"}', '{"sound":1}', "null", "invalid"]) {
    const h = await harness({ storage: [["goclick.settings.v1", value]] });
    assert.equal(h.element("#sound-toggle").attributes.get("aria-pressed"), "false", value);
  }
});

test("profile selection persists without enabling sound, requests, or game progress", async () => {
  const h = await harness();
  const selector = h.element("#sound-profile");
  assert.equal(selector.value, "classic");
  assert.equal(h.element("#sound-enabled").checked, false);
  assert.equal(h.element("#preview-sound").disabled, true);
  selector.value = "low-beep";
  selector.fire("change");
  assert.equal(
    h.element("#sound-profile-description").textContent,
    "A low tone with a soft attack.",
  );
  assert.equal(JSON.parse(h.storage.get("goclick.settings.v1")).soundProfile, "low-beep");
  assert.equal(JSON.parse(h.storage.get("goclick.settings.v1")).sound, false);
  assert.deepEqual(h.requests, []);
  assert.equal(h.element("#click-count").textContent, "10");
  const reloaded = await harness({ storage: [...h.storage] });
  assert.equal(reloaded.element("#sound-profile").value, "low-beep");
  assert.equal(reloaded.element("#sound-enabled").checked, false);
});

test("Options and header sound toggles stay in sync; previews never add clicks", async () => {
  const h = await harness();
  const checkbox = h.element("#sound-enabled"),
    preview = h.element("#preview-sound");
  checkbox.checked = true;
  checkbox.fire("change");
  assert.equal(h.element("#sound-toggle").attributes.get("aria-pressed"), "true");
  assert.equal(preview.disabled, false);
  preview.fire("click");
  assert.deepEqual(h.requests, []);
  assert.equal(h.element("#click-count").textContent, "10");
  h.element("#sound-toggle").fire("click");
  assert.equal(checkbox.checked, false);
  assert.equal(preview.disabled, true);
  preview.fire("click");
  assert.deepEqual(h.requests, []);
});

test("closing Options cancels its sound preview without changing game progress", async () => {
  let playing = false;
  const h = await harness({
    storage: [["goclick.settings.v1", '{"sound":true}']],
    sound: {
      setProfile() {},
      setVolume() {},
      setReverb() {},
      setEnabled() {},
      preview() {
        playing = true;
      },
      cancelPreview() {
        playing = false;
      },
    },
  });
  h.element("#options-button").fire("click");
  assert.equal(h.element("#preview-sound").disabled, false);
  h.element("#preview-sound").fire("click");
  assert.equal(playing, true);
  h.element("#options-dialog").fire("close");
  assert.equal(playing, false);
  assert.equal(h.element("#click-count").textContent, "10");
  assert.deepEqual(h.requests, []);
});

test("profile controls follow cross-tab choices, storage failure, and legacy fallback", async () => {
  const h = await harness({ storage: [["goclick.settings.v1", '{"sound":true}']] });
  const selector = h.element("#sound-profile");
  assert.equal(selector.value, "classic");
  h.window.fire("storage", {
    key: "goclick.settings.v1",
    newValue: '{"sound":true,"soundProfile":"soft-chime"}',
  });
  assert.equal(selector.value, "soft-chime");
  assert.equal(h.element("#sound-enabled").checked, true);
  h.failStorage();
  selector.value = "clunk";
  selector.fire("change");
  assert.equal(selector.value, "clunk");
  assert.match(h.element("#options-status").textContent, /Applied for this visit/);
  for (const invalid of ["unknown", "__proto__", null, 5]) {
    h.window.fire("storage", {
      key: "goclick.settings.v1",
      newValue: JSON.stringify({ soundProfile: invalid }),
    });
    assert.equal(selector.value, "classic");
  }
  assert.deepEqual(h.requests, []);
});

test("simulated ping defaults to 50 ms and preserves an existing 80 ms setting", async () => {
  const defaultPlayer = await harness();
  assert.equal(defaultPlayer.element("#simulated-ping").value, "50");
  const existingPlayer = await harness({
    storage: [["goclick.settings.v1", '{"simulatedPing":80}']],
  });
  const ping = existingPlayer.element("#simulated-ping");
  assert.equal(ping.value, "80");
  ping.value = "50";
  ping.fire("change");
  assert.equal(JSON.parse(existingPlayer.storage.get("goclick.settings.v1")).simulatedPing, 50);
});

test("volume and room settings update, persist, and follow other tabs", async () => {
  const volumes = [],
    reverb = [];
  const h = await harness({
    storage: [["goclick.settings.v1", '{"sound":false,"soundProfile":"clack"}']],
    sound: {
      setProfile() {},
      setEnabled() {},
      setVolume: (value) => volumes.push(value),
      setReverb: (value) => reverb.push(value),
    },
  });
  const slider = h.element("#sound-volume");
  const value = h.element("#sound-volume-value");
  const room = h.element("#sound-reverb");
  assert.equal(slider.value, "100");
  assert.equal(room.checked, true);
  slider.value = "37";
  slider.fire("input");
  assert.equal(value.textContent, "37%");
  assert.equal(volumes.at(-1), 0.37);
  assert.equal(JSON.parse(h.storage.get("goclick.settings.v1")).soundVolume, undefined);
  slider.fire("change");
  room.checked = false;
  room.fire("change");
  assert.equal(reverb.at(-1), false);
  const saved = h.storage.get("goclick.settings.v1");
  const reloaded = await harness({ storage: [["goclick.settings.v1", saved]] });
  assert.equal(reloaded.element("#sound-volume").value, "37");
  assert.equal(reloaded.element("#sound-reverb").checked, false);
  assert.equal(reloaded.element("#sound-enabled").checked, false);

  for (const [newValue, percent] of [
    ['{"soundVolume":0,"soundReverb":true}', "0"],
    ['{"soundVolume":101,"soundReverb":null}', "100"],
    ['{"soundVolume":"50","soundReverb":"false"}', "100"],
  ]) {
    h.window.fire("storage", { key: "goclick.settings.v1", newValue });
    assert.equal(slider.value, percent);
    assert.equal(value.textContent, `${percent}%`);
    assert.equal(room.checked, true);
    assert.equal(volumes.at(-1), Number(percent) / 100);
    assert.equal(reverb.at(-1), true);
  }
  assert.deepEqual(h.requests, []);
});

test("even brief tab switches recheck identity and coalesce focus with visibility", async () => {
  const h = await harness();
  const progress = deferred();
  h.fetch(() => progress.promise);
  h.document.hidden = true;
  h.document.fire("visibilitychange");
  assert.equal(h.requests.length, 0);
  h.document.hidden = false;
  h.document.fire("visibilitychange");
  h.window.fire("focus");
  assert.equal(h.element("#click-button").disabled, true);
  progress.resolve(response(game(3, { id: "2", username: "other_player", admin: false })));
  await settle();
  assert.deepEqual(
    h.requests.map((r) => r.url),
    ["/api/game"],
  );
  assert.equal(h.element("#nav-username").textContent, "other_player");
  assert.equal(h.element("#click-count").textContent, "3");
  assert.equal(h.element("#click-button").disabled, false);
});

test("a session replaced before a click refreshes identity without replaying the rejected write", async () => {
  const h = await harness();
  h.fetch((url, options) => {
    if (options.method === "POST") {
      assert.equal(options.headers.get("X-GoClick-User-ID"), "1");
      return response({ error: "Account changed", code: "account_changed" }, 409);
    }
    return response(game(3, { id: "2", username: "other_player" }));
  });
  await h.element("#click-button").fire("click");
  await settle();
  assert.deepEqual(
    h.requests.map((request) => request.method),
    ["POST", "GET"],
  );
  assert.equal(h.feedback[0].failed, true);
  assert.equal(h.feedback[0].uncertain, false);
  assert.equal(h.element("#nav-username").textContent, "other_player");
  assert.equal(h.element("#click-count").textContent, "3");
  assert.equal(h.element("#click-button").disabled, false);
});

test("returning to the game coalesces refreshes and updates a switched account", async () => {
  const h = await harness();
  const progress = deferred();
  h.fetch(() => progress.promise);
  const first = h.context.refreshGame();
  assert.equal(h.context.refreshGame(), first);
  assert.equal(h.element("#click-button").disabled, true);
  assert.equal(h.element("#refresh-counter").attributes.get("aria-busy"), "true");
  assert.equal(h.element("#counter-card").attributes.get("aria-busy"), "false");
  progress.resolve(response(game(3, { id: "2", username: "other_player", admin: true })));
  await first;
  assert.equal(h.element("#nav-username").textContent, "other_player");
  assert.equal(h.element("#click-count").textContent, "3");
  assert.equal(h.element("#click-button").disabled, false);
  assert.equal(h.element("#admin-link").hidden, false);
  assert.deepEqual(
    h.requests.map((r) => r.method),
    ["GET"],
  );
});

test("production startup uses one account snapshot for display, clicks, and local copying", async () => {
  const other = { id: "2", username: "other_player", admin: false };
  const h = await harness({
    production: true,
    expectedCount: 3,
    initialFetch: async (url) => {
      assert.equal(url, "/api/game");
      return response(game(3, other));
    },
  });
  assert.equal(h.element("#nav-username").textContent, other.username);
  h.fetch(async (url, options) => {
    assert.equal(url, "/api/clicks");
    assert.equal(options.headers.get("X-GoClick-User-ID"), other.id);
    return response(counters(4));
  });
  await h.element("#click-button").fire("click");
  assert.equal(h.element("#click-count").textContent, "4");
  h.element("#options-button").fire("click");
  assert.match(h.element("#copy-online-note").textContent, /other_player/);
  h.element("#replace-local").checked = true;
  await h.element("#copy-online-local").fire("click");
  await settle();
  assert.equal(JSON.parse(h.storage.get("goclick.local.v1")).counters.click_count.count, 4);
});

for (const leave of ["visibility", "blur"]) {
  for (const status of [200, 401]) {
    test(`a later ${leave} return supersedes an older ${status} read without briefly enabling stale play`, async () => {
      const h = await harness({ production: true });
      const oldRead = deferred(),
        freshRead = deferred();
      let reads = 0;
      h.fetch(() => (++reads === 1 ? oldRead.promise : freshRead.promise));
      h.window.fire("focus");
      if (leave === "visibility") {
        h.document.hidden = true;
        h.document.fire("visibilitychange");
        h.document.hidden = false;
        h.document.fire("visibilitychange");
      } else h.window.fire("blur");
      h.window.fire("focus");
      oldRead.resolve(response(status === 200 ? game(77) : { error: "Expired" }, status));
      await settle();
      assert.equal(reads, 2);
      assert.equal(h.element("#click-count").textContent, "10");
      assert.equal(h.element("#click-button").disabled, true);
      freshRead.resolve(response(game(3, { id: "2", username: "other_player" })));
      await settle();
      assert.equal(h.element("#nav-username").textContent, "other_player");
      assert.equal(h.element("#click-count").textContent, "3");
      assert.equal(h.element("#click-button").disabled, false);
      assert.deepEqual(
        h.requests.map((request) => request.url),
        ["/api/game", "/api/game"],
      );
    });
  }
}

test("an initial snapshot also rechecks identity after returning to the loading tab", async () => {
  const initial = deferred();
  const h = await harness({
    production: true,
    expectedCount: 0,
    initialFetch: () => initial.promise,
  });
  h.fetch(async () => response(game(3, { id: "2", username: "other_player" })));
  h.window.fire("blur");
  h.window.fire("focus");
  initial.resolve(response(game(77)));
  await settle();
  assert.equal(h.element("#nav-username").textContent, "other_player");
  assert.equal(h.element("#click-count").textContent, "3");
  assert.equal(h.element("#click-button").disabled, false);
  assert.deepEqual(
    h.requests.map((request) => request.url),
    ["/api/game"],
  );
});

test("an open Options dialog updates the account and requires fresh replacement consent", async () => {
  const h = await harness();
  h.element("#options-button").fire("click");
  assert.match(h.element("#copy-online-note").textContent, /for player\./);
  h.element("#replace-local").checked = true;
  h.fetch(async () => response(game(3, { id: "2", username: "other_player" })));
  h.window.fire("focus");
  await settle();
  assert.match(h.element("#copy-online-note").textContent, /for other_player\./);
  assert.equal(h.element("#replace-local").checked, false);
  await h.element("#copy-online-local").fire("click");
  assert.equal(h.storage.has("goclick.local.v1"), false);
  h.element("#replace-local").checked = true;
  await h.element("#copy-online-local").fire("click");
  await settle();
  assert.equal(JSON.parse(h.storage.get("goclick.local.v1")).counters.click_count.count, 3);
});

test("a refresh waits for pending clicks instead of replacing their results", async () => {
  const h = await harness();
  const click = deferred();
  h.fetch((url, options) =>
    options.method === "POST" ? click.promise : Promise.resolve(response(game(25))),
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
    ["POST", "GET"],
  );
});

test("a stalled local save bounds pending clicks and re-enables play once they are saved", async () => {
  const gate = deferred();
  let attempts = 0;
  const h = await harness({
    storage: [["goclick.mode", "local"]],
    locks: {
      request(_key, _options, operation) {
        attempts++;
        return gate.promise.then(operation);
      },
    },
  });
  const button = h.element("#click-button");
  const clicks = Array.from({ length: 80 }, () => button.fire("click"));
  assert.equal(attempts, 6);
  assert.equal(button.disabled, true);
  h.runTimers(180);
  const pending = h.element("#pending-clicks");
  assert.equal(pending.hidden, false);
  assert.match(pending.textContent, /6/);
  assert.equal(h.feedback.length, 6);
  assert.equal(h.element("#click-count").textContent, "0");

  gate.resolve();
  await Promise.all(clicks);
  assert.equal(button.disabled, false);
  assert.equal(pending.hidden, true);
  assert.equal(h.element("#click-count").textContent, "6");
  await button.fire("click");
  assert.equal(h.element("#click-count").textContent, "7");
});

test("a local save timeout releases play without scoring the timed-out click later", async () => {
  const gate = deferred();
  let lockReady = false;
  const h = await harness({
    storage: [["goclick.mode", "local"]],
    locks: {
      request(_key, { signal }, operation) {
        if (lockReady) return Promise.resolve(operation());
        return new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          void gate.promise.then(() => {
            if (!signal.aborted) resolve(operation());
          });
        });
      },
    },
  });
  const saving = h.element("#click-button").fire("click");
  assert.equal(h.element("#leave-local").disabled, true);
  h.runTimers();
  await saving;
  assert.equal(h.element("#leave-local").disabled, false);
  assert.equal(h.element("#pending-clicks").hidden, true);
  assert.equal(h.feedback[0].failed, true);
  assert.equal(h.element("#click-count").textContent, "0");
  lockReady = true;
  gate.resolve();
  await settle();
  assert.equal(h.storage.has("goclick.local.v1"), false);
  await h.element("#click-button").fire("click");
  assert.equal(h.element("#click-count").textContent, "1");
});

test("offline clicks are paused and reconnection reads progress without replaying", async () => {
  const h = await harness();
  h.window.fire("offline");
  assert.equal(h.element("#click-button").disabled, true);
  assert.equal(h.element("#network-notice").hidden, false);
  await h.element("#click-button").fire("click");
  assert.deepEqual(h.requests, []);
  h.fetch(async () => response(game(18)));
  h.window.fire("online");
  await settle();
  assert.equal(h.element("#click-count").textContent, "18");
  assert.equal(h.element("#click-button").disabled, false);
  assert.equal(h.element("#network-notice").hidden, true);
  assert.deepEqual(
    h.requests.map((r) => r.method),
    ["GET"],
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
  h.fetch(async () => response(game(15)));
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
  h.fetch((url) => (url === "/api/game" ? progress.promise : Promise.resolve(response({}))));
  const refreshing = h.context.refreshGame();
  await h.element("#logout-button").fire("click");
  progress.resolve(response(game(99)));
  await refreshing;
  assert.equal(h.element("#home-view").hidden, false);
  assert.equal(h.element("#game-view").hidden, true);
  assert.equal(h.element("#click-count").textContent, "0");
});

test("a failed sign-out leaves play paused after a failed counter refresh", async () => {
  const h = await harness();
  h.fetch(async () => response({}, 503));
  await h.context.refreshGame();
  await h.element("#logout-button").fire("click");
  assert.equal(h.element("#click-button").disabled, true);
  assert.equal(h.element("#share-stats").disabled, true);
  const retry = h.element("#retry-game-button");
  assert.equal(retry.hidden, false);
  assert.equal(retry.disabled, false);

  h.fetch(async () => response(game(15)));
  await retry.fire("click");
  assert.equal(h.element("#click-count").textContent, "15");
  assert.equal(h.element("#click-button").disabled, false);
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
  assert.equal(h.element("#local-nav").hidden, false);
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
    ["GET"],
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
  h.fetch((url) => (url === "/api/game" ? progress.promise : Promise.resolve(response({}))));
  const refreshing = h.context.refreshGame();
  h.context.startLocalGame();
  await h.element("#click-button").fire("click");
  progress.resolve(response(game(999)));
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
    ["/api/game"],
  );
});

test("the production local-mode bundle skips account requests on startup", async () => {
  const h = await harness({ production: true, storage: [["goclick.mode", "local"]] });
  assert.equal(h.element("#local-nav").hidden, false);
  assert.deepEqual(h.startupRequests, []);
});

test("the Pages edition stays in local play and shares the project URL", async () => {
  const h = await harness({
    production: true,
    offlineOnly: true,
    url: "https://goclick.example/project/?view=achievements",
    storage: [["goclick.mode", "online"]],
  });
  assert.deepEqual(h.startupRequests, []);
  assert.equal(h.element("#achievement-view").hidden, false);
  assert.equal(h.element("#guest-nav").hidden, true);
  assert.equal(h.element("#user-nav").hidden, true);
  assert.equal(h.element("#local-nav").hidden, true);
  assert.match(h.element("#offline-cache-status").textContent, /Offline reopening is unavailable/);

  h.element("#back-to-game").fire("click", { button: 0 });
  assert.equal(h.window.location.href, "https://goclick.example/project/");
  assert.equal(h.element("#game-view").hidden, false);
  h.window.fire("offline");
  await h.element("#click-button").fire("click", { detail: 0 });
  await h.element("#share-stats").fire("click");
  assert.equal(h.element("#click-count").textContent, "1");
  assert.match(h.element("#share-text").value, /https:\/\/goclick\.example\/project\/$/);

  await h.element("#leave-local").fire("click");
  h.window.fire("online");
  h.window.fire("focus");
  assert.deepEqual(h.requests, []);
  assert.equal(h.storage.get("goclick.mode"), "online");
});

test("Pages reports readiness only when the offline worker activates and localizes the status", async () => {
  const installing = Object.assign(new EventTarget(), { state: "installing" });
  const h = await harness({
    offlineOnly: true,
    url: "https://goclick.example/project/?view=achievements",
    serviceWorker: {
      register: async (url) => {
        assert.equal(url, "https://goclick.example/project/service-worker.js");
        return { installing };
      },
    },
  });
  const status = h.element("#offline-cache-status");
  assert.equal(status.textContent, "Preparing offline access…");
  installing.state = "installed";
  installing.dispatchEvent(new Event("statechange"));
  await settle();
  assert.equal(status.textContent, "Preparing offline access…");
  installing.state = "activated";
  installing.dispatchEvent(new Event("statechange"));
  await settle();
  assert.equal(status.textContent, "Ready to reopen offline.");
  await h.chooseLanguage("es");
  assert.equal(status.textContent, "Ya puedes volver a abrir el juego sin conexión.");
});

test("a failed Pages cache install leaves the current tab playable", async () => {
  const installing = Object.assign(new EventTarget(), { state: "installing" });
  const h = await harness({
    offlineOnly: true,
    serviceWorker: { register: async () => ({ installing }) },
  });
  installing.state = "redundant";
  installing.dispatchEvent(new Event("statechange"));
  await settle();
  assert.match(h.element("#offline-cache-status").textContent, /Keep this tab open/);
  h.window.fire("offline");
  await h.element("#click-button").fire("click");
  assert.equal(h.element("#click-count").textContent, "1");
});

test("Pages keeps its offline-ready status if a worker update fails", async () => {
  const h = await harness({
    offlineOnly: true,
    serviceWorker: {
      controller: { scriptURL: "https://goclick.example/service-worker.js" },
      register: async () => {
        throw new Error("Network unavailable");
      },
    },
  });
  assert.equal(h.element("#offline-cache-status").textContent, "Ready to reopen offline.");
});

test("known authentication capacity rejection does not suggest replaying an uncertain click", async () => {
  const h = await harness();
  h.fetch(async () => response({ error: "Busy", code: "authentication_busy" }, 503));
  await h.element("#click-button").fire("click");
  assert.match(h.element("#game-error").textContent, /wasn’t saved/);
  assert.equal(h.element("#retry-game-button").hidden, true);
  assert.equal(h.feedback[0].uncertain, false);
});

test("an old account read cannot interrupt the new snapshot when returning from local play", async () => {
  const h = await harness();
  const oldProgress = deferred(),
    newProgress = deferred();
  let reads = 0;
  h.fetch(() => (++reads === 1 ? oldProgress.promise : newProgress.promise));
  const stale = h.context.refreshGame();
  h.context.startLocalGame();
  h.element("#leave-local").fire("click");
  await settle();
  assert.equal(h.requests.filter((r) => r.url === "/api/game").length, 2);
  oldProgress.resolve(response(game(999)));
  await stale;
  assert.equal(h.element("#loading-view").hidden, false);
  assert.equal(h.element("#game-view").hidden, true);
  assert.equal(h.element("#click-count").textContent, "0");
  newProgress.resolve(response(game(24)));
  await settle();
  assert.equal(h.element("#game-view").hidden, false);
  assert.equal(h.element("#click-count").textContent, "24");
  assert.equal(h.element("#click-button").disabled, false);
  assert.equal(h.element("#refresh-counter").attributes.get("aria-busy"), "false");
});

test("returning online after session expiry clears cached account copying and preserves local progress", async () => {
  const h = await harness({ production: true });
  await h.element("#play-local").fire("click");
  await h.element("#click-button").fire("click");
  const localSave = h.storage.get("goclick.local.v1");
  assert.equal(JSON.parse(localSave).counters.click_count.count, 1);
  const pending = deferred();
  h.fetch(() => pending.promise);
  const returning = h.element("#leave-local").fire("click");
  h.element("#options-button").fire("click");
  h.element("#replace-local").checked = true;
  pending.resolve(response({ error: "Sign in required" }, 401));
  await returning;
  assert.equal(h.element("#home-view").hidden, false);
  assert.equal(h.element("#nav-username").textContent, "");
  assert.equal(h.element("#copy-online-local").disabled, true);
  assert.doesNotMatch(h.element("#copy-online-note").textContent, /for player/);
  assert.equal(h.element("#replace-local").checked, false);
  assert.equal(h.storage.get("goclick.local.v1"), localSave);
  h.element("#replace-local").checked = true;
  await h.element("#copy-online-local").fire("click");
  assert.equal(h.storage.get("goclick.local.v1"), localSave);
});

for (const kind of ["username", "email"]) {
  test(`login sends an explicit ${kind} choice for overlapping legacy identifiers`, async () => {
    const h = await harness({
      form: { username: "shared@example.com", password: "password123", identifier_type: kind },
    });
    h.context.show("login");
    let submitted;
    h.fetch((url, options) => {
      if (url === "/api/auth/login") {
        submitted = JSON.parse(options.body);
        return Promise.resolve(response({ user: player }));
      }
      return Promise.resolve(response(game(12)));
    });
    await h.element("#login-form").fire("submit");
    assert.deepEqual(submitted, {
      username: "shared@example.com",
      password: "password123",
      identifier_type: kind,
    });
    assert.equal(h.element("#nav-username").textContent, player.username);
  });
}

for (const kind of ["login", "signup"]) {
  test(`${kind} rechecks the snapshot if the shared account changes after authentication`, async () => {
    const h = await harness();
    h.context.show(kind);
    h.fetch(async (url) =>
      response(
        url.startsWith("/api/auth/")
          ? { user: player }
          : game(3, { id: "2", username: "other_player" }),
      ),
    );
    await h.element(`#${kind}-form`).fire("submit");
    assert.equal(h.element("#nav-username").textContent, "other_player");
    assert.equal(h.element("#click-count").textContent, "3");
    assert.equal(h.element("#click-button").disabled, false);
    assert.deepEqual(
      h.requests.map((request) => request.url),
      [`/api/auth/${kind}`, "/api/game"],
    );
  });

  test(`${kind} focuses the enabled game button after authentication completes`, async () => {
    const h = await harness();
    h.context.show(kind);
    h.fetch((url) =>
      Promise.resolve(response(url.startsWith("/api/auth/") ? { user: player } : game(12))),
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
      url.startsWith("/api/auth/") ? auth.promise : Promise.resolve(response(game(12))),
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
    auth.resolve(response({ user: { ...player, id: "2" } }));
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
      request: async (_key, _options, operation) => {
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

test("an invalid import explains the failure and leaves the local save intact", async () => {
  const h = await harness({ offlineOnly: true });
  await h.element("#click-button").fire("click");
  const saved = h.storage.get("goclick.local.v1");
  const fileInput = h.element("#import-local");
  const consent = h.element("#replace-local");
  h.element("#options-button").fire("click");
  consent.checked = true;
  fileInput.files = [{ size: 2, text: async () => "{}" }];
  await fileInput.fire("change");
  assert.match(h.element("#options-status").textContent, /Couldn’t import this local save/);
  assert.match(h.element("#options-status").children.at(-1).textContent, /version 1/);
  assert.equal(h.storage.get("goclick.local.v1"), saved);
  assert.equal(h.element("#click-count").textContent, "1");
  assert.equal(consent.checked, false);
  assert.equal(fileInput.disabled, false);

  const maximumSize = 1024 * 1024;
  consent.checked = true;
  fileInput.files = [
    { size: maximumSize + 1, text: async () => assert.fail("Oversized file read") },
  ];
  await fileInput.fire("change");
  assert.match(h.element("#options-status").textContent, /no larger than 1 MiB/);
  assert.equal(h.storage.get("goclick.local.v1"), saved);

  const replacement = JSON.parse(saved);
  replacement.counters.click_count.count = 31;
  const text = JSON.stringify(replacement).padEnd(maximumSize);
  consent.checked = true;
  fileInput.files = [{ size: text.length, text: async () => text }];
  await fileInput.fire("change");
  assert.equal(h.element("#options-status").textContent, "Local save imported.");
  assert.equal(h.element("#click-count").textContent, "31");
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
      request: async (_key, _options, operation) => {
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
  h.runTimers();
  assert.equal(typeof h.feedback[0].ms, "number");
  h.element("#options-button").fire("click");
  assert.equal(h.element("#local-save-summary").textContent, "Clicks in your local save: 42");
  h.storage.delete("goclick.local.v1");
  h.window.fire("storage", { key: null });
  assert.equal(h.element("#click-count").textContent, "0");
  assert.equal(h.element("#local-save-summary").textContent, "Clicks in your local save: 0");
  assert.deepEqual(h.requests, []);
});

test("regaining focus during a local write waits for its achievement announcement", async () => {
  const gate = deferred();
  const h = await harness({
    storage: [["goclick.mode", "local"]],
    locks: {
      request: async (_key, _options, operation) => {
        const saved = operation();
        await gate.promise;
        return saved;
      },
    },
  });
  const click = h.element("#click-button").fire("click");
  h.window.fire("focus");
  assert.equal(h.element("#achievement-count").textContent, "0 / 22");
  assert.equal(h.element("#achievement-announcement").textContent, "");
  gate.resolve();
  await click;
  assert.equal(h.element("#achievement-count").textContent, "1 / 22");
  assert.equal(h.element("#achievement-notice").hidden, false);
  assert.equal(h.element("#achievement-notice-names").textContent, "Gone Click");
  assert.deepEqual(h.requests, []);
});

test("an unreadable local save clears stale achievements and can recover from storage", async () => {
  const h = await harness({ storage: [["goclick.mode", "local"]] });
  await h.element("#click-button").fire("click");
  const key = "goclick.local.v1";
  const saved = h.storage.get(key);
  h.storage.set(key, "{");
  h.window.fire("storage", { key });
  assert.equal(h.element("#achievement-count").textContent, "0 / 22");
  assert.equal(h.element("#achievement-notice").hidden, true);
  assert.equal(h.element("#click-button").disabled, true);
  assert.equal(h.element("#game-error").hidden, false);
  h.storage.set(key, saved);
  h.window.fire("storage", { key });
  assert.equal(h.element("#achievement-count").textContent, "1 / 22");
  assert.equal(h.element("#achievement-notice").hidden, true);
  assert.equal(h.element("#click-button").disabled, false);
  assert.equal(h.element("#game-error").hidden, true);
  assert.deepEqual(h.requests, []);
});

test("a successful response without a click count is an unconfirmed save", async () => {
  const h = await harness();
  h.fetch(async () => response({ message: "OK" }));
  await h.element("#click-button").fire("click");
  assert.equal(h.element("#click-count").textContent, "10");
  assert.match(h.element("#game-error").textContent, /Couldn’t confirm.*Refresh your counter/);
  assert.equal(h.element("#retry-game-button").hidden, false);
  assert.equal(h.feedback[0].uncertain, true);
  assert.equal(h.feedback[0].ms, undefined);
  assert.deepEqual(h.requests, [{ url: "/api/clicks", method: "POST" }]);
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
  assert.match(h.element("#game-error").textContent, /Couldn’t confirm.*Refresh your counter/);
  assert.equal(h.feedback[0].uncertain, true);
  assert.equal(h.requests.length, 1);
});

test("Share copies confirmed progress without account requests or private identifiers", async () => {
  const copies = [];
  const h = await harness({ clipboard: { writeText: async (text) => copies.push(text) } });
  assert.equal(h.element("#share-stats").disabled, false);
  await h.element("#share-stats").fire("click");
  assert.equal(copies.length, 0);
  await h.element("#copy-share-text").fire("click");
  assert.equal(copies.length, 1);
  assert.match(
    copies[0],
    /Go Click\nSaved clicks: 10\nUTC streaks: 0 days · 0 weeks · 0 months · 0 years/,
  );
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
  await h.element("#copy-share-text").fire("click");
  assert.match(copies[1], /Saved clicks: 11/);
});

test("local Share uses the displayed local save and labels its separate progress", async () => {
  const copies = [];
  const h = await harness({ clipboard: { writeText: async (text) => copies.push(text) } });
  h.context.startLocalGame();
  await h.element("#click-button").fire("click");
  await h.element("#share-stats").fire("click");
  await h.element("#copy-share-text").fire("click");
  assert.equal(
    copies[0],
    "Go Click · Offline\nLocal clicks: 1\nUTC streaks: 1 day · 1 week · 1 month · 1 year\nPlay: https://goclick.example",
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
    assert.match(h.element("#share-text").value, /Saved clicks: 10/);
    await h.element("#copy-share-text").fire("click");
    assert.equal(h.element("#share-text").selected, true);
    assert.equal(h.document.activeElement, h.element("#share-text"));
    assert.equal(h.element("#copy-share-text").attributes.get("aria-busy"), "false");
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
  await h.element("#share-stats").fire("click");
  const sharing = h.element("#copy-share-text").fire("click");
  await h.element("#copy-share-text").fire("click");
  assert.equal(requests, 1);
  h.context.startLocalGame();
  copy.resolve();
  await sharing;
  assert.equal(h.element("#share-status").textContent, "");
  assert.equal(h.element("#share-dialog").open, false);
});

test("429s start a calm cooldown, suppress requests, and resume without replaying clicks", async () => {
  const sounds = [];
  const h = await harness({
    sound: {
      setProfile() {},
      setVolume() {},
      setReverb() {},
      setEnabled() {},
      play: (cue) => sounds.push(cue),
    },
  });
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
  assert.deepEqual(sounds, ["limited"]);
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

test("changing game language preserves pending clicks, ordering and account identity", async () => {
  const h = await harness({
    expectedCount: 12345,
    initialFetch: async () => response(game(12345)),
  });
  const save = deferred();
  h.fetch(() => save.promise);
  const click = h.element("#click-button").fire("click");
  h.chooseLanguage("ar");
  assert.equal(h.storage.get("goclick.language.v1"), "ar");
  assert.equal(h.document.documentElement.lang, "ar");
  assert.equal(h.element("#click-count").textContent, new Intl.NumberFormat("ar").format(12345));
  assert.equal(h.element("#refresh-counter").disabled, true);
  assert.equal(h.element("#nav-username").textContent, player.username);
  save.resolve(response(counters(12346)));
  await click;
  assert.equal(h.element("#click-count").textContent, new Intl.NumberFormat("ar").format(12346));
  assert.equal(h.element("#refresh-counter").disabled, false);
  // A stale server reply must not reduce a count represented by localized digits.
  h.fetch(async () => response(counters(12340)));
  await h.element("#click-button").fire("click");
  assert.equal(h.element("#click-count").textContent, new Intl.NumberFormat("ar").format(12346));
  assert.equal(h.requests.length, 2);
});

test("saved game language applies on boot and cross-tab updates do not make account requests", async () => {
  const h = await harness({ storage: [["goclick.language.v1", "de"]] });
  assert.equal(h.element("#counter-label").textContent, "Gespeicherte Klicks");
  h.storage.set("goclick.language.v1", "ja");
  h.window.fire("storage", { key: "goclick.language.v1" });
  assert.equal(h.element("#counter-label").textContent, "保存済みクリック");
  assert.equal(h.element("#language-name").lang, "ja");
  assert.deepEqual(h.requests, []);
  h.failStorage();
  h.chooseLanguage("fr");
  assert.equal(h.element("#counter-label").textContent, "Clics enregistrés");
  assert.equal(h.element("#click-count").textContent, "10");
  assert.deepEqual(h.requests, []);
});

test("an open Options dialog translates sound and save feedback without resetting the volume slider", async () => {
  const h = await harness({
    storage: [
      ["goclick.settings.v1", '{"soundProfile":"clunk","soundVolume":37,"soundReverb":false}'],
    ],
  });
  h.element("#options-button").fire("click");
  await h.element("#restart-local").fire("click");
  const notice = h.element("#options-status");
  assert.match(notice.textContent, /Allow replacing/);
  const settings = h.storage.get("goclick.settings.v1");
  const volume = h.element("#sound-volume");
  assert.equal(volume.value, "37");
  volume.value = "62";
  volume.fire("input");

  h.storage.set("goclick.language.v1", "ar");
  h.window.fire("storage", { key: "goclick.language.v1" });
  const profile = h.element("#sound-profile");
  const percent = new Intl.NumberFormat("ar", { style: "percent" }).format(0.62);
  assert.equal(h.element("#options-dialog").open, true);
  assert.match(notice.textContent, /السماح/);
  assert.equal(notice.classList.contains("notice-error"), true);
  assert.equal(profile.value, "clunk");
  assert.notEqual(profile.children.find((option) => option.value === "clunk").textContent, "Clunk");
  assert.notEqual(h.element("#sound-profile-description").textContent, "A low, muffled thud.");
  assert.equal(volume.value, "62");
  assert.equal(volume.attributes.get("aria-valuetext"), percent);
  assert.equal(h.element("#sound-volume-value").textContent, percent);
  assert.equal(h.element("#sound-reverb").checked, false);
  assert.equal(h.storage.get("goclick.settings.v1"), settings);
  volume.fire("change");
  assert.equal(JSON.parse(h.storage.get("goclick.settings.v1")).soundVolume, 62);
  assert.deepEqual(h.requests, []);
});

test("share preview and errors follow language changes without losing the current state", async () => {
  const h = await harness();
  await h.element("#share-stats").fire("click");
  assert.equal(h.element("#share-dialog").open, true);
  await h.element("#copy-share-text").fire("click");
  h.chooseLanguage("es");
  assert.match(h.element("#share-text").value, /Clics guardados: 10/);
  assert.match(h.element("#share-status").textContent, /Portapapeles/);
  assert.equal(h.element("#share-dialog").open, true);
  h.fetch(async () => response({ error: "Synthetic failure" }, 400));
  await h.element("#click-button").fire("click");
  assert.match(h.element("#game-error").textContent, /Tu clic no se guardó/);
  h.chooseLanguage("de");
  assert.match(h.element("#game-error").textContent, /Dein Klick wurde nicht gespeichert/);
  assert.equal(h.element("#game-error").hidden, false);
  assert.equal(h.requests.length, 1);
});

for (const change of ["language", "options"]) {
  test(`a delayed clipboard success requires copying again after changing ${change}`, async () => {
    const pending = deferred();
    const copies = [];
    const h = await harness({
      clipboard: {
        writeText: (text) => {
          copies.push(text);
          return pending.promise;
        },
      },
    });
    await h.element("#share-stats").fire("click");
    const copy = h.element("#copy-share-text").fire("click");
    if (change === "language") {
      // A second tab can change the locale while this tab has a modal open.
      h.storage.set("goclick.language.v1", "es");
      h.window.fire("storage", { key: "goclick.language.v1" });
    } else {
      h.element("#include-share-clicks").checked = false;
      h.element("#include-share-clicks").fire("change");
    }
    assert.notEqual(h.element("#share-text").value, copies[0]);
    pending.resolve();
    await copy;
    assert.match(
      h.element("#share-status").textContent,
      change === "language" ? /vista previa cambió/ : /Preview changed/,
    );
    assert.equal(h.element("#copy-share-text").attributes.get("aria-busy"), "false");
    assert.equal(copies.length, 1);
    await h.element("#copy-share-text").fire("click");
    await settle();
    assert.equal(copies.length, 2);
    assert.equal(copies[1], h.element("#share-text").value);
    assert.equal(
      h.element("#share-status").textContent,
      change === "language" ? "Estadísticas copiadas." : "Stats copied.",
    );
    assert.deepEqual(h.requests, []);
  });
}

test("changing a previously copied preview clears its stale copied confirmation", async () => {
  const h = await harness({ clipboard: { writeText: async () => {} } });
  await h.element("#share-stats").fire("click");
  await h.element("#copy-share-text").fire("click");
  assert.equal(h.element("#share-status").textContent, "Stats copied.");
  h.element("#include-share-link").checked = false;
  h.element("#include-share-link").fire("change");
  assert.match(h.element("#share-status").textContent, /Preview changed/);
});

test("a stale clipboard failure preserves focus on changed share options", async () => {
  const pending = deferred();
  const h = await harness({
    clipboard: {
      writeText: () =>
        pending.promise.then(() => {
          throw new Error("Denied");
        }),
    },
  });
  await h.element("#share-stats").fire("click");
  const copy = h.element("#copy-share-text").fire("click");
  const option = h.element("#include-share-clicks");
  option.focus();
  option.checked = false;
  option.fire("change");
  pending.resolve();
  await copy;
  assert.equal(h.document.activeElement, option);
  assert.equal(h.element("#share-text").selected, undefined);
  assert.match(h.element("#share-status").textContent, /Clipboard unavailable/);
});

test("older click replies cannot roll back a more recent score or earned badges", async () => {
  const h = await harness();
  const slower = deferred();
  const faster = deferred();
  let sent = 0;
  h.fetch(() => (++sent === 1 ? slower.promise : faster.promise));
  const click = () => h.element("#click-button").fire("click");
  const first = click();
  const second = click();
  const progress = {
    recent_days: 127,
    week_streak: 2,
    best_day_streak: 7,
    best_week_streak: 2,
  };
  const latest = counters(25);
  latest.earned_badges.push("clicks-for-days", "one-week-streak", "good-to-see-you-again");
  faster.resolve(response({ ...latest, progress }));
  await second;
  assert.equal(h.element("#fortnight-score").textContent, "49 / 100");
  assert.equal(h.element("#week-streak").textContent, "2");
  assert.equal(h.element("#achievement-count").textContent, "5 / 22");
  slower.resolve(
    response({ ...counters(24), progress: { ...progress, recent_days: 63, best_day_streak: 6 } }),
  );
  await first;
  assert.equal(h.element("#fortnight-score").textContent, "49 / 100");
  assert.equal(h.element("#achievement-count").textContent, "5 / 22");
});

test("achievements use their own view and a pending unlock waits for gameplay", async () => {
  const h = await harness({ initialFetch: async () => response(game(24)), expectedCount: 24 });
  const gameView = h.element("#game-view");
  const achievementView = h.element("#achievement-view");
  const button = h.element("#click-button");
  const toast = h.element("#achievement-notice");
  const pending = deferred();
  h.fetch(() => pending.promise);
  const click = button.fire("click");
  h.element("#open-achievements").fire("click", { button: 0 });
  assert.equal(h.window.location.search, "?view=achievements");
  assert.equal(gameView.hidden, true);
  assert.equal(achievementView.hidden, false);
  assert.equal(h.document.activeElement, h.element("#achievement-title"));

  pending.resolve(response(counters(25)));
  await click;
  assert.equal(h.element("#achievement-count").textContent, "2 / 22");
  assert.equal(toast.hidden, true);
  h.fetch(async () => response(game(25)));
  await h.context.refreshGame();
  assert.equal(achievementView.hidden, false);
  h.element("#back-to-game").fire("click", { button: 0 });
  await settle();
  assert.equal(gameView.hidden, false);
  assert.equal(achievementView.hidden, true);
  assert.equal(h.document.activeElement, button);
  assert.equal(toast.hidden, false);
  assert.equal(h.element("#achievement-notice-names").textContent, "Sentence");
});

test("loading the achievements URL opens its screen and reset times match gameplay", async () => {
  const h = await harness({ url: "https://goclick.example/?view=achievements" });
  assert.equal(h.element("#game-view").hidden, true);
  assert.equal(h.element("#achievement-view").hidden, false);
  h.window.location.search = "";
  h.window.fire("popstate");
  const reset = h.element("#streak-reset-button");
  const details = h.element("#streak-reset-details");
  assert.equal(details.hidden, true);
  reset.fire("pointerenter", { pointerType: "mouse" });
  assert.equal(details.hidden, false);
  assert.equal(
    h.element("#streak-reset-local").textContent,
    h.element("#day-reset-local").textContent,
  );
  reset.fire("click");
  h.element(".streak-panel").fire("pointerleave");
  assert.equal(details.hidden, false);
  h.document.fire("keydown", { key: "Escape" });
  assert.equal(details.hidden, true);
  const elapsed = h.element("#day-reset-meter").value;
  assert.equal(h.element("#streak-reset-ring").attributes.get("stroke-dasharray"), `${elapsed} 1`);
});

test("signed-out players can browse saved badges without changing play mode or adding clicks", async () => {
  const key = "goclick.local.v1";
  const save = JSON.stringify({
    format: "goclick-local",
    version: 1,
    counters: counters(25),
  });
  const h = await harness({
    initialFetch: async () => response({}, 401),
    expectedCount: 0,
    storage: [[key, save]],
  });
  const link = h.element("#open-achievements");
  const title = h.element("#achievement-title");
  assert.equal(link.hidden, false);
  link.fire("click", { button: 0 });
  assert.equal(h.window.location.search, "?view=achievements");
  assert.equal(h.element("#achievement-view").hidden, false);
  assert.equal(h.element("#guest-nav").hidden, false);
  assert.equal(h.element("#local-nav").hidden, true);
  assert.equal(h.document.activeElement, title);
  assert.equal(title.textContent, "Offline achievements");
  assert.equal(h.element("#achievement-count").textContent, "2 / 22");
  h.chooseLanguage("es");
  assert.equal(title.textContent, "Logros sin conexión");
  assert.deepEqual(h.requests, []);
  assert.equal(h.storage.get(key), save);
  assert.equal(h.storage.has("goclick.mode"), false);

  h.element("#back-to-game").fire("click", { button: 0 });
  assert.equal(h.window.location.search, "");
  assert.equal(h.element("#home-view").hidden, false);
  assert.equal(h.document.activeElement, h.element("#guest-click-button"));
});

test("signing in from a signed-out achievements deep link shows account badges", async () => {
  const key = "goclick.local.v1";
  const save = JSON.stringify({ format: "goclick-local", version: 1, counters: counters(100) });
  const h = await harness({
    url: "https://goclick.example/?view=achievements",
    initialFetch: async () => response({}, 401),
    expectedCount: 0,
    storage: [[key, save]],
  });
  assert.equal(h.element("#achievement-count").textContent, "3 / 22");
  h.context.show("login");
  h.fetch(async (url) => response(url === "/api/auth/login" ? { user: player } : game(1)));
  await h.element("#login-form").fire("submit");
  assert.equal(h.element("#achievement-title").textContent, "Achievements");
  assert.equal(h.element("#achievement-count").textContent, "1 / 22");
  assert.equal(h.element("#user-nav").hidden, false);
  assert.equal(h.storage.get(key), save);
});

test("the streak readout uses singular and plural units in the selected language", async () => {
  const h = await harness({
    initialFetch: async () =>
      response({
        user: player,
        counters: {
          click_count: { count: 10, modified_time: "2026-05-16T11:00:00Z" },
          streak_counter_day: { count: 1 },
          streak_counter_month: { count: 2 },
          streak_counter_year: { count: 1 },
        },
      }),
  });
  for (const [unit, label] of [
    ["day", "day"],
    ["week", "week"],
    ["month", "months"],
    ["year", "year"],
  ])
    assert.equal(h.element(`#${unit}-streak-unit`).textContent, label);

  h.chooseLanguage("ru");
  assert.equal(h.element("#month-streak").textContent, "2");
  assert.equal(h.element("#month-streak-unit").textContent, "месяца");
  h.chooseLanguage("ar");
  assert.equal(h.element("#month-streak").textContent, "شهران");
  assert.equal(h.element("#month-streak-unit").hidden, true);
});

test("account badge status comes from the server and offline badges stay with the local save", async () => {
  const h = await harness({
    url: "https://goclick.example/?view=achievements",
    initialFetch: async () =>
      response({ user: player, counters: { ...counters(25), earned_badges: ["gone-click"] } }),
    expectedCount: 25,
  });
  const count = h.element("#achievement-count");
  assert.equal(count.textContent, "1 / 22");
  h.context.startLocalGame();
  assert.equal(count.textContent, "0 / 22");
  h.element("#back-to-game").fire("click", { button: 0 });
  for (let i = 0; i < 25; i++) await h.element("#click-button").fire("click");
  assert.equal(count.textContent, "2 / 22");
  assert.deepEqual(h.requests, []);
  h.fetch(async () => response(game(1, { ...player, id: "2" })));
  await h.element("#leave-local").fire("click");
  assert.equal(count.textContent, "1 / 22");
  assert.equal(h.element("#achievement-notice").hidden, true);
  h.context.startLocalGame();
  assert.equal(count.textContent, "2 / 22");
});

test("the guest button saves its first click offline and briefly tells the player", async () => {
  const h = await harness({ initialFetch: async () => response({}, 401), expectedCount: 0 });
  assert.equal(h.element("#home-view").hidden, false);
  await h.element("#guest-click-button").fire("click");
  assert.equal(h.element("#game-view").hidden, false);
  assert.equal(h.element("#login-form").hidden, true);
  assert.equal(h.element("#click-count").textContent, "1");
  assert.equal(h.element("#last-click").hidden, true);
  assert.equal(h.element("#offline-start-notice").textContent, "Continuing offline.");
  assert.equal(h.document.activeElement, h.element("#click-button"));
  assert.equal(JSON.parse(h.storage.get("goclick.local.v1")).counters.click_count.count, 1);
  assert.deepEqual(h.requests, []);
  h.runTimers();
  assert.equal(h.element("#offline-start-notice").textContent, "");
});

test("the last-click timestamp stays fixed and fades only after six confirmed saves", async () => {
  const initial = { click_count: { count: 10, modified_time: "2026-10-10T10:10:00Z" } };
  const h = await harness({
    initialFetch: async () => response({ user: player, counters: initial }),
  });
  const last = h.element("#last-click");
  const original = last.textContent;
  assert.match(original, /10/);
  h.fetch(async () => response({ error: "Save failed" }, 500));
  await h.element("#click-button").fire("click");
  assert.equal(last.style["--last-click-opacity"], "1");
  for (let i = 1; i <= 6; i++) {
    h.fetch(async () =>
      response({ click_count: { count: 10 + i, modified_time: "2026-11-19T23:00:00Z" } }),
    );
    await h.element("#click-button").fire("click");
    assert.equal(last.textContent, original);
    assert.equal(Number(last.style["--last-click-opacity"]), 1 - i / 6);
  }
  assert.equal(last.attributes.get("aria-hidden"), "true");
});

test("new achievements announce without replaying loaded badges", async () => {
  const h = await harness();
  const notice = h.element("#achievement-notice");
  const live = h.element("#achievement-announcement");
  const button = h.element("#click-button");
  assert.equal(notice.hidden, true);
  assert.equal(live.textContent, "");
  h.fetch(async () => response({ error: "Save failed" }, 500));
  await button.fire("click");
  assert.equal(live.textContent, "");

  h.fetch(async () => response(counters(100)));
  button.focus();
  await button.fire("click");
  assert.equal(notice.hidden, false);
  assert.equal(live.textContent, "Achievements unlocked. Sentence. Paragraph.");
  assert.equal(h.element("#achievement-notice-names").textContent, "Sentence · Paragraph");
  assert.equal(h.document.activeElement, button);
  h.chooseLanguage("fr");
  assert.equal(h.element("#achievement-notice-title").textContent, "Succès déverrouillés");
  assert.equal(live.textContent, "Achievements unlocked. Sentence. Paragraph.");

  h.runTimers();
  assert.equal(notice.hidden, true);
  h.fetch(async () => response(counters(101)));
  await button.fire("click");
  assert.equal(live.textContent, "");
});

test("a save confirmed in a hidden tab announces its badge after returning", async () => {
  const h = await harness({ initialFetch: async () => response(game(24)), expectedCount: 24 });
  const pending = deferred();
  const notice = h.element("#achievement-notice");
  h.fetch(() => pending.promise);
  const click = h.element("#click-button").fire("click");
  h.document.hidden = true;
  h.document.fire("visibilitychange");
  pending.resolve(response(counters(25)));
  await click;
  assert.equal(notice.hidden, true);

  h.fetch(async () => response(game(25)));
  h.document.hidden = false;
  h.document.fire("visibilitychange");
  await settle();
  assert.equal(notice.hidden, false);
  assert.equal(h.element("#achievement-notice-names").textContent, "Sentence");
});

test("local button achievements record interactions without clicks and persist with the save", async () => {
  const h = await harness({ storage: [["goclick.mode", "local"]], clickAchievements: 58 });
  const button = h.element("#click-button");
  await button.fire("button-interaction", { detail: { interaction: "reset" } });
  assert.equal(h.element("#click-count").textContent, "0");
  assert.equal(h.element("#achievement-notice-names").textContent, "Circuit Breaker");
  await button.fire("button-interaction", { detail: { interaction: "reconnect", socket: "top" } });
  assert.match(h.element("#achievement-notice-names").textContent, /Reconnected/);
  assert.equal(h.element("#achievement-count").textContent, "2 / 22");
  await button.fire("button-interaction", { detail: { interaction: "reconnect", socket: "top" } });
  assert.equal(h.element("#achievement-count").textContent, "2 / 22");
  await h.context.refreshGame();
  await button.fire("button-interaction", {
    detail: { interaction: "reconnect", socket: "bottom" },
  });
  assert.match(h.element("#achievement-notice-names").textContent, /Parallel Outlet/);
  assert.equal(h.element("#achievement-count").textContent, "3 / 22");
  await button.fire("click");
  assert.equal(h.element("#achievement-count").textContent, "8 / 22");
  assert.match(h.element("#achievement-notice-names").textContent, /Off-Grid/);
  assert.match(h.element("#achievement-notice-names").textContent, /Slacking Off/);
  assert.match(h.element("#achievement-notice-names").textContent, /Rebound/);
  assert.match(h.element("#achievement-notice-names").textContent, /Hold that Thought/);
  assert.equal(h.element("#next-click-milestone-name").textContent, "Sentence");
  await h.context.refreshGame();
  const saved = JSON.parse(h.storage.get("goclick.local.v1")).counters;
  assert.equal(saved.button_achievements, 255);
  assert.equal(saved.click_count.count, 1);
  assert.deepEqual(h.requests, []);
});

test("each socket can be recorded while the other socket is saving", async () => {
  const h = await harness();
  const top = deferred();
  const button = h.element("#click-button");
  h.fetch((url, options) => {
    assert.equal(url, "/api/button-achievements");
    const { socket } = JSON.parse(options.body);
    return socket === "top" ? top.promise : response({ button_achievements: 193 });
  });
  const reconnect = (socket) =>
    button.fire("button-interaction", { detail: { interaction: "reconnect", socket } });
  const first = reconnect("top");
  await reconnect("top");
  await reconnect("bottom");
  top.resolve(response({ button_achievements: 65 }));
  await first;
  assert.equal(h.requests.length, 2);
  assert.equal(h.element("#achievement-count").textContent, "3 / 22");
  assert.match(h.element("#achievement-notice-names").textContent, /Parallel Outlet/);
});

test("an earlier online click response keeps the hardware badge that arrived first", async () => {
  const h = await harness({ clickAchievements: 26 });
  const pendingClick = deferred();
  const button = h.element("#click-button");
  h.fetch((url, options) => {
    if (url.endsWith("/api/clicks")) {
      assert.equal(options.headers.get("X-GoClick-Button-Achievements"), "26");
      return pendingClick.promise;
    }
    assert.equal(url, "/api/button-achievements");
    assert.equal(options.headers.get("X-GoClick-User-ID"), player.id);
    assert.deepEqual(JSON.parse(options.body), { interaction: "reset" });
    return response({ button_achievements: 4 });
  });
  const clicking = button.fire("click");
  await button.fire("button-interaction", { detail: { interaction: "reset" } });
  await button.fire("button-interaction", { detail: { interaction: "reset" } });
  assert.equal(h.requests.length, 2);
  pendingClick.resolve(response({ ...counters(11), button_achievements: 26 }));
  await clicking;
  assert.equal(h.element("#achievement-count").textContent, "5 / 22");
  assert.equal(h.element("#click-count").textContent, "11");
});

test("an authoritative account refresh can roll back earned hardware badges", async () => {
  const h = await harness({ clickAchievements: 24 });
  const initial = h.element("#achievement-count").textContent;
  h.fetch(async () => response({ ...counters(11), button_achievements: 24 }));
  await h.element("#click-button").fire("click");
  assert.equal(h.element("#achievement-count").textContent, "3 / 22");
  assert.match(h.element("#achievement-notice-names").textContent, /Rebound/);
  h.fetch(async () => response(game(10)));
  await h.context.refreshGame();
  assert.equal(h.element("#click-count").textContent, "10");
  assert.equal(h.element("#achievement-count").textContent, initial);
  assert.equal(h.element("#achievement-notice").hidden, true);
});
