import { badgesFor } from "./achievements.js";
import type { Badge } from "./achievements.js";
import { required as $ } from "./dom.js";
import {
  currentLanguage,
  formatNumber,
  languageDirection,
  message as t,
  onLanguageChange,
} from "./i18n.js";
import type { ClickProgress, Counters } from "./types.js";

const screen = $("#achievement-view");
const list = $("#achievement-list");
const empty = $("#achievement-empty");
const spoiler = $<HTMLInputElement>("#achievement-spoilers");
const filters = {
  all: $("#achievement-all"),
  earned: $("#achievement-earned"),
  locked: $("#achievement-locked"),
};
const notice = $("#achievement-notice");
const noticeTitle = $("#achievement-notice-title");
const noticeNames = $("#achievement-notice-names");
const live = $("#achievement-announcement");
const game = $("#game-view");
const spoilerKey = "goclick.achievements.reveal.v1";
let filter: keyof typeof filters = "all";
let badges: Badge[] = [];
let badgeKey = "";
let noticeTimer = 0;
let noticeScheduled = false;
const pending = new Set<string>();
const visible = new Set<string>();

try {
  spoiler.checked = localStorage.getItem(spoilerKey) === "1";
} catch {
  // Revealing requirements still works for this visit.
}

function card(badge: Badge) {
  const item = document.createElement("li");
  item.className = badge.earned ? "achievement-card earned" : "achievement-card";

  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", "achievement-icon");
  icon.setAttribute("viewBox", "0 0 48 48");
  icon.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `/achievement-icons.svg#${badge.icon}`);
  icon.append(use);

  const text = document.createElement("div");
  const name = document.createElement("strong");
  name.lang = "en";
  name.dir = "ltr";
  name.textContent = badge.name;
  const description = document.createElement("p");
  description.className = "achievement-description";
  const showDetail = badge.earned || spoiler.checked;
  description.lang = showDetail ? badge.descriptionLanguage : "en";
  description.dir = languageDirection(showDetail ? badge.descriptionLanguage : "en");
  description.textContent = showDetail ? badge.description : badge.hint;

  const state = document.createElement("span");
  state.className = "achievement-state";
  state.textContent = t(badge.earned ? "earned" : "locked");
  text.append(name, description);
  if (showDetail && badge.meter) {
    const { count, total } = badge.meter;
    const row = document.createElement("div");
    row.className = "achievement-card-progress";
    const meter = document.createElement("progress");
    meter.max = total;
    meter.value = count;
    meter.setAttribute("aria-label", badge.name);
    const amount = document.createElement("span");
    amount.textContent = t("outOf", { count: formatNumber(count), total: formatNumber(total) });
    row.append(meter, amount);
    text.append(row);
  }
  item.append(icon, state, text);
  return item;
}

export function paintAchievementList() {
  const cards = badges.filter(
    (badge) => filter === "all" || badge.earned === (filter === "earned"),
  );
  list.textContent = "";
  list.append(...cards.map(card));
  empty.hidden = cards.length > 0;
  if (!cards.length)
    empty.textContent = t(filter === "locked" ? "allAchievementsEarned" : "noAchievementsEarned");
}

for (const key of Object.keys(filters) as (keyof typeof filters)[]) {
  filters[key].addEventListener("click", () => {
    if (filter === key) return;
    filters[filter].setAttribute("aria-pressed", "false");
    filter = key;
    filters[key].setAttribute("aria-pressed", "true");
    paintAchievementList();
    if (list.getBoundingClientRect().top < 0) window.scrollTo(0, 0);
  });
}
spoiler.addEventListener("change", () => {
  try {
    localStorage.setItem(spoilerKey, spoiler.checked ? "1" : "0");
  } catch {
    // The checkbox still applies when storage is blocked.
  }
  paintAchievementList();
});

export function hideAchievementNotice() {
  window.clearTimeout(noticeTimer);
  visible.clear();
  notice.hidden = true;
  live.textContent = "";
}

export function clearAchievementNotice() {
  pending.clear();
  hideAchievementNotice();
}

function queueNotice(names: string[]) {
  if (!names.length || (game.hidden && screen.hidden)) return;
  for (const name of names) pending.add(name);
  showAchievementNotices();
}

function unlockTitle(count: number) {
  return t(count === 1 ? "achievementUnlocked" : "achievementsUnlocked");
}
onLanguageChange(() => {
  if (visible.size) noticeTitle.textContent = unlockTitle(visible.size);
});

export function showAchievementNotices() {
  if (noticeScheduled || !pending.size || game.hidden || document.hidden) return;
  noticeScheduled = true;
  // A saved click can also earn a button trick in the same turn.
  void Promise.resolve().then(() => {
    noticeScheduled = false;
    if (!pending.size || game.hidden || document.hidden) return;
    const earned = [...pending];
    pending.clear();
    for (const name of earned) visible.add(name);
    noticeTitle.textContent = unlockTitle(visible.size);
    noticeNames.textContent = [...visible].join(" · ");
    notice.hidden = false;
    const names = earned.join(". ");
    live.textContent = `${unlockTitle(earned.length)}. ${languageDirection() === "rtl" ? `\u2066${names}\u2069` : names}.`;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(hideAchievementNotice, 6500);
  });
}

export function renderAchievements(data: Counters, progress: ClickProgress, announce: boolean) {
  const next = badgesFor(data, progress);
  const key = `${currentLanguage()}:${next
    .map(({ earned, meter }) => `${Number(earned)}-${meter?.count ?? ""}`)
    .join(",")}`;
  if (key === badgeKey) return;
  if (announce && badges.length) {
    queueNotice(
      next.filter((badge, index) => badge.earned && !badges[index]?.earned).map(({ name }) => name),
    );
  }
  badges = next;
  badgeKey = key;
  const count = badges.filter(({ earned }) => earned).length;
  $("#achievement-count").textContent = t("outOf", {
    count: formatNumber(count),
    total: formatNumber(badges.length),
  });
  const meter = $<HTMLProgressElement>("#achievement-meter");
  meter.max = badges.length;
  meter.value = count;
  if (!screen.hidden) paintAchievementList();
}
