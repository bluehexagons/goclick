const tricks = [
  "hold",
  "outlet",
  "keyboard",
  "u-turn",
  "loose-plug",
  "saved-keyboard",
  "saved-pointer",
  "touch-100",
  "wrong-button",
] as const;
type Trick = (typeof tricks)[number];
const trickPrefix = "goclick.trick.";
const earnedTricks = new Set<Trick>();
const listeners = new Set<() => void>();
for (const trick of tricks) {
  try {
    if (localStorage.getItem(trickPrefix + trick) === "1") earnedTricks.add(trick);
  } catch {
    // Discoveries still work in this tab when storage is unavailable.
  }
}

export function hasTrick(trick: Trick) {
  return earnedTricks.has(trick);
}

export function unlockTrick(trick: Trick) {
  if (hasTrick(trick)) return;
  earnedTricks.add(trick);
  try {
    localStorage.setItem(trickPrefix + trick, "1");
  } catch {
    // Keep this visit's badge if the browser cannot save it.
  }
  for (const listener of listeners) listener();
}

export function onTrickUnlock(listener: () => void) {
  listeners.add(listener);
}
window.addEventListener("storage", (event) => {
  const trick = tricks.find((name) => event.key === trickPrefix + name);
  if (trick && event.newValue === "1" && !hasTrick(trick)) {
    earnedTricks.add(trick);
    for (const listener of listeners) listener();
  }
});

// Metadata is attached only to the controller's release event and is counted
// after the game confirms the save. A native or synthetic click alone has no
// input information, and rejected clicks cannot advance these achievements.
export interface ButtonActivation {
  source: "keyboard" | "pointer" | "touch";
  uTurn?: boolean;
}
const activations = new WeakMap<Event, ButtonActivation>();
let touchClicks = 0;

export function rememberButtonActivation(event: Event, activation: ButtonActivation) {
  activations.set(event, activation);
}

export function recordSavedButtonClick(event: Event) {
  const activation = activations.get(event);
  if (!activation) return;
  activations.delete(event);
  unlockTrick(activation.source === "keyboard" ? "saved-keyboard" : "saved-pointer");
  if (activation.uTurn) unlockTrick("u-turn");
  if (activation.source === "touch" && !hasTrick("touch-100") && ++touchClicks === 100)
    unlockTrick("touch-100");
}
