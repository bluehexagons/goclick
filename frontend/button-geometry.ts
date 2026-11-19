import type { ButtonState } from "./types.js";

// State translation is in screen pixels. Cancel perspective's magnification and
// the face center's tilt offset so a pixel of drag remains a pixel on screen.
// The native hit surface and WebGL solid must use this same world transform.
export function projectButtonPose(state: ButtonState, buttonWidth: number) {
  const scale = (buttonWidth / 260) * (1 + Math.max(-0.065, Math.min(0.1, state.pop || 0)));
  const press = Math.max(-0.22, Math.min(1, state.press));
  const rx = (state.rx * Math.PI) / 180,
    ry = (state.ry * Math.PI) / 180;
  const cx = Math.cos(rx),
    sx = Math.sin(rx),
    cy = Math.cos(ry),
    sy = Math.sin(ry);
  const recession = press * 24;
  const lowest =
    -Math.abs(cx * sy) * 130 * scale -
    Math.abs(sx) * 72 * scale +
    Math.min(cx * cy * (-16 - recession), cx * cy * (18 - recession));
  const lift = Math.max(0, -34 - lowest);
  const front = 18 - recession;
  const distance = 850 - (lift + cx * cy * front);
  return {
    scale,
    recession,
    lift,
    cx,
    sx,
    cy,
    sy,
    x: (state.x * distance) / 850 - sy * front,
    y: (state.y * distance) / 850 + sx * cy * front,
    rotation: [cy, sx * sy, -cx * sy, 0, cx, sx, sy, -sx * cy, cx * cy],
  };
}

export const holdDuration = 10_000;
export const holdBeat = 2_000;

export function holdLighting(elapsed: number) {
  const charge = Math.min(1, Math.max(0, elapsed / holdDuration));
  const beat = 0.5 + 0.5 * Math.cos((2 * Math.PI * elapsed) / holdBeat);
  return charge * (0.085 + 0.018 * beat);
}

export type PlugState = "seated" | "loose" | "unplugged";
export const plugTransitionDuration = { loose: 280, unplugged: 680 };
export const powerDrainDuration = 920;

const hangingCordLength = (buttonWidth: number) => buttonWidth * 0.24 + 48;

export function createPlugSwing() {
  let angle = 0;
  let velocity = 0;
  let previousX = 0;
  const limit = 0.55;
  return {
    get angle() {
      return angle;
    },
    reset(x: number) {
      previousX = x;
      angle = velocity = 0;
    },
    step(x: number, buttonWidth: number, dt: number) {
      // As the anchor moves, the plug's mass lags behind. Gravity and damping
      // carry it through a small overshoot and bring it back under the anchor.
      angle += (previousX - x) / hangingCordLength(buttonWidth);
      previousX = x;
      velocity = (velocity - 0.023 * angle * dt) * 0.9 ** dt;
      angle += velocity * dt;
      if (Math.abs(angle) > limit) {
        angle = Math.sign(angle) * limit;
        if (angle * velocity > 0) velocity = 0;
      }
      if (Math.abs(angle) < 0.002 && Math.abs(velocity) < 0.001) angle = velocity = 0;
      return angle !== 0 || velocity !== 0;
    },
  };
}

export function powerDrainLighting(elapsed: number) {
  const remaining = Math.max(0, 1 - Math.max(0, elapsed) / powerDrainDuration);
  // Two brief dropouts give way to the slower discharge of the last light.
  const dropout = (center: number, radius: number) =>
    Math.max(0, 1 - Math.abs(elapsed - center) / radius);
  return 0.5 * remaining ** 2.2 * (1 - 0.8 * dropout(56, 30) - 0.65 * dropout(146, 38));
}

