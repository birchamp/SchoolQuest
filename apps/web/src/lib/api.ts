/**
 * API client.
 *
 * The browser PWA authenticates by cookie. The Tauri desktop shell does not reliably
 * share the browser cookie jar, so it stores the session token and sends it as a bearer
 * header instead — hence both paths here.
 */

const TOKEN_KEY = "sq_session_token";

/** True when running inside the Tauri desktop window rather than a browser tab. */
export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** In dev the Vite proxy forwards /api; in production set VITE_API_URL to the Worker origin. */
const API_BASE = import.meta.env["VITE_API_URL"] ?? "";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private-mode browsers can refuse localStorage; the cookie still works there.
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = storedToken();
  const isFormData = init.body instanceof FormData;

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => ({}) as Record<string, unknown>);
  if (!response.ok) {
    const message =
      typeof payload["error"] === "string" ? payload["error"] : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, form: FormData) =>
    request<T>(path, { method: "POST", body: form }),
};
