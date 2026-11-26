import { currentLanguage, formatNumber, formatUnit, message as t } from "./i18n.js";
import type { Language } from "./i18n.js";
import { buttonAchievementBits } from "./types.js";
import type { ClickProgress, Counters } from "./types.js";

import {
  calendarBadgeTargets as targets,
  century,
  countSetBits,
  distinctHoursTarget,
  emptyClickAchievements,
  fiveGrand,
  fourDigits,
  fortnight,
  fortnightActivity,
  sameUtcMonth,
  threeVisits,
  utcDay,
  utcWeek,
} from "./progress.js";

export type BadgeIcon = "medal" | "clicks" | "calendar" | "pace" | "hardware";

export interface Badge {
  id: string;
  icon: BadgeIcon;
  hint: string;
  name: string;
  description: string;
  earned: boolean;
  meter: { count: number; total: number };
}

type Goal =
  | "firstClick"
  | "clickMilestone"
  | "dayStreak"
  | "weekStreak"
  | "dayClickGoal"
  | "weekClickGoal"
  | "monthClickGoal"
  | "distinctHoursGoal"
  | "distinctDaysGoal"
  | "distinctMonthsGoal"
  | "chickenDinnerGoal"
  | "otherAchievementsGoal"
  | "reconnectPlugGoal"
  | "slackCordGoal"
  | "resetOutletGoal"
  | "reboundGoal"
  | "holdThatThoughtGoal"
  | "offGridGoal"
  | "parallelOutletGoal";

const translatedRequirements = new Map<string, string>();
function requirement(goal: Goal, target: number, language: Language) {
  const key = `${language}:${goal}:${target}`;
  const cached = translatedRequirements.get(key);
  if (cached !== undefined) return cached;

  let description: string;
  if (goal === "firstClick") description = t(goal, {}, language);
  else if (goal === "dayStreak" || goal === "weekStreak") {
    const duration = formatUnit(target, goal === "dayStreak" ? "day" : "week", language);
    description = t(
      goal === "dayStreak" ? "consecutiveDays" : "consecutiveWeeks",
      { duration },
      language,
    );
  } else {
    description = t(goal, { count: formatNumber(target, language) }, language);
  }
  translatedRequirements.set(key, description);
  return description;
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
  const sameMonth = sameUtcMonth(new Date(last), new Date(now));
  const hours = sameDay ? countSetBits(calendar.hours) : 0;

  function badge(
    id: string,
    icon: BadgeIcon,
    name: string,
    hint: string,
    goal: Goal,
    current: number,
    target: number,
    earnedOffline = current >= target,
    earnedOnline = accountBadges.has(id),
  ): Badge {
    const earned = local ? earnedOffline : earnedOnline;
    return {
      id,
      icon,
      name,
      hint,
      description: requirement(goal, target, language),
      earned,
      meter: { count: earned ? target : Math.min(target, current), total: target },
    };
  }
  const badges = [
    badge("gone-click", "medal", "Gone Click", "Early progress.", "firstClick", clicks, 1),
    badge("sentence", "clicks", "Sentence", "Click total.", "clickMilestone", clicks, 25),
    badge("paragraph", "clicks", "Paragraph", "Click total.", "clickMilestone", clicks, 100),
    badge("essay", "clicks", "Essay", "Click total.", "clickMilestone", clicks, 500),
    badge(
      "clicks-for-days",
      "calendar",
      "Clicks for Days",
      "Daily activity.",
      "dayStreak",
      progress.best_day_streak,
      3,
    ),
    badge(
      "one-week-streak",
      "calendar",
      "One-Week Streak",
      "Daily activity.",
      "dayStreak",
      progress.best_day_streak,
      7,
    ),
    badge(
      "good-to-see-you-again",
      "calendar",
      "Good to See You Again",
      "Weekly activity.",
      "weekStreak",
      progress.best_week_streak,
      2,
    ),
    badge(
      "double-fortnight",
      "calendar",
      "Double Fortnight",
      "Weekly activity.",
      "weekStreak",
      progress.best_week_streak,
      4,
    ),
    badge(
      "busy-day",
      "pace",
      "Busy Day",
      "Click volume.",
      "dayClickGoal",
      sameDay ? calendar.day_clicks : 0,
      targets.day_clicks,
      Boolean(calendar.earned & century),
    ),
    badge(
      "brisk-pace",
      "pace",
      "Brisk Pace",
      "Click volume.",
      "weekClickGoal",
      sameWeek ? calendar.week_clicks : 0,
      targets.week_clicks,
      Boolean(calendar.earned & fourDigits),
    ),
    badge(
      "high-score",
      "pace",
      "High Score",
      "Click volume.",
      "monthClickGoal",
      sameMonth ? calendar.month_clicks : 0,
      targets.month_clicks,
      Boolean(calendar.earned & fiveGrand),
    ),
    badge(
      "three-visits",
      "pace",
      "Three Visits",
      "Play timing.",
      "distinctHoursGoal",
      hours,
      distinctHoursTarget,
      Boolean(calendar.earned & threeVisits),
    ),
    badge(
      "returning-clicker",
      "calendar",
      "Returning Clicker",
      "Play history.",
      "distinctDaysGoal",
      calendar.active_days,
      targets.active_days,
    ),
    badge(
      "welcome-back",
      "calendar",
      "Welcome Back",
      "Long-term activity.",
      "distinctMonthsGoal",
      calendar.active_months,
      targets.active_months,
    ),
    badge(
      "chicken-dinner",
      "calendar",
      "Chicken Dinner",
      "Fortnight activity.",
      "chickenDinnerGoal",
      fortnightActivity(progress.recent_days).score,
      100,
      progress.best_day_streak >= fortnight,
    ),
  ];
  for (const [bit, id, name, hint, goal] of [
    [
      buttonAchievementBits.reconnect,
      "live-wire",
      "Reconnected",
      "Plug behavior.",
      "reconnectPlugGoal",
    ],
    [
      buttonAchievementBits.slackClick,
      "hanging-loose",
      "Slacking Off",
      "Cord behavior.",
      "slackCordGoal",
    ],
    [
      buttonAchievementBits.reset,
      "circuit-breaker",
      "Circuit Breaker",
      "Outlet controls.",
      "resetOutletGoal",
    ],
    [buttonAchievementBits.rebound, "rebound", "Rebound", "Button movement.", "reboundGoal"],
    [
      buttonAchievementBits.holdThatThought,
      "hold-that-thought",
      "Hold that Thought",
      "Button appearance.",
      "holdThatThoughtGoal",
    ],
    [buttonAchievementBits.offGrid, "off-grid", "Off-Grid", "Power state.", "offGridGoal"],
  ] as const) {
    const earned = Boolean((data.button_achievements ?? 0) & bit);
    badges.push(badge(id, "hardware", name, hint, goal, Number(earned), 1, earned, earned));
  }
  const sockets = countSetBits(
    (data.button_achievements ?? 0) &
      (buttonAchievementBits.topSocket | buttonAchievementBits.bottomSocket),
  );
  badges.push(
    badge(
      "parallel-outlet",
      "hardware",
      "Parallel Outlet",
      "Outlet setup.",
      "parallelOutletGoal",
      sockets,
      2,
      sockets === 2,
      sockets === 2,
    ),
  );
  const earned = badges.filter((entry) => entry.earned).length;
  badges.push(
    badge(
      "recursion",
      "medal",
      "Recursion",
      "Achievement progress.",
      "otherAchievementsGoal",
      earned,
      10,
      earned >= 10,
      earned >= 10 || accountBadges.has("recursion"),
    ),
  );
  return badges;
}
