import { badgesFor } from "./achievements.js";
import type { Badge } from "./achievements.js";
import { required as $ } from "./dom.js";
import { currentLanguage, formatNumber, languageDirection, message as t } from "./i18n.js";
import type { ClickProgress, Counters } from "./types.js";

const launcher = $<HTMLButtonElement>("#open-achievements");
const dialog = $<HTMLDialogElement>("#achievement-dialog");
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
const dialogLive = $("#achievement-dialog-announcement");
const game = $("#game-view");
const spoilerKey = "goclick.achievements.reveal.v1";
let filter: keyof typeof filters = "all";
let badges: Badge[] = [];
let badgeKey = "";
let noticeTimer = 0;
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
  item.append(icon, state, text);
  return item;
}

function paintList() {
  const cards = badges.filter(
    (badge) => filter === "all" || badge.earned === (filter === "earned"),
  );
  list.textContent = "";
  list.append(...cards.map(card));
  empty.hidden = cards.length > 0;
  if (!cards.length)
    empty.textContent =
      filter === "locked" ? "You’ve earned every achievement." : "No achievements earned yet.";
}

for (const key of Object.keys(filters) as (keyof typeof filters)[]) {
  filters[key].addEventListener("click", () => {
    if (filter === key) return;
    filters[filter].setAttribute("aria-pressed", "false");
    filter = key;
    filters[key].setAttribute("aria-pressed", "true");
    paintList();
    dialog.scrollTop = 0;
  });
}
spoiler.addEventListener("change", () => {
  try {
    localStorage.setItem(spoilerKey, spoiler.checked ? "1" : "0");
  } catch {
    // The checkbox still applies when storage is blocked.
  }
  paintList();
});
launcher.addEventListener("click", () => {
  paintList();
  if (!dialog.open) {
    dialog.append(notice);
    dialog.showModal();
  }
});
dialog.addEventListener("close", () => {
  if (!dialog.open) game.append(notice);
});
$("#close-achievements").addEventListener("click", closeAchievements);

export function closeAchievements() {
  if (dialog.open) dialog.close();
}

export function clearAchievementNotice() {
  window.clearTimeout(noticeTimer);
  pending.clear();
  visible.clear();
  notice.hidden = true;
  live.textContent = "";
  dialogLive.textContent = "";
}

function queueNotice(names: string[]) {
  if (!names.length || game.hidden || document.hidden) return;
  const queued = pending.size > 0;
  for (const name of names) pending.add(name);
  if (queued) return;
  // A saved click can also earn a button trick in the same turn.
  void Promise.resolve().then(() => {
    if (!pending.size) return;
    const earned = [...pending];
    pending.clear();
    if (game.hidden || document.hidden) return;
    for (const name of earned) visible.add(name);
    noticeTitle.textContent = visible.size === 1 ? "Achievement unlocked" : "Achievements unlocked";
    noticeNames.textContent = [...visible].join(" · ");
    notice.hidden = false;
    const title = earned.length === 1 ? "Achievement unlocked" : "Achievements unlocked";
    const announcement = dialog.open ? dialogLive : live;
    announcement.textContent = `${title}. ${earned.join(". ")}.`;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(clearAchievementNotice, 6500);
  });
}

export function renderAchievements(data: Counters, progress: ClickProgress, announce: boolean) {
  const next = badgesFor(data, progress);
  const key = `${currentLanguage()}:${next.map(({ earned }) => Number(earned)).join("")}`;
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
  meter.value = count;
  meter.max = badges.length;
  if (dialog.open) paintList();
}
