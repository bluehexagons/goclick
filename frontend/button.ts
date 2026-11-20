import { motionPreference } from "./preferences.js";
import {
  createPlugPullTracker,
  createPlugSwing,
  holdBeat,
  holdDuration,
  holdLighting,
  outletSockets,
  plugTransitionDuration,
  powerDrainDuration,
  powerDrainLighting,
  projectButtonLettering,
  projectButtonPose,
  projectButtonPower,
} from "./button-geometry.js";
import type { OutletSocket, PlugState } from "./button-geometry.js";
import { createButtonRenderer } from "./button-3d.js";
import { required } from "./dom.js";
import { clickSound } from "./sound.js";
import { hasTrick, rememberButtonActivation, unlockTrick } from "./button-tricks.js";
import type { ButtonActivation } from "./button-tricks.js";
import { message } from "./i18n.js";
import type { ButtonController, ButtonState, ResponseState, Renderer } from "./types.js";

// Press and release depth are immediate; dragging and rebound use springs.
// Holds never auto-score; cancelled/outside releases never activate the button.
const QUICK_TAP_MS = 90;
const TAP_RELEASE_MS = 70;
const HOLD_RELEASE_MS = 110;
const PLUG_DWELL_MS = 3000;
const PLUG_SEAT_MS = 200;
const CORD_MODE_MS = 260;
const tactileButtons = new Map<HTMLButtonElement, ButtonController>();
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-tactile-button]")) {
  const maybeStage = button.closest<HTMLElement>(".button-stage");
  if (!maybeStage) throw new Error("Tactile button needs a stage");
  const stage: HTMLElement = maybeStage;
  const rig = required(".button-rig", stage);
  const power = stage.querySelector<SVGSVGElement>(".button-power");
  const cords = power?.querySelectorAll<SVGPathElement>(".power-cord");
  const outlet = power?.querySelector<SVGGElement>(".power-outlet");
  const plug = power?.querySelector<SVGGElement>(".power-plug");
  const plugControl = stage.querySelector<HTMLButtonElement>(".plug-control");
  const outletControl = stage.querySelector<HTMLButtonElement>(".outlet-control");
  const plugEdge = stage.querySelector<SVGRectElement>(".plug-edge");
  const gameButton = button.id === "click-button";
  const plugPulls = createPlugPullTracker();
  const plugSwing = createPlugSwing();
  let plugState: PlugState = "seated";
  let cordSlack = false;
  let slackChange: { from: number; startedAt: number } | null = null;
  let plugStartedAt: number | null = null;
  let looseBeforeDetach = 1;
  let outletTripped = false;
  let drainStartedAt: number | null = null;
  let outletTouch: { id: number; x: number; y: number } | null = null;
  let socket: OutletSocket = "bottom";
  let docking: { socket: OutletSocket; x: number; y: number; angle: number } | null = null;
  let dockWhileParked = false;
  let dockTimer = 0;
  let plugTap: { id: number; x: number; y: number } | null = null;
  let seating: { x: number; y: number; angle: number; startedAt: number } | null = null;
  const readout = gameButton ? document.querySelector<HTMLElement>(".game-readout") : null;
  let readoutOffset = 0;
  let readoutOpacity = 1;
  const effects = document.createElement("div");
  effects.className = "button-effects";
  effects.setAttribute("aria-hidden", "true");
  stage.append(effects);
  const reducedMotion = motionPreference;
  const keys = ["x", "y", "rx", "ry", "pop"] as const;
  const current: ButtonState = {
    x: 0,
    y: 0,
    rx: 0,
    ry: 0,
    press: 0,
    labelCharge: 0,
    labelPhase: 0,
    copper: 0,
    pop: 0,
    flash: 0,
    response: 0,
    responseProgress: 0,
    responseColor: [0.35, 0.67, 0.94],
  };
  const target = { ...current },
    velocity = { ...current };
  let renderer: Renderer | null = null;
  let setupFrame = 0,
    frame = 0,
    lastFrame = 0;
  const pointers = new Map<
    number,
    {
      x: number;
      y: number;
      startX: number;
      startY: number;
      vx: number;
      vy: number;
      movedAt: number;
      wentAway: boolean;
    }
  >();
  let dragFromX = 0,
    dragFromY = 0;
  let dragOriginX = 0,
    dragOriginY = 0;
  let coastUntil = 0;
  let coastFromX = 0,
    coastFromY = 0;
  let activeKey: string | null = null;
  let activatingRelease: ButtonActivation | null = null;
  let pressedAt = 0,
    releasedAt: number | null = null,
    releaseCopper = 0,
    releaseDuration = TAP_RELEASE_MS,
    holdTimer = 0,
    achievementTimer = 0,
    beatTimer = 0,
    phase: "idle" | "pressed" | "held" = "idle";
  let responseStarted: number | null = null;
  let responseDuration = 500;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  function plugProgress(time: number) {
    if (plugState === "seated" || plugStartedAt === null) return 1;
    return clamp((time - plugStartedAt) / plugTransitionDuration[plugState], 0, 1);
  }

  function buttonStaysPut() {
    return plugState === "unplugged" || cordSlack;
  }

  function cordSlackAmount(time: number) {
    const destination = cordSlack ? 1 : 0;
    if (!slackChange) return destination;
    const { from, startedAt } = slackChange;
    const progress = clamp((time - startedAt) / CORD_MODE_MS, 0, 1);
    if (progress === 1) slackChange = null;
    return destination + (from - destination) * (1 - progress) ** 2;
  }

  function alignPlug(cable: ReturnType<typeof projectButtonPower> | null) {
    if (!power) return;
    let next: typeof docking = null;
    if (cable) {
      const y = cable.startY - cable.outletY - 12;
      const nearest = y < (outletSockets.top + outletSockets.bottom) / 2 ? "top" : "bottom";
      if (
        Math.abs(cable.startX - cable.outletX) <= 18 &&
        Math.abs(y - outletSockets[nearest]) <= 14
      )
        next = { socket: nearest, x: cable.startX, y: cable.startY, angle: cable.plugAngle };
    }
    const previous = docking?.socket;
    docking = next;
    if (next?.socket === previous) return;
    window.clearTimeout(dockTimer);
    plugTap = null;
    if (plugControl) {
      const key = next ? "reconnectPlug" : "cordSlack";
      const label = message(key);
      plugControl.setAttribute("data-i18n-aria-label", key);
      plugControl.setAttribute("data-i18n-title", key);
      plugControl.setAttribute("aria-label", label);
      plugControl.setAttribute("title", label);
      if (next) plugControl.removeAttribute("aria-pressed");
      else plugControl.setAttribute("aria-pressed", String(cordSlack));
    }
    if (next) {
      power.dataset.dock = next.socket;
      if (outletControl) outletControl.dataset.dock = next.socket;
      dockTimer = window.setTimeout(reconnectPlug, PLUG_DWELL_MS);
    } else {
      delete power.dataset.dock;
      if (outletControl) delete outletControl.dataset.dock;
    }
  }

  function updatePower(time: number) {
    const powered = !outletTripped && plugState !== "unplugged";
    if ((current.powered !== false) === powered) return;
    current.powered = powered;
    clickSound.setPowered(powered);
    if (powered) {
      drainStartedAt = null;
      if (phase !== "idle") {
        current.copper = 1;
        current.labelCharge = reducedMotion.matches ? 0 : 1;
        scheduleHoldBeat();
      }
    } else {
      drainStartedAt = reducedMotion.matches ? null : time;
      releasedAt = null;
      current.copper = current.flash = current.holdLight = current.labelCharge = 0;
      clearResponse();
      effects.replaceChildren();
      window.clearTimeout(beatTimer);
    }
  }

  function reconnectPlug() {
    if (
      !power ||
      !docking ||
      (!pointers.size && !dockWhileParked) ||
      button.disabled ||
      document.hidden ||
      !stage.clientWidth ||
      !stage.clientHeight
    )
      return;
    const { socket: nextSocket, x, y, angle } = docking;
    const restoreFocus = plugControl && document.activeElement === plugControl;
    alignPlug(null);
    dockWhileParked = false;
    socket = nextSocket;
    seating = reducedMotion.matches ? null : { x, y, angle, startedAt: performance.now() };
    plugState = power.dataset.plug = "seated";
    plugStartedAt = null;
    plugPulls.reseat();
    if (outletControl) outletControl.disabled = false;
    updatePower(performance.now());
    if (pointers.size) {
      // Start measuring fresh tugs here while preserving the dragged position.
      dragFromX = target.x;
      dragFromY = target.y;
      aimPointers();
    } else {
      if (!buttonStaysPut()) target.x = target.y = 0;
      animate();
    }
    if (!reducedMotion.matches) paint();
    if (restoreFocus) button.focus({ preventScroll: true });
  }

  function activatePlug() {
    if (
      plugState !== "unplugged" ||
      !plugControl ||
      plugControl.hidden ||
      button.disabled ||
      document.hidden
    )
      return;
    if (docking) {
      reconnectPlug();
      return;
    }
    const startedAt = performance.now();
    const from = cordSlackAmount(startedAt);
    cordSlack = !cordSlack;
    slackChange = reducedMotion.matches ? null : { from, startedAt };
    plugControl.setAttribute("aria-pressed", String(cordSlack));
    animate();
  }

  function paint(time = performance.now(), dt = 0) {
    if (seating && time - seating.startedAt >= PLUG_SEAT_MS) seating = null;
    const progress = plugProgress(time);
    current.drainLight = drainStartedAt === null ? 0 : powerDrainLighting(time - drainStartedAt);
    const cable =
      power && stage.clientWidth && stage.clientHeight
        ? projectButtonPower(current, button.offsetWidth, plugState, {
            progress,
            looseBeforeDetach,
            hangAngle: plugSwing.angle,
            socket,
            slack: cordSlackAmount(time),
            seating: seating
              ? {
                  ...seating,
                  remaining: (1 - clamp((time - seating.startedAt) / PLUG_SEAT_MS, 0, 1)) ** 2,
                }
              : undefined,
          })
        : null;
    if (power && cable) {
      power.style.setProperty("--cord-scale", cable.thickness.toFixed(3));
      power.setAttribute(
        "viewBox",
        `${-stage.clientWidth / 2} ${-stage.clientHeight / 2} ${stage.clientWidth} ${stage.clientHeight}`,
      );
      for (const cord of cords ?? []) cord.setAttribute("d", cable.cord);
      outlet?.setAttribute("transform", `translate(${cable.outletX} ${cable.outletY})`);
      plug?.setAttribute("transform", cable.plugTransform);
      plugEdge?.setAttribute("transform", cable.plugEdgeTransform);
    }
    if (plugControl) {
      const available = !!cable && plugState === "unplugged" && progress === 1 && !button.disabled;
      if (plugControl.hidden === available) plugControl.hidden = !available;
      if (available) {
        plugControl.style.setProperty("--plug-x", `${cable.startX}px`);
        plugControl.style.setProperty("--plug-y", `${cable.startY}px`);
      }
    }
    if (gameButton && plugState === "unplugged")
      alignPlug(
        progress === 1 && (pointers.size || dockWhileParked) && !button.disabled && !document.hidden
          ? cable
          : null,
      );
    current.reducedMotion = reducedMotion.matches;
    const lettering = projectButtonLettering(current);
    rig.style.setProperty("--label-scale-x", lettering.scaleX.toFixed(3));
    rig.style.setProperty("--label-scale-y", lettering.scaleY.toFixed(3));
    rig.style.setProperty(
      "--label-shift",
      `${(lettering.shiftY * button.offsetHeight).toFixed(3)}px`,
    );
    rig.style.setProperty("--label-ink", lettering.ink.toFixed(3));
    rig.style.setProperty("--label-charge", lettering.charge.toFixed(3));
    rig.style.setProperty("--label-light", lettering.light.toFixed(3));
    const pose = projectButtonPose(current, button.offsetWidth);
    rig.style.setProperty("--shift-x", `${pose.x.toFixed(3)}px`);
    rig.style.setProperty("--shift-y", `${pose.y.toFixed(3)}px`);
    rig.style.setProperty("--lift", `${pose.lift.toFixed(3)}px`);
    rig.style.setProperty("--tilt-x", `${current.rx.toFixed(3)}deg`);
    rig.style.setProperty("--tilt-y", `${current.ry.toFixed(3)}deg`);
    rig.style.setProperty("--press", String(current.press));
    rig.style.setProperty("--copper", current.copper.toFixed(3));
    rig.style.setProperty("--button-pop", (1 + clamp(current.pop, -0.065, 0.1)).toFixed(3));
    stage.style.setProperty(
      "--spark-color",
      `rgb(${current.responseColor.map((value) => Math.round(value * 255)).join(" ")})`,
    );
    const glow = Math.min(
      1.4,
      current.copper * 0.38 +
        current.flash * 0.65 +
        current.response * 0.8 +
        (current.holdLight ?? 0) +
        current.drainLight,
    );
    rig.style.setProperty("--glow-intensity", glow.toFixed(3));
    const glowColor = current.response > 0 ? current.responseColor : [0.22, 0.72, 0.46];
    rig.style.setProperty(
      "--glow-color",
      `rgb(${glowColor.map((value) => Math.round(value * 255)).join(" ")})`,
    );
    renderer?.draw(current);
    const readoutMoving = readout && (dt > 0 || reducedMotion.matches) && moveReadout(readout, dt);
    if (
      gameButton &&
      power &&
      cable &&
      pointers.size &&
      !hasTrick("outlet") &&
      Math.hypot(current.x, current.y) > 45
    ) {
      // Check the painted pose so a flick that never exposes the outlet
      // cannot unlock it. Sample inside the plate to ignore a sliver at its edge.
      const frame = power.getBoundingClientRect();
      const face = button.getBoundingClientRect();
      const x = frame.left + frame.width / 2 + cable.outletX;
      const y = frame.top + frame.height / 2 + cable.outletY;
      if (
        x > 0 &&
        x < window.innerWidth &&
        y > 0 &&
        y < window.innerHeight &&
        ((x - 15 > 0 && x - 15 < face.left) ||
          (x + 15 < window.innerWidth && x + 15 > face.right) ||
          (y - 42 > 0 && y - 42 < face.top) ||
          (y + 34 < window.innerHeight && y + 34 > face.bottom))
      )
        unlockTrick("outlet");
    }
    return readoutMoving;
  }
  function moveReadout(readout: HTMLElement, dt: number) {
    let offset = 0;
    if (Math.abs(current.y) > 8) {
      const face = button.getBoundingClientRect();
      const text = readout.getBoundingClientRect();
      const top = text.top - readoutOffset;
      const bottom = text.bottom - readoutOffset;
      const clearance = 22;
      if (face.bottom + clearance > top && face.top - clearance < bottom) {
        const below = Math.ceil(face.bottom + clearance - top);
        const above = Math.floor(face.top - clearance - bottom);
        offset = bottom + below <= window.innerHeight - 8 ? below : Math.max(8 - top, above);
      }
    }
    const distance = offset - readoutOffset;
    const reduce = reducedMotion.matches;
    const nextOffset =
      reduce || Math.abs(distance) < 0.5
        ? offset
        : readoutOffset + distance * (1 - Math.exp(-0.2 * dt));
    const shade = reduce ? 1 : 1 - 0.65 * clamp(Math.abs(distance) / 90, 0, 1);
    const nextOpacity =
      reduce || Math.abs(shade - readoutOpacity) < 0.005
        ? shade
        : readoutOpacity + (shade - readoutOpacity) * (1 - Math.exp(-0.42 * dt));
    if (readoutOffset !== nextOffset) {
      readoutOffset = nextOffset;
      readout.style.setProperty("--readout-offset", `${nextOffset}px`);
    }
    if (readoutOpacity !== nextOpacity) {
      readoutOpacity = nextOpacity;
      readout.style.setProperty("--readout-opacity", nextOpacity.toFixed(3));
    }
    return nextOffset !== offset || nextOpacity !== 1;
  }
  function tick(time: number) {
    const dt = lastFrame ? clamp((time - lastFrame) / (1000 / 60), 0.25, 2) : 1;
    lastFrame = time;
    let moving = false;
    for (const key of keys) {
      const coasting = time < coastUntil && (key === "x" || key === "y");
      const from = key === "x" ? coastFromX : coastFromY;
      const springTarget = coasting
        ? target[key] + (from - target[key]) * Math.max(0, (coastUntil - time) / 80)
        : target[key];
      if (pointers.size && (key === "x" || key === "y")) {
        // Follow with a short, frame-rate-independent lag. While held, never
        // carry velocity through the pointer's destination or on a reversal.
        const movement = (target[key] - current[key]) * (1 - Math.exp(-0.4 * dt));
        current[key] += movement;
        velocity[key] = movement / dt;
      } else {
        velocity[key] =
          (velocity[key] + (springTarget - current[key]) * (coasting ? 0.045 : 0.16) * dt) *
          Math.pow(coasting ? 0.88 : 0.64, dt);
        current[key] += velocity[key] * dt;
      }
      if (Math.abs(target[key] - current[key]) > 0.002 || Math.abs(velocity[key]) > 0.002)
        moving = true;
      else {
        current[key] = target[key];
        velocity[key] = 0;
      }
    }
    if (releasedAt !== null) {
      const progress = clamp((time - releasedAt) / releaseDuration, 0, 1);
      const returnAmount = Math.pow(1 - progress, 2);
      current.copper = releaseCopper * returnAmount;
      current.labelCharge = returnAmount;
      if (progress < 1) moving = true;
      else releasedAt = null;
    }
    if (current.press && !reducedMotion.matches && current.powered !== false) {
      const elapsed = time - pressedAt;
      current.labelPhase = elapsed / 1000;
      if (gameButton) current.holdLight = holdLighting(elapsed);
      moving = true;
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
    const animatingPower =
      plugProgress(time) < 1 ||
      (drainStartedAt !== null && time - drainStartedAt < powerDrainDuration);
    const swinging =
      plugState === "unplugged" &&
      !reducedMotion.matches &&
      plugSwing.step(current.x, button.offsetWidth, dt);
    const readoutMoving = paint(time, dt);
    frame =
      (moving || animatingPower || swinging || seating || slackChange || readoutMoving) &&
      !document.hidden
        ? requestAnimationFrame(tick)
        : 0;
    if (!frame) lastFrame = 0;
  }
  function animate() {
    if (reducedMotion.matches) {
      for (const key of keys) {
        // Deliberate drag follows the pointer directly in reduced motion.
        // Hover, tilt, springs, and release animation remain suppressed.
        current[key] =
          (pointers.size || buttonStaysPut()) && (key === "x" || key === "y") ? target[key] : 0;
        velocity[key] = 0;
      }
      current.flash = 0;
      current.labelCharge = 0;
      plugSwing.reset(current.x);
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
  function scheduleHoldBeat() {
    if (!gameButton || current.powered === false) return;
    const elapsed = performance.now() - pressedAt;
    let nextBeat = (Math.floor(elapsed / holdBeat) + 1) * holdBeat;
    const onBeat = () => {
      if (phase === "idle" || button.disabled || document.hidden || current.powered === false)
        return;
      const elapsed = performance.now() - pressedAt;
      if (elapsed >= nextBeat) {
        clickSound.play("hold");
        nextBeat = (Math.floor(elapsed / holdBeat) + 1) * holdBeat;
      }
      beatTimer = window.setTimeout(onBeat, Math.max(1, nextBeat - elapsed));
    };
    beatTimer = window.setTimeout(onBeat, nextBeat - elapsed);
  }
  function begin() {
    if (gameButton) clickSound.play("press");
    window.clearTimeout(holdTimer);
    clearResponse();
    coastUntil = 0;
    pressedAt = performance.now();
    releasedAt = null;
    current.press = 1;
    current.copper = current.powered === false ? 0 : 1;
    current.labelCharge = reducedMotion.matches ? 0 : current.copper;
    current.holdLight = 0;
    current.labelPhase = 0;
    target.pop = reducedMotion.matches ? 0 : -0.045;
    current.pop = target.pop;
    velocity.pop = 0;
    current.flash = 0;
    setPhase("pressed");
    if (reducedMotion.matches) {
      paint();
      animate();
    } else burst(true);
    holdTimer = window.setTimeout(() => setPhase("held"), 180);
    scheduleHoldBeat();
    if (gameButton && !hasTrick("hold")) {
      achievementTimer = window.setTimeout(() => {
        if (!button.disabled && !document.hidden && phase !== "idle") unlockTrick("hold");
      }, holdDuration);
    }
  }
  function aimHover(event: PointerEvent) {
    const rect = stage.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left - rect.width / 2) / (rect.width / 2), -1, 1);
    const y = clamp((event.clientY - rect.top - rect.height / 2) / (rect.height / 2), -1, 1);
    target.rx = -y * 16;
    target.ry = x * 22;
    target.x = x * 4;
    target.y = y * 4;
    animate();
  }
  function release(cancelled = false) {
    plugPulls.endPull();
    if (cancelled && gameButton) clickSound.cancelPending();
    activeKey = null;
    window.clearTimeout(holdTimer);
    window.clearTimeout(achievementTimer);
    window.clearTimeout(beatTimer);
    current.holdLight = 0;
    const wasPressed = phase !== "idle";
    const quick = performance.now() - pressedAt < QUICK_TAP_MS;
    current.press = 0;
    if (cancelled) current.labelCharge = 0;
    target.pop = current.pop = velocity.pop = 0;
    // Even a tap between frames gets a brief copper trace, without holding the
    // button down. A new press replaces this fade synchronously.
    releaseDuration = quick ? TAP_RELEASE_MS : HOLD_RELEASE_MS;
    releaseCopper =
      wasPressed && !cancelled && !reducedMotion.matches && current.powered !== false
        ? quick
          ? 0.72
          : 1
        : 0;
    current.copper = releaseCopper;
    releasedAt = releaseCopper ? performance.now() : null;
    current.flash = 0;
    setPhase("idle");
    paint();
    animate();
  }
  function keepParkedButtonInView() {
    const stageRect = stage.getBoundingClientRect();
    if (!stageRect.width || !stageRect.height) return false;
    // Leave the center reachable after letting go outside the window or resizing it.
    const margin = 16;
    const x = stageRect.left + stageRect.width / 2;
    const y = stageRect.top + stageRect.height / 2;
    const nextX = clamp(target.x, margin - x, window.innerWidth - margin - x);
    const nextY = clamp(target.y, margin - y, window.innerHeight - margin - y);
    if (nextX === target.x && nextY === target.y) return false;
    target.x = nextX;
    target.y = nextY;
    return true;
  }
  function reset(cancelled = true) {
    dockWhileParked = false;
    outletTouch = null;
    plugTap = null;
    clearResponse();
    const captured = [...pointers.keys()];
    pointers.clear();
    for (const id of captured) if (button.hasPointerCapture(id)) button.releasePointerCapture(id);
    release(cancelled);
    releasedAt = null;
    coastUntil = 0;
    current.copper = 0;
    // Reset also interrupts an in-progress release after the pointer leaves.
    // Its lettering must return to rest when that release clock is cancelled.
    current.labelCharge = 0;
    current.labelPhase = 0;
    if (!buttonStaysPut()) target.x = target.y = 0;
    target.rx = target.ry = 0;
    animate();
  }
  function clearResponse() {
    responseStarted = null;
    current.response = 0;
    current.responseProgress = 0;
    current.responseColor = [1, 0.78, 0.32];
    delete stage.dataset.response;
  }
  function respond(state: ResponseState, milliseconds = 0) {
    if (current.powered === false) return;
    current.responseColor =
      state === "error"
        ? [1, 0.49, 0.47]
        : state === "slow"
          ? [0.64, 0.54, 1]
          : state === "limited"
            ? [1, 0.58, 0.26]
            : state === "pending"
              ? [1, 0.78, 0.32]
              : state === "fast"
                ? [0.38, 0.8, 0.65]
                : [0.35, 0.67, 0.94];
    stage.dataset.response = state;
    responseDuration = clamp(300 + milliseconds * 0.4, 320, 800);
    current.responseProgress = reducedMotion.matches ? 0.5 : 0;
    // With reduced motion, keep a quiet static tint until the next interaction.
    current.response = state === "pending" ? 0.18 : reducedMotion.matches ? 0.22 : 1;
    responseStarted = state === "pending" || reducedMotion.matches ? null : performance.now();
    paint();
    animate();
  }
  function aimPointers(trackPull = false) {
    const points = [...pointers.values()];
    const clientX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const clientY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    if (!trackPull) {
      // A finger landing or lifting changes the average without moving the drag.
      dragOriginX = clientX - (target.x - dragFromX);
      dragOriginY = clientY - (target.y - dragFromY);
    }
    // Pointer capture keeps the drag following the gesture outside the stage.
    const pulledX = clientX - dragOriginX;
    const pulledY = clientY - dragOriginY;
    target.x = dragFromX + pulledX;
    target.y = dragFromY + pulledY;
    if (trackPull && gameButton && power && !seating) {
      const nextPlug = plugPulls.pull(pulledX, pulledY, button.offsetWidth);
      if (nextPlug) {
        const now = performance.now();
        if (nextPlug === "unplugged") {
          looseBeforeDetach = plugProgress(now);
          plugSwing.reset(current.x);
        }
        plugState = nextPlug;
        plugStartedAt = reducedMotion.matches ? null : now;
        power.dataset.plug = nextPlug;
        if (nextPlug === "loose") unlockTrick("loose-plug");
        else {
          outletTouch = null;
          if (outletControl) outletControl.disabled = true;
          updatePower(now);
        }
      }
    }
    animate();
  }
  function burst(press = false) {
    if (reducedMotion.matches) return;
    const quick = press || releaseDuration === TAP_RELEASE_MS;

    if (!press) {
      current.pop = Math.max(current.pop, quick ? 0.065 : 0.04);
      velocity.pop = quick ? 0.035 : 0.022;
    }
    if (current.powered === false) {
      animate();
      return;
    }
    current.flash = press ? 0.72 : quick ? 0.85 : 0.55;
    paint();
    animate();
    // Small round sparks survive successive presses. Recolor the recent cloud
    // from the latest acknowledgement, without stretching a halo or an ellipse.
    const count = press ? 8 : quick ? 12 : 8;
    while (effects.childElementCount > 64 - count) effects.firstElementChild?.remove();
    const width = button.offsetWidth,
      height = button.offsetHeight;
    for (let i = 0; i < count; i++) {
      const particle = document.createElement("span");
      particle.className = "click-particle";
      const side = i % 4,
        along = (Math.random() - 0.5) * 0.75;
      const nx = side === 1 ? 1 : side === 3 ? -1 : 0;
      const ny = side === 0 ? -1 : side === 2 ? 1 : 0;
      const x = current.x + (nx ? (nx * width) / 2 : along * width);
      const y = current.y + (ny ? (ny * height) / 2 : along * height);
      const drift = (press ? 12 : 22) + Math.random() * (press ? 18 : 28);
      effects.append(particle);
      particle
        .animate(
          [
            { opacity: 0.95, transform: `translate(${x}px, ${y}px) scale(${quick ? 1.3 : 1})` },
            { opacity: 0.6, offset: 0.22 },
            {
              opacity: 0,
              transform: `translate(${x + nx * drift + along * 15}px, ${y + ny * drift - (press ? 12 : 22)}px) scale(.35)`,
            },
          ],
          {
            duration: press ? 520 + Math.random() * 260 : 850 + Math.random() * 650,
            easing: "cubic-bezier(.1,.5,.3,1)",
          },
        )
        .finished.then(
          () => particle.remove(),
          () => particle.remove(),
        );
    }
  }

  function activateRelease(activation: ButtonActivation, event?: PointerEvent) {
    activatingRelease = activation;
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
      activatingRelease = null;
    }
  }
  function pressOutlet() {
    if (!outletControl || plugState === "unplugged" || document.hidden) return;
    outletTripped = !outletTripped;
    outletControl.setAttribute("aria-pressed", String(outletTripped));
    outletControl.dataset.press = outletTripped ? "test" : "reset";
    updatePower(performance.now());
    if (!reducedMotion.matches) paint();
    animate();
  }
  if (outletControl) {
    outletControl.addEventListener("click", (event) => {
      if (event.pointerType !== "touch" || event.isPrimary || event.detail === 0) pressOutlet();
    });
    // Browsers can omit click for a second finger while the first holds the button.
    outletControl.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch" || event.isPrimary || event.button !== 0 || outletTouch)
        return;
      event.preventDefault();
      outletControl.setPointerCapture(event.pointerId);
      outletTouch = { id: event.pointerId, x: event.clientX, y: event.clientY };
    });
    outletControl.addEventListener("pointermove", (event) => {
      if (
        event.pointerId === outletTouch?.id &&
        Math.hypot(event.clientX - outletTouch.x, event.clientY - outletTouch.y) > 12
      )
        outletTouch = null;
    });
    outletControl.addEventListener("pointerup", (event) => {
      if (event.pointerId !== outletTouch?.id) return;
      const tapped = Math.hypot(event.clientX - outletTouch.x, event.clientY - outletTouch.y) <= 12;
      outletTouch = null;
      if (tapped) pressOutlet();
    });
    const cancelOutletTouch = (event: PointerEvent) => {
      if (event.pointerId === outletTouch?.id) outletTouch = null;
    };
    outletControl.addEventListener("pointercancel", cancelOutletTouch);
    outletControl.addEventListener("lostpointercapture", cancelOutletTouch);
  }
  if (plugControl) {
    plugControl.addEventListener("click", (event) => {
      if (event.detail === 0) activatePlug();
    });
    plugControl.addEventListener("pointerdown", (event) => {
      if (plugControl.hidden || plugTap || event.button !== 0 || pointers.has(event.pointerId))
        return;
      event.preventDefault();
      plugControl.setPointerCapture(event.pointerId);
      plugTap = { id: event.pointerId, x: event.clientX, y: event.clientY };
    });
    function movedOffPlug(event: PointerEvent) {
      return !!plugTap && Math.hypot(event.clientX - plugTap.x, event.clientY - plugTap.y) > 12;
    }
    plugControl.addEventListener("pointermove", (event) => {
      if (plugTap?.id === event.pointerId && movedOffPlug(event)) plugTap = null;
    });
    plugControl.addEventListener("pointerup", (event) => {
      if (plugTap?.id !== event.pointerId) return;
      const tapped = !movedOffPlug(event);
      plugTap = null;
      if (tapped) activatePlug();
    });
    const cancelTap = (event: PointerEvent) => {
      if (plugTap?.id === event.pointerId) plugTap = null;
    };
    plugControl.addEventListener("pointercancel", cancelTap);
    plugControl.addEventListener("lostpointercapture", cancelTap);
  }
  stage.addEventListener("pointermove", (event) => {
    if (button.disabled) return;
    const point = pointers.get(event.pointerId);
    if (point) {
      const now = performance.now(),
        elapsed = now - point.movedAt;
      const dt = clamp(elapsed, 8, 50);
      point.vx = elapsed > 80 ? 0 : point.vx * 0.35 + ((event.clientX - point.x) / dt) * 0.65;
      point.vy = elapsed > 80 ? 0 : point.vy * 0.35 + ((event.clientY - point.y) / dt) * 0.65;
      point.movedAt = now;
      point.x = event.clientX;
      point.y = event.clientY;
      if (
        gameButton &&
        !point.wentAway &&
        Math.hypot(point.x - point.startX, point.y - point.startY) >=
          Math.max(45, button.offsetWidth * 0.35)
      )
        point.wentAway = true;
      aimPointers(true);
    } else if (
      !pointers.size &&
      !buttonStaysPut() &&
      activeKey === null &&
      event.pointerType === "mouse"
    )
      aimHover(event);
  });
  stage.addEventListener("pointerleave", () => {
    if (
      !pointers.size &&
      !buttonStaysPut() &&
      activeKey === null &&
      performance.now() >= coastUntil
    )
      reset(false);
  });
  button.addEventListener("pointerdown", (event) => {
    if (gameButton && event.pointerType === "mouse" && event.button === 1) event.preventDefault();
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
      vx: 0,
      vy: 0,
      movedAt: performance.now(),
      wentAway: false,
    });
    if (pointers.size === 1) {
      dragFromX = target.x = current.x;
      dragFromY = target.y = current.y;
      current.rx = target.rx = velocity.rx = 0;
      current.ry = target.ry = velocity.ry = 0;
      velocity.x = velocity.y = 0;
      begin();
    } else if (gameButton) clickSound.play("press");
    button.setPointerCapture(event.pointerId);
    aimPointers();
  });
  function endPointer(event: PointerEvent, cancelled = false) {
    if (!pointers.has(event.pointerId)) return;
    const rect = button.getBoundingClientRect();
    const slop = event.pointerType === "touch" ? 24 : 12;
    const near = (dx: number, dy: number) =>
      event.clientX >= rect.left + dx - slop &&
      event.clientX <= rect.right + dx + slop &&
      event.clientY >= rect.top + dy - slop &&
      event.clientY <= rect.bottom + dy + slop;
    // The release may beat the last frame of the spring. Accept the painted
    // face and the face at the most recent drag target.
    const inViewport =
      event.clientX >= 0 &&
      event.clientX < window.innerWidth &&
      event.clientY >= 0 &&
      event.clientY < window.innerHeight;
    const inside = inViewport && (near(0, 0) || near(target.x - current.x, target.y - current.y));
    const point = pointers.get(event.pointerId)!;
    // A cancelled finger can be independent of another one still holding the
    // button. Neither cancellation nor an outside release may replay its press
    // after a delayed audio unlock.
    if ((cancelled || !inside) && pointers.size > 1 && gameButton) clickSound.cancelPending();
    pointers.delete(event.pointerId);
    if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
    if (!pointers.size) {
      if (buttonStaysPut()) {
        dockWhileParked = plugState === "unplugged" && !cancelled && inside;
        keepParkedButtonInView();
        velocity.x = velocity.y = 0;
      }
      release(cancelled || !inside);
    } else aimPointers();
    if (!cancelled && inside && !button.disabled) {
      const uTurn =
        point.wentAway &&
        Math.hypot(event.clientX - point.startX, event.clientY - point.startY) <=
          Math.max(12, button.offsetWidth * 0.05);
      activateRelease(
        { source: event.pointerType === "touch" ? "touch" : "pointer", uTurn },
        event,
      );
    }
    if (pointers.size || buttonStaysPut()) return;
    if (
      !cancelled &&
      inside &&
      !reducedMotion.matches &&
      performance.now() - point.movedAt < 70 &&
      Math.hypot(event.clientX - point.startX, event.clientY - point.startY) >= 14 &&
      Math.hypot(point.vx, point.vy) >= 0.12
    ) {
      coastUntil = performance.now() + 80;
      coastFromX = current.x;
      coastFromY = current.y;
      velocity.x = clamp(point.vx * 10, -14, 14);
      velocity.y = clamp(point.vy * 10, -14, 14);
    }
    target.x = target.y = 0;
    animate();
  }
  button.addEventListener("pointerup", (event) => endPointer(event));
  button.addEventListener("pointercancel", (event) => endPointer(event, true));
  button.addEventListener("lostpointercapture", (event) => endPointer(event, true));
  button.addEventListener("dragstart", (event) => event.preventDefault());
  button.addEventListener("contextmenu", (event) => event.preventDefault());
  button.addEventListener("auxclick", (event) => {
    if (gameButton && !button.disabled && (event.button === 1 || event.button === 2)) {
      event.preventDefault();
      unlockTrick("wrong-button");
    }
  });
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
    if (!button.disabled) {
      if (gameButton) unlockTrick("keyboard");
      activateRelease({ source: "keyboard" });
    }
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
    if (gameButton && activatingRelease) rememberButtonActivation(event, activatingRelease);
    if (event.detail === 0 && !activatingRelease) {
      begin();
      release();
    }
    if (gameButton) clickSound.play("release");
    burst();
  });
  new MutationObserver(() => {
    if (button.disabled) reset();
    else if (plugState === "unplugged") paint();
  }).observe(button, { attributes: true, attributeFilter: ["disabled"] });
  // Lettering changes also need a redraw when reduced motion has no active frame.
  new MutationObserver(() => paint()).observe(required(".button-label", button), {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["lang", "dir"],
  });
  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) {
      plugStartedAt = null;
      drainStartedAt = null;
      seating = null;
      slackChange = null;
    }
    reset();
    if (reducedMotion.matches) {
      for (const animation of effects.getAnimations({ subtree: true })) animation.cancel();
      effects.replaceChildren();
    }
  });
  window.addEventListener("blur", () => reset());
  window.addEventListener("resize", () => {
    if (buttonStaysPut()) keepParkedButtonInView();
    reset();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      plugStartedAt = null;
      drainStartedAt = null;
      seating = null;
      plugSwing.reset(current.x);
      reset();
    }
  });

  // The CSS button is usable immediately. Compile graphics only for a visible
  // stage, after its first paint; hidden login/game buttons do no startup work.
  new ResizeObserver(() => {
    if (buttonStaysPut() && !pointers.size && keepParkedButtonInView()) animate();
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
