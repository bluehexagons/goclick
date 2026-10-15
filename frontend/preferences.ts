import { isRecord } from "./dom.js";

// Shared by the renderer, input controller and app. Manual choices override both
// JavaScript animations and CSS; Auto follows a live OS/browser preference.
type MotionSetting = "auto" | "on" | "off";
interface Settings {
  motion: MotionSetting;
  simulatedPing: 0 | 80 | 250 | 800;
}
const gameSettings = (() => {
  const key = "goclick.settings.v1";
  const browser = window.matchMedia("(prefers-reduced-motion: reduce)");
  const listeners = new Set<(event: { matches: boolean }) => void>();
  let value: Settings = { motion: "auto", simulatedPing: 80 };
  function parse(raw: string | null): Settings {
    const decoded: unknown = JSON.parse(raw || "{}");
    const saved = isRecord(decoded) ? decoded : {};
    return {
      motion: saved.motion === "on" || saved.motion === "off" ? saved.motion : "auto",
      simulatedPing:
        saved.simulatedPing === 0 || saved.simulatedPing === 250 || saved.simulatedPing === 800
          ? saved.simulatedPing
          : 80,
    };
  }
  try {
    value = parse(localStorage.getItem(key));
  } catch {
    /* Defaults remain usable without storage. */
  }
  const motion = {
    get matches() {
      return value.motion === "on" || (value.motion === "auto" && browser.matches);
    },
    addEventListener(type: "change", callback: (event: { matches: boolean }) => void) {
      if (type === "change") listeners.add(callback);
    },
  };
  let appliedMotion: boolean | undefined;
  function apply() {
    const matches = motion.matches;
    document.documentElement.dataset.reducedMotion = String(matches);
    if (matches === appliedMotion) return;
    appliedMotion = matches;
    for (const callback of listeners) callback({ matches });
  }
  browser.addEventListener("change", apply);
  window.addEventListener("storage", (event) => {
    if (event.key !== key) return;
    try {
      value = parse(event.newValue);
      apply();
    } catch {
      /* Ignore malformed settings from another tab. */
    }
  });
  apply();
  return {
    motion,
    get value() {
      return { ...value };
    },
    update(patch: Partial<Settings>) {
      value = parse(JSON.stringify({ ...value, ...patch }));
      apply();
      // Apply this visit even when a private/quota-limited browser cannot persist it.
      localStorage.setItem(key, JSON.stringify(value));
    },
    mode() {
      try {
        return localStorage.getItem("goclick.mode") === "local" ? "local" : "online";
      } catch {
        return "online";
      }
    },
    setMode(mode: "local" | "online") {
      localStorage.setItem("goclick.mode", mode);
    },
  };
})();
const motionPreference = gameSettings.motion;

export { gameSettings, motionPreference };
