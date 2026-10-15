"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { frontend } = require("./frontend.cjs");
const { formatStats } = frontend({
  document: { querySelector: () => ({ addEventListener() {} }) },
}).load("share");

test("share summaries are plain text, readable, and contain only clicks and UTC streaks", () => {
  assert.equal(
    formatStats({}, false),
    "Go Click\n0 saved clicks\nUTC streaks: 0 days · 0 months · 0 years",
  );
  const counters = {
    click_count: { count: 1234567 },
    streak_counter_day: { count: 14 },
    streak_counter_month: { count: 2 },
    streak_counter_year: { count: 1 },
  };
  assert.equal(
    formatStats(counters, false),
    "Go Click\n1,234,567 saved clicks\nUTC streaks: 14 days · 2 months · 1 year",
  );
  assert.match(formatStats(counters, true), /^Go Click · offline\n1,234,567 local clicks/);
});
