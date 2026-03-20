/**
 * config/env.js
 * Centralized environment configuration.
 * Reads from import.meta.env (Vite) or falls back to window.__ENV__ (runtime injection).
 * All app.js files import API_URL and STRIPE_KEY from here — never hardcoded.
 */

const meta = (typeof import !== "undefined" && import.meta?.env) || {};
const win  = (typeof window !== "undefined" && window.__ENV__) || {};

// ─── Helper ───────────────────────────────────────────────────────────────────
function env(key, fallback = "") {
  return meta[key] || win[key] || fallback;
}

// ─── API ──────────────────────────────────────────────────────────────────────
const isLocalhost = typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

export const API_URL = env("VITE_API_URL", isLocalhost ? "" : "");
// Empty string = same-origin (Vercel serves both static + /api on same domain)
// Set VITE_API_URL only when your API lives on a different domain

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
  const url = API_URL ? `${API_URL}${path}` : path;
  const headers = { "Content-Type": "application/json", ...options.headers };

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

  const res = await fetch(url, {
    method: options.method || "POST",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...options
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}
