import { required as $ } from "./dom.js";
import { currentLanguage, formatNumber, languageDirection, message as t } from "./i18n.js";
import {
  dayMilliseconds,
  fortnight,
  fortnightActivity,
  seedProgress,
  utcReset,
} from "./progress.js";
import type { Counters } from "./types.js";
import { badgesFor } from "./achievements.js";
import { onTrickUnlock } from "./button-tricks.js";

const activityRail = $("#activity-days");
const dayMarks = Array.from({ length: fortnight }, () => {
  const mark = document.createElement("span");
  activityRail.append(mark);
  return mark;
});
const resetMeter = $<HTMLProgressElement>("#day-reset-meter");
const resetTime = $("#day-reset-local");
const timeLeft = $("#day-reset-left");

let lastActivity = "";
let lastBadges = "";
let resetMinute = NaN;
let resetTimer = 0;
let shownCounters: Counters = {};
onTrickUnlock(() => renderProgress(shownCounters));

export function renderProgress(data: Counters) {
  shownCounters = data;
  const progress =
    data.progress ??
    seedProgress(data.click_count?.modified_time, data.streak_counter_day?.count ?? 0);
  $("#week-streak").textContent = formatNumber(progress.week_streak);

  const activityKey = `${currentLanguage()}:${progress.recent_days}`;
  if (activityKey !== lastActivity) {
    lastActivity = activityKey;
    const { days, score } = fortnightActivity(progress.recent_days);
    $("#fortnight-score").textContent = t("outOf", {
      count: formatNumber(score),
      total: formatNumber(100),
    });
    $("#activity-count").textContent = t("daysActive", { count: formatNumber(days) });
    for (const [index, mark] of dayMarks.entries())
      mark.classList.toggle(
        "active",
        Boolean(progress.recent_days & (1 << (fortnight - 1 - index))),
      );
  }

  const badges = badgesFor(data, progress);
  const badgeKey = `${currentLanguage()}:${badges.map(({ earned }) => Number(earned)).join("")}`;
  if (badgeKey !== lastBadges) {
    lastBadges = badgeKey;
    $("#achievement-count").textContent = t("outOf", {
      count: formatNumber(badges.filter(({ earned }) => earned).length),
      total: formatNumber(badges.length),
    });
    const list = $("#achievement-list");
    list.textContent = "";
    for (const badge of badges) {
      const item = document.createElement("li");
      item.classList.toggle("earned", badge.earned);
      const state = document.createElement("span");
      state.className = "visually-hidden";
      state.textContent = `${t(badge.earned ? "earned" : "locked")}. `;
      const name = document.createElement("strong");
      name.lang = "en";
      name.dir = "ltr";
      name.textContent = badge.name;
      const description = document.createElement("span");
      description.className = "achievement-description";
      description.lang = badge.descriptionLanguage;
      description.dir = languageDirection(badge.descriptionLanguage);
      description.textContent = badge.description;
      item.append(state, name, description);
      list.append(item);
    }
  }
}

export function paintReset(force = false) {
  const now = Date.now();
  const minute = Math.floor(now / 60_000);
  if (!force && minute === resetMinute) return;
  resetMinute = minute;
  const { next, elapsed, minutesLeft } = utcReset(now);
  const formatter = new Intl.NumberFormat(currentLanguage(), { minimumIntegerDigits: 2 });
  const remaining = `${formatter.format(Math.floor(minutesLeft / 60))}:${formatter.format(minutesLeft % 60)}`;
  const countdown = t("timeUntilReset", { time: remaining });
  timeLeft.textContent = countdown;
  resetMeter.value = elapsed / dayMilliseconds;
  resetMeter.setAttribute("aria-valuetext", countdown);
  resetTime.textContent = t("localReset", {
    time: new Date(next).toLocaleString(currentLanguage(), {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      timeZoneName: "short",
    }),
  });
}

export function showReset(show: boolean) {
  window.clearInterval(resetTimer);
  if (!show) return;
  paintReset(true);
  resetTimer = window.setInterval(paintReset, 1000);
}
