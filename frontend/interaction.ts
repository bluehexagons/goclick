// Cancel native page drags without interfering with pointer-driven gameplay,
// scrolling, external file drops, or editing text within a form field.
document.addEventListener(
  "dragstart",
  (event) => {
    const target = event.target;
    const element =
      target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    const editor = element?.closest<HTMLElement>("input, textarea, [contenteditable]");
    if (editor?.isContentEditable) return;
    if (editor?.matches("input:not([type=file]), textarea")) {
      const field = editor as HTMLInputElement | HTMLTextAreaElement;
      if (!field.disabled && !field.readOnly) return;
    }
    event.preventDefault();
  },
  { capture: true },
);

export {};
