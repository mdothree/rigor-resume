/**
 * config/env.js
 * Centralized environment configuration.
 * Reads from import.meta.env (Vite) or falls back to window.__ENV__ (runtime injection).
 * All app.js files import API_URL and STRIPE_KEY from here — never hardcoded.
 */

// NOTE: `typeof import` is a SyntaxError; import.meta is always defined inside an ES module.
const meta = (import.meta && import.meta.env) || {};
const win  = (typeof window !== "undefined" && window.__ENV__) || {};

// ─── Helper ───────────────────────────────────────────────────────────────────
function env(key, fallback = "") {
  return meta[key] || win[key] || fallback;
}

// ─── API ──────────────────────────────────────────────────────────────────────
const isLocalhost = typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

// The AI handlers live in the separate rigor-api project (projects/rigor/api),
// documented as https://api.rigor.design (.env.example, PROJECTS_MASTER.md).
// The frontends have no /api folder, so same-origin calls 404 in production.
// Localhost keeps same-origin ("") unless VITE_API_URL / window.__ENV__ overrides it.
export const API_URL = env("VITE_API_URL", isLocalhost ? "" : "https://api.rigor.design");

// Default client-side timeout for AI requests (ms)
export const API_TIMEOUT_MS = 60000;

// ─── Stripe ───────────────────────────────────────────────────────────────────
export const STRIPE_KEY = isLocalhost
  ? env("VITE_STRIPE_PUBLISHABLE_KEY_TEST", env("VITE_STRIPE_PUBLISHABLE_KEY", ""))
  : env("VITE_STRIPE_PUBLISHABLE_KEY_LIVE", env("VITE_STRIPE_PUBLISHABLE_KEY", ""));

export const STRIPE_PRO_PRICE_ID = isLocalhost
  ? env("VITE_STRIPE_PRO_PRICE_ID_TEST",  env("VITE_STRIPE_PRO_PRICE_ID", ""))
  : env("VITE_STRIPE_PRO_PRICE_ID_LIVE",  env("VITE_STRIPE_PRO_PRICE_ID", ""));

export const STRIPE_TEAM_PRICE_ID = isLocalhost
  ? env("VITE_STRIPE_TEAM_PRICE_ID_TEST", env("VITE_STRIPE_TEAM_PRICE_ID", ""))
  : env("VITE_STRIPE_TEAM_PRICE_ID_LIVE", env("VITE_STRIPE_TEAM_PRICE_ID", ""));

// ─── Feature flags ────────────────────────────────────────────────────────────
export const ENABLE_PAYMENTS   = env("VITE_ENABLE_PAYMENTS",     "true") === "true";
export const FREE_TIER_LIMIT   = parseInt(env("VITE_FREE_TIER_LIMIT", "3"), 10);

// ─── Convenience fetch wrapper (injects API_URL + auth token) ─────────────────
import { auth } from "./firebase.js";

export async function apiFetch(path, body, options = {}) {
  const { headers: extraHeaders, timeoutMs = API_TIMEOUT_MS, ...rest } = options;
  const url = API_URL ? `${API_URL}${path}` : path;
  const headers = { "Content-Type": "application/json", ...extraHeaders };

  // Attach Firebase auth token if user is logged in
  const user = auth.currentUser;
  if (user) {
    try {
      const token = await user.getIdToken();
      headers["Authorization"] = `Bearer ${token}`;
    } catch {
      // proceed without token (public endpoint)
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: rest.method || "POST",
      ...rest,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
  } catch (e) {
    const err = new Error(e?.name === "AbortError"
      ? "The request timed out. Please try again."
      : "Could not reach the server. Check your connection and try again.");
    err.status = 0;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || `Request failed (HTTP ${res.status})`);
    err.status = res.status;
    throw err;
  }
  // Returns the parsed JSON body. Callers must NOT call .json() again.
  return res.json();
}
