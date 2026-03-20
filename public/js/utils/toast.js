/**
 * utils/toast.js
 * Lightweight toast notification system.
 * Replaces all alert() calls across every project.
 * Usage: import { toast } from "./utils/toast.js";
 *        toast.success("Saved!") | toast.error("Failed") | toast.info("...") | toast.warning("...")
 */

class ToastManager {
  constructor() {
    this._container = null;
    this._queue = [];
    this._defaultDuration = 3500;
  }

  _getContainer() {
    if (this._container) return this._container;
    this._container = document.createElement("div");
    this._container.id = "toast-container";
    this._container.setAttribute("role", "status");
    this._container.setAttribute("aria-live", "polite");
    this._container.setAttribute("aria-atomic", "false");
    document.body.appendChild(this._container);
    return this._container;
  }

  _show(message, type = "info", duration = this._defaultDuration) {
    const container = this._getContainer();
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.setAttribute("role", "alert");

    const icons = { success: "✓", error: "✕", warning: "⚠", info: "ℹ" };
    toast.innerHTML = `
      <span class="toast-icon" aria-hidden="true">${icons[type] || icons.info}</span>
      <span class="toast-message">${message}</span>
      <button class="toast-close" aria-label="Dismiss notification">×</button>`;

    container.appendChild(toast);

    // Trigger enter animation
    requestAnimationFrame(() => toast.classList.add("toast-visible"));

    // Auto-dismiss
    const timer = setTimeout(() => this._dismiss(toast), duration);

    // Manual dismiss
    toast.querySelector(".toast-close").addEventListener("click", () => {
      clearTimeout(timer);
      this._dismiss(toast);
    });

    return toast;
  }

  _dismiss(toast) {
    toast.classList.remove("toast-visible");
    toast.classList.add("toast-leaving");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }

  success(message, duration) { return this._show(message, "success", duration); }
  error(message, duration)   { return this._show(message, "error", duration || 5000); }
  warning(message, duration) { return this._show(message, "warning", duration); }
  info(message, duration)    { return this._show(message, "info", duration); }

  /** Show a loading toast that you manually dismiss by calling the returned fn */
  loading(message) {
    const t = this._show(`<span class="toast-spinner"></span> ${message}`, "info", 999999);
    return () => this._dismiss(t);
  }
}

export const toast = new ToastManager();
