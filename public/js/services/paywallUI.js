/**
 * paywallUI.js
 * Renders pricing modal, plan badges, usage meters, and upgrade prompts.
 * Import this into any project's app.js and call initPaywall().
 */

import {
  PLANS, getSubscription, onSubscriptionChange,
  isPro, checkLimit,
  mountEmbeddedCheckout, openCustomerPortal, CheckoutUnavailableError
} from "./paymentService.js";
import { PRO_CHECKOUT_ENABLED, PRO_COMING_SOON_LABEL } from "../config/env.js";

// Honest copy while Pro checkout is off (RIGOR-PAY-BEFORE-API).
const PRO_NOTICE = "Rigor Pro isn't available to buy yet. Checkout opens once the Pro service is live. " +
  "The free plan (3 uses a month) works now, and nothing can be charged here.";
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
let _subscription = { plan: "free", status: "none" };
let _unsubscribe = null;

// ─── Init (call once after auth) ─────────────────────────────────────────────
export async function initPaywall(userId) {
  _userId = userId;
  if (!userId) { _subscription = { plan: "free", status: "none" }; updateUI(); return; }

  _subscription = await getSubscription(userId);
  updateUI();

  if (_unsubscribe) _unsubscribe();
  _unsubscribe = onSubscriptionChange(userId, sub => {
    _subscription = sub;
    updateUI();
    // Close paywall modal if just subscribed
    if (sub.plan !== "free") closePricingModal();
  });
}

// ─── Gate check ──────────────────────────────────────────────────────────────
export async function gate(action, onAllowed, onBlocked) {
  if (!_userId) { showAuthPrompt(); return; }

  const plan = _subscription.plan || "free";
  const limit = PLANS[plan]?.limits?.[action] ?? PLANS.free.limits[action] ?? 3;
  const { allowed, reason, used, limit: lim } = await checkLimit(_userId, action, limit);

  if (allowed) {
    // Usage is counted server-side only (the API increments usage/{uid}_{month}
    // after a successful AI call; firestore.rules deny client writes to usage).
    // Counting here too double-counted and charged quota for failed calls.
    onAllowed();
  } else {
    if (reason === "login") { showAuthPrompt(); return; }
    onBlocked?.();
    showUpgradePrompt(action, used, lim);
  }
}

