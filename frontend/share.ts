import { required as $ } from "./dom.js";
import {
  currentLanguage,
  message as t,
  formatNumber,
  formatUnit,
  onLanguageChange,
} from "./i18n.js";
import type { MessageKey } from "./messages.js";
import type { Counters } from "./types.js";

interface ShareOptions {
  siteLink: boolean;
  clicks: boolean;
  streaks: boolean;
}

export function formatStats(counters: Counters, local: boolean): string {
  return formatShareText(counters, local, { siteLink: false, clicks: true, streaks: true });
}

export function formatShareText(
  counters: Counters,
  local: boolean,
  options: ShareOptions,
  siteUrl = typeof window === "undefined" ? "" : (window.location?.origin ?? ""),
): string {
  const lines = [`Go Click${local ? ` · ${t("offline")}` : ""}`];
  if (options.clicks)
    lines.push(
      t("statsClicks", {
        label: t(local ? "localClicks" : "savedClicks"),
        count: formatNumber(counters.click_count?.count ?? 0),
      }),
    );
  if (options.streaks) {
    lines.push(
      t("statsStreaks", {
        day: formatUnit(counters.streak_counter_day?.count ?? 0, "day"),
        month: formatUnit(counters.streak_counter_month?.count ?? 0, "month"),
        year: formatUnit(counters.streak_counter_year?.count ?? 0, "year"),
      }),
    );
  }
  if (options.siteLink && siteUrl) lines.push(t("playLink", { url: siteUrl }));
  return lines.join("\n");
}

export const statsShare = (() => {
  const button = $<HTMLButtonElement>("#share-stats");
  const status = $("#share-status");
  const dialog = $<HTMLDialogElement>("#share-dialog");
  const text = $<HTMLTextAreaElement>("#share-text");
  const copyButton = $<HTMLButtonElement>("#copy-share-text");
  const options = {
    siteLink: $<HTMLInputElement>("#include-share-link"),
    clicks: $<HTMLInputElement>("#include-share-clicks"),
    streaks: $<HTMLInputElement>("#include-share-streaks"),
  };
  let generation = 0,
    feedbackTimer = 0,
    clearTimer = 0,
    busy = false,
    currentStats: { counters: Counters; local: boolean } | null = null;
  let announcement: MessageKey | null = null;

  function announce(key: MessageKey | null) {
    announcement = key;
    const message = key ? t(key) : "";
    window.clearTimeout(feedbackTimer);
    window.clearTimeout(clearTimer);
    status.textContent = message;
    status.setAttribute("data-visible", String(!!message));
    if (!message) return;
    feedbackTimer = window.setTimeout(() => {
      status.setAttribute("data-visible", "false");
      clearTimer = window.setTimeout(() => {
        status.textContent = "";
        announcement = null;
      }, 400);
    }, 2200);
  }

  function selectedOptions(): ShareOptions {
    return {
      siteLink: options.siteLink.checked,
      clicks: options.clicks.checked,
      streaks: options.streaks.checked,
    };
  }

  function updatePreview() {
    text.lang = currentLanguage();
    if (currentStats)
      text.value = formatShareText(currentStats.counters, currentStats.local, selectedOptions());
  }

  async function copyCurrent(openDialog: boolean) {
    if (busy || !currentStats) return;
    busy = true;
    const current = generation;
    const summary = formatShareText(currentStats.counters, currentStats.local, selectedOptions());
    text.value = summary;
    text.lang = currentLanguage();
    button.setAttribute("aria-busy", "true");
    copyButton.setAttribute("aria-busy", "true");
    announce(null);

    // Start the clipboard write during the button activation, before opening a
    // modal can consume the browser's transient user activation.
    let clipboardWrite: Promise<void>;
    try {
      clipboardWrite = navigator.clipboard.writeText(summary);
    } catch {
      clipboardWrite = Promise.reject(new Error("Clipboard unavailable"));
    }
    if (openDialog && !dialog.open) dialog.showModal();

    try {
      await clipboardWrite;
      if (current === generation) announce("copied");
    } catch {
      if (current !== generation) return;
      announce("clipboardUnavailable");
      text.focus();
      text.select();
    } finally {
      if (current === generation) {
        busy = false;
        button.setAttribute("aria-busy", "false");
        copyButton.setAttribute("aria-busy", "false");
      }
    }
  }

  onLanguageChange(() => {
    updatePreview();
    if (announcement) status.textContent = t(announcement);
  });

  $<HTMLButtonElement>("#close-share").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    const outside =
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom;
    if (outside) dialog.close();
  });
  copyButton.addEventListener("click", () => void copyCurrent(false));
  for (const option of Object.values(options)) option.addEventListener("change", updatePreview);

  return {
    reset() {
      generation++;
      busy = false;
      currentStats = null;
      window.clearTimeout(feedbackTimer);
      window.clearTimeout(clearTimer);
      button.setAttribute("aria-busy", "false");
      copyButton.setAttribute("aria-busy", "false");
      announce(null);
      text.value = "";
      if (dialog.open) dialog.close();
    },
    copy(counters: Counters, local: boolean) {
      currentStats = { counters, local };
      return copyCurrent(true);
    },
  };
})();
