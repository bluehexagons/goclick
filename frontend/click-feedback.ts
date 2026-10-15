import { motionPreference } from "./preferences.js";
import { tactileButtons } from "./button.js";
import { required } from "./dom.js";
import type { Activation, ResponseState } from "./types.js";

interface Feedback {
  remove(): void;
  reduce(): void;
  success(milliseconds: number): void;
  fail(uncertain?: boolean, limited?: boolean): void;
}
const clickFeedback = (() => {
  const samples: number[] = [],
    live = new Set<Feedback>();
  const average = () =>
    samples.length ? samples.reduce((sum, sample) => sum + sample, 0) / samples.length : 150;
  function start(button: HTMLButtonElement, event: Activation, simulated = false) {
    const stage = button.closest<HTMLElement>(".button-stage");
    if (!stage) throw new Error("Click feedback needs a stage");
    const rect = stage.getBoundingClientRect();
    const face = button.getBoundingClientRect();
    const pointer = event.detail > 0;
    const x = Math.max(
      40,
      Math.min(rect.width - 40, (pointer ? event.clientX : face.left + face.width / 2) - rect.left),
    );
    const y = Math.max(
      24,
      Math.min(rect.height - 16, (pointer ? event.clientY : face.top + face.height / 2) - rect.top),
    );
    const popup = document.createElement("span"),
      score = document.createElement("strong"),
      timing = document.createElement("small");
    popup.className = "click-bonus";
    popup.dataset.state = "pending";
    popup.setAttribute("aria-hidden", "true");
    popup.style.left = `${x}px`;
    popup.style.top = `${y}px`;
    score.textContent = "+1";
    timing.textContent = "…";
    popup.append(score, timing);
    required(".score-effects", stage).append(popup);
    tactileButtons.get(button)?.respond("pending");
    const baseline = average();
    let animation: Animation | null = null;
    let removal = 0,
      settled = false;
    const slow = window.setTimeout(
      () => {
        if (!settled) {
          popup.dataset.state = "slow";
          timing.textContent = "waiting";
        }
      },
      Math.max(250, baseline * 1.6),
    );
    function remove() {
      settled = true;
      window.clearTimeout(slow);
      window.clearTimeout(removal);
      animation?.cancel();
      popup.remove();
      live.delete(handle);
    }
    const handle: Feedback = {
      remove,
      reduce() {
        animation?.cancel();
        animation = null;
      },
      success(milliseconds: number) {
        if (settled) return;
        settled = true;
        window.clearTimeout(slow);
        const ms = Math.max(0, milliseconds);
        popup.dataset.state =
          ms > Math.max(250, baseline * 1.6) ? "slow" : ms < baseline * 0.7 ? "fast" : "saved";
        tactileButtons.get(button)?.respond(popup.dataset.state as ResponseState, ms);
        timing.textContent = `✓ ${Math.round(ms)} ms${simulated ? " · sim" : ""}`;
        popup.title = `Saved · ${Math.round(ms)} ms · recent average ${Math.round(baseline)} ms`;
        samples.push(ms);
        if (samples.length > 20) samples.shift();
        finish();
      },
      fail(uncertain = false, limited = false) {
        if (settled) return;
        settled = true;
        window.clearTimeout(slow);
        popup.dataset.state = limited ? "limited" : "error";
        tactileButtons.get(button)?.respond(limited ? "limited" : "error");
        score.textContent = limited ? "…" : uncertain ? "?" : "×";
        timing.textContent = limited ? "cooldown" : uncertain ? "unconfirmed" : "not saved";
        finish();
      },
    };
    function finish() {
      if (!motionPreference.matches)
        animation = popup.animate(
          [
            { transform: "translate(-50%, -115%) scale(1)", opacity: 0.85 },
            { transform: "translate(-50%, -135%) scale(1.06)", opacity: 0.85, offset: 0.18 },
            { transform: "translate(-50%, -220%) scale(.95)", opacity: 0 },
          ],
          { duration: 900, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" },
        );
      removal = window.setTimeout(remove, motionPreference.matches ? 800 : 950);
    }
    // Pending +1s stay anchored until confirmed, including on a slow connection.
    popup.title = `Awaiting save · recent average ${Math.round(baseline)} ms`;
    live.add(handle);
    while (live.size > 32) live.values().next().value?.remove();
    return handle;
  }
  motionPreference.addEventListener("change", () => {
    if (motionPreference.matches) for (const handle of live) handle.reduce();
  });
  return {
    start,
    reset() {
      for (const handle of live) handle.remove();
      samples.length = 0;
    },
  };
})();

export { clickFeedback };
