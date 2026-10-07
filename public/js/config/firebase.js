import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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
 */
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDCIDNUzirzlHapKBLcMXR-iYSOiV6yUvo",
  authDomain: "mdo3d-career.firebaseapp.com",
  projectId: "mdo3d-career",
  storageBucket: "mdo3d-career.firebasestorage.app",
  messagingSenderId: "408387980482",
  appId: "1:408387980482:web:d564e195308f4da2553f5b"
};

const RUNTIME_ENV = (typeof window !== "undefined" && window.__ENV__) || {};
const FIREBASE_CONFIG = RUNTIME_ENV.FIREBASE_CONFIG || DEFAULT_FIREBASE_CONFIG;

// env.js, authService.js, firestoreService.js and paymentService.js import { auth, db }.
const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;

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

let _appCheck = null;
const _appCheckReady = (APP_CHECK_ENABLED && APP_CHECK_SITE_KEY)
  ? import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js")
      .then(({ initializeAppCheck, ReCaptchaEnterpriseProvider }) => {
        _appCheck = initializeAppCheck(app, {
          provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
          isTokenAutoRefreshEnabled: true
        });
        return _appCheck;
      })
      .catch(err => { console.warn("[AppCheck] init failed:", err?.message); return null; })
  : Promise.resolve(null);

/** App Check token for the rigor API, or null when App Check is off/unavailable. */
export async function getAppCheckToken() {
  const ac = await _appCheckReady;
  if (!ac) return null;
  try {
    const { getToken } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js");
    const { token } = await getToken(ac, false);
    return token || null;
  } catch {
    return null;
  }
}
