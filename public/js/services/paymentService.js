import {
  STRIPE_KEY, STRIPE_PRO_PRICE_ID, STRIPE_TEAM_PRICE_ID, apiFetch,
  PRO_CHECKOUT_ENABLED, apiReachable, INCLUDED_ANALYSES
} from "../config/env.js";

/**
 * paymentService.js
 * Handles Stripe Checkout sessions + subscription state via Firebase
 * Uses Stripe Embedded Elements (Payment Element) — no redirect needed
 */

// PERF-003: Firestore is lazy (config/firebase.js). Subscription reads fall back
// to "no subscription" on any failure; usage reads reject, so gate() blocks (fails closed).
import { loadFirebase } from "../config/firebase.js";

// ─── Plan config (update keys per project) ──────────────────────────────────
export const PLANS = {
  // #94 paid-only: `free` is the internal key for "no active subscription" (the
  // Stripe webhook and Firestore use it). It is NOT a plan: never shown in the
  // pricing modal, and its allowance is INCLUDED_ANALYSES (0 = paid from first use).
  free: {
    name: "No plan",
    price: 0,
    hidden: true,
    limits: { analyses: INCLUDED_ANALYSES, saves: 0 },
    features: []
  },
  pro: {
    name: "Pro",
    priceId: STRIPE_PRO_PRICE_ID || "pro",
    price: 10, // must equal the Stripe price the API sells (RIGOR_GO.sh checks 1000 USD cents/month; decision 2026-10-14)
    limits: { analyses: Infinity, saves: Infinity },
    // Honest claims: only what the tools do today.
    features: ["Unlimited use of all 7 Rigor career tools", "Full AI results", "Cancel anytime from Manage Plan"]
  },
  team: {
    name: "Team",
    priceId: STRIPE_TEAM_PRICE_ID || "",
    // Q7: no Team price exists and its features are not built: hidden until both are real.
    hidden: !STRIPE_TEAM_PRICE_ID,
    price: 30, // placeholder only: Team is hidden and has no Stripe price (flat whole dollars, no *.99)
    limits: { analyses: Infinity, saves: Infinity },
    features: ["Everything in Pro", "5 team members", "Team dashboard", "API access"]
  }
};

// ─── Stripe loader ────────────────────────────────────────────────────────────
let _stripe = null;
async function getStripe(publishableKey) {
  if (_stripe) return _stripe;
  const key = STRIPE_KEY || publishableKey;
  if (!key) throw new CheckoutUnavailableError("Checkout isn't configured yet. Nothing was charged.", "unconfigured");
  await loadScript("https://js.stripe.com/v3/");
  _stripe = Stripe(key);
  return _stripe;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ─── Subscription state ───────────────────────────────────────────────────────
// Same rule as the API (api/lib/quota.js): a paid plan only counts while the
// Stripe status is active/trialing (past_due/canceled count as no subscription).
function normalizeSub(data) {
  if (!data) return { plan: "free", status: "none" };
  const active = data.status === "active" || data.status === "trialing";
  return active ? data : { ...data, plan: "free" };
}

export async function getSubscription(userId) {
  try {
    const { db, fsM: { doc, getDoc } } = await loadFirebase();
    const snap = await getDoc(doc(db, "subscriptions", userId));
    return normalizeSub(snap.exists() ? snap.data() : null);
  } catch {
    return { plan: "free", status: "none" };
  }
}

// Returns an unsubscribe function synchronously (the listener attaches once the SDK loads).
export function onSubscriptionChange(userId, callback) {
  let cancelled = false;
  let unsub = null;
  loadFirebase().then(({ db, fsM: { doc, onSnapshot } }) => {
    if (cancelled) return;
    unsub = onSnapshot(doc(db, "subscriptions", userId), snap => {
      callback(normalizeSub(snap.exists() ? snap.data() : null));
    });
  }).catch(e => console.warn("[subscription] listener failed:", e?.message));
  return () => { cancelled = true; if (unsub) unsub(); };
}

export function isPaidPlan(plan) {
  return plan === "pro" || plan === "team";
}

export async function isPro(userId) {
  const sub = await getSubscription(userId);
  return sub.plan === "pro" || sub.plan === "team";
}

// ─── Usage (read-only) ─────────────────────────────────────────────────────────
// Usage is reserved/incremented only by the rigor API (api/lib/quota.js);
// firestore.rules deny client writes to usage/.
export async function getUsage(userId, action) {
  const month = new Date().toISOString().slice(0, 7);
  const { db, fsM: { doc, getDoc } } = await loadFirebase();
  const snap = await getDoc(doc(db, "usage", `${userId}_${month}`));
  return snap.exists() ? (snap.data()[action] || 0) : 0;
}

export async function checkLimit(userId, action, limit) {
  if (!userId) return { allowed: false, reason: "login" };
  if (limit === Infinity) return { allowed: true };
  const used = await getUsage(userId, action);
  if (used >= limit) return { allowed: false, reason: "limit", used, limit };
  return { allowed: true, used, limit };
}

// ─── Stripe Embedded Checkout (Payment Element) ───────────────────────────────
// Thrown when checkout must not open (flag off, or the API is unreachable).
export class CheckoutUnavailableError extends Error {
  constructor(message, reason) { super(message); this.name = "CheckoutUnavailableError"; this.reason = reason; }
}

export async function mountEmbeddedCheckout(containerId, priceId, userId) {
  // RIGOR-PAY-BEFORE-API: never load Stripe or create a session while Pro
  // checkout is off, or when the API that would serve the plan is unreachable.
  if (!PRO_CHECKOUT_ENABLED) {
    throw new CheckoutUnavailableError("Pro checkout isn't open yet.", "disabled");
  }
  if (!(await apiReachable())) {
    throw new CheckoutUnavailableError("Checkout is temporarily unavailable because the Rigor service can't be reached.", "unreachable");
  }
  // Get client secret (+ publishable key, Q7) from the API. apiFetch adds API_URL +
  // the Firebase ID token; the server derives the user from the token.
  const { clientSecret, publishableKey } = await apiFetch("/api/payment/create-embedded-session", { priceId });
  if (!clientSecret) throw new Error("Failed to initialize checkout");
  const stripe = await getStripe(publishableKey);

  const checkout = await stripe.initEmbeddedCheckout({ clientSecret });
  checkout.mount(`#${containerId}`);
  return checkout; // call checkout.destroy() to unmount
}

// ─── Customer portal ──────────────────────────────────────────────────────────
export async function openCustomerPortal(userId) {
  // Server derives the user from the Firebase ID token (apiFetch attaches it).
  const { url } = await apiFetch("/api/payment/portal", {});
  if (!url) throw new Error("Could not open the billing portal");
  window.location.href = url;
}

