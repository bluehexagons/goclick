import { isRecord } from "./dom.js";
import { advanceProgress, fortnightMask, seedProgress, utcDay } from "./progress.js";
import { counterKinds } from "./types.js";
import type { ClickProgress, Counters } from "./types.js";

// One local slot, intentionally unrelated to authentication or the account API.
const localGame = (() => {
  const key = "goclick.local.v1";
  const kinds = counterKinds;
  function validate(counters: unknown): Counters {
    if (!isRecord(counters)) throw new Error("Invalid local counters.");
    const result: Counters = {};
    for (const kind of kinds) {
      const entity = counters[kind];
      if (entity == null) {
        result[kind] = null;
        continue;
      }
      if (
        !isRecord(entity) ||
        typeof entity.count !== "number" ||
        !Number.isSafeInteger(entity.count) ||
        entity.count < 0
      )
        throw new Error("Invalid local click or streak total.");
      const time = entity.modified_time;
      if (time != null && (typeof time !== "string" || !Number.isFinite(Date.parse(time))))
        throw new Error("Invalid local save timestamp.");
      result[kind] = {
        count: entity.count,
        modified_time: typeof time === "string" ? new Date(time).toISOString() : null,
      };
    }
    const last = result.click_count?.modified_time;
    const daily = result.streak_counter_day?.count ?? 0;
    result.progress =
      counters.progress == null
        ? seedProgress(last, daily)
        : validateProgress(counters.progress, last, daily);
    return result;
  }
  function validateProgress(
    value: unknown,
    last: string | null | undefined,
    daily: number,
  ): ClickProgress {
    if (!isRecord(value)) throw new Error("Invalid local achievement progress.");
    const { recent_days, week_streak, best_day_streak, best_week_streak } = value;
    if (
      !nonnegativeInteger(recent_days) ||
      recent_days > fortnightMask ||
      !nonnegativeInteger(week_streak) ||
      !nonnegativeInteger(best_day_streak) ||
      best_day_streak < daily ||
      !nonnegativeInteger(best_week_streak) ||
      best_week_streak < week_streak ||
      Boolean(recent_days & 1) !== Boolean(last) ||
      Boolean(week_streak) !== Boolean(last) ||
      (last ? best_day_streak < 1 : recent_days !== 0 || best_week_streak !== 0)
    )
      throw new Error("Invalid local achievement progress.");
    return { recent_days, week_streak, best_day_streak, best_week_streak };
  }
  function nonnegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  }
  function decode(raw: string) {
    const save: unknown = JSON.parse(raw);
    if (!isRecord(save) || save.format !== "goclick-local" || save.version !== 1)
      throw new Error("Choose a Go Click local save (version 1).");
    return validate(save.counters);
  }
  function read() {
    const raw = localStorage.getItem(key);
    return raw === null ? validate({}) : decode(raw);
  }
  function encode(counters: Counters) {
    return JSON.stringify(
      { format: "goclick-local", version: 1, counters: validate(counters) },
      null,
      2,
    );
  }
  function write(counters: Counters) {
    const clean = validate(counters);
    localStorage.setItem(key, encode(clean));
    return clean;
  }
  function period(time: string, index: number) {
    const date = new Date(time);
    return index === 1
      ? utcDay(date.getTime())
      : index === 2
        ? date.getUTCFullYear() * 12 + date.getUTCMonth()
        : date.getUTCFullYear();
  }
  function increment(now = new Date()) {
    const counters = read();
    const previous = counters.click_count?.modified_time;
    const time = previous && Date.parse(previous) > now.getTime() ? previous : now.toISOString();
    for (const [index, kind] of kinds.entries()) {
      const old = counters[kind],
        count = old?.count ?? 0;
      let next = count + 1;
      if (index > 0) {
        const gap = old?.modified_time
          ? period(time, index) - period(old.modified_time, index)
          : Infinity;
        next = count === 0 || gap > 1 || gap < 0 ? 1 : gap === 0 ? count : count + 1;
      }
      counters[kind] = { count: next, modified_time: time };
    }
    counters.progress = advanceProgress(
      counters.progress!,
      previous,
      time,
      counters.streak_counter_day!.count,
    );
    return write(counters);
  }
  // Operations are synchronous so an IndexedDB read/write transaction can
  // provide the same cross-tab exclusion on browsers without Web Locks.
  function change<T>(operation: () => T): Promise<T> {
    if (navigator.locks) return navigator.locks.request(key, operation);
    if (typeof indexedDB === "undefined")
      return Promise.reject(new Error("This browser cannot safely coordinate the local save."));
    return new Promise((resolve, reject) => {
      const opening = indexedDB.open("goclick-local-locks", 1);
      let blocked = false;
      opening.onupgradeneeded = () => opening.result.createObjectStore("locks");
      opening.onerror = () => reject(opening.error);
      opening.onblocked = () => {
        blocked = true;
        reject(new Error("Close other Go Click tabs, then try the local save again."));
      };
      opening.onsuccess = () => {
        const database = opening.result;
        if (blocked) {
          database.close();
          return;
        }
        let result: T;
        let failure: unknown;
        try {
          const transaction = database.transaction("locks", "readwrite");
          transaction.oncomplete = () => {
            database.close();
            resolve(result);
          };
          transaction.onabort = () => {
            database.close();
            reject(failure ?? transaction.error ?? new Error("Local save coordination failed."));
          };
          transaction.objectStore("locks").get(key).onsuccess = () => {
            try {
              result = operation();
            } catch (error) {
              failure = error;
              transaction.abort();
            }
          };
        } catch (error) {
          database.close();
          reject(error);
        }
      };
    });
  }
  return { key, read, encode, decode, validate, change, increment, replace: write };
})();

export { localGame };
