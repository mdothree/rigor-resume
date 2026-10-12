/**
 * paywallUI.js
 * Renders the pricing modal, plan badges, usage meter and subscription prompts.
 * Import this into any project's app.js and call initPaywall().
 *
 * JARVIS #94 (paid-only): Rigor tools run on Rigor Pro / Team from the first use.
 * There is no unpaid plan in the modal or the meter. An unsubscribed user's first
 * use opens the pricing modal (requirePro / gate), and a 402
 * subscription_required from the API (apiFetch dispatches
 * "rigor:subscription-required") opens it too. Early access = promo codes entered
 * at Stripe checkout. While PRO_CHECKOUT_ENABLED is false the modal shows an honest
 * "Rigor Pro opens soon" state: no Stripe load, no session, no payment link.
 */

import {
  PLANS, getSubscription, onSubscriptionChange,
  isPaidPlan, checkLimit,
  mountEmbeddedCheckout, openCustomerPortal, CheckoutUnavailableError
} from "./paymentService.js";
import { PRO_CHECKOUT_ENABLED, PRO_COMING_SOON_LABEL, INCLUDED_ANALYSES } from "../config/env.js";

// Honest copy while Pro checkout is off (RIGOR-PAY-BEFORE-API / #93).
const PRO_NOTICE = "Rigor Pro opens soon. Rigor tools run on Rigor Pro, and checkout isn't open yet, " +
  "so nothing can be charged on this page and no results can be generated until it opens.";
const UNREACHABLE_NOTICE = "Checkout is temporarily unavailable because the Rigor service can't be reached. " +
  "Nothing was charged. Please try again later.";

