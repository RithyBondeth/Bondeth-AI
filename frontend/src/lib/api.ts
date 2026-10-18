/**
 * Client for the Bondeth AI FastAPI backend.
 *
 * Session tokens are kept in localStorage so a reload keeps you signed in.
 * Access tokens last 15 minutes; on a 401 the client refreshes once (refresh
 * tokens are single-use, so concurrent refreshes share one request) and retries.
 */

import { getLocale } from "./i18n";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export type User = { id: string; email: string; full_name: string | null; email_verified: boolean; created_at: string };
type Session = { access: string; refresh: string; user: User };
type AuthMode = "required" | "optional" | "none";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------- Session store (works with useSyncExternalStore) ----------

const STORAGE_KEY = "bondeth.session";
const listeners = new Set<() => void>();
let session: Session | null | undefined; // undefined = not yet read from storage

function readSession(): Session | null {
  if (session === undefined) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      session = raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      session = null;
    }
  }
  return session;
}

function writeSession(next: Session | null): void {
  session = next;
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the session still works until the tab closes.
  }
  listeners.forEach((fn) => fn());
}

export const sessionStore = {
  get: (): Session | null => (typeof window === "undefined" ? null : readSession()),
  getServer: (): Session | null => null,
  subscribe(fn: () => void) {
    listeners.add(fn);
    // Stay in sync when the user signs in or out in another tab.
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        session = undefined;
        fn();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(fn);
      window.removeEventListener("storage", onStorage);
    };
  },
};

// ---------- Usage changes ----------

// Requests that spend part of the daily allowance; the usage meter refetches after each one.
const METERED = /^\/api\/v1\/(stt|tts|clone)(\/jobs)?\/?(\?|$)/;
const usageListeners = new Set<() => void>();

/** Tell the usage meter to refetch (for metered work that doesn't go through api(), e.g. dictation). */
export function notifyUsageChanged(): void {
  usageListeners.forEach((fn) => fn());
}

export function onUsageChange(fn: () => void): () => void {
  usageListeners.add(fn);
  return () => usageListeners.delete(fn);
}

// ---------- Requests ----------

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const detail = body?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      // FastAPI validation errors: [{loc: [..., "field"], msg: "..."}]
      return detail.map((d) => `${d.loc?.at(-1) ?? "input"}: ${d.msg}`).join("; ");
    }
  } catch {
    // Not JSON.
  }
  return res.statusText || `Request failed (${res.status})`;
}

let refreshing: Promise<boolean> | null = null;

function refreshTokens(): Promise<boolean> {
  refreshing ??= (async () => {
    const current = readSession();
    if (!current) return false;
    try {
      const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: current.refresh }),
      });
      if (!res.ok) {
        writeSession(null);
        return false;
      }
      const tokens = await res.json();
      writeSession({ ...current, access: tokens.access_token, refresh: tokens.refresh_token });
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api(path: string, init: RequestInit & { auth?: AuthMode } = {}): Promise<Response> {
  const { auth = "optional", ...rest } = init;

  const send = async (withToken: boolean) => {
    const headers = new Headers(rest.headers);
    // Use the explicit interface preference, including signed-out recovery requests.
    headers.set("Accept-Language", getLocale());
    const current = readSession();
    if (withToken && current) headers.set("Authorization", `Bearer ${current.access}`);
    try {
      return await fetch(`${API_URL}${path}`, { ...rest, headers });
    } catch {
      throw new ApiError(0, "Can't reach the Bondeth AI server. Is the backend running?");
    }
  };

  const useToken = auth !== "none" && readSession() !== null;
  if (auth === "required" && !useToken) throw new ApiError(401, "Please sign in first.");

  let res = await send(useToken);
  if (res.status === 401 && useToken) {
    if (await refreshTokens()) res = await send(true);
    else if (auth === "optional") res = await send(false); // session ended: carry on anonymously
  }
  if (rest.method === "POST" && METERED.test(path)) usageListeners.forEach((fn) => fn());
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  return res;
}

export type ServerEvent = { event: string; data: unknown };

/**
 * Follow a Server-Sent Events endpoint. Uses fetch rather than EventSource so the
 * Authorization header (and token refresh) work. Resolves when the server ends the stream.
 */
export async function streamEvents(path: string, onEvent: (e: ServerEvent) => void,
  init: { auth?: AuthMode; signal?: AbortSignal } = {}): Promise<void> {
  const res = await api(path, { ...init, headers: { Accept: "text/event-stream" } });
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let end;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data.push(line.slice(6));
      }
      if (data.length) onEvent({ event, data: JSON.parse(data.join("\n")) });
    }
  }
}

export async function apiJson<T>(path: string, init: RequestInit & { auth?: AuthMode } = {}): Promise<T> {
  return (await api(path, init)).json() as Promise<T>;
}

// ---------- Auth ----------

type AuthResponse = { access_token: string; refresh_token: string; user: User };

function startSession(res: AuthResponse): User {
  writeSession({ access: res.access_token, refresh: res.refresh_token, user: res.user });
  return res.user;
}

export async function login(email: string, password: string): Promise<User> {
  const body = new URLSearchParams({ username: email, password });
  return startSession(await apiJson<AuthResponse>("/api/v1/auth/login", { method: "POST", body, auth: "none" }));
}

export async function register(email: string, password: string, fullName?: string): Promise<User> {
  return startSession(
    await apiJson<AuthResponse>("/api/v1/auth/register", {
      method: "POST",
      auth: "none",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, full_name: fullName || null }),
    }),
  );
}

/** Re-read the signed-in user (e.g. after verifying the email) so every component sees the change. */
export async function refreshUser(): Promise<User | null> {
  const current = readSession();
  if (!current) return null;
  const user = await apiJson<User>("/api/v1/auth/me", { auth: "required" });
  const latest = readSession(); // the request may have refreshed the tokens
  if (latest) writeSession({ ...latest, user });
  return user;
}

/** Forget the session locally without calling the server (e.g. after deleting the account). */
export function clearSession(): void {
  writeSession(null);
}

export async function logout(): Promise<void> {
  const current = readSession();
  writeSession(null);
  if (current) {
    // Revoke the refresh token server-side; signing out locally never waits on it.
    fetch(`${API_URL}/api/v1/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: current.refresh }),
    }).catch(() => {});
  }
}
