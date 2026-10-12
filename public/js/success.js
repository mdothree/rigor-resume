/**
 * success.js — Q7: the checkout return page confirms access instead of claiming it.
 * Stripe returns here with ?session_id=cs_…; the rigor API (POST /api/payment/confirm)
 * reads that session from Stripe and turns Pro on for the signed-in account (the
 * webhook does the same in the background). The page only says "active" once the
 * API reports an active plan.
 */
import { apiFetch } from "./config/env.js";
import { authService } from "./services/authService.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const raw = params.get("session_id") || "";
const sessionId = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/.test(raw) ? raw : null;

function show(state, title, text, cta = "Go to the tool") {
  $("pay-icon").textContent = state === "ok" ? "✓" : state === "wait" ? "…" : "!";
  $("pay-title").textContent = title;
  $("pay-text").textContent = text;
  $("pay-cta").textContent = cta;
  document.querySelector(".payment-status-card")?.setAttribute("data-state", state);
}

let tries = 0;
async function confirm() {
  try {
    const r = await apiFetch("/api/payment/confirm", sessionId ? { sessionId } : {}, { timeoutMs: 20000 });
    if (r.active) {
      show("ok", "Rigor Pro is active", `Your ${r.plan === "team" ? "Team" : "Pro"} plan is on for this account. Every Rigor tool is unlocked.`, "Start using Rigor Pro");
      return;
    }
    if (++tries <= 10) {
      show("wait", "Confirming your payment…", "Stripe is finishing the payment. This page updates on its own.");
      setTimeout(confirm, 3000);
      return;
    }
    show("err", "Payment received, plan not active yet",
      "Your payment is safe, but the plan hasn't switched on yet. Refresh this page in a minute. If it still isn't active, reply to your Stripe receipt email and we'll fix it.");
  } catch (e) {
    if (e.status === 403) {
      show("err", "Signed in with a different account", e.message + " Sign out, then sign in with the account you paid with and reopen this page.");
    } else if (e.status === 401) {
      show("err", "Please sign in", "Sign in on the tool page with the account you paid with, then come back to this page.", "Sign in");
    } else {
      show("err", "We couldn't confirm yet", "Your payment is safe. We couldn't reach the Rigor service just now. Refresh this page in a minute.");
    }
  }
}

show("wait", "Confirming your payment…", "Checking your Rigor account.");
let started = false;
authService.onAuthChanged(user => {
  if (started) return;
  if (!user) {
    show("err", "Please sign in", "Your payment went through Stripe. Sign in on the tool page with the account you paid with and Rigor Pro will show there.", "Sign in");
    return;
  }
  started = true;
  confirm();
});
