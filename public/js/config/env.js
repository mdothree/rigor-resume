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

// The AI handlers are served by https://api.rigor.design.
// The frontends have no /api folder, so same-origin calls 404 in production.
// Localhost keeps same-origin ("") unless VITE_API_URL / window.__ENV__ overrides it.
export const API_URL = env("VITE_API_URL", isLocalhost ? "" : "https://api.rigor.design");

// Default client-side timeout for AI requests (ms)
export const API_TIMEOUT_MS = 60000;

// ─── Stripe ───────────────────────────────────────────────────────────────────
export const STRIPE_KEY = isLocalhost
  ? env("VITE_STRIPE_PUBLISHABLE_KEY_TEST", env("VITE_STRIPE_PUBLISHABLE_KEY", ""))
  : env("VITE_STRIPE_PUBLISHABLE_KEY_LIVE", env("VITE_STRIPE_PUBLISHABLE_KEY", ""));

// Q7: the API resolves the alias "pro" to its configured Stripe price, so these
// static pages never carry a price id; the publishable key comes back from the API too.
export const STRIPE_PRO_PRICE_ID = isLocalhost
  ? env("VITE_STRIPE_PRO_PRICE_ID_TEST",  env("VITE_STRIPE_PRO_PRICE_ID", "pro"))
  : env("VITE_STRIPE_PRO_PRICE_ID_LIVE",  env("VITE_STRIPE_PRO_PRICE_ID", "pro"));

export const STRIPE_TEAM_PRICE_ID = isLocalhost
  ? env("VITE_STRIPE_TEAM_PRICE_ID_TEST", env("VITE_STRIPE_TEAM_PRICE_ID", ""))
  : env("VITE_STRIPE_TEAM_PRICE_ID_LIVE", env("VITE_STRIPE_TEAM_PRICE_ID", ""));

// ─── Feature flags ────────────────────────────────────────────────────────────
export const ENABLE_PAYMENTS   = env("VITE_ENABLE_PAYMENTS",     "true") === "true";
// #94 paid-only: AI uses per month WITHOUT an active Pro/Team subscription.
// Mirrors INCLUDED_ANALYSES in the rigor API (api/lib/quota.js), which enforces it.
// 0 = paid from first use (promo codes at checkout are the early-access lever).
export const INCLUDED_ANALYSES = 0;

// ─── Pro checkout gate (RIGOR-PAY-BEFORE-API) ─────────────────────────────────
// ONE switch for every Upgrade/Pro CTA (nav button, pricing CTA, paywall modal,
// usage meter, upgrade banner). While false, those show "Pro — coming soon" and
// clicking shows an inline notice: no Stripe.js load, no create-embedded-session.
// Keep false until api.rigor.design is healthy (RIGOR-API-525) and the quota +
// webhook are verified (Principal decision). To enable, change the default below
// to "true" (or set VITE_PRO_CHECKOUT_ENABLED / window.__ENV__) and redeploy.
// Q7 (Principal: "fix it, not take it down"): ON in the q7/paid-path build, which ships
// only after api.rigor.design/health is 200 (RIGOR_GO.sh). Even when on, checkout opens
// only if the API answers (apiReachable) because the API creates the Stripe session:
// there is no way to pay while the API is down.
export const PRO_CHECKOUT_ENABLED = env("VITE_PRO_CHECKOUT_ENABLED", "true") === "true";
export const PRO_COMING_SOON_LABEL = "Pro — coming soon";

/**
 * apiReachable(): the truthful API signal (L-RES-03). GET ${API_URL}/health on the rigor
 * API answers 200 {ok:true} only when every required env var is set, the Stripe key modes
 * match and Firebase Admin initializes; otherwise 503 {ok:false, checks}. Checkout opens
 * only on ok === true. A network/TLS failure (e.g. Cloudflare 525), CORS failure, non-2xx,
 * non-JSON body, ok !== true or timeout → false, so checkout fails closed. It needs the API
 * build whose /health sends CORS for the rigor.design origins (rigor-api q7/paid-path);
 * against an older API it stays false. This site's own deployment stamp is /health.json
 * (static, built by scripts/health-stamp.mjs); it does not check the API.
 */
export async function apiReachable(timeoutMs = 3000) {
  const url = `${API_URL}/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", cache: "no-store", credentials: "omit", signal: controller.signal });
    if (!res.ok) return false;
    const body = await res.json().catch(() => null);
    return !!(body && body.ok === true);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Convenience fetch wrapper (injects API_URL + auth token) ─────────────────
import { loadFirebase, getAppCheckToken } from "./firebase.js";

export async function apiFetch(path, body, options = {}) {
  const { headers: extraHeaders, timeoutMs = API_TIMEOUT_MS, ...rest } = options;
  const url = API_URL ? `${API_URL}${path}` : path;
  const headers = { "Content-Type": "application/json", ...extraHeaders };

  // Attach Firebase auth token if user is logged in (SDK is lazy: PERF-003;
  // if it can't load there is no signed-in user to attach).
  const fb = await loadFirebase().catch(() => null);
  const user = fb?.auth.currentUser;
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
    // #94: 402 {error:"subscription_required", checkout:true} = no active Pro plan.
    const subscriptionRequired = res.status === 402 && (data.checkout === true || data.error === "subscription_required");
    const err = new Error(subscriptionRequired
      ? (data.message || "Rigor Pro is required to use this tool.")
      : (data.error || `Request failed (HTTP ${res.status})`));
    err.status = res.status;
    if (subscriptionRequired) {
      err.code = "subscription_required";
      err.checkout = true;
      // paywallUI.js listens for this and opens the pricing modal.
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("rigor:subscription-required"));
    }
    throw err;
  }
  // Returns the parsed JSON body. Callers must NOT call .json() again.
  return res.json();
}
