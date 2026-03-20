/**
 * paywallUI.js
 * Renders pricing modal, plan badges, usage meters, and upgrade prompts.
 * Import this into any project's app.js and call initPaywall().
 */

import {
  PLANS, getSubscription, onSubscriptionChange,
  isPro, checkLimit, trackUsage,
  mountEmbeddedCheckout, openCustomerPortal
} from "./paymentService.js";

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
    await trackUsage(_userId, action);
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
  overlay.innerHTML = `
    <div class="pricing-modal">
      <button class="pricing-close" id="pricing-close-btn">&times;</button>
      <div class="pricing-header">
        <h2>Choose Your Plan</h2>
        <p>Unlock the full power of your tools</p>
      </div>
      <div class="pricing-cards">
        ${Object.entries(PLANS).map(([key, plan]) => `
          <div class="pricing-card ${key === highlightPlan ? 'highlighted' : ''} ${_subscription.plan === key ? 'current' : ''}">
            ${key === highlightPlan ? '<div class="popular-badge">Most Popular</div>' : ''}
            ${_subscription.plan === key ? '<div class="current-badge">Current Plan</div>' : ''}
            <div class="plan-name">${plan.name}</div>
            <div class="plan-price">${plan.price === 0 ? 'Free' : `$${plan.price}<span>/mo</span>`}</div>
            <ul class="plan-features">
              ${plan.features.map(f => `<li>✓ ${f}</li>`).join("")}
            </ul>
            ${plan.price === 0
              ? `<button class="plan-btn free-btn" disabled>${_subscription.plan === "free" ? "Current Plan" : "Downgrade"}</button>`
              : _subscription.plan === key
              ? `<button class="plan-btn manage-btn" onclick="window._openPortal()">Manage Plan</button>`
              : `<button class="plan-btn upgrade-btn" onclick="window._startCheckout('${plan.priceId}', '${key}')">
                   ${_subscription.plan !== "free" ? "Switch to " + plan.name : "Upgrade to " + plan.name}
                 </button>`
            }
          </div>
        `).join("")}
      </div>
      <div class="pricing-footer">
        <p>🔒 Secured by Stripe · Cancel anytime · No contracts</p>
        <div id="stripe-embedded-container" class="stripe-embedded hidden"></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById("pricing-close-btn").addEventListener("click", closePricingModal);
  overlay.addEventListener("click", e => { if (e.target === overlay) closePricingModal(); });

  // Expose helpers on window for inline onclick
  window._startCheckout = startEmbeddedCheckout;
  window._openPortal = () => openCustomerPortal(_userId);
}

export function closePricingModal() { removePricingModal(); }
function removePricingModal() {
  const el = document.getElementById("pricing-modal-overlay");
  if (el) el.remove();
}

async function startEmbeddedCheckout(priceId, planKey) {
  if (!_userId) { showAuthPrompt(); return; }
  const container = document.getElementById("stripe-embedded-container");
  if (!container) return;
  container.classList.remove("hidden");
  container.innerHTML = `<div id="stripe-checkout-mount" style="min-height:200px"></div>`;
  try {
    const checkout = await mountEmbeddedCheckout("stripe-checkout-mount", priceId, _userId);
    // Store reference for cleanup
    window._stripeCheckout = checkout;
  } catch (e) {
    container.innerHTML = `<p style="color:#EF4444;padding:1rem">Checkout failed: ${e.message}</p>`;
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
        <p>Upgrade to Pro for unlimited access — just $9.99/mo</p>
      </div>
      <button class="upgrade-cta" id="upgrade-cta-btn">Upgrade to Pro</button>
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
  if (limit === Infinity) { container.innerHTML = `<span class="usage-unlimited">✓ Unlimited ${action}s</span>`; return; }
  const { used } = await checkLimit(_userId, action, limit);
  const pct = Math.min(100, (used / limit) * 100);
  container.innerHTML = `
    <div class="usage-meter">
      <div class="usage-label"><span>${used} / ${limit} ${action}s used</span><button class="usage-upgrade" onclick="window._showPricing?.()">Upgrade</button></div>
      <div class="usage-bar"><div class="usage-fill ${pct > 80 ? 'warning' : ''}" style="width:${pct}%"></div></div>
    </div>`;
  window._showPricing = () => showPricingModal("pro");
}

export function getCurrentPlan() { return _subscription.plan || "free"; }
export function getSubscriptionData() { return _subscription; }
