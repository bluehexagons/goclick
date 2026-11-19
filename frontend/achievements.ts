import { currentLanguage, formatNumber, formatUnit, message as t } from "./i18n.js";
import type { Language } from "./i18n.js";
import type { ClickProgress, Counters } from "./types.js";

import { hasTrick, savedTouchClicks } from "./button-tricks.js";
import {
  century,
  emptyClickAchievements,
  fiveGrand,
  fourDigits,
  threeVisits,
  utcDay,
  utcWeek,
} from "./progress.js";

export type BadgeIcon = "medal" | "clicks" | "calendar" | "pace" | "discovery";

export interface Badge {
  icon: BadgeIcon;
  hint: string;
  name: string;
  description: string;
  earned: boolean;
  descriptionLanguage: Language;
  meter?: { count: number; total: number };
}

const translatedRequirements = new Map<Language, string[]>();
function requirements(language: Language) {
  if (!translatedRequirements.has(language)) {
    translatedRequirements.set(language, [
      t("firstClick"),
      ...[25, 100, 500].map((count) => t("clickMilestone", { count: formatNumber(count) })),
      ...[3, 7].map((count) => t("consecutive", { duration: formatUnit(count, "day") })),
      ...[2, 4].map((count) => t("consecutive", { duration: formatUnit(count, "week") })),
    ]);
  }
  return translatedRequirements.get(language)!;
}

export function badgesFor(data: Counters, progress: ClickProgress): Badge[] {
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
  const localized = language === "en" ? [] : requirements(language);
  function badge(
    icon: BadgeIcon,
    name: string,
    hint: string,
    description: string,
    earned: boolean,
    translation?: string,
    current?: number,
    total?: number,
  ): Badge {
    return {
      icon,
      name,
      hint,
      description: translation ?? description,
      descriptionLanguage: translation ? language : "en",
      earned,
      meter:
        current !== undefined && total !== undefined
          ? { count: earned ? total : Math.min(total, current), total }
          : undefined,
    };
  }
  const badges = [
    badge(
      "medal",
      "Gone Click",
      "An early milestone.",
      "Saved you a click.",
      clicks >= 1,
      localized[0],
      clicks,
      1,
    ),
    badge(
      "clicks",
      "Sentence",
      "A few clicks in.",
      "Save 25 clicks in total.",
      clicks >= 25,
      localized[1],
      clicks,
      25,
    ),
    badge(
      "clicks",
      "Paragraph",
      "The clicks add up.",
      "Save 100 clicks in total.",
      clicks >= 100,
      localized[2],
      clicks,
      100,
    ),
    badge(
      "clicks",
      "Essay",
      "No time limit.",
      "Save 500 clicks in total.",
      clicks >= 500,
      localized[3],
      clicks,
      500,
    ),
    badge(
      "calendar",
      "Clicks for Days",
      "A short run of consecutive days.",
      "Save a click on 3 consecutive UTC days.",
      progress.best_day_streak >= 3,
      localized[4],
      progress.best_day_streak,
      3,
    ),
    badge(
      "calendar",
      "One-Week Streak",
      "A longer daily streak.",
      "Save a click on 7 consecutive UTC days.",
      progress.best_day_streak >= 7,
      localized[5],
      progress.best_day_streak,
      7,
    ),
    badge(
      "calendar",
      "Good to See You Again",
      "Check in again next week.",
      "Save a click in 2 consecutive UTC weeks.",
      progress.best_week_streak >= 2,
      localized[6],
      progress.best_week_streak,
      2,
    ),
    badge(
      "calendar",
      "Double Fortnight",
      "A longer weekly streak.",
      "Save a click in 4 consecutive UTC weeks.",
      progress.best_week_streak >= 4,
      localized[7],
      progress.best_week_streak,
      4,
    ),
    badge(
      "pace",
      "Busy Day",
      "Clicks within one UTC day.",
      "Save 100 clicks in one UTC day.",
      Boolean(calendar.earned & century),
      undefined,
      sameDay ? calendar.day_clicks : 0,
      100,
    ),
    badge(
      "pace",
      "Brisk Pace",
      "Clicks within one UTC week.",
      "Save 1,000 clicks in one Monday–Sunday UTC week.",
      Boolean(calendar.earned & fourDigits),
      undefined,
      sameWeek ? calendar.week_clicks : 0,
      1000,
    ),
    badge(
      "pace",
      "High Score",
      "Clicks within one UTC month.",
      "Save 5,000 clicks in one UTC calendar month.",
      Boolean(calendar.earned & fiveGrand),
      undefined,
      sameMonth ? calendar.month_clicks : 0,
      5000,
    ),
    badge(
      "pace",
      "Three Visits",
      "Different times on the same day.",
      "Save a click in 3 different UTC hours on the same day.",
      Boolean(calendar.earned & threeVisits),
      undefined,
      hours,
      3,
    ),
    badge(
      "calendar",
      "Returning Clicker",
      "The days can be spread out.",
      "Save a click on 10 different UTC days, with gaps allowed.",
      calendar.active_days >= 10,
      undefined,
      calendar.active_days,
      10,
    ),
    badge(
      "calendar",
      "Welcome Back",
      "An occasional visit is enough.",
      "Save a click in 3 different UTC calendar months, with gaps allowed.",
      calendar.active_months >= 3,
      undefined,
      calendar.active_months,
      3,
    ),
    badge(
      "discovery",
      "Hold It",
      "The button can wait.",
      "Hold the button for 10 seconds.",
      hasTrick("hold"),
    ),
    badge(
      "discovery",
      "Behind the Button",
      "The button has a back.",
      "Drag the button far enough to reveal the outlet.",
      hasTrick("outlet"),
    ),
    badge(
      "discovery",
      "Key Player",
      "Keyboard input.",
      "Press and release Space or Enter with the game button focused.",
      hasTrick("keyboard"),
    ),
    badge(
      "discovery",
      "U-Turn",
      "A return trip.",
      "Drag the button away, return it to its starting point, then release to save a click.",
      hasTrick("u-turn"),
    ),
    badge(
      "discovery",
      "That Seems Unsafe",
      "The cord has some slack.",
      "Loosen the plug by making at least four long pulls in at least three different directions.",
      hasTrick("loose-plug"),
    ),
    badge(
      "discovery",
      "Alternative Press",
      "There’s more than one way to click.",
      "Save one click with the keyboard and one with a pointer, in either order.",
      hasTrick("saved-keyboard") && hasTrick("saved-pointer"),
      undefined,
      Number(hasTrick("saved-keyboard")) + Number(hasTrick("saved-pointer")),
      2,
    ),
    badge(
      "discovery",
      "Mobile Mogul",
      "Touch input.",
      "Save 100 clicks using touch in one session.",
      hasTrick("touch-100"),
      undefined,
      savedTouchClicks(),
      100,
    ),
    badge(
      "discovery",
      "Wrong Button",
      "That’s a mouse button too.",
      "Click the game button with the middle or right mouse button.",
      hasTrick("wrong-button"),
    ),
    badge(
      "medal",
      "Curiosity",
      "A look around the interface.",
      "Open the Achievements screen.",
      hasTrick("achievements"),
    ),
  ];
  const earned = badges.filter((entry) => entry.earned).length;
  badges.push(
    badge(
      "medal",
      "Recursion",
      "Achievements count toward this one.",
      "Earn 10 other achievements.",
      earned >= 10,
      undefined,
      earned,
      10,
    ),
  );
  return badges;
}