function escapeText(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Pro CTA labels (static HTML ships the "coming soon" label) ───────────────
// Elements carry data-pro-label = the label to use when checkout is enabled.
export function applyProCtas(root = document) {
  root.querySelectorAll("#nav-upgrade, #pricing-upgrade-cta, [data-pro-cta]").forEach(el => {
    if (PRO_CHECKOUT_ENABLED) {
      if (el.dataset.proLabel) el.textContent = el.dataset.proLabel;
      el.classList.remove("pro-soon");
    } else {
      // Still clickable: a click opens the inline "coming soon" notice.
      el.textContent = PRO_COMING_SOON_LABEL;
      el.classList.add("pro-soon");
      el.title = "Pro checkout isn't open yet";
    }
  });
}

let _userId = null;
let _subscription = { plan: "free", status: "none" }; // "free" = internal key for no subscription
let _subscriptionFor = null; // uid whose subscription has been loaded
let _unsubscribe = null;

// ─── Init (call once after auth) ─────────────────────────────────────────────
export async function initPaywall(userId) {
  _userId = userId;
  if (!userId) {
    _subscription = { plan: "free", status: "none" };
    _subscriptionFor = null;
    updateUI();
    return;
  }

  _subscription = await getSubscription(userId);
  _subscriptionFor = userId;
  updateUI();

  if (_unsubscribe) _unsubscribe();
  _unsubscribe = onSubscriptionChange(userId, sub => {
    _subscription = sub;
    _subscriptionFor = userId;
    updateUI();
    // Close paywall modal / prompt once subscribed
    if (isPaidPlan(sub.plan)) { closePricingModal(); removeUpgradePrompt(); }
  });
}

// ─── Gate check ──────────────────────────────────────────────────────────────
function includedLimit(action) {
  return PLANS.free.limits?.[action] ?? INCLUDED_ANALYSES;
}

/**
 * Resolve to true when the signed-in user may run an AI action, otherwise open
 * the sign-in or pricing modal and resolve to false. The API enforces the same
 * rule (402 subscription_required); this only avoids a doomed round-trip.
 */
export async function requirePro(action = "analyses") {
  if (!_userId) { showAuthPrompt(); return false; }
  if (_subscriptionFor !== _userId) {
    _subscription = await getSubscription(_userId);
    _subscriptionFor = _userId;
  }
  if (isPaidPlan(_subscription.plan)) return true;

  const limit = includedLimit(action);
  if (limit > 0) {
    // Rollback path only (INCLUDED_ANALYSES > 0): metered allowance.
    const { allowed, reason, used } = await checkLimit(_userId, action, limit);
    if (allowed) return true;
    if (reason === "login") { showAuthPrompt(); return false; }
    showSubscriptionRequired(action, used, limit);
    return false;
  }
  showSubscriptionRequired(action);
  return false;
}

export async function gate(action, onAllowed, onBlocked) {
  // Usage is counted server-side only (the API increments usage/{uid}_{month};
  // firestore.rules deny client writes to usage).
  if (await requirePro(action)) onAllowed();
  else onBlocked?.();
}

function showSubscriptionRequired(action, used, limit) {
  showUpgradePrompt(action, used, limit);
  showPricingModal("pro");
}

// Server said 402 subscription_required (apiFetch) or a tool error box asked for Pro.
if (typeof window !== "undefined") {
  window.addEventListener("rigor:subscription-required", () => showSubscriptionRequired("analyses"));
}

// ─── Pricing modal ────────────────────────────────────────────────────────────
export function showPricingModal(highlightPlan = "pro") {
  removePricingModal();
  const overlay = document.createElement("div");
  overlay.id = "pricing-modal-overlay";
  overlay.className = "pricing-overlay";
  const subscribed = isPaidPlan(_subscription.plan);
  const paidButton = (key, plan) => {
    if (_subscription.plan === key) {
      return `<button type="button" class="plan-btn manage-btn" data-action="portal">Manage Plan</button>`;
    }
    if (!PRO_CHECKOUT_ENABLED) {
      return `<button type="button" class="plan-btn upgrade-btn plan-btn-soon" data-action="soon">${plan.name} — coming soon</button>`;
    }
    return `<button type="button" class="plan-btn upgrade-btn" data-action="checkout" data-price="${escapeText(plan.priceId)}" data-plan="${key}">
              ${subscribed ? "Switch to " + plan.name : "Get " + plan.name}
            </button>`;
  };
  // #94: only paid plans are offered; the internal "no subscription" key is never a card.
  const plans = Object.entries(PLANS).filter(([, plan]) => !plan.hidden && plan.price > 0);
  overlay.innerHTML = `
    <div class="pricing-modal" role="dialog" aria-modal="true" aria-label="Rigor Pro">
      <button type="button" class="pricing-close" id="pricing-close-btn" aria-label="Close">&times;</button>
      <div class="pricing-header">
        <h2>${PRO_CHECKOUT_ENABLED ? "Get Rigor Pro" : "Rigor Pro opens soon"}</h2>
        <p>${PRO_CHECKOUT_ENABLED
          ? "Rigor tools run on a Pro or Team subscription. Have an early-access promo code? Enter it at checkout."
          : "Rigor tools run on a Pro or Team subscription. Checkout isn't open yet."}</p>
      </div>
      <p class="pro-notice ${PRO_CHECKOUT_ENABLED ? "hidden" : ""}" id="pro-notice" role="status">${escapeText(PRO_NOTICE)}</p>
      <div class="pricing-cards">
        ${plans.map(([key, plan]) => `
          <div class="pricing-card ${key === highlightPlan ? 'highlighted' : ''} ${_subscription.plan === key ? 'current' : ''}">
            ${key === highlightPlan && PRO_CHECKOUT_ENABLED ? '<div class="popular-badge">Most Popular</div>' : ''}
            ${_subscription.plan === key ? '<div class="current-badge">Current Plan</div>' : ''}
            <div class="plan-name">${plan.name}</div>
            <div class="plan-price">$${plan.price}<span>/mo</span></div>
            <ul class="plan-features">
              ${plan.features.map(f => `<li>✓ ${f}</li>`).join("")}
            </ul>
            ${paidButton(key, plan)}
          </div>
        `).join("")}
      </div>
      <div class="pricing-footer">
        <p>${PRO_CHECKOUT_ENABLED ? "🔒 Secured by Stripe · Promo codes accepted at checkout · Cancel anytime" : "Checkout is not open yet. No payment can be taken on this page."}</p>
        <div id="stripe-embedded-container" class="stripe-embedded hidden"></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById("pricing-close-btn").addEventListener("click", closePricingModal);
  overlay.addEventListener("click", e => { if (e.target === overlay) closePricingModal(); });

  // No inline onclick handlers: the CSP (script-src 'self') blocks them.
  overlay.querySelectorAll(".plan-btn[data-action]").forEach(btn => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      if (action === "soon") showProNotice(PRO_NOTICE);
      else if (action === "checkout") startEmbeddedCheckout(btn.dataset.price, btn.dataset.plan);
      else if (action === "portal") openPortalSafely();
    });
  });
}

// Inline notice inside the pricing modal (opens the modal first if needed).
export function showProNotice(message = PRO_NOTICE) {
  if (!document.getElementById("pricing-modal-overlay")) showPricingModal("pro");
  const el = document.getElementById("pro-notice");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
  el.scrollIntoView?.({ block: "nearest" });
}

async function openPortalSafely() {
  try {
    await openCustomerPortal(_userId);
  } catch (e) {
    showProNotice(e?.status === 0 ? UNREACHABLE_NOTICE : `Couldn't open billing: ${e?.message || "unknown error"}`);
  }
}

