// Programmatic focus inherits browser heuristics from the previous element.
// Track navigation input separately so typing in a form does not leave mouse
// and touch users with rings on the next screen or in a newly opened dialog.
const root = document.documentElement;
root.dataset.focusInput = "pointer";
const navigationKeys = new Set([
  "Tab",
  "Enter",
  " ",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Escape",
]);
document.addEventListener(
  "keydown",
  (event) => {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (navigationKeys.has(event.key)) root.dataset.focusInput = "keyboard";
  },
  { capture: true },
);
document.addEventListener(
  "pointerdown",
  () => {
    root.dataset.focusInput = "pointer";
  },
  { capture: true, passive: true },
);
