"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { frontend } = require("./frontend.cjs");

function transport(fetch, locks) {
  const timers = new Map();
  let id = 0;
  const { request } = frontend({
    AbortController,
    navigator: { locks },
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

function sessionResponse(user = "1", expires = "1810000000") {
  return {
    ...response(),
    headers: {
      get: (name) =>
        name === "X-GoClick-User-ID" ? user : name === "X-GoClick-Session-Expires" ? expires : null,
    },
  };
}

function sessionLocks() {
  let tail = Promise.resolve();
  return {
    request(name, { signal }, callback) {
      assert.equal(name, "goclick.session");
      const pending = tail.then(() => {
        if (signal.aborted) throw new Error("Aborted");
        return callback();
      });
      tail = pending.catch(() => {});
      let abort;
      const cancelled = new Promise((_, reject) => {
        abort = () => reject(new Error("Aborted"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
      return Promise.race([pending, cancelled]).finally(() =>
        signal.removeEventListener("abort", abort),
      );
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

for (const cancel of ["deadline", "caller cancellation"]) {
  test(`${cancel} removes a queued cookie mutation without dispatching it`, async () => {
    const locks = sessionLocks();
    const started = deferred();
    const release = deferred();
    const calls = [];
    const fetch = async (url) => {
      calls.push(url);
      started.resolve();
      await release.promise;
      return response();
    };
    const first = transport(fetch, locks);
    const second = transport(fetch, locks);
    const holder = first.request("/api/admin/backups/restore", { method: "POST" });
    await started.promise;
    const caller = new AbortController();
    const queued = second.request("/api/auth/login", { method: "POST", signal: caller.signal });
    const rejected = assert.rejects(queued, (error) => !error.uncertain);
    assert.equal(second.timers.size, 1);
    if (cancel === "deadline") second.expire();
    else caller.abort();
    await rejected;
    assert.equal(second.timers.size, 0);
    assert.deepEqual(calls, ["/api/admin/backups/restore"]);
    release.resolve();
    await holder;
    await flush();
    assert.deepEqual(calls, ["/api/admin/backups/restore"]);
  });
}

test("cross-tab login waits for a pending renewal response before replacing its cookie", async () => {
  const locks = sessionLocks();
  const renewing = deferred();
  const release = deferred();
  let cookie = "A";
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url === "/api/auth/renew") {
      const token = cookie;
      renewing.resolve();
      await release.promise;
      cookie = token; // Apply Set-Cookie when the delayed response arrives.
    }
    if (url === "/api/auth/login") cookie = "B";
    return sessionResponse();
  };
  const first = transport(fetch, locks);
  const second = transport(fetch, locks);
  await first.request("/api/game");
  await renewing.promise;
  const login = second.request("/api/auth/login", { method: "POST" });
  await flush();
  assert.equal(calls.includes("/api/auth/login"), false);
  release.resolve();
  await login;
  assert.equal(cookie, "B");
  assert.equal(first.timers.size, 0);
  assert.equal(second.timers.size, 0);
});

test("a late old-account read renews only its expected identity after a newer login", async () => {
  const locks = sessionLocks();
  const release = deferred();
  const calls = [];
  let cookie = "A";
  const fetch = async (url, options) => {
    calls.push(url);
    if (url === "/api/game") {
      await release.promise;
      return sessionResponse("9007199254740993");
    }
    if (url === "/api/auth/login") cookie = "B";
    if (url === "/api/auth/renew") {
      assert.equal(cookie, "B");
      assert.equal(options.headers["X-GoClick-User-ID"], "9007199254740993");
      return {
        ...sessionResponse(),
        ok: false,
        status: 409,
        json: async () => ({ code: "account_changed" }),
      };
    }
    return response();
  };
  const oldTab = transport(fetch, locks);
  const newTab = transport(fetch, locks);
  const oldRead = oldTab.request("/api/game");
  await newTab.request("/api/auth/login", { method: "POST" });
  release.resolve();
  await oldRead;
  await flush();
  assert.equal(calls.filter((url) => url === "/api/auth/renew").length, 1);
  assert.equal(cookie, "B");
});

test("renewal failure never fails or replays a successful click and later activity retries", async () => {
  const calls = [];
  const h = transport(async (url) => {
    calls.push(url);
    if (url === "/api/auth/renew") throw new Error("offline");
    return sessionResponse();
  }, sessionLocks());
  assert.equal((await h.request("/api/clicks", { method: "POST" })).count, 1);
  await flush();
  await h.request("/api/game");
  await flush();
  assert.equal(calls.filter((url) => url === "/api/clicks").length, 1);
  assert.equal(calls.filter((url) => url === "/api/auth/renew").length, 2);
  assert.equal(h.timers.size, 0);
});

test("renewal coalesces parallel activity and only repeats when the expiry advances", async () => {
  const release = deferred();
  let expiry = "1810000000";
  let renewals = 0;
  const h = transport(async (url) => {
    if (url === "/api/auth/renew") {
      renewals++;
      await release.promise;
    }
    return sessionResponse("1", expiry);
  }, sessionLocks());
  await Promise.all([h.request("/api/game"), h.request("/api/clicks", { method: "POST" })]);
  assert.equal(renewals, 1);
  release.resolve();
  await flush();
  await h.request("/api/game");
  await flush();
  assert.equal(renewals, 1);
  expiry = "1810086400";
  await h.request("/api/game");
  await flush();
  assert.equal(renewals, 2);
});

test("browsers without Web Locks keep ordinary requests and login working without automatic renewal", async () => {
  const calls = [];
  const h = transport(async (url) => {
    calls.push(url);
    return sessionResponse();
  });
  await h.request("/api/game");
  await h.request("/api/auth/login", { method: "POST" });
  await flush();
  assert.deepEqual(calls, ["/api/game", "/api/auth/login"]);
});

for (const url of ["/api/auth/signup", "/api/auth/logout", "/api/admin/backups/restore"]) {
  test(`${url} shares the session lock while ordinary reads remain parallel`, async () => {
    const locks = sessionLocks();
    const release = deferred();
    const started = deferred();
    const calls = [];
    const fetch = async (path) => {
      calls.push(path);
      if (path === "/api/auth/login") {
        started.resolve();
        await release.promise;
      }
      return response();
    };
    const first = transport(fetch, locks);
    const second = transport(fetch, locks);
    const login = first.request("/api/auth/login", { method: "POST" });
    await started.promise;
    const mutation = second.request(url, { method: url.endsWith("logout") ? "DELETE" : "POST" });
    await second.request("/api/game");
    assert.deepEqual(calls, ["/api/auth/login", "/api/game"]);
    release.resolve();
    await Promise.all([login, mutation]);
    assert.equal(calls[2], url);
  });
}

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
