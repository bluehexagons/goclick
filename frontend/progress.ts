import type { ClickAchievements, ClickProgress } from "./types.js";

export const fortnight = 14;
export const fortnightMask = (1 << fortnight) - 1;
export const dayMilliseconds = 86_400_000;
export const emptyProgress: ClickProgress = {
  recent_days: 0,
  week_streak: 0,
  best_day_streak: 0,
  best_week_streak: 0,
};

export function utcDay(time: number) {
  return Math.floor(time / dayMilliseconds);
}

export function utcWeek(day: number) {
  // 1970-01-01 was Thursday. Weeks start on Monday.
  return Math.floor((day + 3) / 7);
}

export function seedProgress(time: string | null | undefined, dailyStreak: number): ClickProgress {
  if (!time) return { ...emptyProgress, best_day_streak: dailyStreak };
  const last = utcDay(Date.parse(time));
  const first = Math.max(-100_000_000, last - Math.max(0, dailyStreak - 1));
  const weeks = utcWeek(last) - utcWeek(first) + 1;
  return {
    recent_days: (1 << Math.min(fortnight, last - first + 1)) - 1,
    week_streak: weeks,
    best_day_streak: Math.max(1, dailyStreak),
    best_week_streak: weeks,
  };
}

export function advanceProgress(
  progress: ClickProgress,
  previous: string | null | undefined,
  time: string,
  dailyStreak: number,
): ClickProgress {
  if (!previous) {
    const first = seedProgress(time, dailyStreak);
    first.best_day_streak = Math.max(first.best_day_streak, progress.best_day_streak);
    return first;
  }
  const before = utcDay(Date.parse(previous));
  const today = utcDay(Date.parse(time));
  if (before === today) {
    return dailyStreak <= progress.best_day_streak
      ? progress
      : { ...progress, best_day_streak: dailyStreak };
  }
  const gap = utcWeek(today) - utcWeek(before);
  const weeks = gap <= 1 ? progress.week_streak + gap : 1;
  return {
    recent_days:
      ((progress.recent_days << Math.min(fortnight, today - before)) | 1) & fortnightMask,
    week_streak: weeks,
    best_day_streak: Math.max(dailyStreak, progress.best_day_streak),
    best_week_streak: Math.max(weeks, progress.best_week_streak),
  };
}

export function fortnightActivity(mask: number) {
  let days = 0;
  let consecutivePairs = 0;
  for (let bits = mask; bits; bits >>>= 1) {
    days += bits & 1;
    consecutivePairs += bits & (bits >>> 1) & 1;
  }
  // Five points per active day and two per pair of consecutive days.
  const score = Math.round(
    (100 * (5 * days + 2 * consecutivePairs)) / (5 * fortnight + 2 * (fortnight - 1)),
  );
  return { days, score };
}

export function utcReset(now: number) {
  const start = utcDay(now) * dayMilliseconds;
  const next = start + dayMilliseconds;
  return { next, elapsed: now - start, minutesLeft: Math.ceil((next - now) / 60_000) };
}

export const century = 1;
export const fourDigits = 2;
export const fiveGrand = 4;
export const threeVisits = 8;

export const emptyClickAchievements: ClickAchievements = {
  day_clicks: 0,
  week_clicks: 0,
  month_clicks: 0,
  hours: 0,
  active_days: 0,
  active_months: 0,
  earned: 0,
};
