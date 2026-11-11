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

// The wall plug stays fixed. The other end attaches to the rear of the solid,
// using the same camera as its hit surface, including tilt and press depth.
export function projectButtonPower(state: ButtonState, buttonWidth: number) {
  const pose = projectButtonPose(state, buttonWidth);
  const { scale, recession, lift, cx, sx, cy, sy } = pose;
  const x = -35 * scale,
    y = 10 * scale,
    z = -16 - recession;
  const factor = 850 / (850 - (-cx * sy * x + sx * y + cx * cy * z + lift));
  const endX = (cy * x + sy * z + pose.x) * factor;
  const endY = (sx * sy * x + cx * y - sx * cy * z + pose.y) * factor;
  // Tuck the entire outlet and relaxed cable beneath the resting face. Only
  // the button moves: dragging reveals the fixed outlet without a visibility toggle.
  const outletX = 0,
    outletY = -12;
  // The cable exits the front-face grommet, above the plug body in SVG order.
  const startY = outletY + 12;
  const dx = endX - outletX,
    dy = endY - startY;
  const distance = Math.hypot(dx, dy);
  const length = Math.max(90, buttonWidth * 0.42);
  // Slack vanishes smoothly at the cable's natural length. Further pulling
  // extends the taut cable and narrows its jacket like stretched rubber.
  const sag = buttonWidth * 0.1 * Math.max(0, 1 - (distance / length) ** 2);
  const thickness = Math.max(0.55, 1 / Math.sqrt(Math.max(1, distance / length)));
  return {
    outletX,
    outletY,
    cord: `M ${outletX} ${startY} C ${outletX + dx / 3} ${startY + dy / 3 + sag}, ${endX - dx / 3} ${endY - dy / 3 + sag}, ${endX} ${endY}`,
    endX,
    endY,
    sag,
    thickness,
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
  const charge = state.reducedMotion
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
    light: state.reducedMotion
      ? Math.min(0.3, state.press * 0.3 + state.response * 0.25)
      : Math.min(1, Math.max(charge, state.flash * 0.8, state.response * 0.7)),
    charge,
    sheen: state.reducedMotion
      ? 1.35
      : 0.35 + Math.sin((state.labelPhase ?? 0) * 8.8) * 0.5 + (1 - charge),
  };
}
