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

export function request<T>(url: string, options?: RequestInit, binary?: false): Promise<T>;
export function request(url: string, options: RequestInit, binary: true): Promise<Blob>;
export async function request<T>(
  url: string,
  options: RequestInit = {},
  binary = false,
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
