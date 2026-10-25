import { isRecord, message } from "./dom.js";

export class RequestError extends Error {
  status = 0;
  uncertain = false;
  retryAfter: string | null = null;
  code: string | undefined;
}

export function requestError(error: unknown): RequestError {
  return error instanceof RequestError ? error : new RequestError(message(error));
}

export interface RequestOptions extends RequestInit {
  timeoutMilliseconds?: number;
}

const sessionLock = "goclick.session";
const cookieMutations = new Set([
  "/api/auth/login",
  "/api/auth/signup",
  "/api/auth/logout",
  "/api/auth/renew",
  "/api/admin/backups/restore",
]);
const renewedExpiries = new Map<string, string>();
const pendingRenewals = new Set<string>();

function sessionLocks(): LockManager | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.locks;
}

export function request<T>(url: string, options?: RequestOptions, binary?: false): Promise<T>;
export function request(url: string, options: RequestOptions, binary: true): Promise<Blob>;
export async function request<T>(
  url: string,
  options: RequestOptions = {},
  binary = false,
): Promise<T | Blob> {
  const { timeoutMilliseconds = 30000, signal, ...init } = options;
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMilliseconds);
  let dispatched = false;
  try {
    const send = () => {
      dispatched = true;
      return readResponse<T>(url, { ...init, signal: controller.signal }, binary);
    };
    const locks = sessionLocks();
    // Cover the queue wait with the same deadline and cancellation. Once sent,
    // hold the lock through headers and body so login cannot overtake renewal.
    return locks && cookieMutations.has(url)
      ? await locks.request(sessionLock, { signal: controller.signal }, send)
      : await send();
  } catch (caught) {
    if (timedOut) {
      const cause = requestError(caught);
      const error = new RequestError("The server took too long to respond. Check your connection.");
      error.status = cause.status;
      error.code = cause.code;
      error.retryAfter = cause.retryAfter;
      // Preserve a known rejection even if its body stalled. Without response
      // headers, a timed-out write may have committed; never replay it here.
      error.uncertain = dispatched && (cause.status < 400 || cause.uncertain);
      throw error;
    }
    if (!dispatched) throw new RequestError("Request was cancelled before it was sent.");
    throw caught;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function renewSession(url: string, response: Response): void {
  // Without cross-tab coordination, leave the existing persistent cookie alone.
  if (cookieMutations.has(url) || !sessionLocks()) return;
  const user = response.headers?.get("X-GoClick-User-ID");
  const expires = response.headers?.get("X-GoClick-Session-Expires");
  if (!user || !expires || !/^[1-9]\d*$/.test(user) || !/^\d+$/.test(expires)) return;
  const key = `${user}:${expires}`;
  if (renewedExpiries.get(user) === expires || pendingRenewals.has(key)) return;
  pendingRenewals.add(key);
  // A stale response may schedule this after another tab has signed in. The
  // endpoint checks the expected identity against the cookie at dispatch time.
  void request("/api/auth/renew", {
    method: "POST",
    headers: { "X-GoClick-User-ID": user },
    timeoutMilliseconds: 5000,
  })
    .then(() => renewedExpiries.set(user, expires))
    .catch(() => {
      // Renewal is best effort. Never fail or replay an already accepted click.
    })
    .finally(() => pendingRenewals.delete(key));
}

async function readResponse<T>(
  url: string,
  options: RequestInit,
  binary: boolean,
): Promise<T | Blob> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: "same-origin", ...options });
  } catch {
    const error = new RequestError("Can’t reach Go Click. Check your connection and try again.");
    error.uncertain = true;
    throw error;
  }
  let data: unknown;
  try {
    if (response.ok && binary) {
      const blob = await response.blob();
      renewSession(url, response);
      return blob;
    }
    data = await response.json();
    if (!isRecord(data)) throw new TypeError("Expected a JSON object");
  } catch {
    if (response.ok) {
      const error = new RequestError("Couldn’t read the server’s response.");
      error.status = response.status;
      error.uncertain = true;
      throw error;
    }
    data = {};
  }
  if (!isRecord(data)) throw new TypeError("Expected a JSON object");
  if (!response.ok) {
    const text =
      Array.isArray(data.errors) && data.errors.every((item) => typeof item === "string")
        ? data.errors.join(". ")
        : typeof data.error === "string"
          ? data.error
          : "Request failed. Try again.";
    const error = new RequestError(text);
    error.status = response.status;
    error.code = typeof data.code === "string" ? data.code : undefined;
    error.retryAfter = response.headers.get("Retry-After");
    error.uncertain = response.status >= 500 && error.code !== "authentication_busy";
    throw error;
  }
  // Each endpoint supplies its Go response contract. Runtime object validation
  // above still rejects broken/empty success responses as uncertain outcomes.
  renewSession(url, response);
  return data as T;
}

export function jsonOptions(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// Retry-After can be delta seconds or an HTTP date. Never let malformed proxy
// headers strand play, or exceed the browser's timeout range.
export function retryAfterMilliseconds(value: string | null, now = Date.now()): number {
  if (!value?.trim()) return 5000;
  const text = value.trim();
  const delay = /^\d+$/.test(text) ? Number(text) * 1000 : Date.parse(text) - now;
  return Number.isFinite(delay) ? Math.max(1000, Math.min(86400000, delay)) : 5000;
}
