const TOKEN_KEY = "ret_token";

// By default the frontend calls relative /api/* URLs: in local dev Vite's dev
// server proxy (see vite.config.ts) forwards them to the backend, and in
// production the API is served from the same domain. Only set
// VITE_API_BASE_URL if the API is deliberately hosted on a different domain.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") || "";

const PORTFOLIO_KEY = "ret_portfolio";

/**
 * Which portfolio this browser tab is working in. Kept per tab (sessionStorage) so a
 * new sign-in or a new tab asks again, and two tabs can show two different portfolios.
 */
export function getActivePortfolioId(): string | null {
  try {
    return sessionStorage.getItem(PORTFOLIO_KEY);
  } catch {
    return null;
  }
}

export function setActivePortfolioId(id: string | null) {
  try {
    if (id) sessionStorage.setItem(PORTFOLIO_KEY, id);
    else sessionStorage.removeItem(PORTFOLIO_KEY);
  } catch {
    /* storage unavailable — the default portfolio is used */
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(getActivePortfolioId() ? { "X-Portfolio-Id": getActivePortfolioId() as string } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };

  const res = await fetch(`${API_BASE_URL}/api${path}`, { ...options, headers });

  if (res.status === 204) return undefined as T;

  const isCsv = res.headers.get("content-type")?.includes("text/csv");
  if (isCsv) {
    return (await res.blob()) as unknown as T;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error || "Something went wrong. Please try again.", res.status);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, formData: FormData) => request<T>(path, { method: "POST", body: formData }),
};
