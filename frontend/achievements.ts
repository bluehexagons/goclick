import { currentLanguage, formatNumber, formatUnit, message as t } from "./i18n.js";
import type { Language } from "./i18n.js";
import type { MessageKey } from "./messages.js";
import type { ClickProgress, Counters } from "./types.js";

import {
  century,
  emptyClickAchievements,
  fiveGrand,
  fourDigits,
  threeVisits,
  utcDay,
  utcWeek,
} from "./progress.js";

export type BadgeIcon = "medal" | "clicks" | "calendar" | "pace";

export interface Badge {
  icon: BadgeIcon;
  hint: string;
  name: string;
  description: string;
  earned: boolean;
  meter?: { count: number; total: number };
}

function formatRequirements(language: Language) {
  const count = (key: MessageKey, value: number) =>
    t(key, { count: formatNumber(value, language) }, language);
  const consecutive = (value: number, unit: "day" | "week") =>
    t("consecutive", { duration: formatUnit(value, unit, language) }, language);
  return {
    first: t("firstClick", {}, language),
    sentence: count("clickMilestone", 25),
    paragraph: count("clickMilestone", 100),
    essay: count("clickMilestone", 500),
    threeDays: consecutive(3, "day"),
    sevenDays: consecutive(7, "day"),
    twoWeeks: consecutive(2, "week"),
    fourWeeks: consecutive(4, "week"),
    busyDay: count("dayClickGoal", 100),
    briskPace: count("weekClickGoal", 1000),
    highScore: count("monthClickGoal", 5000),
    threeVisits: count("distinctHoursGoal", 3),
    returningClicker: count("distinctDaysGoal", 10),
    welcomeBack: count("distinctMonthsGoal", 3),
    recursion: count("otherAchievementsGoal", 10),
  };
}
const translatedRequirements = new Map<Language, ReturnType<typeof formatRequirements>>();
function requirements(language: Language) {
  let localized = translatedRequirements.get(language);
  if (!localized) {
    localized = formatRequirements(language);
    translatedRequirements.set(language, localized);
  }
  return localized;
}

export function badgesFor(data: Counters, progress: ClickProgress, local: boolean): Badge[] {
  const accountBadges = new Set(data.earned_badges);
  const language = currentLanguage();
  const clicks = data.click_count?.count ?? 0;
  const calendar = data.achievements ?? emptyClickAchievements;
  const last = Date.parse(data.click_count?.modified_time ?? "");
  const now = Date.now();
  const sameDay = utcDay(last) === utcDay(now);
  const sameWeek = utcWeek(utcDay(last)) === utcWeek(utcDay(now));
  const sameMonth =
    Number.isFinite(last) &&
    new Date(last).toISOString().slice(0, 7) === new Date(now).toISOString().slice(0, 7);
  let hours = 0;
  if (sameDay) {
    for (let bits = calendar.hours; bits; bits >>>= 1) hours += bits & 1;
  }
  const localized = requirements(language);
  function badge(
    id: string,
    icon: BadgeIcon,
    name: string,
    hint: string,
    description: string,
    earnedOffline: boolean,
    current?: number,
    total?: number,
  ): Badge {
    const earned = local ? earnedOffline : accountBadges.has(id);
    return {
      icon,
      name,
      hint,
      description,
      earned,
      meter:
        current !== undefined && total !== undefined
          ? { count: earned ? total : Math.min(total, current), total }
          : undefined,
    };
  }
  const badges = [
    badge(
      "gone-click",
      "medal",
      "Gone Click",
      "An early milestone.",
      localized.first,
      clicks >= 1,
      clicks,
      1,
    ),
    badge(
      "sentence",
      "clicks",
      "Sentence",
      "A few clicks in.",
      localized.sentence,
      clicks >= 25,
      clicks,
      25,
    ),
    badge(
      "paragraph",
      "clicks",
      "Paragraph",
      "The clicks add up.",
      localized.paragraph,
      clicks >= 100,
      clicks,
      100,
    ),
    badge(
      "essay",
      "clicks",
      "Essay",
      "No time limit.",
      localized.essay,
      clicks >= 500,
      clicks,
      500,
    ),
    badge(
      "clicks-for-days",
      "calendar",
      "Clicks for Days",
      "A short run of consecutive days.",
      localized.threeDays,
      progress.best_day_streak >= 3,
      progress.best_day_streak,
      3,
    ),
    badge(
      "one-week-streak",
      "calendar",
      "One-Week Streak",
      "A longer daily streak.",
      localized.sevenDays,
      progress.best_day_streak >= 7,
      progress.best_day_streak,
      7,
    ),
    badge(
      "good-to-see-you-again",
      "calendar",
      "Good to See You Again",
      "Check in again next week.",
      localized.twoWeeks,
      progress.best_week_streak >= 2,
      progress.best_week_streak,
      2,
    ),
    badge(
      "double-fortnight",
      "calendar",
      "Double Fortnight",
      "A longer weekly streak.",
      localized.fourWeeks,
      progress.best_week_streak >= 4,
      progress.best_week_streak,
      4,
    ),
    badge(
      "busy-day",
      "pace",
      "Busy Day",
      "Clicks within one UTC day.",
      localized.busyDay,
      Boolean(calendar.earned & century),
      sameDay ? calendar.day_clicks : 0,
      100,
    ),
    badge(
      "brisk-pace",
      "pace",
      "Brisk Pace",
      "Clicks within one UTC week.",
      localized.briskPace,
      Boolean(calendar.earned & fourDigits),
      sameWeek ? calendar.week_clicks : 0,
      1000,
    ),
    badge(
      "high-score",
      "pace",
      "High Score",
      "Clicks within one UTC month.",
      localized.highScore,
      Boolean(calendar.earned & fiveGrand),
      sameMonth ? calendar.month_clicks : 0,
      5000,
    ),
    badge(
      "three-visits",
      "pace",
      "Three Visits",
      "Different times on the same day.",
      localized.threeVisits,
      Boolean(calendar.earned & threeVisits),
      hours,
      3,
    ),
    badge(
      "returning-clicker",
      "calendar",
      "Returning Clicker",
      "The days can be spread out.",
      localized.returningClicker,
      calendar.active_days >= 10,
      calendar.active_days,
      10,
    ),
    badge(
      "welcome-back",
      "calendar",
      "Welcome Back",
      "An occasional visit is enough.",
      localized.welcomeBack,
      calendar.active_months >= 3,
      calendar.active_months,
      3,
    ),
  ];
  const earned = badges.filter((entry) => entry.earned).length;
  badges.push(
    badge(
      "recursion",
      "medal",
      "Recursion",
      "Achievements count toward this one.",
      localized.recursion,
      earned >= 10,
      earned,
      10,
    ),
  );
  return badges;
}
