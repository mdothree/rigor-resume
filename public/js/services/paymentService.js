import { STRIPE_KEY, STRIPE_PRO_PRICE_ID, STRIPE_TEAM_PRICE_ID, apiFetch } from "../config/env.js";

/**
 * paymentService.js
 * Handles Stripe Checkout sessions + subscription state via Firebase
 * Uses Stripe Embedded Elements (Payment Element) — no redirect needed
 */

import { auth, db } from "../config/firebase.js";
import {
  doc, getDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── Plan config (update keys per project) ──────────────────────────────────
export const PLANS = {
  free: {
    name: "Free",
    price: 0,
    limits: { analyses: 3, saves: 5 },
    features: ["3 uses per month", "Basic results", "No history"]
  },
  pro: {
    name: "Pro",
    priceId: STRIPE_PRO_PRICE_ID || "__STRIPE_PRO_PRICE_ID__",
    price: 9.99,
    limits: { analyses: Infinity, saves: Infinity },
    features: ["Unlimited uses", "Full results", "Save history", "Priority AI", "Export PDF"]
  },
  team: {
    name: "Team",
    priceId: STRIPE_TEAM_PRICE_ID || "__STRIPE_TEAM_PRICE_ID__",
    price: 29.99,
    limits: { analyses: Infinity, saves: Infinity },
    features: ["Everything in Pro", "5 team members", "Team dashboard", "API access"]
  }
};

// ─── Stripe loader ────────────────────────────────────────────────────────────
let _stripe = null;
async function getStripe() {
  if (_stripe) return _stripe;
  await loadScript("https://js.stripe.com/v3/");
  _stripe = Stripe(STRIPE_KEY || "__STRIPE_PUBLISHABLE_KEY__");
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
// Stripe status is active/trialing (past_due/canceled fall back to free limits).
function normalizeSub(data) {
  if (!data) return { plan: "free", status: "none" };
  const active = data.status === "active" || data.status === "trialing";
  return active ? data : { ...data, plan: "free" };
}

export async function getSubscription(userId) {
  try {
    const snap = await getDoc(doc(db, "subscriptions", userId));
    return normalizeSub(snap.exists() ? snap.data() : null);
  } catch {
    return { plan: "free", status: "none" };
  }
}

export function onSubscriptionChange(userId, callback) {
  return onSnapshot(doc(db, "subscriptions", userId), snap => {
    callback(normalizeSub(snap.exists() ? snap.data() : null));
  });
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
export async function mountEmbeddedCheckout(containerId, priceId, userId) {
  const stripe = await getStripe();

  // Get client secret from the API. apiFetch adds API_URL + the Firebase ID token;
  // the server derives the user from the token (the userId arg is no longer sent).
  const { clientSecret } = await apiFetch("/api/payment/create-embedded-session", { priceId });
  if (!clientSecret) throw new Error("Failed to initialize checkout");

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

