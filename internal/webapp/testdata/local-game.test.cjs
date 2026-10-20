"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { frontend } = require("./frontend.cjs");

function harness(options = {}) {
  const storage = new Map();
  let tail = Promise.resolve();
  const runtime = frontend({
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    navigator: options.withoutLocks
      ? {}
      : {
          locks: {
            request: (_, callback) => {
              const next = tail.then(callback);
              tail = next.catch(() => {});
              return next;
            },
          },
        },
  });
  return { game: runtime.load("local-game").localGame, storage };
}

test("local streaks use UTC day, calendar month and year boundaries", () => {
  const { game } = harness();
  const click = (time) => game.increment(new Date(time));
  click("2025-12-31T23:59:59Z");
  let data = click("2026-01-01T00:00:00Z");
  assert.equal(data.click_count.count, 2);
  for (const kind of ["day", "month", "year"])
    assert.equal(data[`streak_counter_${kind}`].count, 2);
  data = click("2026-01-01T23:59:59Z");
  assert.equal(data.streak_counter_day.count, 2);
  data = click("2026-01-03T00:00:00Z");
  assert.equal(data.streak_counter_day.count, 1);
  assert.equal(data.streak_counter_month.count, 2);
  data = click("2026-03-03T00:00:00Z");
  assert.equal(data.streak_counter_month.count, 1);
  data = click("2028-03-03T00:00:00Z");
  assert.equal(data.streak_counter_year.count, 1);
});

test("local saves round-trip and reject invalid imports without overwriting", () => {
  const { game, storage } = harness();
  game.increment(new Date("2026-10-15T00:00:00Z"));
  const exported = game.encode(game.read());
  assert.equal(game.decode(exported).click_count.count, 1);
  for (const raw of [
    "{}",
    "null",
    '{"format":"goclick-local","version":2}',
    '{"format":"goclick-local","version":1,"counters":{"click_count":{"count":-1}}}',
    '{"format":"goclick-local","version":1,"counters":{"click_count":{"count":2,"modified_time":"bad"}}}',
    '{"format":"goclick-local","version":1,"counters":{"click_count":{"count":9007199254740992}}}',
  ]) {
    assert.throws(() => game.decode(raw));
    assert.equal(storage.get(game.key), exported);
  }
  storage.set(game.key, "corrupt save");
  assert.throws(() => game.increment());
  assert.equal(storage.get(game.key), "corrupt save");
});

test("concurrent local clicks reread the slot inside the browser lock", async () => {
  const { game } = harness();
  await Promise.all(Array.from({ length: 40 }, () => game.change(() => game.increment())));
  assert.equal(game.read().click_count.count, 40);
});

test("counter overflow is rejected before changing the local save", () => {
  const { game, storage } = harness();
  game.replace({ click_count: { count: Number.MAX_SAFE_INTEGER } });
  const saved = storage.get(game.key);
  assert.throws(() => game.increment());
  assert.equal(storage.get(game.key), saved);
});

test("missing cross-tab coordination refuses a local write without changing the slot", async () => {
  const { game, storage } = harness({ withoutLocks: true });
  game.replace({ click_count: { count: 12 } });
  const saved = storage.get(game.key);
  await assert.rejects(
    game.change(() => game.increment()),
    /safely coordinate/,
  );
  assert.equal(storage.get(game.key), saved);
});
