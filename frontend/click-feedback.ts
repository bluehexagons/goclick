import { motionPreference } from "./preferences.js";
import { tactileButtons } from "./button.js";
import { required } from "./dom.js";
import { clickSound } from "./sound.js";
import {
  currentLanguage,
  languageDirection,
  message as t,
  formatNumber,
  formatUnit,
  onLanguageChange,
} from "./i18n.js";
import type { Activation, ResponseState } from "./types.js";

interface Feedback {
  readonly settled: boolean;
  remove(): void;
  reduce(): void;
  translate(): void;
  success(milliseconds: number): void;
  fail(uncertain?: boolean, limited?: boolean): void;
}
const feedbackLabels = {
  waiting: "feedbackWaiting",
  limited: "feedbackCooldown",
  unconfirmed: "feedbackUnconfirmed",
  unsaved: "feedbackUnsaved",
} as const;

function measureImpact(button: HTMLButtonElement, event: Activation) {
  const stage = button.closest<HTMLElement>(".button-stage");
  if (!stage) throw new Error("Click feedback needs a stage");
  const { left, top, width, height } = stage.getBoundingClientRect();
  let { clientX, clientY } = event;
  if (!(event.detail > 0)) {
    const face = button.getBoundingClientRect();
    clientX = face.left + face.width / 2;
    clientY = face.top + face.height / 2;
  }
  const hitX = clientX - left;
  const hitY = clientY - top;
  // A delayed reply belongs to the original impact, even if the face has moved.
  const origin = { x: hitX / width - 0.5, y: hitY / height - 0.5 };
  return { stage, hitX, hitY, width, height, origin };
}

const clickFeedback = (() => {
  const samples: number[] = [],
    live = new Set<Feedback>();
  let latestImpact = 0;
  const average = () =>
    samples.length ? samples.reduce((sum, sample) => sum + sample, 0) / samples.length : 150;
  function start(button: HTMLButtonElement, event: Activation, simulated = false) {
    const impact = ++latestImpact;
    const { stage, hitX, hitY, width, height, origin } = measureImpact(button, event);
    const x = Math.max(40, Math.min(width - 40, hitX));
    const y = Math.max(24, Math.min(height - 16, hitY));
    const popup = document.createElement("span"),
      score = document.createElement("strong"),
      timing = document.createElement("small");
    popup.className = "click-bonus";
    popup.dataset.state = "pending";
    popup.setAttribute("aria-hidden", "true");
    // Keep the anchor on the stage if the viewport changes while a reply is pending.
    popup.style.left = `${(100 * x) / width}%`;
    popup.style.top = `${(100 * y) / height}%`;
    popup.append(score, timing);
    required(".score-effects", stage).append(popup);
    tactileButtons.get(button)?.respond("pending");
    const baseline = average();
    let phase: "pending" | "waiting" | "saved" | "limited" | "unconfirmed" | "unsaved" = "pending";
    let measured = 0;
    function translate() {
      popup.lang = currentLanguage();
      popup.dir = languageDirection();
      score.textContent =
        phase === "limited"
          ? "…"
          : phase === "unconfirmed"
            ? "?"
            : phase === "unsaved"
              ? "×"
              : `+${formatNumber(1)}`;
      const average = formatUnit(Math.round(baseline), "millisecond");
      if (phase === "saved") {
        const time = formatUnit(Math.round(measured), "millisecond");
        timing.textContent = "";
        popup.title = t(simulated ? "feedbackSimulatedHint" : "feedbackSavedHint", {
          time,
          average,
        });
      } else {
        timing.textContent = phase === "pending" ? "" : t(feedbackLabels[phase]);
        popup.title =
          phase === "pending" || phase === "waiting"
            ? t("feedbackAwaitingHint", { average })
            : timing.textContent;
      }
    }
    translate();
    let animation: Animation | null = null;
    let removal = 0,
      settled = false;
    const slow = window.setTimeout(
      () => {
        if (!settled) {
          popup.dataset.state = "slow";
          phase = "waiting";
          translate();
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
      get settled() {
        return settled;
      },
      remove,
      translate,
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
        tactileButtons.get(button)?.respond(popup.dataset.state as ResponseState, {
          milliseconds: ms,
          origin,
          affectFace: impact === latestImpact,
        });
        clickSound.play(popup.dataset.state === "slow" ? "slow" : "saved");
        phase = "saved";
        measured = ms;
        translate();
        samples.push(ms);
        if (samples.length > 20) samples.shift();
        finish();
      },
      fail(uncertain = false, limited = false) {
        if (settled) return;
        settled = true;
        window.clearTimeout(slow);
        popup.dataset.state = limited ? "limited" : "error";
        // A cooldown changes what the whole button can do, even if an older request triggered it.
        if (limited) latestImpact++;
        tactileButtons.get(button)?.respond(limited ? "limited" : "error", {
          origin,
          affectFace: limited || impact === latestImpact,
        });
        clickSound.play(limited ? "limited" : "error");
        phase = limited ? "limited" : uncertain ? "unconfirmed" : "unsaved";
        translate();
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
    live.add(handle);
    if (live.size > 32) {
      const discard = [...live].find((item) => item.settled) ?? live.values().next().value;
      discard?.remove();
    }
    return handle;
  }
  onLanguageChange(() => {
    for (const handle of live) handle.translate();
  });
  motionPreference.addEventListener("change", () => {
    if (motionPreference.matches) for (const handle of live) handle.reduce();
  });
  return {
    start,
    showCooldown(button: HTMLButtonElement, event: Activation) {
      latestImpact++;
      const { origin } = measureImpact(button, event);
      tactileButtons.get(button)?.respond("limited", { origin });
      clickSound.play("limited");
    },
    reset() {
      for (const handle of live) handle.remove();
      samples.length = 0;
    },
  };
})();

export { clickFeedback };
