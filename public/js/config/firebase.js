/**
 * config/firebase.js — the ONLY Firebase init for this rigor tool.
 * Modular v10 SDK, one initializeApp, project mdo3d-career.
 *
 * The web config below is public by design (Firebase web API keys identify the
 * project, they do not authorize anything). Access is controlled by
 * shared/career/firestore.rules + the rigor API's ID-token checks. The key MUST be
 * restricted in GCP (APIs & Services > Credentials) to HTTP referrers
 * https://*.rigor.design/* and https://rigor.design/* (+ localhost for dev).
 *
 * window.__ENV__.FIREBASE_CONFIG (an object) overrides it, so a build/deploy step
 * can inject a different project without editing this file.
 *
 * PERF-003: the SDK is loaded LAZILY with dynamic import(). It used to be
 * imported statically, so ~500 KB of gstatic JS sat on the critical path of every
 * page (LCP ~6.3 s on mobile). Now first paint never waits on Firebase:
 *  - loadFirebase() fetches + inits the SDK on first real use (sign-in click,
 *    Firestore read, API call) and is idempotent; it rejects if the SDK can't load
 *    (and lets a later call retry).
 *  - afterFirstPaint() resolves after window load + idle (or the first user
 *    interaction); authService.onAuthChanged waits on it, so a signed-in user is
 *    still restored on every page load, just off the critical path.
 *  - Until auth resolves, app state stays "signed out": every gate fails CLOSED.
 */
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDCIDNUzirzlHapKBLcMXR-iYSOiV6yUvo",
  authDomain: "mdo3d-career.firebaseapp.com",
  projectId: "mdo3d-career",
  storageBucket: "mdo3d-career.firebasestorage.app",
  messagingSenderId: "408387980482",
  appId: "1:408387980482:web:d564e195308f4da2553f5b"
};

const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";
const RUNTIME_ENV = (typeof window !== "undefined" && window.__ENV__) || {};
const FIREBASE_CONFIG = RUNTIME_ENV.FIREBASE_CONFIG || DEFAULT_FIREBASE_CONFIG;

// ─── App Check (OFF by default) ───────────────────────────────────────────────
// Turn on by setting, before this module loads:
//   window.__ENV__ = { VITE_FIREBASE_APPCHECK_ENABLED: "true",
//                      VITE_FIREBASE_APPCHECK_SITE_KEY: "<reCAPTCHA Enterprise site key>" }
// Register the key in Firebase console > App Check first, run in "monitor" mode
// (do NOT enforce) until metrics show real traffic carries tokens. When enabled,
// apiFetch (env.js) also sends the token as X-Firebase-AppCheck to the rigor API.
// CSP note: enabling needs https://www.google.com + https://www.gstatic.com/recaptcha/
// in script-src and https://www.google.com in frame-src (vercel.json).
const APP_CHECK_ENABLED = String(RUNTIME_ENV.VITE_FIREBASE_APPCHECK_ENABLED || "") === "true";
const APP_CHECK_SITE_KEY = RUNTIME_ENV.VITE_FIREBASE_APPCHECK_SITE_KEY || "";

let _fb = null;          // { app, auth, db, authM, fsM } once loaded
let _fbPromise = null;
let _appCheckReady = Promise.resolve(null);

/**
 * Load + init the Firebase SDK (one initializeApp). Idempotent. Resolves to
 * { app, auth, db, authM, fsM }; rejects if the SDK can't load (retry allowed).
 */
export function loadFirebase() {
  if (_fb) return Promise.resolve(_fb);
  if (!_fbPromise) {
    _fbPromise = Promise.all([
      import(SDK + "firebase-app.js"),
      import(SDK + "firebase-auth.js"),
      import(SDK + "firebase-firestore.js")
    ]).then(([appM, authM, fsM]) => {
      const app = appM.getApps().length ? appM.getApp() : appM.initializeApp(FIREBASE_CONFIG);
      _fb = { app, auth: authM.getAuth(app), db: fsM.getFirestore(app), authM, fsM };
      startAppCheck(app);
      return _fb;
    }).catch(err => {
      _fbPromise = null; // allow a later retry
      console.warn("[firebase] SDK unavailable:", err?.message);
      throw err;
    });
  }
  return _fbPromise;
}

/** The loaded Firebase set, or null while it is not loaded (sync, never triggers a load). */
export function firebaseIfLoaded() { return _fb; }

let _afterPaint = null;
/**
 * Resolves once the page has painted and gone idle (window load + idle callback),
 * or on the first user interaction, whichever comes first (5 s hard cap).
 */
export function afterFirstPaint() {
  if (_afterPaint) return _afterPaint;
  _afterPaint = new Promise(resolve => {
    if (typeof window === "undefined") { resolve(); return; }
    let done = false;
    const go = () => { if (!done) { done = true; resolve(); } };
    const idle = () => (window.requestIdleCallback
      ? window.requestIdleCallback(go, { timeout: 1500 })
      : setTimeout(go, 200));
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
    for (const t of ["pointerdown", "keydown", "touchstart"]) {
      window.addEventListener(t, go, { once: true, passive: true, capture: true });
    }
    setTimeout(go, 5000);
  });
  return _afterPaint;
}

function startAppCheck(app) {
  if (!(APP_CHECK_ENABLED && APP_CHECK_SITE_KEY)) return;
  _appCheckReady = import(SDK + "firebase-app-check.js")
    .then(({ initializeAppCheck, ReCaptchaEnterpriseProvider }) => initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
      isTokenAutoRefreshEnabled: true
    }))
    .catch(err => { console.warn("[AppCheck] init failed:", err?.message); return null; });
}

/** App Check token for the rigor API, or null when App Check is off/unavailable. */
export async function getAppCheckToken() {
  if (!(APP_CHECK_ENABLED && APP_CHECK_SITE_KEY)) return null;
  try { await loadFirebase(); } catch { return null; }
  const ac = await _appCheckReady;
  if (!ac) return null;
  try {
    const { getToken } = await import(SDK + "firebase-app-check.js");
    const { token } = await getToken(ac, false);
    return token || null;
  } catch {
    return null;
  }
}
