import { loadFirebase, firebaseIfLoaded, afterFirstPaint } from "../config/firebase.js";

// PERF-003: the Firebase Auth SDK is lazy (see config/firebase.js). Actions load
// it on demand; the auth listener attaches after first paint, so a signed-in user
// is still restored on load without blocking it. Until then the app is "signed
// out" (gates fail closed). If the SDK can't load, the listener reports null.
export const authService = {
  async signUp(email, password, name) {
    const { auth, authM } = await loadFirebase();
    const cred = await authM.createUserWithEmailAndPassword(auth, email, password);
    if (name) await authM.updateProfile(cred.user, { displayName: name });
    return cred.user;
  },

  async signIn(email, password) {
    const { auth, authM } = await loadFirebase();
    const cred = await authM.signInWithEmailAndPassword(auth, email, password);
    return cred.user;
  },

  async signOut() {
    const { auth, authM } = await loadFirebase();
    await authM.signOut(auth);
  },

  /** Subscribe to auth changes; returns an unsubscribe function synchronously. */
  onAuthChanged(callback) {
    let cancelled = false;
    let unsub = null;
    afterFirstPaint().then(loadFirebase).then(({ auth, authM }) => {
      if (cancelled) return;
      unsub = authM.onAuthStateChanged(auth, callback);
    }, () => {
      if (!cancelled) callback(null);
    });
    return () => { cancelled = true; if (unsub) unsub(); };
  },

  currentUser() {
    return firebaseIfLoaded()?.auth.currentUser ?? null;
  }
};
