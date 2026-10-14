"use strict";

// Keep the interaction surface stable while its keycap moves in 3D.
// Activation stays with the native button: one click on release, including
// keyboard activation. Dragging outside or cancelling a gesture never scores.
const tactileButtons = new Map();
for (const button of document.querySelectorAll("[data-tactile-button]")) {
  const stage = button.closest(".button-stage");
  const rig = stage.querySelector(".button-rig");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const keys = ["x", "y", "rx", "ry", "press"];
  const current = { x: 0, y: 0, rx: 0, ry: 0, press: 0 };
  const target = { ...current }, velocity = { ...current };
  let pointer = null, origin = null, frame = 0, lastFrame = 0, pulseTimer = 0;
  let cancelClick = false, keyboardPressed = false;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function paint() {
    rig.style.setProperty("--shift-x", `${current.x.toFixed(3)}px`);
    rig.style.setProperty("--shift-y", `${current.y.toFixed(3)}px`);
    rig.style.setProperty("--tilt-x", `${current.rx.toFixed(3)}deg`);
    rig.style.setProperty("--tilt-y", `${current.ry.toFixed(3)}deg`);
    rig.style.setProperty("--press", clamp(current.press, 0, 1).toFixed(3));
  }
  function tick(time) {
    const dt = lastFrame ? clamp((time - lastFrame) / (1000 / 60), .25, 2) : 1;
    lastFrame = time;
    let moving = false;
    for (const key of keys) {
      velocity[key] = (velocity[key] + (target[key] - current[key]) * .16 * dt) * Math.pow(.64, dt);
      current[key] += velocity[key] * dt;
      if (Math.abs(target[key] - current[key]) > .002 || Math.abs(velocity[key]) > .002) moving = true;
      else { current[key] = target[key]; velocity[key] = 0; }
    }
    paint();
    frame = moving ? requestAnimationFrame(tick) : 0;
    if (!moving) lastFrame = 0;
  }
  function animate() {
    if (reducedMotion.matches) { for (const key of keys) { current[key] = 0; velocity[key] = 0; } paint(); return; }
    if (!frame) frame = requestAnimationFrame(tick);
  }
  function aim(event) {
    const rect = stage.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left - rect.width / 2) / (rect.width / 2), -1, 1);
    const y = clamp((event.clientY - rect.top - rect.height / 2) / (rect.height / 2), -1, 1);
    target.rx = -y * 11; target.ry = x * 15;
    target.x = x * 5; target.y = y * 4;
    if (pointer !== null && origin) {
      target.x += clamp((event.clientX - origin.x) * .18, -12, 12);
      target.y += clamp((event.clientY - origin.y) * .18, -10, 10);
    }
    rig.style.setProperty("--light-x", `${50 + x * 32}%`);
    rig.style.setProperty("--light-y", `${38 + y * 28}%`);
    animate();
  }
  function release(cancelled = false) {
    const captured = pointer;
    pointer = null; origin = null; keyboardPressed = false;
    target.press = 0; button.classList.remove("is-pressed");
    if (cancelled) cancelClick = true;
    if (captured !== null && button.hasPointerCapture(captured)) button.releasePointerCapture(captured);
    animate();
  }
  function reset(cancelled = true) {
    window.clearTimeout(pulseTimer);
    release(cancelled);
    for (const key of keys) target[key] = 0;
    rig.style.removeProperty("--light-x"); rig.style.removeProperty("--light-y");
    animate();
  }
  stage.addEventListener("pointermove", (event) => {
    if (button.disabled || (pointer !== null && event.pointerId !== pointer) || (event.pointerType === "touch" && pointer === null)) return;
    aim(event);
  });
  stage.addEventListener("pointerleave", () => { if (pointer === null) reset(false); });
  button.addEventListener("pointerdown", (event) => {
    if (button.disabled || !event.isPrimary || event.button !== 0 || pointer !== null) return;
    window.clearTimeout(pulseTimer); cancelClick = false;
    pointer = event.pointerId; origin = { x: event.clientX, y: event.clientY };
    target.press = 1; button.classList.add("is-pressed");
    button.setPointerCapture(pointer); aim(event);
  });
  button.addEventListener("pointerup", (event) => {
    if (event.pointerId !== pointer) return;
    const rect = button.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    release(outside);
    if (event.pointerType !== "mouse" || outside) reset(outside);
  });
  button.addEventListener("pointercancel", (event) => { if (event.pointerId === pointer) reset(); });
  button.addEventListener("lostpointercapture", () => { if (pointer !== null) reset(); });
  button.addEventListener("keydown", (event) => {
    if (button.disabled || (event.key !== " " && event.key !== "Enter") || event.repeat) return;
    cancelClick = false; keyboardPressed = true; target.press = 1;
    button.classList.add("is-pressed"); animate();
  });
  button.addEventListener("keyup", (event) => { if (event.key === " " || event.key === "Enter") release(); });
  button.addEventListener("blur", () => { if (keyboardPressed) reset(); });
  button.addEventListener("click", (event) => {
    if (cancelClick && event.detail > 0) { event.preventDefault(); event.stopImmediatePropagation(); cancelClick = false; return; }
    if (event.detail === 0 && !keyboardPressed && !button.disabled) {
      target.press = .85; button.classList.add("is-pressed"); animate();
      window.clearTimeout(pulseTimer); pulseTimer = window.setTimeout(() => release(), 100);
    }
  });
  new MutationObserver(() => { if (button.disabled) reset(); }).observe(button, { attributes: true, attributeFilter: ["disabled"] });
  reducedMotion.addEventListener("change", reset);
  window.addEventListener("blur", reset);
  window.addEventListener("resize", reset);
  document.addEventListener("visibilitychange", () => { if (document.hidden) reset(); });
  tactileButtons.set(button, { reset });
}
