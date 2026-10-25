"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { frontend } = require("./frontend.cjs");
const { parseStoredTimestamp } = frontend({}).load("timestamp");

test("native timestamps retain the same instant across browser parsing differences", () => {
  for (const [raw, expected] of [
    ["2026-10-23 12:00:00", "2026-10-23T12:00:00.000Z"],
    ["2026-10-23   12:00:00", "2026-10-23T12:00:00.000Z"],
    ["2026-10-23 0:00:00.123456789", "2026-10-23T00:00:00.123Z"],
    ["2026-10-23 00:00:00,1234567890", "2026-10-23T00:00:00.123Z"],
    ["2026-10-23T0:00:00Z", "2026-10-23T00:00:00.000Z"],
    ["2026-10-23T00:00:00,123456789Z", "2026-10-23T00:00:00.123Z"],
    ["2026-10-23T01:30:00.1+01:30", "2026-10-23T00:00:00.100Z"],
    ["2026-10-23T01:00:00+00:60", "2026-10-23T00:00:00.000Z"],
    ["2026-10-24T01:00:00.123456789+24:60", "2026-10-23T00:00:00.123Z"],
    ["2026-10-21T23:00:00-24:60", "2026-10-23T00:00:00.000Z"],
    ["1969-12-31T23:59:59.999999999Z", "1969-12-31T23:59:59.999Z"],
    ["0000-01-01 00:00:00", "0000-01-01T00:00:00.000Z"],
    ["0000-01-01T00:00:00+24:60", "-000001-12-30T23:00:00.000Z"],
    ["9999-12-31T23:59:59-24:60", "+010000-01-02T00:59:59.000Z"],
  ])
    assert.equal(parseStoredTimestamp(raw).toISOString(), expected, raw);
});

test("invalid native timestamps do not silently roll over or gain a timezone", () => {
  for (const raw of [
    "",
    "invalid",
    "2026-02-29T00:00:00Z",
    "2026-10-23T24:00:00Z",
    "2026-10-23T00:60:00Z",
    "2026-10-23T00:00:60Z",
    "2026-10-23T00:00:00",
    "2026-10-23 00:00:00Z",
    "2026-10-23T00:00:00+25:00",
    "2026-10-23T00:00:00+00:61",
  ])
    assert.equal(Number.isNaN(parseStoredTimestamp(raw).getTime()), true, raw);
});
