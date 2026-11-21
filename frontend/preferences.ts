import { isRecord } from "./dom.js";
import { isSoundProfile, typicalSaveDelayMs } from "./sound-design.js";
import type { SoundProfile } from "./sound-design.js";

// Shared by the renderer, input controller and app. Manual choices override both
// JavaScript animations and CSS; Auto follows a live OS/browser preference.
type MotionSetting = "auto" | "on" | "off";
const simulatedPings = [0, typicalSaveDelayMs, 80, 250, 800] as const;
type SimulatedPing = (typeof simulatedPings)[number];
export function isSimulatedPing(value: unknown): value is SimulatedPing {
  return simulatedPings.some((ping) => ping === value);
}
interface Settings {
  motion: MotionSetting;
  simulatedPing: SimulatedPing;
  sound: boolean;
  soundProfile: SoundProfile;
  soundVolume: number;
  soundReverb: boolean;
}
const defaultSoundVolume = 100;
const gameSettings = (() => {
  const key = "goclick.settings.v1";
  const browser = window.matchMedia("(prefers-reduced-motion: reduce)");
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const settingListeners = new Set<() => void>();
  let value: Settings = {
    motion: "auto",
    simulatedPing: typicalSaveDelayMs,
    sound: false,
    soundProfile: "classic",
    soundVolume: defaultSoundVolume,
    soundReverb: true,
  };
  function parse(raw: string | null): Settings {
    const decoded: unknown = JSON.parse(raw || "{}");
    const saved = isRecord(decoded) ? decoded : {};
    return {
      sound: saved.sound === true,
      soundProfile: isSoundProfile(saved.soundProfile) ? saved.soundProfile : "classic",
      soundVolume:
        typeof saved.soundVolume === "number" &&
        Number.isInteger(saved.soundVolume) &&
        saved.soundVolume >= 0 &&
        saved.soundVolume <= 100
          ? saved.soundVolume
          : defaultSoundVolume,
      soundReverb: saved.soundReverb !== false,
      motion: saved.motion === "on" || saved.motion === "off" ? saved.motion : "auto",
      simulatedPing: isSimulatedPing(saved.simulatedPing)
        ? saved.simulatedPing
        : typicalSaveDelayMs,
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
    for (const callback of settingListeners) callback();
    if (matches === appliedMotion) return;
    appliedMotion = matches;
    for (const callback of listeners) callback({ matches });
  }
  browser.addEventListener("change", apply);
  window.addEventListener("storage", (event) => {
    if (event.key !== key && event.key !== null) return;
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
    onChange(callback: () => void) {
      settingListeners.add(callback);
    },
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
