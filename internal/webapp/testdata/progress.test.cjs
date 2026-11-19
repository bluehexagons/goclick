"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { frontend } = require("./frontend.cjs");

const { fortnightActivity, utcReset } = frontend().load("progress");

test("the activity score rewards adjacent days even with gaps and reserves 100 for 14 active days", () => {
  assert.equal(fortnightActivity(0).score, 0);
  assert.equal(fortnightActivity(0b1).score, 5);
  assert.equal(fortnightActivity(0b10101).score, 16);
  assert.equal(fortnightActivity(0b1011).score, 18);
  assert.equal(fortnightActivity(0b111).score, 20);
  assert.equal(fortnightActivity(0b1111111111111).score, 93);
  assert.equal(fortnightActivity(0b11111111111111).score, 100);
});

test("the reset switches at UTC midnight even when the input time has a local offset", () => {
  const utcMidnight = Date.parse("2026-11-02T00:00:00Z");
  const before = utcReset(Date.parse("2026-11-01T17:59:59.999-06:00"));
  assert.equal(before.next, utcMidnight);
  assert.equal(before.minutesLeft, 1);
  const after = utcReset(utcMidnight);
  assert.equal(after.next, utcMidnight + 86_400_000);
  assert.equal(after.elapsed, 0);
  assert.equal(after.minutesLeft, 1440);
});
