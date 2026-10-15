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
  try {
    return await readResponse<T>(url, { ...init, signal: controller.signal }, binary);
  } catch (caught) {
    if (timedOut) {
      const cause = requestError(caught);
      const error = new RequestError("The server took too long to respond. Check your connection.");
      error.status = cause.status;
      error.code = cause.code;
      error.retryAfter = cause.retryAfter;
      // Preserve a known rejection even if its body stalled. Without response
      // headers, a timed-out write may have committed; never replay it here.
      error.uncertain = cause.status < 400 || cause.uncertain;
      throw error;
    }
    throw caught;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
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
    if (response.ok && binary) return await response.blob();
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
  return data as T;
}

export function jsonOptions(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
