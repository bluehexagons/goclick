import { required as $ } from "./dom.js";
import type { Counters } from "./types.js";

interface ShareOptions {
  siteLink: boolean;
  clicks: boolean;
  streaks: boolean;
}

export function formatStats(counters: Counters, local: boolean): string {
  const number = new Intl.NumberFormat("en-US");
  const quantity = (count: number, unit: string) =>
    `${number.format(count)} ${unit}${count === 1 ? "" : "s"}`;
  return [
    `Go Click${local ? " · offline" : ""}`,
    quantity(counters.click_count?.count ?? 0, local ? "local click" : "saved click"),
    `UTC streaks: ${quantity(counters.streak_counter_day?.count ?? 0, "day")} · ${quantity(counters.streak_counter_month?.count ?? 0, "month")} · ${quantity(counters.streak_counter_year?.count ?? 0, "year")}`,
  ].join("\n");
}

export function formatShareText(
  counters: Counters,
  local: boolean,
  options: ShareOptions,
  siteUrl = window.location?.origin ?? "",
): string {
  const number = new Intl.NumberFormat("en-US");
  const quantity = (count: number, unit: string) =>
    `${number.format(count)} ${unit}${count === 1 ? "" : "s"}`;
  const lines = [`Go Click${local ? " · offline" : ""}`];
  if (options.clicks)
    lines.push(quantity(counters.click_count?.count ?? 0, local ? "local click" : "saved click"));
  if (options.streaks) {
    lines.push(
      `UTC streaks: ${quantity(counters.streak_counter_day?.count ?? 0, "day")} · ${quantity(counters.streak_counter_month?.count ?? 0, "month")} · ${quantity(counters.streak_counter_year?.count ?? 0, "year")}`,
    );
  }
  if (options.siteLink && siteUrl) lines.push(`Play: ${siteUrl}`);
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

  function announce(message: string) {
    window.clearTimeout(feedbackTimer);
    window.clearTimeout(clearTimer);
    status.textContent = message;
    status.setAttribute("data-visible", String(!!message));
    if (!message) return;
    feedbackTimer = window.setTimeout(() => {
      status.setAttribute("data-visible", "false");
      clearTimer = window.setTimeout(() => {
        status.textContent = "";
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
    if (currentStats)
      text.value = formatShareText(currentStats.counters, currentStats.local, selectedOptions());
  }

  async function copyCurrent(openDialog: boolean) {
    if (busy || !currentStats) return;
    busy = true;
    const current = generation;
    const summary = formatShareText(currentStats.counters, currentStats.local, selectedOptions());
    text.value = summary;
    button.setAttribute("aria-busy", "true");
    copyButton.setAttribute("aria-busy", "true");
    announce("");

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
      if (current === generation) announce("Stats copied.");
    } catch {
      if (current !== generation) return;
      announce("Clipboard unavailable. Select and copy the preview text.");
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

  $<HTMLButtonElement>("#close-share").addEventListener("click", () => dialog.close());
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
      announce("");
      text.value = "";
      if (dialog.open) dialog.close();
    },
    copy(counters: Counters, local: boolean) {
      currentStats = { counters, local };
      return copyCurrent(true);
    },
  };
})();
