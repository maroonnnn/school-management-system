export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:5000/api";

const TOKEN_KEY = "sms.token";

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown> | null;
  constructor(status: number, message: string, body: Record<string, unknown> | null = null) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** fetch wrapper: adds JWT, parses JSON, throws ApiError with the server's Arabic message. */
export async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(0, "تعذر الاتصال بالخادم");
  }

  const body = await response.json().catch(() => null);

  if (response.status === 401 && token) onUnauthorized?.();
  if (!response.ok || body?.success === false) {
    throw new ApiError(response.status, body?.message ?? "حدث خطأ غير متوقع", body);
  }
  return body as T;
}