// ─── Pricing modal ────────────────────────────────────────────────────────────
export function showPricingModal(highlightPlan = "pro") {
  removePricingModal();
  const overlay = document.createElement("div");
  overlay.id = "pricing-modal-overlay";
  overlay.className = "pricing-overlay";
  const paidButton = (key, plan) => {
    if (_subscription.plan === key) {
      return `<button type="button" class="plan-btn manage-btn" data-action="portal">Manage Plan</button>`;
    }
    if (!PRO_CHECKOUT_ENABLED) {
      return `<button type="button" class="plan-btn upgrade-btn plan-btn-soon" data-action="soon">${plan.name} — coming soon</button>`;
    }
    return `<button type="button" class="plan-btn upgrade-btn" data-action="checkout" data-price="${escapeText(plan.priceId)}" data-plan="${key}">
              ${_subscription.plan !== "free" ? "Switch to " + plan.name : "Upgrade to " + plan.name}
            </button>`;
  };
  overlay.innerHTML = `
    <div class="pricing-modal" role="dialog" aria-modal="true" aria-label="Plans">
      <button type="button" class="pricing-close" id="pricing-close-btn" aria-label="Close">&times;</button>
      <div class="pricing-header">
        <h2>${PRO_CHECKOUT_ENABLED ? "Choose Your Plan" : "Plans"}</h2>
        <p>${PRO_CHECKOUT_ENABLED ? "Unlock the full power of your tools" : "Pro is coming soon"}</p>
      </div>
      <p class="pro-notice ${PRO_CHECKOUT_ENABLED ? "hidden" : ""}" id="pro-notice" role="status">${escapeText(PRO_NOTICE)}</p>
      <div class="pricing-cards">
        ${Object.entries(PLANS).map(([key, plan]) => `
          <div class="pricing-card ${key === highlightPlan ? 'highlighted' : ''} ${_subscription.plan === key ? 'current' : ''}">
            ${key === highlightPlan && PRO_CHECKOUT_ENABLED ? '<div class="popular-badge">Most Popular</div>' : ''}
            ${_subscription.plan === key ? '<div class="current-badge">Current Plan</div>' : ''}
            <div class="plan-name">${plan.name}</div>
            <div class="plan-price">${plan.price === 0 ? 'Free' : `$${plan.price}<span>/mo</span>`}</div>
            <ul class="plan-features">
              ${plan.features.map(f => `<li>✓ ${f}</li>`).join("")}
            </ul>
            ${plan.price === 0
              ? `<button type="button" class="plan-btn free-btn" disabled>${_subscription.plan === "free" ? "Current Plan" : "Downgrade"}</button>`
              : paidButton(key, plan)
            }
          </div>
        `).join("")}
      </div>
      <div class="pricing-footer">
        <p>${PRO_CHECKOUT_ENABLED ? "🔒 Secured by Stripe · Cancel anytime · No contracts" : "Checkout is not open yet. No payment can be taken on this page."}</p>
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

// ─── Upgrade prompt (inline banner) ──────────────────────────────────────────
export function showUpgradePrompt(action, used, limit) {
  removeUpgradePrompt();
  const banner = document.createElement("div");
  banner.id = "upgrade-prompt";
  banner.className = "upgrade-prompt";
  banner.innerHTML = `
    <div class="upgrade-content">
      <div class="upgrade-icon">🚀</div>
      <div class="upgrade-text">
        <strong>You've used ${used} of ${limit} free ${action}s this month</strong>
        <p>${PRO_CHECKOUT_ENABLED ? "Upgrade to Pro for unlimited access — just $9.99/mo" : "Your free uses reset next month. Unlimited Pro is coming soon."}</p>
      </div>
      <button type="button" class="upgrade-cta" id="upgrade-cta-btn" data-pro-cta data-pro-label="Upgrade to Pro">${PRO_CHECKOUT_ENABLED ? "Upgrade to Pro" : PRO_COMING_SOON_LABEL}</button>
      <button class="upgrade-dismiss" id="upgrade-dismiss-btn">&times;</button>
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
  // Update plan badge in nav if it exists
  const badge = document.getElementById("plan-badge");
  if (badge) {
    const plan = _subscription.plan || "free";
    badge.textContent = plan.charAt(0).toUpperCase() + plan.slice(1);
    badge.className = `plan-badge plan-badge-${plan}`;
    badge.classList.toggle("plan-badge-hidden", plan === "free");
  }
  // Update upgrade button visibility
  const upgradeBtn = document.getElementById("nav-upgrade");
  if (upgradeBtn) {
    upgradeBtn.classList.toggle("nav-upgrade-hidden", _subscription.plan === "pro" || _subscription.plan === "team");
  upgradeBtn.classList.toggle("nav-upgrade-visible", _subscription.plan !== "pro" && _subscription.plan !== "team");
  }
  // Show/hide manage button
  const manageBtn = document.getElementById("nav-manage");
  if (manageBtn) {
    manageBtn.classList.toggle("nav-manage-hidden", _subscription.plan === "free");
  manageBtn.classList.toggle("nav-manage-visible", _subscription.plan !== "free");
  }
}

// ─── Usage meter widget ───────────────────────────────────────────────────────
export async function renderUsageMeter(containerId, action) {
  const container = document.getElementById(containerId);
  if (!container || !_userId) return;
  const plan = _subscription.plan || "free";
  const limit = PLANS[plan]?.limits?.[action] ?? 3;
  const noun = action.endsWith("s") ? action : `${action}s`; // "analyses", not "analysess"
  if (limit === Infinity) { container.innerHTML = `<span class="usage-unlimited">✓ Unlimited ${noun}</span>`; return; }
  const { used } = await checkLimit(_userId, action, limit);
  const pct = Math.min(100, (used / limit) * 100);
  container.innerHTML = `
    <div class="usage-meter">
      <div class="usage-label"><span>${used} / ${limit} ${noun} used</span><button type="button" class="usage-upgrade" data-pro-cta data-pro-label="Upgrade">${PRO_CHECKOUT_ENABLED ? "Upgrade" : PRO_COMING_SOON_LABEL}</button></div>
      <div class="usage-bar"><div class="usage-fill ${pct > 80 ? 'warning' : ''}" style="width:${pct}%"></div></div>
    </div>`;
  container.querySelector(".usage-upgrade")?.addEventListener("click", () => showPricingModal("pro"));
}

export function getCurrentPlan() { return _subscription.plan || "free"; }
export function getSubscriptionData() { return _subscription; }

// Label the static CTAs as soon as this module loads (module scripts run after parse).
if (typeof document !== "undefined") applyProCtas();