// Attach the cord to the plug's grommet and the projected rear of the solid.
export function projectButtonPower(
  state: ButtonState,
  buttonWidth: number,
  plug: PlugState = "seated",
  { progress = 1, looseBeforeDetach = 1, hangAngle = 0 } = {},
) {
  const pose = projectButtonPose(state, buttonWidth);
  const { scale, recession, lift, cx, sx, cy, sy } = pose;
  const x = -35 * scale,
    y = 10 * scale,
    z = -16 - recession;
  const factor = 850 / (850 - (-cx * sy * x + sx * y + cx * cy * z + lift));
  const endX = (cy * x + sy * z + pose.x) * factor;
  const endY = (sx * sy * x + cx * y - sx * cy * z + pose.y) * factor;
  // The outlet itself is fixed under the resting face.
  const outletX = 0;
  const outletY = -12;
  const pullDistance = Math.hypot(state.x, state.y);
  const pull = Math.max(buttonWidth * 0.52, pullDistance, 1);
  const disconnecting = plug === "unplugged";
  const travel = disconnecting ? 1 - (1 - progress) ** 3 : 0;
  let startX = outletX;
  let startY = outletY + 12;
  let plugTransform = `translate(${outletX} ${outletY})`;
  let plugEdgeTransform = "";
  if (plug !== "seated") {
    const loosening = disconnecting ? looseBeforeDetach : progress;
    const rock = 1 - (1 - loosening) ** 2 * Math.cos(Math.PI * 2 * loosening);
    // Tip around the axis perpendicular to the pull. The orthographic
    // projection foreshortens the face only along the pull direction.
    const towardX = state.x / (pullDistance || 1);
    const towardY = state.y / (pullDistance || 1);
    const tilt = (Math.PI / 5) * (pullDistance / pull) * rock * (1 - travel);
    const foreshortening = 1 - Math.cos(tilt);
    const a = 1 - foreshortening * towardX * towardX;
    const b = -foreshortening * towardX * towardY;
    const d = 1 - foreshortening * towardY * towardY;
    const depth = 8;
    const reach = depth * Math.sin(tilt);
    startX += reach * towardX;
    startY += reach * towardY;
    let rotation = "";
    if (disconnecting) {
      const length = hangingCordLength(buttonWidth);
      const hangX = endX + length * Math.sin(hangAngle);
      const hangY = endY + length * Math.cos(hangAngle);
      const tug = 32 * Math.sin(Math.PI * progress) * (1 - progress);
      startX += (hangX - startX) * travel + tug * towardX;
      startY += (hangY - startY) * travel + tug * towardY;
      const swing = 30 * Math.sin(2 * Math.PI * progress) * (1 - progress);
      // Align the plug with the cable, which is taut when it hangs freely.
      const angle = (180 - (hangAngle * 180) / Math.PI) * travel;
      rotation = `rotate(${angle + swing}) `;
    }
    plugTransform = `translate(${startX} ${startY}) ${rotation}matrix(${a} ${b} ${b} ${d} 0 0) translate(0 -12)`;
    // Counter the front's offset so the back stays over the socket while loose.
    // Both parts move together once the plug is free.
    const setback = -depth * Math.tan(tilt);
    plugEdgeTransform = `translate(${setback * towardX} ${setback * towardY})`;
  }
  const dx = endX - startX;
  const dy = endY - startY;
  const distance = Math.hypot(dx, dy);
  const length = Math.max(90, buttonWidth * 0.42);
  // Slack vanishes smoothly at the cable's natural length. Further pulling
  // extends the taut cable and narrows its jacket like stretched rubber.
  const sag = buttonWidth * 0.1 * Math.max(0, 1 - (distance / length) ** 2) * (1 - travel);
  const stretch = Math.max(0.55, 1 / Math.sqrt(Math.max(1, distance / length)));
  const thickness = stretch + (1 - stretch) * travel;
  return {
    outletX,
    outletY,
    plugTransform,
    plugEdgeTransform,
    cord: `M ${startX} ${startY} C ${startX + dx / 3} ${startY + dy / 3 + sag}, ${endX - dx / 3} ${endY - dy / 3 + sag}, ${endX} ${endY}`,
    endX,
    endY,
    sag,
    thickness,
  };
}

// Four strong pulls over at least three sides loosen the plug. Travel back
// toward center or turn sharply to start a new pull without releasing.
export function createPlugPullTracker() {
  let previous: { x: number; y: number } | null = null;
  const directions = new Set<number>();
  let pulls = 0;
  let state: PlugState = "seated";
  return {
    endPull() {
      previous = null;
    },
    pull(x: number, y: number, width: number) {
      const distance = Math.hypot(x, y);
      if (state === "unplugged") return;
      const threshold =
        state === "seated" ? Math.max(84, width * 0.52) : Math.max(105, width * 0.66);
      if (distance < threshold * 0.55) previous = null;
      if (distance < threshold) return;
      const direction = { x: x / distance, y: y / distance };
      if (previous && previous.x * direction.x + previous.y * direction.y > 0.25) return;
      previous = direction;
      pulls++;
      if (state === "seated") {
        directions.add(Math.abs(x) >= Math.abs(y) ? (x > 0 ? 0 : 1) : y > 0 ? 2 : 3);
        if (pulls < 4 || directions.size < 3) return;
        pulls = 0;
        state = "loose";
        return state;
      }
      if (pulls === 3) {
        state = "unplugged";
        return state;
      }
      return;
    },
  };
}

