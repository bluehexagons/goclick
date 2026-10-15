import { motionPreference } from "./preferences.js";
import { createButtonRenderer } from "./button-3d.js";
import { required } from "./dom.js";
import type { ButtonController, ButtonState, ResponseState, Renderer } from "./types.js";

// A press is immediate; its return is a spring. Holds never auto-score, and a
// cancelled/outside release never activates the native button.
const tactileButtons = new Map<HTMLButtonElement, ButtonController>();
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-tactile-button]")) {
  const maybeStage = button.closest<HTMLElement>(".button-stage");
  if (!maybeStage) throw new Error("Tactile button needs a stage");
  const stage: HTMLElement = maybeStage;
  const rig = required(".button-rig", stage);
  const effects = document.createElement("div");
  effects.className = "button-effects";
  effects.setAttribute("aria-hidden", "true");
  stage.append(effects);
  const reducedMotion = motionPreference;
  const keys = ["x", "y", "rx", "ry", "press", "pop"] as const;
  const current: ButtonState = {
    x: 0,
    y: 0,
    rx: 0,
    ry: 0,
    press: 0,
    pop: 0,
    flash: 0,
    response: 0,
    responseProgress: 0,
    responseColor: [0.38, 0.84, 0.8],
  };
  const target = { ...current },
    velocity = { ...current };
  let renderer: Renderer | null = null;
  let setupFrame = 0,
    frame = 0,
    lastFrame = 0;
  const pointers = new Map<number, { x: number; y: number; startX: number; startY: number }>();
  let activeKey: string | null = null;
  let activatingRelease = false;
  let pulseTimer = 0,
    holdTimer = 0,
    phase: "idle" | "pressed" | "held" = "idle";
  let responseStarted: number | null = null;
  let responseDuration = 500;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  function paint() {
    rig.style.setProperty("--shift-x", `${current.x.toFixed(3)}px`);
    rig.style.setProperty("--shift-y", `${current.y.toFixed(3)}px`);
    rig.style.setProperty("--tilt-x", `${current.rx.toFixed(3)}deg`);
    rig.style.setProperty("--tilt-y", `${current.ry.toFixed(3)}deg`);
    rig.style.setProperty("--press", clamp(current.press, -0.22, 1).toFixed(3));
    rig.style.setProperty("--button-pop", (1 + clamp(current.pop, -0.065, 0.1)).toFixed(3));
    rig.style.setProperty(
      "--response-wash",
      `rgba(${current.responseColor.map((value) => Math.round(value * 255)).join(",")},${(current.response * 0.5).toFixed(3)})`,
    );
    renderer?.draw(current);
  }
  function tick(time: number) {
    const dt = lastFrame ? clamp((time - lastFrame) / (1000 / 60), 0.25, 2) : 1;
    lastFrame = time;
    let moving = false;
    for (const key of keys) {
      const press = key === "press";
      velocity[key] =
        (velocity[key] + (target[key] - current[key]) * (press ? 0.4 : 0.16) * dt) *
        Math.pow(press ? 0.6 : 0.64, dt);
      current[key] += velocity[key] * dt;
      if (Math.abs(target[key] - current[key]) > 0.002 || Math.abs(velocity[key]) > 0.002)
        moving = true;
      else {
        current[key] = target[key];
        velocity[key] = 0;
      }
    }
    current.flash *= Math.pow(0.68, dt);
    if (current.flash > 0.005) moving = true;
    else current.flash = 0;
    if (responseStarted !== null) {
      current.responseProgress = clamp((time - responseStarted) / responseDuration, 0, 1);
      current.response = Math.pow(1 - current.responseProgress, 0.65);
      if (current.responseProgress < 1) moving = true;
      else responseStarted = null;
    }
    paint();
    frame = moving && !document.hidden ? requestAnimationFrame(tick) : 0;
    if (!frame) lastFrame = 0;
  }
  function animate() {
    if (reducedMotion.matches) {
      for (const key of keys) {
        current[key] = key === "press" ? target.press : 0;
        velocity[key] = 0;
      }
      current.flash = 0;
      paint();
      return;
    }
    if (!frame && !document.hidden) frame = requestAnimationFrame(tick);
  }
  function setPhase(next: "idle" | "pressed" | "held") {
    if (phase === next) return;
    phase = next;
    button.classList.toggle("is-pressed", phase !== "idle");
    stage.classList.toggle("is-pressed", phase !== "idle");
    stage.classList.toggle("is-held", phase === "held");
    button.dispatchEvent(new CustomEvent("buttonstate", { detail: phase }));
  }
  function begin() {
    window.clearTimeout(pulseTimer);
    window.clearTimeout(holdTimer);
    clearResponse();
    // Snap on the input event itself. Only the release waits for the spring.
    target.press = current.press = 1;
    velocity.press = 0;
    target.pop = current.pop = reducedMotion.matches ? 0 : -0.045;
    velocity.pop = 0;
    current.flash = reducedMotion.matches ? 0 : 0.3;
    setPhase("pressed");
    paint();
    animate();
    holdTimer = window.setTimeout(() => setPhase("held"), 180);
  }
  function aim(event: Pick<PointerEvent, "clientX" | "clientY">) {
    const rect = stage.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left - rect.width / 2) / (rect.width / 2), -1, 1);
    const y = clamp((event.clientY - rect.top - rect.height / 2) / (rect.height / 2), -1, 1);
    target.rx = -y * 16;
    target.ry = x * 22;
    target.x = x * 4;
    target.y = y * 4;
    if (pointers.size) {
      const points = [...pointers.values()];
      // Keep the larger pull inside the stage, including on narrow screens.
      const pullX = Math.min(84, Math.max(20, (rect.width - button.offsetWidth) / 2 - 12));
      const pullY = Math.min(64, Math.max(24, (rect.height - button.offsetHeight) / 2 - 12));
      target.x += clamp(
        (points.reduce((sum, point) => sum + point.x - point.startX, 0) / points.length) * 0.65,
        -pullX,
        pullX,
      );
      target.y += clamp(
        (points.reduce((sum, point) => sum + point.y - point.startY, 0) / points.length) * 0.65,
        -pullY,
        pullY,
      );
    }
    animate();
  }
  function release(cancelled = false) {
    activeKey = null;
    window.clearTimeout(holdTimer);
    window.clearTimeout(pulseTimer);
    target.press = 0;
    target.pop = 0;
    velocity.press = cancelled || phase === "idle" ? 0 : -0.3;
    setPhase("idle");
    animate();
  }
  function reset(cancelled = true) {
    clearResponse();
    const captured = [...pointers.keys()];
    pointers.clear();
    for (const id of captured) if (button.hasPointerCapture(id)) button.releasePointerCapture(id);
    release(cancelled);
    for (const key of keys) target[key] = 0;
    animate();
  }
  function clearResponse() {
    responseStarted = null;
    current.response = 0;
    current.responseProgress = 0;
    delete stage.dataset.response;
  }
  function respond(state: ResponseState, milliseconds = 0) {
    current.responseColor =
      state === "error" ? [1, 0.49, 0.47] : state === "slow" ? [0.64, 0.54, 1] : [0.38, 0.84, 0.8];
    stage.dataset.response = state;
    responseDuration = clamp(300 + milliseconds * 0.4, 320, 800);
    current.responseProgress = reducedMotion.matches ? 0.5 : 0;
    // With reduced motion, keep a quiet static tint until the next interaction.
    current.response = reducedMotion.matches ? 0.22 : 1;
    responseStarted = reducedMotion.matches ? null : performance.now();
    paint();
    animate();
  }
  function aimPointers() {
    if (!pointers.size) return;
    const points = [...pointers.values()];
    aim({
      clientX: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      clientY: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    });
  }
  function burst() {
    if (reducedMotion.matches) return;
    current.flash = 1;
    current.pop = Math.max(current.pop, 0.045);
    velocity.pop = 0.035;
    paint();
    animate();
    // Keep rapid clicks bounded, and keep particles inside the stage so they
    // cannot introduce horizontal scrolling on a phone.
    while (effects.childElementCount > 32) effects.firstElementChild?.remove();
    const ring = document.createElement("span");
    ring.className = "click-ring";
    effects.append(ring);
    ring
      .animate(
        [
          { opacity: 0.7, transform: "translate(-50%, -50%) scale(.65)" },
          { opacity: 0, transform: "translate(-50%, -50%) scale(1.45)" },
        ],
        { duration: 360, easing: "cubic-bezier(.15,.7,.3,1)" },
      )
      .finished.then(
        () => ring.remove(),
        () => ring.remove(),
      );
    for (let i = 0; i < 7; i++) {
      const particle = document.createElement("span");
      particle.className = "click-particle";
      const angle = (i / 7) * Math.PI * 2 - Math.PI / 2,
        scale = button.offsetWidth / 260;
      const x = Math.cos(angle) * (115 + (i % 3) * 4) * scale,
        y = Math.sin(angle) * 66 * scale;
      particle.style.setProperty(
        "--particle-color",
        ["var(--gold)", "var(--teal)", "var(--violet)"][i % 3]!,
      );
      effects.append(particle);
      particle
        .animate(
          [
            { opacity: 0, transform: `translate(${x * 0.95}px, ${y * 0.95}px) scale(.3)` },
            { opacity: 1, offset: 0.16 },
            {
              opacity: 0,
              transform: `translate(${x * 1.22}px, ${y * 1.28 - 16}px) rotate(${i * 45}deg) scale(.4)`,
            },
          ],
          { duration: 420 + i * 15, easing: "cubic-bezier(.15,.65,.4,1)" },
        )
        .finished.then(
          () => particle.remove(),
          () => particle.remove(),
        );
    }
  }
  function activateRelease(event?: Pick<PointerEvent, "clientX" | "clientY">) {
    activatingRelease = true;
    try {
      // Preserve the releasing pointer's coordinates, even for non-primary
      // fingers. One controlled activation per release; native clicks are suppressed.
      if (event)
        button.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            clientX: event.clientX,
            clientY: event.clientY,
            detail: 1,
          }),
        );
      else button.click();
    } finally {
      activatingRelease = false;
    }
  }
  stage.addEventListener("pointermove", (event) => {
    if (button.disabled) return;
    const point = pointers.get(event.pointerId);
    if (point) {
      point.x = event.clientX;
      point.y = event.clientY;
      aimPointers();
    } else if (!pointers.size && activeKey === null && event.pointerType === "mouse") aim(event);
  });
  stage.addEventListener("pointerleave", () => {
    if (!pointers.size && activeKey === null) reset(false);
  });
  button.addEventListener("pointerdown", (event) => {
    if (
      button.disabled ||
      event.button !== 0 ||
      activeKey !== null ||
      pointers.has(event.pointerId)
    )
      return;
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    button.focus({ preventScroll: true });
    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
    });
    if (pointers.size === 1) begin();
    button.setPointerCapture(event.pointerId);
    aimPointers();
  });
  function endPointer(event: PointerEvent, cancelled = false) {
    if (!pointers.has(event.pointerId)) return;
    const rect = button.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    pointers.delete(event.pointerId);
    if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
    if (!pointers.size) release(cancelled || !inside);
    else aimPointers();
    if (!cancelled && inside && !button.disabled) activateRelease(event);
    if (!pointers.size && !cancelled && event.pointerType === "mouse") aim(event);
    else if (!pointers.size) {
      for (const key of ["x", "y", "rx", "ry"] as const) target[key] = 0;
      animate();
    }
  }
  button.addEventListener("pointerup", (event) => endPointer(event));
  button.addEventListener("pointercancel", (event) => endPointer(event, true));
  button.addEventListener("lostpointercapture", (event) => endPointer(event, true));
  button.addEventListener("dragstart", (event) => event.preventDefault());
  button.addEventListener("contextmenu", (event) => event.preventDefault());
  button.addEventListener("keydown", (event) => {
    if (button.disabled || (event.key !== " " && event.key !== "Enter")) return;
    event.preventDefault();
    if (event.repeat || activeKey !== null || pointers.size) return;
    window.getSelection()?.removeAllRanges();
    activeKey = event.key;
    begin();
  });
  button.addEventListener("keyup", (event) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (event.key !== activeKey) return;
    release();
    if (!button.disabled) activateRelease();
  });
  button.addEventListener("blur", () => {
    if (activeKey !== null) reset();
  });
  button.addEventListener("click", (event) => {
    if (!activatingRelease && (event.detail > 0 || event.pointerType)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (button.disabled) return;
    if (event.detail === 0 && !activatingRelease) {
      begin();
      pulseTimer = window.setTimeout(() => release(), 80);
    }
    burst();
  });
  new MutationObserver(() => {
    if (button.disabled) reset();
  }).observe(button, { attributes: true, attributeFilter: ["disabled"] });
  reducedMotion.addEventListener("change", () => {
    reset();
    if (reducedMotion.matches) {
      for (const animation of effects.getAnimations({ subtree: true })) animation.cancel();
      effects.replaceChildren();
    }
  });
  window.addEventListener("blur", () => reset());
  window.addEventListener("resize", () => reset());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) reset();
  });

  // The CSS button is usable immediately. Compile graphics only for a visible
  // stage, after its first paint; hidden login/game buttons do no startup work.
  new ResizeObserver(() => {
    if (!renderer && !setupFrame && stage.clientWidth && stage.clientHeight) {
      setupFrame = requestAnimationFrame(() => {
        setupFrame = 0;
        if (!stage.clientWidth || !stage.clientHeight) return;
        renderer = createButtonRenderer(stage, button);
        paint();
      });
    } else paint();
  }).observe(stage);
  tactileButtons.set(button, { reset, respond });
}

export { tactileButtons };
