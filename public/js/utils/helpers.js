/**
 * utils/helpers.js
 * Shared utility functions used across all projects.
 */

// ─── DOM helpers ──────────────────────────────────────────────────────────────
export const $ = (selector, parent = document) => parent.querySelector(selector);
export const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

export function show(el) { if (typeof el === "string") el = $(el); el?.classList.remove("hidden"); }
export function hide(el) { if (typeof el === "string") el = $(el); el?.classList.add("hidden"); }
export function toggle(el, force) { if (typeof el === "string") el = $(el); el?.classList.toggle("hidden", force); }

// ─── String helpers ───────────────────────────────────────────────────────────
export function truncate(str, max = 80) {
  return str?.length > max ? str.slice(0, max) + "..." : str;
}

export function slugify(str) {
  return str.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-");
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
}

// ─── Number / formatting helpers ─────────────────────────────────────────────
export function formatNumber(n) {
  return Number(n).toLocaleString();
}

export function formatBytes(bytes, decimals = 1) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

export function formatCurrency(amount, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
export function timeAgo(date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  const intervals = [
    [31536000, "year"], [2592000, "month"], [86400, "day"],
    [3600, "hour"], [60, "minute"], [1, "second"]
  ];
  for (const [secs, label] of intervals) {
    const count = Math.floor(seconds / secs);
    if (count >= 1) return `${count} ${label}${count !== 1 ? "s" : ""} ago`;
  }
  return "just now";
}

export function formatDate(date, opts = {}) {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric", ...opts
  });
}

// ─── Clipboard ────────────────────────────────────────────────────────────────
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  }
}

export function showCopiedFeedback(btn, originalText = "📋 Copy") {
  btn.textContent = "✓ Copied!";
  btn.style.color = "var(--emerald, #10B981)";
  setTimeout(() => { btn.textContent = originalText; btn.style.color = ""; }, 2000);
}

// ─── File helpers ─────────────────────────────────────────────────────────────
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text, filename, mimeType = "text/plain") {
  downloadBlob(new Blob([text], { type: mimeType }), filename);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
export function setLoading(btn, loading, loadingText = "Loading...") {
  const textEl = btn.querySelector(".btn-text");
  const loaderEl = btn.querySelector(".btn-loader");
  btn.disabled = loading;
  if (textEl && loaderEl) {
    textEl.classList.toggle("hidden", loading);
    loaderEl.classList.toggle("hidden", !loading);
  } else {
    btn._originalText = btn._originalText || btn.textContent;
    btn.textContent = loading ? loadingText : btn._originalText;
  }
}

export function initTabSwitcher(tabSelector, viewPrefix) {
  document.querySelectorAll(tabSelector).forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(tabSelector).forEach(t => t.classList.remove("active"));
      document.querySelectorAll(`[id^="${viewPrefix}"]`).forEach(v => {
        v.classList.remove("active"); v.classList.add("hidden");
      });
      tab.classList.add("active");
      const view = document.getElementById(`${viewPrefix}${tab.dataset.tool || tab.dataset.tab}`);
      if (view) { view.classList.remove("hidden"); view.classList.add("active"); }
    });
  });
}

export function initAuthModal(authService) {
  const modal = document.getElementById("auth-modal");
  if (!modal) return;

  document.getElementById("modal-close")?.addEventListener("click", () => modal.classList.add("hidden"));
  modal.addEventListener("click", e => { if (e.target === modal) modal.classList.add("hidden"); });

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tab-content").forEach(t => t.classList.add("hidden"));
      document.getElementById(`tab-${btn.dataset.tab}`)?.classList.remove("hidden");
    });
  });

  document.getElementById("btn-login")?.addEventListener("click", async () => {
    const email = document.getElementById("login-email")?.value;
    const password = document.getElementById("login-password")?.value;
    const errorEl = document.getElementById("auth-error");
    try {
      await authService.signIn(email, password);
      modal.classList.add("hidden");
    } catch (e) {
      if (errorEl) { errorEl.textContent = e.message; errorEl.classList.remove("hidden"); }
    }
  });

  document.getElementById("btn-signup")?.addEventListener("click", async () => {
    const name = document.getElementById("signup-name")?.value;
    const email = document.getElementById("signup-email")?.value;
    const password = document.getElementById("signup-password")?.value;
    const errorEl = document.getElementById("auth-error");
    try {
      await authService.signUp(email, password, name);
      modal.classList.add("hidden");
    } catch (e) {
      if (errorEl) { errorEl.textContent = e.message; errorEl.classList.remove("hidden"); }
    }
  });
}

// ─── Drag-and-drop file zones ─────────────────────────────────────────────────
export function initDropZone(dropZoneId, fileInputId, onFiles, accept = null) {
  const zone = document.getElementById(dropZoneId);
  const input = document.getElementById(fileInputId);
  if (!zone || !input) return;

  zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("drag-over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", e => {
    e.preventDefault(); zone.classList.remove("drag-over");
    const files = Array.from(e.dataTransfer.files);
    const filtered = accept ? files.filter(f => accept.split(",").some(a => f.type.includes(a.trim().replace(".", "").replace("*", "")) || f.name.endsWith(a.trim()))) : files;
    if (filtered.length) onFiles(filtered);
  });
  zone.addEventListener("click", () => input.click());
  input.addEventListener("change", () => { if (input.files.length) onFiles(Array.from(input.files)); });
}

// ─── Local state helpers ──────────────────────────────────────────────────────
export function debounce(fn, delay = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

export function throttle(fn, limit = 200) {
  let last = 0;
  return (...args) => { const now = Date.now(); if (now - last >= limit) { last = now; fn(...args); } };
}

// ─── API helpers ─────────────────────────────────────────────────────────────
export async function apiFetch(url, body, token = null) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error ${res.status}`);
  }
  return res.json();
}

// ─── Skeleton screens ─────────────────────────────────────────────────────────
export function showSkeleton(containerId, rows = 5, type = "row") {
  const container = document.getElementById(containerId);
  if (!container) return;
  const skeletons = {
    row:   () => `<div class="skeleton skeleton-row"></div>`,
    card:  () => `<div class="skeleton skeleton-card"></div>`,
    text:  () => `<div class="skeleton skeleton-text w-full"></div><div class="skeleton skeleton-text w-3-4"></div>`,
    table: () => `<div class="results-skeleton">${Array(rows).fill('<div class="skeleton skeleton-row"></div>').join('')}</div>`,
  };
  const fn = skeletons[type] || skeletons.row;
  container.innerHTML = `<div class="results-skeleton">${Array(rows).fill(fn()).join('')}</div>`;
}

export function hideSkeleton(containerId) {
  const container = document.getElementById(containerId);
  if (container) {
    const skeleton = container.querySelector(".results-skeleton");
    if (skeleton) skeleton.remove();
  }
}
