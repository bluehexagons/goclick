import { required as $ } from "./dom.js";
import { currentLanguage, formatNumber, message as t } from "./i18n.js";
import {
  dayMilliseconds,
  fortnight,
  fortnightActivity,
  seedProgress,
  utcReset,
} from "./progress.js";
import type { Counters } from "./types.js";
import { renderAchievements } from "./achievement-panel.js";
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

const streaks = $(".streak-panel");
const resetButton = $<HTMLButtonElement>("#streak-reset-button");
const resetDetails = $("#streak-reset-details");
const compactTime = $("#streak-reset-local");
const compactTimeLeft = $("#streak-reset-left");
const ring = document.querySelector<SVGCircleElement>("#streak-reset-ring")!;
let resetPinned = false;

function setResetDetails(open: boolean) {
  resetDetails.hidden = !open;
  resetButton.setAttribute("aria-expanded", String(open));
}

function closeResetDetails() {
  resetPinned = false;
  setResetDetails(false);
}

resetButton.addEventListener("pointerenter", (event) => {
  if (event.pointerType === "mouse") setResetDetails(true);
});
streaks.addEventListener("pointerleave", () => {
  if (!resetPinned) setResetDetails(false);
});
resetButton.addEventListener("click", () => {
  resetPinned = !resetPinned;
  setResetDetails(resetPinned);
});
document.addEventListener("pointerdown", (event) => {
  if (!resetDetails.hidden && !streaks.contains(event.target as Node)) closeResetDetails();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !resetDetails.hidden) closeResetDetails();
});

let lastActivity = "";
let resetMinute = NaN;
let nextReset = NaN;
let resetTimer = 0;
let shownCounters: Counters = {};
onTrickUnlock((local) => renderProgress(shownCounters, local));

export function renderProgress(data: Counters, announce = false) {
  shownCounters = data;
  const progress =
    data.progress ??
    seedProgress(data.click_count?.modified_time, data.streak_counter_day?.count ?? 0);
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

  renderAchievements(data, progress, announce);
  return progress;
}

export function paintReset(force = false) {
  const now = Date.now();
  const minute = Math.floor(now / 60_000);
  if (!force && minute === resetMinute) return;
  resetMinute = minute;
  const { next, elapsed, minutesLeft } = utcReset(now);
  if (next !== nextReset) {
    nextReset = next;
    // Period badge meters reset on the calendar. The activity score still
    // reflects the dates ending on the last saved click.
    if (!$("#achievement-view").hidden) renderProgress(shownCounters);
  }
  const formatter = new Intl.NumberFormat(currentLanguage(), { minimumIntegerDigits: 2 });
  const remaining = `${formatter.format(Math.floor(minutesLeft / 60))}:${formatter.format(minutesLeft % 60)}`;
  const countdown = t("timeUntilReset", { time: remaining });
  timeLeft.textContent = compactTimeLeft.textContent = countdown;
  const fraction = elapsed / dayMilliseconds;
  resetMeter.value = fraction;
  ring.setAttribute("stroke-dasharray", `${fraction} 1`);
  resetMeter.setAttribute("aria-valuetext", countdown);
  resetTime.textContent = compactTime.textContent = t("localReset", {
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
  closeResetDetails();
  if (!show) return;
  paintReset(true);
  resetTimer = window.setInterval(paintReset, 1000);
}
