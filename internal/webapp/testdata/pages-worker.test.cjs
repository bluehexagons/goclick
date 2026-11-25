"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const scope = "https://goclick.example/project/";
const source = readFileSync(path.join(__dirname, "../../../scripts/pages-worker.js"), "utf8");

function worker({ match, fetch }) {
  const listeners = new Map();
  runInNewContext(source, {
    URL,
    self: {
      registration: { scope },
      addEventListener: (type, listener) => listeners.set(type, listener),
    },
    pagesRevision: "test-revision",
    pagesFiles: ["index.html", "app.js"],
    caches: { match },
    fetch,
  });
  return (request) => {
    let response;
    listeners.get("fetch")({
      request,
      respondWith: (promise) => (response = promise),
    });
    return response;
  };
}

test("Pages serves achievements navigation from its own cached game shell", async () => {
  const cached = new Response("cached shell");
  const dispatch = worker({
    match: async (url, { cacheName }) => {
      assert.equal(url, new URL("index.html", scope).href);
      assert.equal(cacheName, `goclick-pages:${encodeURIComponent(scope)}:test-revision`);
      return cached;
    },
    fetch: () => assert.fail("A cached navigation must work offline"),
  });
  const request = {
    url: new URL("?view=achievements", scope).href,
    method: "GET",
    mode: "navigate",
  };
  assert.equal(await dispatch(request), cached);
});

test("Pages uses the original network request when cache storage cannot be read", async () => {
  const request = new Request(new URL("app.js", scope));
  const online = new Response("network script");
  const dispatch = worker({
    match: async () => {
      throw new Error("Cache storage unavailable");
    },
    fetch: async (received) => {
      assert.equal(received, request);
      return online;
    },
  });
  assert.equal(await dispatch(request), online);
});
