import { motionPreference } from "./preferences.js";

// Distances and lifetimes stay short so successive clicks read as separate impacts.
type Palette = readonly [string, ...string[]];

interface Burst {
  count: number;
  reach: number;
  lifetime: number;
  colors: Palette;
  style: "spark" | "dust" | "chip";
  fall?: number;
  ring?: boolean;
}

const gold = ["#fff0b0", "#ffca64", "#ec9560"] as const;
const mint = ["#d5fff1", "#7ee9c0", "#43b998"] as const;
const violet = ["#f4e4ff", "#d4a7ff", "#a88aee"] as const;
const steel = ["#d1c5ad", "#9d9489", "#817f8b"] as const;
const bursts = {
  press: { count: 5, reach: 19, lifetime: 190, colors: gold, style: "spark" },
  release: { count: 9, reach: 48, lifetime: 350, colors: gold, style: "spark", fall: 13 },
  heldRelease: { count: 7, reach: 34, lifetime: 440, colors: gold, style: "chip", fall: 22 },
  rebound: { count: 10, reach: 63, lifetime: 370, colors: gold, style: "spark" },
  unpowered: { count: 5, reach: 24, lifetime: 350, colors: steel, style: "dust", fall: 17 },
  hold: { count: 5, reach: 20, lifetime: 390, colors: mint, style: "chip" },
  thought: { count: 5, reach: 32, lifetime: 430, colors: violet, style: "chip" },
  thoughtReady: { count: 8, reach: 39, lifetime: 510, colors: violet, style: "chip", ring: true },
  fast: { count: 5, reach: 32, lifetime: 260, colors: mint, style: "spark" },
  saved: { count: 5, reach: 33, lifetime: 370, colors: ["#d3edff", "#74bfff"], style: "chip" },
  slow: { count: 6, reach: 36, lifetime: 530, colors: violet, style: "chip", ring: true },
  error: {
    count: 6,
    reach: 33,
    lifetime: 400,
    colors: ["#ffba9f", "#fc797b"],
    style: "chip",
    fall: 31,
  },
  limited: {
    count: 3,
    reach: 21,
    lifetime: 310,
    colors: ["#ffbf80", "#e5975d"],
    style: "chip",
    fall: 13,
    ring: true,
  },
  boot: { count: 11, reach: 47, lifetime: 460, colors: mint, style: "spark" },
  drain: {
    count: 7,
    reach: 22,
    lifetime: 480,
    colors: ["#f9bb82", "#b96d52"],
    style: "dust",
    fall: 37,
  },
  loose: { count: 5, reach: 33, lifetime: 290, colors: gold, style: "spark" },
  unplug: { count: 10, reach: 52, lifetime: 420, colors: gold, style: "spark", fall: 24 },
  dock: { count: 4, reach: 19, lifetime: 330, colors: mint, style: "chip", ring: true },
  reconnect: { count: 8, reach: 38, lifetime: 340, colors: mint, style: "spark", ring: true },
  slack: { count: 5, reach: 21, lifetime: 400, colors: steel, style: "dust", fall: 26 },
  tension: { count: 5, reach: 26, lifetime: 260, colors: steel, style: "chip" },
} satisfies Record<string, Burst>;

export type ParticleEvent = keyof typeof bursts;

interface Point {
  x: number;
  y: number;
}

interface Source extends Point {
  radiusX?: number;
  radiusY?: number;
  direction?: number;
}

const maxParticles = 64;

export function createButtonParticles(stage: HTMLElement) {
  const layer = document.createElement("div");
  layer.className = "button-effects";
  layer.setAttribute("aria-hidden", "true");
  stage.append(layer);
  const active = new Map<HTMLElement, Animation>();

  function remove(node: HTMLElement) {
    const animation = active.get(node);
    if (!animation) return;
    active.delete(node);
    animation.cancel();
    node.remove();
  }

  function spawn(
    event: ParticleEvent,
    style: Burst["style"] | "ring",
    color: string,
    from: Point,
    size: number,
    frames: Keyframe[],
    lifetime: number,
  ) {
    const node = document.createElement("span");
    node.className = "button-particle";
    node.dataset.event = event;
    node.dataset.shape = style;
    node.style.setProperty("--particle-color", color);
    node.style.setProperty("--particle-size", `${size}px`);
    node.style.setProperty("left", `calc(50% + ${from.x}px)`);
    node.style.setProperty("top", `calc(50% + ${from.y}px)`);
    layer.append(node);
    const animation = node.animate(frames, { duration: lifetime });
    active.set(node, animation);
    const finish = () => remove(node);
    animation.finished.then(finish, finish);
  }

  function emit(event: ParticleEvent, { x, y, radiusX = 0, radiusY = 0, direction }: Source) {
    if (motionPreference.matches || document.hidden || !stage.clientWidth || !stage.clientHeight)
      return;
    const { count, reach, lifetime, colors, style, ring, fall = 0 }: Burst = bursts[event];
    const limit = maxParticles - count - Number(Boolean(ring));
    while (active.size > limit) {
      const oldest = active.keys().next().value;
      if (!oldest) break;
      remove(oldest);
    }
    if (ring) {
      spawn(
        event,
        "ring",
        colors[0],
        { x, y },
        18,
        [
          { opacity: 0.55, transform: "scale(.45)", easing: "cubic-bezier(.12,.6,.35,1)" },
          { opacity: 0, transform: `scale(${reach / 12})` },
        ],
        lifetime * 0.84,
      );
    }
    const spread = direction === undefined ? Math.PI * 2 : Math.PI * 0.8;
    const start = direction === undefined ? Math.random() * spread : direction - spread / 2;
    for (let i = 0; i < count; i++) {
      const angle = start + (spread * (i + 0.2 + Math.random() * 0.6)) / count;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const distance = reach * (0.55 + Math.random() * 0.55);
      const travelX = dx * distance;
      const travelY = dy * distance;
      const rotation = (angle * 180) / Math.PI;
      const shape = style === "spark" && i % 3 === 0 ? "chip" : style;
      const turn = shape === "chip" ? (Math.random() - 0.5) * 150 : 0;
      const size = shape === "spark" ? 2.6 + Math.random() : 2.4 + Math.random() * 2;
      // Follow the rounded rectangle of the button's rim.
      const from = {
        x: x + Math.sign(dx) * Math.cbrt(Math.abs(dx)) * radiusX,
        y: y + Math.sign(dy) * Math.cbrt(Math.abs(dy)) * radiusY,
      };
      spawn(
        event,
        shape,
        colors[i % colors.length] ?? colors[0],
        from,
        size,
        [
          {
            opacity: shape === "dust" ? 0.62 : 0.95,
            transform: `rotate(${rotation}deg)`,
            easing: "cubic-bezier(.18,.63,.46,1)",
          },
          {
            offset: 0.45,
            opacity: 0.62,
            transform: `translate(${travelX * 0.68}px, ${travelY * 0.68 + fall * 0.2}px) rotate(${rotation + turn * 0.5}deg) scale(.8)`,
          },
          {
            opacity: 0,
            transform: `translate(${travelX}px, ${travelY + fall}px) rotate(${rotation + turn}deg) scale(${shape === "dust" ? 1.35 : 0.32})`,
          },
        ],
        lifetime * (0.82 + Math.random() * 0.32),
      );
    }
  }

  return {
    emit,
    clear() {
      for (const node of active.keys()) remove(node);
    },
  };
}
