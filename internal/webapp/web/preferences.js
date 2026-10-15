"use strict";

// Shared by the renderer, input controller and app. Manual choices override both
// JavaScript animations and CSS; Auto follows a live OS/browser preference.
const gameSettings = (() => {
  const key = "goclick.settings.v1";
  const browser = window.matchMedia("(prefers-reduced-motion: reduce)");
  const listeners = new Set();
  let value = { motion: "auto", simulatedPing: 80 };
  function parse(raw) {
    const saved = JSON.parse(raw || "{}");
    return {
      motion: ["auto", "on", "off"].includes(saved?.motion) ? saved.motion : "auto",
      simulatedPing: [0, 80, 250, 800].includes(saved?.simulatedPing) ? saved.simulatedPing : 80,
    };
  }
  try { value = parse(localStorage.getItem(key)); } catch (_) { /* Defaults remain usable without storage. */ }
  const motion = {
    get matches() { return value.motion === "on" || (value.motion === "auto" && browser.matches); },
    addEventListener(type, callback) { if (type === "change") listeners.add(callback); },
  };
  function apply() {
    document.documentElement.dataset.reducedMotion = String(motion.matches);
    for (const callback of listeners) callback({ matches: motion.matches });
  }
  browser.addEventListener("change", apply);
  window.addEventListener("storage", event => {
    if (event.key !== key) return;
    try { value = parse(event.newValue); apply(); } catch (_) { /* Ignore malformed settings from another tab. */ }
  });
  apply();
  return {
    motion,
    get value() { return { ...value }; },
    update(patch) {
      value = parse(JSON.stringify({ ...value, ...patch }));
      apply();
      // Apply this visit even when a private/quota-limited browser cannot persist it.
      localStorage.setItem(key, JSON.stringify(value));
    },
    mode() { try { return localStorage.getItem("goclick.mode") === "local" ? "local" : "online"; } catch (_) { return "online"; } },
    setMode(mode) { localStorage.setItem("goclick.mode", mode); },
  };
})();
const motionPreference = gameSettings.motion;
