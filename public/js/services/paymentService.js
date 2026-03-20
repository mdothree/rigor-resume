import { STRIPE_KEY, STRIPE_PRO_PRICE_ID, STRIPE_TEAM_PRICE_ID } from "../config/env.js";

/**
 * paymentService.js
 * Handles Stripe Checkout sessions + subscription state via Firebase
 * Uses Stripe Embedded Elements (Payment Element) — no redirect needed
 */

import { auth, db } from "../config/firebase.js";
import {
  doc, getDoc, setDoc, onSnapshot, collection, addDoc, serverTimestamp
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
export async function getSubscription(userId) {
  try {
    const snap = await getDoc(doc(db, "subscriptions", userId));
    if (!snap.exists()) return { plan: "free", status: "none" };
    return snap.data();
  } catch {
    return { plan: "free", status: "none" };
  }
}

export function onSubscriptionChange(userId, callback) {
  return onSnapshot(doc(db, "subscriptions", userId), snap => {
    callback(snap.exists() ? snap.data() : { plan: "free", status: "none" });
  });
}

export async function isPro(userId) {
  const sub = await getSubscription(userId);
  return sub.plan === "pro" || sub.plan === "team";
}

// ─── Usage tracking ───────────────────────────────────────────────────────────
export async function trackUsage(userId, action) {
  const month = new Date().toISOString().slice(0, 7); // "2025-01"
  const ref = doc(db, "usage", `${userId}_${month}`);
  const snap = await getDoc(ref);
  const current = snap.exists() ? snap.data() : {};
  const count = (current[action] || 0) + 1;
  await setDoc(ref, { ...current, [action]: count, userId, month }, { merge: true });
  return count;
}

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

// ─── Stripe Checkout (server-side session) ────────────────────────────────────
export async function createCheckoutSession(userId, priceId, successUrl, cancelUrl) {
  const res = await fetch("/api/payment/create-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, priceId, successUrl, cancelUrl })
  });
  if (!res.ok) throw new Error("Failed to create checkout session");
  return res.json(); // { sessionId, url }
}

// ─── Stripe Embedded Checkout (Payment Element) ───────────────────────────────
export async function mountEmbeddedCheckout(containerId, priceId, userId) {
  const stripe = await getStripe();

  // Get client secret from server
  const res = await fetch("/api/payment/create-embedded-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ priceId, userId })
  });
  if (!res.ok) throw new Error("Failed to initialize checkout");
  const { clientSecret } = await res.json();

  const checkout = await stripe.initEmbeddedCheckout({ clientSecret });
  checkout.mount(`#${containerId}`);
  return checkout; // call checkout.destroy() to unmount
}

// ─── Customer portal ──────────────────────────────────────────────────────────
export async function openCustomerPortal(userId) {
  const res = await fetch("/api/payment/portal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId })
  });
  const { url } = await res.json();
  window.location.href = url;
}

// ─── Log payment event ────────────────────────────────────────────────────────
export async function logPaymentEvent(userId, event) {
  await addDoc(collection(db, "payment_events"), {
    userId, ...event, createdAt: serverTimestamp()
  });
}
