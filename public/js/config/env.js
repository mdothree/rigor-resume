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

// ─── Pro checkout gate (RIGOR-PAY-BEFORE-API) ─────────────────────────────────
// ONE switch for every Upgrade/Pro CTA (nav button, pricing CTA, paywall modal,
// usage meter, upgrade banner). While false, those show "Pro — coming soon" and
// clicking shows an inline notice: no Stripe.js load, no create-embedded-session.
// Keep false until api.rigor.design is healthy (RIGOR-API-525) and the quota +
// webhook are verified (Principal decision). To enable, change the default below
// to "true" (or set VITE_PRO_CHECKOUT_ENABLED / window.__ENV__) and redeploy.
export const PRO_CHECKOUT_ENABLED = env("VITE_PRO_CHECKOUT_ENABLED", "false") === "true";
export const PRO_COMING_SOON_LABEL = "Pro — coming soon";

/**
 * Lightweight reachability probe for the API that paymentService uses.
 * Sends OPTIONS to the checkout route: withCors (api/_middleware/cors.js) answers
 * it with 204 before auth or Stripe run, so this never creates a session.
 * A TLS/origin failure (e.g. Cloudflare 525), CORS failure, non-2xx or timeout → false.
 */
export async function apiReachable(timeoutMs = 3000) {
  const url = `${API_URL}/api/payment/create-embedded-session`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "OPTIONS", cache: "no-store", signal: controller.signal });
    return res.ok; // 204 from withCors
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Convenience fetch wrapper (injects API_URL + auth token) ─────────────────
import { auth, getAppCheckToken } from "./firebase.js";

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

  // App Check token (only when enabled in config/firebase.js; off by default).
  const appCheckToken = await getAppCheckToken();
  if (appCheckToken) headers["X-Firebase-AppCheck"] = appCheckToken;

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