export function closePricingModal() { removePricingModal(); }
function removePricingModal() {
  const el = document.getElementById("pricing-modal-overlay");
  if (el) el.remove();
}

async function startEmbeddedCheckout(priceId, planKey) {
  // Flag first: with checkout off nothing below (auth, Stripe, API) runs.
  if (!PRO_CHECKOUT_ENABLED) { showProNotice(PRO_NOTICE); return; }
  if (!_userId) { showAuthPrompt(); return; }
  const container = document.getElementById("stripe-embedded-container");
  if (!container) return;
  container.classList.remove("hidden");
  container.innerHTML = `<div id="stripe-checkout-mount" style="min-height:200px"><p class="pro-checking">Checking checkout availability…</p></div>`;
  try {
    // mountEmbeddedCheckout re-checks the flag and probes the API before Stripe loads.
    const checkout = await mountEmbeddedCheckout("stripe-checkout-mount", priceId, _userId);
    window._stripeCheckout = checkout;
  } catch (e) {
    container.classList.add("hidden");
    container.innerHTML = "";
    if (e instanceof CheckoutUnavailableError) {
      showProNotice(e.reason === "disabled" ? PRO_NOTICE : UNREACHABLE_NOTICE);
    } else {
      showProNotice(`Checkout failed: ${e?.message || "unknown error"}. Nothing was charged.`);
    }
  }
}

// ─── Subscription prompt (inline banner, stays after the modal is closed) ─────
export function showUpgradePrompt(action, used, limit) {
  removeUpgradePrompt();
  const banner = document.createElement("div");
  banner.id = "upgrade-prompt";
  banner.className = "upgrade-prompt";
  const metered = Number.isFinite(limit) && limit > 0 && Number.isFinite(used);
  const headline = metered
    ? `You've used ${used} of ${limit} ${action} this month`
    : "This tool is part of Rigor Pro";
  const detail = PRO_CHECKOUT_ENABLED
    ? "Get unlimited use with Rigor Pro for $9.99/mo. Early-access promo codes are accepted at checkout."
    : "Rigor Pro opens soon. Checkout isn't open yet, so nothing can be charged.";
  banner.innerHTML = `
    <div class="upgrade-content">
      <div class="upgrade-icon">🚀</div>
      <div class="upgrade-text">
        <strong>${escapeText(headline)}</strong>
        <p>${detail}</p>
      </div>
      <button type="button" class="upgrade-cta" id="upgrade-cta-btn" data-pro-cta data-pro-label="Get Rigor Pro">${PRO_CHECKOUT_ENABLED ? "Get Rigor Pro" : PRO_COMING_SOON_LABEL}</button>
      <button class="upgrade-dismiss" id="upgrade-dismiss-btn" aria-label="Dismiss">&times;</button>
    </div>`;
  // Insert after hero or at top of tool section
  const toolSection = document.querySelector(".tool-section") || document.body;
  toolSection.insertBefore(banner, toolSection.firstChild);
  document.getElementById("upgrade-cta-btn").addEventListener("click", () => showPricingModal("pro"));
  document.getElementById("upgrade-dismiss-btn").addEventListener("click", removeUpgradePrompt);
}

