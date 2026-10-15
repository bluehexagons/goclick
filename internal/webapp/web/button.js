"use strict";

// A press is immediate; its return is a spring. Holds never auto-score, and a
// cancelled/outside release never activates the native button.
const tactileButtons = new Map();
for (const button of document.querySelectorAll("[data-tactile-button]")) {
  const stage = button.closest(".button-stage"), rig = stage.querySelector(".button-rig");
  const effects = document.createElement("div");
  effects.className = "button-effects"; effects.setAttribute("aria-hidden", "true"); stage.append(effects);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const keys = ["x", "y", "rx", "ry", "press"];
  const current = { x: 0, y: 0, rx: 0, ry: 0, press: 0, flash: 0 };
  const target = { ...current }, velocity = { ...current };
  let renderer = null, setupFrame = 0, frame = 0, lastFrame = 0;
  let pointer = null, origin = null, activeKey = null, cancelClick = false;
  let suppressNativeClick = false, activatingRelease = false;
  let pulseTimer = 0, holdTimer = 0, phase = "idle";
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function paint() {
    rig.style.setProperty("--shift-x", `${current.x.toFixed(3)}px`);
    rig.style.setProperty("--shift-y", `${current.y.toFixed(3)}px`);
    rig.style.setProperty("--tilt-x", `${current.rx.toFixed(3)}deg`);
    rig.style.setProperty("--tilt-y", `${current.ry.toFixed(3)}deg`);
    rig.style.setProperty("--press", clamp(current.press, -.22, 1).toFixed(3));
    renderer?.draw(current);
  }
  function tick(time) {
    const dt = lastFrame ? clamp((time - lastFrame) / (1000 / 60), .25, 2) : 1;
    lastFrame = time;
    let moving = false;
    for (const key of keys) {
      const press = key === "press";
      velocity[key] = (velocity[key] + (target[key] - current[key]) * (press ? .4 : .16) * dt) * Math.pow(press ? .6 : .64, dt);
      current[key] += velocity[key] * dt;
      if (Math.abs(target[key] - current[key]) > .002 || Math.abs(velocity[key]) > .002) moving = true;
      else { current[key] = target[key]; velocity[key] = 0; }
    }
    current.flash *= Math.pow(.68, dt);
    if (current.flash > .005) moving = true; else current.flash = 0;
    paint();
    frame = moving && !document.hidden ? requestAnimationFrame(tick) : 0;
    if (!frame) lastFrame = 0;
  }
  function animate() {
    if (reducedMotion.matches) {
      for (const key of keys) { current[key] = key === "press" ? target.press : 0; velocity[key] = 0; }
      current.flash = 0; paint(); return;
    }
    if (!frame && !document.hidden) frame = requestAnimationFrame(tick);
  }
  function setPhase(next) {
    if (phase === next) return;
    phase = next;
    button.classList.toggle("is-pressed", phase !== "idle");
    stage.classList.toggle("is-pressed", phase !== "idle");
    stage.classList.toggle("is-held", phase === "held");
    button.dispatchEvent(new CustomEvent("buttonstate", { detail: phase }));
  }
  function begin() {
    window.clearTimeout(pulseTimer); window.clearTimeout(holdTimer); cancelClick = false;
    target.press = 1; current.press = Math.max(.7, current.press); velocity.press = 0;
    current.flash = reducedMotion.matches ? 0 : 1;
    setPhase("pressed"); paint(); animate();
    holdTimer = window.setTimeout(() => setPhase("held"), 180);
  }
  function aim(event) {
    const rect = stage.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left - rect.width / 2) / (rect.width / 2), -1, 1);
    const y = clamp((event.clientY - rect.top - rect.height / 2) / (rect.height / 2), -1, 1);
    target.rx = -y * 16; target.ry = x * 22;
    target.x = x * 3; target.y = y * 3;
    if (pointer !== null && origin) {
      target.x += clamp((event.clientX - origin.x) * .22, -16, 16);
      target.y += clamp((event.clientY - origin.y) * .22, -12, 12);
    }
    animate();
  }
  function release(cancelled = false) {
    const captured = pointer;
    pointer = null; origin = null; activeKey = null;
    window.clearTimeout(holdTimer); window.clearTimeout(pulseTimer);
    target.press = 0; velocity.press = cancelled || phase === "idle" ? 0 : -.24;
    setPhase("idle");
    if (cancelled) cancelClick = true;
    if (captured !== null && button.hasPointerCapture(captured)) button.releasePointerCapture(captured);
    animate();
  }
  function reset(cancelled = true) {
    release(cancelled);
    for (const key of keys) target[key] = 0;
    animate();
  }
  function burst() {
    if (reducedMotion.matches) return;
    // Keep rapid clicks bounded, and keep particles inside the stage so they
    // cannot introduce horizontal scrolling on a phone.
    while (effects.childElementCount > 32) effects.firstElementChild.remove();
    const ring = document.createElement("span"); ring.className = "click-ring"; effects.append(ring);
    ring.animate([{ opacity: .7, transform: "translate(-50%, -50%) scale(.65)" }, { opacity: 0, transform: "translate(-50%, -50%) scale(1.45)" }], { duration: 360, easing: "cubic-bezier(.15,.7,.3,1)" }).finished.then(() => ring.remove(), () => ring.remove());
    for (let i = 0; i < 7; i++) {
      const particle = document.createElement("span"); particle.className = "click-particle";
      const angle = (i / 7 * Math.PI * 2) - Math.PI / 2, scale = button.offsetWidth / 260;
      const x = Math.cos(angle) * (115 + i % 3 * 4) * scale, y = Math.sin(angle) * 66 * scale;
      particle.style.setProperty("--particle-color", ["var(--gold)", "var(--teal)", "var(--violet)"][i % 3]);
      effects.append(particle);
      particle.animate([{ opacity: 0, transform: `translate(${x * .95}px, ${y * .95}px) scale(.3)` }, { opacity: 1, offset: .16 }, { opacity: 0, transform: `translate(${x * 1.22}px, ${y * 1.28 - 16}px) rotate(${i * 45}deg) scale(.4)` }], { duration: 420 + i * 15, easing: "cubic-bezier(.15,.65,.4,1)" }).finished.then(() => particle.remove(), () => particle.remove());
    }
  }
  function activateRelease() {
    activatingRelease = true;
    try { button.click(); } finally { activatingRelease = false; }
  }
  stage.addEventListener("pointermove", (event) => {
    if (button.disabled || (pointer !== null && event.pointerId !== pointer) || (event.pointerType === "touch" && pointer === null)) return;
    aim(event);
  });
  stage.addEventListener("pointerleave", () => { if (pointer === null && activeKey === null) reset(false); });
  button.addEventListener("pointerdown", (event) => {
    if (button.disabled || !event.isPrimary || event.button !== 0 || pointer !== null || activeKey !== null) return;
    suppressNativeClick = false;
    pointer = event.pointerId; origin = { x: event.clientX, y: event.clientY };
    begin(); button.setPointerCapture(pointer); aim(event);
  });
  button.addEventListener("pointerup", (event) => {
    if (event.pointerId !== pointer) return;
    const rect = button.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    release(outside);
    // Browsers suppress a touch click after a drag, even inside the button.
    // Activate that release explicitly and swallow its optional native click.
    if (event.pointerType !== "mouse") {
      suppressNativeClick = true;
      if (!outside && !button.disabled) activateRelease();
    }
    if (event.pointerType !== "mouse" || outside) reset(outside);
  });
  button.addEventListener("pointercancel", (event) => { if (event.pointerId === pointer) reset(); });
  button.addEventListener("lostpointercapture", () => { if (pointer !== null) reset(); });
  button.addEventListener("keydown", (event) => {
    if (button.disabled || (event.key !== " " && event.key !== "Enter")) return;
    // Normalize Space and Enter to one activation on release, including when
    // the OS repeats keydown events while the key is held.
    event.preventDefault();
    if (event.repeat || activeKey !== null || pointer !== null) return;
    activeKey = event.key; begin();
  });
  button.addEventListener("keyup", (event) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (event.key !== activeKey) return;
    if (!button.disabled) activateRelease();
    release();
  });
  button.addEventListener("blur", () => { if (activeKey !== null) reset(); });
  button.addEventListener("click", (event) => {
    if (suppressNativeClick && event.detail > 0) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (cancelClick && event.detail > 0) { event.preventDefault(); event.stopImmediatePropagation(); cancelClick = false; return; }
    if (button.disabled) return;
    if (event.detail === 0 && activeKey === null && !activatingRelease) {
      begin(); pulseTimer = window.setTimeout(() => release(), 80);
    }
    burst();
  });
  new MutationObserver(() => { if (button.disabled) reset(); }).observe(button, { attributes: true, attributeFilter: ["disabled"] });
  reducedMotion.addEventListener("change", () => {
    reset();
    if (reducedMotion.matches) {
      for (const animation of effects.getAnimations({ subtree: true })) animation.cancel();
      effects.replaceChildren();
    }
  });
  window.addEventListener("blur", () => reset());
  window.addEventListener("resize", () => reset());
  document.addEventListener("visibilitychange", () => { if (document.hidden) reset(); });

  // The CSS button is usable immediately. Compile graphics only for a visible
  // stage, after its first paint; hidden login/game buttons do no startup work.
  new ResizeObserver(() => {
    if (!renderer && !setupFrame && stage.clientWidth && stage.clientHeight) {
      setupFrame = requestAnimationFrame(() => {
        setupFrame = 0;
        if (!stage.clientWidth || !stage.clientHeight) return;
        renderer = createButtonRenderer(stage, button); paint();
      });
    } else paint();
  }).observe(stage);
  tactileButtons.set(button, { reset });
}
