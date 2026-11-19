import { currentLanguage, formatNumber, formatUnit, message as t } from "./i18n.js";
import type { Language } from "./i18n.js";
import type { ClickProgress, Counters } from "./types.js";

import { hasTrick } from "./button-tricks.js";
import { century, emptyClickAchievements, fiveGrand, fourDigits, threeVisits } from "./progress.js";

interface Badge {
  name: string;
  description: string;
  earned: boolean;
  descriptionLanguage: Language;
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
  const localized = language === "en" ? [] : requirements(language);
  function badge(name: string, description: string, earned: boolean, localized?: string): Badge {
    return {
      name,
      description: language !== "en" && localized ? localized : description,
      earned,
      descriptionLanguage: localized ? language : "en",
    };
  }
  return [
    badge("First Click", "Save your first click.", clicks >= 1, localized[0]),
    badge("Warm-Up", "Save 25 clicks in total.", clicks >= 25, localized[1]),
    badge("Getting the Hang of It", "Save 100 clicks in total.", clicks >= 100, localized[2]),
    badge("Old Reliable", "Save 500 clicks in total.", clicks >= 500, localized[3]),
    badge(
      "Three in a Row",
      "Save a click on 3 consecutive UTC days.",
      progress.best_day_streak >= 3,
      localized[4],
    ),
    badge(
      "Seven in a Row",
      "Save a click on 7 consecutive UTC days.",
      progress.best_day_streak >= 7,
      localized[5],
    ),
    badge(
      "See You Next Week",
      "Save a click in 2 consecutive UTC weeks.",
      progress.best_week_streak >= 2,
      localized[6],
    ),
    badge(
      "Weekly Regular",
      "Save a click in 4 consecutive UTC weeks.",
      progress.best_week_streak >= 4,
      localized[7],
    ),
    badge("Century", "Save 100 clicks in one UTC day.", Boolean(calendar.earned & century)),
    badge(
      "Four Digits",
      "Save 1,000 clicks in one Monday–Sunday UTC week.",
      Boolean(calendar.earned & fourDigits),
    ),
    badge(
      "Five Grand",
      "Save 5,000 clicks in one UTC calendar month.",
      Boolean(calendar.earned & fiveGrand),
    ),
    badge(
      "Three Visits",
      "Save a click in 3 different UTC hours on the same day.",
      Boolean(calendar.earned & threeVisits),
    ),
    badge(
      "Ten Days Your Way",
      "Save clicks on 10 different UTC days, with gaps allowed.",
      calendar.active_days >= 10,
    ),
    badge(
      "Familiar Face",
      "Save clicks in 3 different UTC calendar months, with gaps allowed.",
      calendar.active_months >= 3,
    ),
    badge(
      "Hold That Thought",
      "Keep the button pressed for 10 seconds without releasing it.",
      hasTrick("hold"),
    ),
    badge(
      "Behind the Button",
      "Drag the button far enough to reveal the outlet.",
      hasTrick("outlet"),
    ),
    badge(
      "Key Player",
      "Press and release Space or Enter with the game button focused.",
      hasTrick("keyboard"),
    ),
  ];
}