// Match the native button's 850px perspective. Fit the full projected solid and
// soft shadow; the layout stage is not a painting or dragging boundary.
export function projectButtonScene(
  state: ButtonState,
  buttonWidth: number,
  stage: Pick<DOMRect, "left" | "top" | "width" | "height">,
  viewport: { width: number; height: number },
) {
  const pose = projectButtonPose(state, buttonWidth);
  const { scale, recession, lift, cx, sx, cy, sy } = pose;
  const centerX = pose.x - sy * recession,
    centerY = pose.y + sx * cy * recession;
  const centerZ = lift - cx * cy * recession,
    clearance = 42 + centerZ;
  const projection = clearance / (500 - centerZ);
  const shadow = {
    x: centerX + (centerX + 280) * projection,
    y: centerY + (centerY + 350) * projection,
    halfWidth: 126 * scale * (1 - Math.abs(sy) * 0.15),
    halfHeight: 70 * scale * (1 - Math.abs(sx) * 0.15),
    blur: 8 + clearance * 0.18,
  };
  const groundScale = 850 / 892;
  let left = (shadow.x - shadow.halfWidth - shadow.blur) * groundScale;
  let right = (shadow.x + shadow.halfWidth + shadow.blur) * groundScale;
  let top = (shadow.y - shadow.halfHeight - shadow.blur) * groundScale;
  let bottom = (shadow.y + shadow.halfHeight + shadow.blur) * groundScale;
  // Eight corners conservatively cover every bevel, including spring overshoot.
  for (const x of [-130 * scale, 130 * scale]) {
    for (const y of [-72 * scale, 72 * scale]) {
      for (const z of [-16 - recession, 18 - recession]) {
        const factor = 850 / (850 - (-cx * sy * x + sx * y + cx * cy * z + lift));
        const px = (cy * x + sy * z + pose.x) * factor;
        const py = (sx * sy * x + cx * y - sx * cy * z + pose.y) * factor;
        left = Math.min(left, px);
        right = Math.max(right, px);
        top = Math.min(top, py);
        bottom = Math.max(bottom, py);
      }
    }
  }
  const originX = stage.left + stage.width / 2,
    originY = stage.top + stage.height / 2;
  // Clip painting at the screen edge, never at an invisible stage boundary.
  const visibleLeft = Math.max(0, Math.min(viewport.width - 1, originX + left - 4));
  const visibleTop = Math.max(0, Math.min(viewport.height - 1, originY + top - 4));
  const visibleRight = Math.min(viewport.width, Math.max(visibleLeft + 1, originX + right + 4));
  const visibleBottom = Math.min(viewport.height, Math.max(visibleTop + 1, originY + bottom + 4));
  // Bucket the allocation so a one-pixel movement does not continually resize
  // the GPU framebuffer. The camera offset preserves smooth movement within it.
  const width = Math.min(viewport.width, Math.ceil((visibleRight - visibleLeft + 32) / 64) * 64);
  const height = Math.min(viewport.height, Math.ceil((visibleBottom - visibleTop + 32) / 64) * 64);
  const frame = {
    left: Math.max(0, Math.min(viewport.width - width, Math.floor((visibleLeft - 16) / 16) * 16)),
    top: Math.max(0, Math.min(viewport.height - height, Math.floor((visibleTop - 16) / 16) * 16)),
    width,
    height,
  };
  return {
    ...pose,
    shadow,
    frame,
    originX: originX - frame.left - frame.width / 2,
    originY: originY - frame.top - frame.height / 2,
  };
}

// Shared lettering pose keeps the DOM fallback and GPU atlas in step. Motion
// comes from the existing press/rebound, so repeated clicks never queue effects.
export function projectButtonLettering(state: ButtonState) {
  const powered = state.powered !== false;
  const charge =
    !powered || state.reducedMotion
      ? 0
      : Math.max(0, Math.min(1, state.labelCharge ?? state.press));
  return {
    scaleX: 1 + charge * 0.22,
    scaleY: 1 + charge * 0.22,
    shiftY: charge ? -charge * 0.01 : 0,
    ink: Math.min(
      0.55,
      state.response * 0.45 + charge * 0.25 + (state.reducedMotion ? 0 : state.flash * 0.18),
    ),
    light: !powered
      ? 0.9 * (state.drainLight ?? 0) ** 1.4
      : state.reducedMotion
        ? Math.min(0.3, state.press * 0.3 + state.response * 0.25)
        : Math.min(1, Math.max(charge, state.flash * 0.8, state.response * 0.7)),
    charge,
    sheen: state.reducedMotion
      ? 1.35
      : 0.35 + Math.sin((state.labelPhase ?? 0) * 8.8) * 0.5 + (1 - charge),
  };
}
