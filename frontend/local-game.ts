import { isRecord } from "./dom.js";
import {
  advanceProgress,
  calendarBadgeTargets as targets,
  century,
  countSetBits,
  distinctHoursTarget,
  emptyClickAchievements,
  fiveGrand,
  fortnightMask,
  fourDigits,
  sameUtcMonth,
  seedProgress,
  threeVisits,
  utcDay,
  utcWeek,
} from "./progress.js";
import { buttonAchievementMask, buttonInteractionBits, counterKinds } from "./types.js";
import type { ButtonInteraction, ClickAchievements, ClickProgress, Counters } from "./types.js";

// One local slot, intentionally unrelated to authentication or the account API.
const localGame = (() => {
  const key = "goclick.local.v1";
  const coordinationTimeout = 10000;
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
    result.achievements =
      counters.achievements == null
        ? seedAchievements(last, daily, result.streak_counter_month?.count ?? 0)
        : validateAchievements(counters.achievements, Boolean(last));
    const hardware = counters.button_achievements;
    if (hardware !== undefined) {
      if (!nonnegativeInteger(hardware) || hardware > buttonAchievementMask)
        throw new Error("Invalid local button achievements.");
      if (hardware) result.button_achievements = hardware;
    }
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
  const achievementLimits = {
    ...targets,
    hours: 0xffffff,
    earned: century | fourDigits | fiveGrand | threeVisits,
  };
  function validateAchievements(value: unknown, hasTime: boolean): ClickAchievements {
    if (!isRecord(value)) throw new Error("Invalid local achievement progress.");
    const result: ClickAchievements = { ...emptyClickAchievements };
    for (const key of Object.keys(achievementLimits) as (keyof ClickAchievements)[]) {
      const field = value[key];
      if (!nonnegativeInteger(field) || field > achievementLimits[key])
        throw new Error("Invalid local achievement progress.");
      result[key] = field;
    }
    for (const key of ["day_clicks", "week_clicks", "month_clicks", "hours"] as const)
      if (Boolean(result[key]) !== hasTime) throw new Error("Invalid local achievement activity.");
    return result;
  }
  function seedAchievements(time: string | null | undefined, days: number, months: number) {
    const activity = {
      ...emptyClickAchievements,
      active_days: Math.min(targets.active_days, days),
      active_months: Math.min(targets.active_months, months),
    };
    if (!time) return activity;
    const seeded = advanceAchievements(emptyClickAchievements, null, time);
    seeded.active_days = Math.max(activity.active_days, 1);
    seeded.active_months = Math.max(activity.active_months, 1);
    return seeded;
  }
  function advanceAchievements(
    a: ClickAchievements,
    previous: string | null | undefined,
    current: string,
  ): ClickAchievements {
    const now = new Date(current);
    const before = previous ? new Date(previous) : null;
    const day = utcDay(now.getTime());
    const previousDay = before ? utcDay(before.getTime()) : NaN;
    const sameMonth = before !== null && sameUtcMonth(before, now);
    const dayClicks = day === previousDay ? Math.min(targets.day_clicks, a.day_clicks + 1) : 1;
    const weekClicks =
      utcWeek(day) === utcWeek(previousDay) ? Math.min(targets.week_clicks, a.week_clicks + 1) : 1;
    const monthClicks = sameMonth ? Math.min(targets.month_clicks, a.month_clicks + 1) : 1;
    const hours = (day === previousDay ? a.hours : 0) | (1 << now.getUTCHours());
    return {
      day_clicks: dayClicks,
      week_clicks: weekClicks,
      month_clicks: monthClicks,
      hours,
      active_days: Math.min(targets.active_days, a.active_days + Number(day !== previousDay)),
      active_months: Math.min(targets.active_months, a.active_months + Number(!sameMonth)),
      earned:
        a.earned |
        (dayClicks === targets.day_clicks ? century : 0) |
        (weekClicks === targets.week_clicks ? fourDigits : 0) |
        (monthClicks === targets.month_clicks ? fiveGrand : 0) |
        (countSetBits(hours) >= distinctHoursTarget ? threeVisits : 0),
    };
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
  function increment(now = new Date(), earned = 0) {
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
    counters.achievements = advanceAchievements(counters.achievements!, previous, time);
    if (earned) counters.button_achievements = (counters.button_achievements ?? 0) | earned;
    return write(counters);
  }
  function recordButtonAchievement(interaction: ButtonInteraction) {
    const counters = read();
    const previous = counters.button_achievements ?? 0;
    const earned = previous | buttonInteractionBits(interaction);
    if (earned !== previous) write({ ...counters, button_achievements: earned });
    return earned;
  }
  // Operations are synchronous so an IndexedDB read/write transaction can
  // provide the same cross-tab exclusion on browsers without Web Locks.
  async function change<T>(operation: () => T): Promise<T> {
    const controller = new AbortController();
    const { signal } = controller;
    const timer = window.setTimeout(() => {
      controller.abort(new Error("The local save was busy for too long. Try again."));
    }, coordinationTimeout);
    const run = () => {
      // Only timing out before the operation starts can guarantee no write.
      if (signal.aborted) throw signal.reason;
      window.clearTimeout(timer);
      return operation();
    };
    try {
      return navigator.locks
        ? await navigator.locks.request(key, { signal }, run)
        : await changeWithIndexedDB(run, signal);
    } finally {
      window.clearTimeout(timer);
    }
  }
  function changeWithIndexedDB<T>(operation: () => T, signal: AbortSignal): Promise<T> {
    if (typeof indexedDB === "undefined")
      return Promise.reject(new Error("This browser cannot safely coordinate the local save."));
    return new Promise((resolve, reject) => {
      const opening = indexedDB.open("goclick-local-locks", 1);
      let blocked = false;
      let transaction: IDBTransaction | undefined;
      signal.addEventListener(
        "abort",
        () => {
          reject(signal.reason);
          try {
            transaction?.abort();
          } catch {
            // The transaction may already be finishing.
          }
        },
        { once: true },
      );
      opening.onupgradeneeded = () => opening.result.createObjectStore("locks");
      opening.onerror = () => reject(opening.error);
      opening.onblocked = () => {
        blocked = true;
        reject(new Error("Close other Go Click tabs, then try the local save again."));
      };
      opening.onsuccess = () => {
        const database = opening.result;
        try {
          if (blocked || signal.aborted) return;
          const writeLock = database.transaction("locks", "readwrite");
          transaction = writeLock;
          writeLock.onabort = () => {
            reject(writeLock.error ?? new Error("Local save coordination failed."));
          };
          writeLock.objectStore("locks").get(key).onsuccess = () => {
            try {
              // The operation uses localStorage. A later IndexedDB abort cannot undo it.
              resolve(operation());
            } catch (error) {
              reject(error);
            }
          };
        } catch (error) {
          reject(error);
        } finally {
          // Close after any queued transaction finishes and releases the lock.
          database.close();
        }
      };
    });
  }
  return {
    key,
    read,
    encode,
    decode,
    validate,
    change,
    increment,
    recordButtonAchievement,
    replace: write,
  };
})();

export { localGame };