function removeUpgradePrompt() {
  const el = document.getElementById("upgrade-prompt");
  if (el) el.remove();
}

// ─── Auth prompt ──────────────────────────────────────────────────────────────
function showAuthPrompt() {
  const modal = document.getElementById("auth-modal");
  if (modal) modal.classList.remove("hidden");
}

// ─── Plan badge (nav) ─────────────────────────────────────────────────────────
function updateUI() {
  applyProCtas();
  const paid = isPaidPlan(_subscription.plan);
  // Plan badge only for a paid plan (the "no subscription" key is never shown).
  const badge = document.getElementById("plan-badge");
  if (badge) {
    const plan = _subscription.plan || "free";
    badge.textContent = paid ? plan.charAt(0).toUpperCase() + plan.slice(1) : "";
    badge.className = `plan-badge plan-badge-${paid ? plan : "none"}`;
    badge.classList.toggle("plan-badge-hidden", !paid);
  }
  // Update upgrade button visibility
  const upgradeBtn = document.getElementById("nav-upgrade");
  if (upgradeBtn) {
    upgradeBtn.classList.toggle("nav-upgrade-hidden", paid);
    upgradeBtn.classList.toggle("nav-upgrade-visible", !paid);
  }
  // Show/hide manage button
  const manageBtn = document.getElementById("nav-manage");
  if (manageBtn) {
    manageBtn.classList.toggle("nav-manage-hidden", !paid);
    manageBtn.classList.toggle("nav-manage-visible", paid);
  }
}

// ─── Usage meter widget ───────────────────────────────────────────────────────
export async function renderUsageMeter(containerId, action) {
  const container = document.getElementById(containerId);
  if (!container || !_userId) return;
  const plan = _subscription.plan || "free";
  const paid = isPaidPlan(plan);
  const noun = action.endsWith("s") ? action : `${action}s`; // "analyses", not "analysess"
  const limit = paid ? (PLANS[plan]?.limits?.[action] ?? Infinity) : includedLimit(action);
  if (limit === Infinity) { container.innerHTML = `<span class="usage-unlimited">✓ Unlimited ${noun}</span>`; return; }
  if (!(limit > 0)) {
    // #94: no unpaid allowance, so there is nothing to meter; point at Pro instead.
    container.innerHTML = `
      <div class="usage-meter">
        <div class="usage-label"><span>${PRO_CHECKOUT_ENABLED ? "Rigor tools run on Rigor Pro" : "Rigor Pro opens soon"}</span><button type="button" class="usage-upgrade" data-pro-cta data-pro-label="Get Pro">${PRO_CHECKOUT_ENABLED ? "Get Pro" : PRO_COMING_SOON_LABEL}</button></div>
      </div>`;
    container.querySelector(".usage-upgrade")?.addEventListener("click", () => showPricingModal("pro"));
    return;
  }
  const { used } = await checkLimit(_userId, action, limit);
  const pct = Math.min(100, (used / limit) * 100);
  container.innerHTML = `
    <div class="usage-meter">
      <div class="usage-label"><span>${used} / ${limit} ${noun} used</span><button type="button" class="usage-upgrade" data-pro-cta data-pro-label="Get Pro">${PRO_CHECKOUT_ENABLED ? "Get Pro" : PRO_COMING_SOON_LABEL}</button></div>
      <div class="usage-bar"><div class="usage-fill ${pct > 80 ? 'warning' : ''}" style="width:${pct}%"></div></div>
    </div>`;
  container.querySelector(".usage-upgrade")?.addEventListener("click", () => showPricingModal("pro"));
}

export function getCurrentPlan() { return _subscription.plan || "free"; }
export function getSubscriptionData() { return _subscription; }

// Label the static CTAs as soon as this module loads (module scripts run after parse).
if (typeof document !== "undefined") applyProCtas();
