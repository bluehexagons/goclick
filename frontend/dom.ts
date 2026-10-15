// Required markup is a programming invariant. Fail with a useful selector
// instead of spreading unchecked nullable elements through event handlers.
export function required<T extends HTMLElement = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Required element missing: ${selector}`);
  return element;
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
