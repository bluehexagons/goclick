import { required as $ } from "./dom.js";
import type { Counters } from "./types.js";

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

export const statsShare = (() => {
  const button = $<HTMLButtonElement>("#share-stats");
  const status = $("#share-status");
  const dialog = $<HTMLDialogElement>("#share-dialog");
  const text = $<HTMLTextAreaElement>("#share-text");
  let generation = 0,
    busy = false;
  $<HTMLButtonElement>("#close-share").addEventListener("click", () => dialog.close());
  return {
    reset() {
      generation++;
      busy = false;
      button.setAttribute("aria-busy", "false");
      status.textContent = "";
      text.value = "";
      if (dialog.open) dialog.close();
    },
    async copy(counters: Counters, local: boolean) {
      if (busy) return;
      busy = true;
      const current = generation;
      const summary = formatStats(counters, local);
      button.setAttribute("aria-busy", "true");
      status.textContent = "";
      try {
        // Invoke directly from the activation event. Fetching or reading storage
        // first can lose clipboard activation in Firefox and Safari.
        await navigator.clipboard.writeText(summary);
        if (current === generation) status.textContent = "Stats copied.";
      } catch {
        if (current !== generation) return;
        text.value = summary;
        status.textContent = "Select and copy your stats from the dialog.";
        dialog.showModal();
        text.focus();
        text.select();
      } finally {
        if (current === generation) {
          busy = false;
          button.setAttribute("aria-busy", "false");
        }
      }
    },
  };
})();
