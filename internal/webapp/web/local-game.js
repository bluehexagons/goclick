"use strict";

// One local slot, intentionally unrelated to authentication or the account API.
const localGame = (() => {
  const key = "goclick.local.v1";
  const kinds = ["click_count", "streak_counter_day", "streak_counter_month", "streak_counter_year"];
  function validate(counters) {
    if (!counters || typeof counters !== "object" || Array.isArray(counters)) throw new Error("Invalid local counters.");
    return Object.fromEntries(kinds.map(kind => {
      const entity = counters[kind];
      if (entity == null) return [kind, null];
      if (!Number.isSafeInteger(entity.count) || entity.count < 0) throw new Error("Invalid local click or streak total.");
      const time = entity.modified_time;
      if (time != null && (typeof time !== "string" || !Number.isFinite(Date.parse(time)))) throw new Error("Invalid local save timestamp.");
      return [kind, { count: entity.count, modified_time: time == null ? null : new Date(time).toISOString() }];
    }));
  }
  function decode(raw) {
    const save = JSON.parse(raw);
    if (save?.format !== "goclick-local" || save.version !== 1) throw new Error("Choose a Go Click local save (version 1).");
    return validate(save.counters);
  }
  function read() {
    const raw = localStorage.getItem(key);
    return raw === null ? validate({}) : decode(raw);
  }
  function encode(counters) { return JSON.stringify({ format: "goclick-local", version: 1, counters: validate(counters) }, null, 2); }
  function write(counters) { const clean = validate(counters); localStorage.setItem(key, encode(clean)); return clean; }
  function period(time, index) {
    const date = new Date(time);
    return index === 1 ? Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000)
      : index === 2 ? date.getUTCFullYear() * 12 + date.getUTCMonth() : date.getUTCFullYear();
  }
  function increment(now = new Date()) {
    const counters = read(), time = now.toISOString();
    for (const [index, kind] of kinds.entries()) {
      const old = counters[kind], count = old?.count ?? 0;
      let next = count + 1;
      if (index > 0) {
        const gap = old?.modified_time ? period(time, index) - period(old.modified_time, index) : Infinity;
        next = count === 0 || gap > 1 || gap < 0 ? 1 : gap === 0 ? count : count + 1;
      }
      counters[kind] = { count: next, modified_time: time };
    }
    return write(counters);
  }
  // Serialize writes between tabs when Web Locks is available. Every operation
  // rereads the shared slot inside the lock, including import/copy/restart.
  function change(operation) {
    return navigator.locks ? navigator.locks.request(key, operation) : Promise.resolve().then(operation);
  }
  return { key, read, encode, decode, validate, change, increment, replace: write };
})();
