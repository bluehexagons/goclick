export const powerBootDuration = 350;
export const powerBootSteps = [
  { at: 0, pitch: 310, light: 0.14 },
  { at: 70, pitch: 465, light: 0.28 },
  { at: 145, pitch: 620, light: 0.52 },
];

export function powerBootLighting(elapsed: number) {
  if (elapsed < 0 || elapsed >= powerBootDuration) return 0;
  const remaining = Math.sqrt(1 - elapsed / powerBootDuration);
  let light = 0;
  for (const step of powerBootSteps) {
    const time = Math.max(0, elapsed - step.at);
    const attack = Math.min(time / 28, 1);
    light += step.light * attack * Math.exp(-Math.max(0, time - 28) / 90);
  }
  return light * remaining;
}
