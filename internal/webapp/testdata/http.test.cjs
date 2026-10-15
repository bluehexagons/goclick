"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { frontend } = require("./frontend.cjs");

function transport(fetch) {
  const timers = new Map();
  let id = 0;
  const { request } = frontend({
    AbortController,
    window: {
      setTimeout(callback, delay) {
        timers.set(++id, { callback, delay });
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
    fetch,
  }).load("http");
  return {
    request,
    timers,
    expire() {
      for (const timer of timers.values()) timer.callback();
    },
  };
}
const response = () => ({ ok: true, status: 200, json: async () => ({ count: 1 }) });
const waitForAbort = (signal) =>
  new Promise((_resolve, reject) => {
    if (signal.aborted) reject(new Error("Aborted"));
    else signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
  });

for (const stage of ["headers", "JSON body", "download body"]) {
  test(`request timeout covers stalled ${stage} and reports an uncertain outcome`, async () => {
    let aborted;
    const h = transport((_url, options) => {
      aborted = options.signal;
      if (stage === "headers") return waitForAbort(options.signal);
      return {
        ...response(),
        json: () => waitForAbort(options.signal),
        blob: () => waitForAbort(options.signal),
      };
    });
    const pending =
      stage === "download body"
        ? h.request("/backup", {}, true)
        : h.request("/click", { method: "POST" });
    const rejected = assert.rejects(
      pending,
      (error) => error.uncertain && /took too long/.test(error.message),
    );
    assert.equal([...h.timers.values()][0].delay, 30000);
    await Promise.resolve(); // Headers have arrived; the body is now pending.
    h.expire();
    await rejected;
    assert.equal(aborted.aborted, true);
    assert.equal(h.timers.size, 0);
  });
}

test("successful requests clear their deadline and detach the caller's abort listener", async () => {
  const caller = new AbortController();
  let signal;
  const h = transport((_url, options) => {
    signal = options.signal;
    return response();
  });
  await h.request("/read", { signal: caller.signal });
  assert.equal(h.timers.size, 0);
  caller.abort();
  assert.equal(signal.aborted, false);
});

test("caller cancellation still aborts transport and recovery operations can use a longer deadline", async () => {
  const caller = new AbortController();
  let signal;
  const h = transport((_url, options) => {
    signal = options.signal;
    return waitForAbort(signal);
  });
  const pending = h.request("/recovery", { signal: caller.signal, timeoutMilliseconds: 150000 });
  const rejected = assert.rejects(pending, /Can’t reach Go Click/);
  assert.equal([...h.timers.values()][0].delay, 150000);
  caller.abort();
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(h.timers.size, 0);
});

for (const status of [401, 429]) {
  test(`timeout while reading a ${status} error body preserves the definite rejection`, async () => {
    const h = transport((_url, options) => ({
      ok: false,
      status,
      headers: { get: (name) => (name === "Retry-After" ? "5" : null) },
      json: () => waitForAbort(options.signal),
    }));
    const pending = h.request("/click", { method: "POST" });
    const rejected = assert.rejects(
      pending,
      (error) => error.status === status && !error.uncertain && error.retryAfter === "5",
    );
    await Promise.resolve();
    h.expire();
    await rejected;
  });
}

test("Retry-After accepts seconds and dates and bounds malformed or extreme values", () => {
  const { retryAfterMilliseconds: retry } = frontend({}).load("http");
  const now = Date.parse("2026-10-15T12:00:00Z");
  assert.equal(retry("15", now), 15000);
  assert.equal(retry("Thu, 15 Oct 2026 12:00:10 GMT", now), 10000);
  assert.equal(retry("Thu, 15 Oct 2026 11:00:00 GMT", now), 1000);
  assert.equal(retry("garbage", now), 5000);
  assert.equal(retry(null, now), 5000);
  assert.equal(retry("999999999999", now), 86400000);
});
