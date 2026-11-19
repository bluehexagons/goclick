const tricks = ["hold", "outlet", "keyboard"] as const;
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
