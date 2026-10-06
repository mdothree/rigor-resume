"use strict";

const CACHE_NAME = "rigor-resume-v2";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/css/styles.css",
  "/js/app.js",
  "/js/config/firebase.js",
  "/js/config/env.js",
  "/js/services/authService.js",
  "/js/services/paymentService.js",
  "/js/services/paywallUI.js",
  "/js/services/firestoreService.js",
  "/js/utils/helpers.js",
  "/js/utils/toast.js",
  "/js/utils/validate.js",
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Never cache API calls, Firebase, or Stripe
  if (
    url.pathname.startsWith("/api/") ||
    url.hostname.includes("googleapis") ||
    url.hostname.includes("stripe") ||
    url.hostname.includes("firebaseio") ||
    event.request.method !== "GET"
  ) {
    return; // fall through to network
  }

  // Only handle same-origin requests.
  if (url.origin !== self.location.origin) return;

  // Network-first: always try the latest deployed file, fall back to the cache
  // when offline. (Cache-first kept serving stale, broken JS after deploys.)
  event.respondWith(
    fetch(event.request).then(res => {
      if (res.ok && res.type === "basic") {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
      }
      return res;
    }).catch(() =>
      caches.match(event.request).then(cached => cached || new Response("Offline", { status: 503 }))
    )
  );
});
