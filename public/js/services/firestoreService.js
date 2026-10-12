/**
 * services/firestoreService.js
 * Generic Firestore CRUD service. Each project passes its collection name.
 * Provides: save, getAll, getById, update, remove, subscribeToCollection
 */

import { loadFirebase } from "../config/firebase.js";

// PERF-003: Firestore is lazy. Each call awaits the SDK (loaded once); if it can't
// load, the call rejects into the caller's try/catch, as a Firestore error did.
async function fs() {
  const { db, fsM } = await loadFirebase();
  return { db, ...fsM };
}

// ─── Core CRUD ────────────────────────────────────────────────────────────────

export async function saveDoc(collectionName, userId, data) {
  const { db, collection, addDoc, serverTimestamp } = await fs();
  const ref = await addDoc(collection(db, collectionName), {
    userId,
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return ref.id;
}

export async function updateDoc_(collectionName, docId, data) {
  const { db, doc, updateDoc, serverTimestamp } = await fs();
  await updateDoc(doc(db, collectionName, docId), {
    ...data,
    updatedAt: serverTimestamp()
  });
}

export async function getDoc_(collectionName, docId) {
  const { db, doc, getDoc } = await fs();
  const snap = await getDoc(doc(db, collectionName, docId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function deleteDoc_(collectionName, docId) {
  const { db, doc, deleteDoc } = await fs();
  await deleteDoc(doc(db, collectionName, docId));
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getUserDocs(collectionName, userId, options = {}) {
  const { orderByField = "createdAt", orderDir = "desc", limitTo = 50 } = options;
  const { db, collection, query, where, orderBy, limit, getDocs } = await fs();
  const q = query(
    collection(db, collectionName),
    where("userId", "==", userId),
    orderBy(orderByField, orderDir),
    limit(limitTo)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getUserDocsByField(collectionName, userId, field, value) {
  const { db, collection, query, where, orderBy, getDocs } = await fs();
  const q = query(
    collection(db, collectionName),
    where("userId", "==", userId),
    where(field, "==", value),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ─── Real-time ────────────────────────────────────────────────────────────────

// Returns an unsubscribe function synchronously (the listener attaches once the SDK loads).
export function subscribeToUserDocs(collectionName, userId, callback, options = {}) {
  const { orderByField = "createdAt", orderDir = "desc", limitTo = 50 } = options;
  let cancelled = false;
  let unsub = null;
  fs().then(({ db, collection, query, where, orderBy, limit, onSnapshot }) => {
    if (cancelled) return;
    const q = query(
      collection(db, collectionName),
      where("userId", "==", userId),
      orderBy(orderByField, orderDir),
      limit(limitTo)
    );
    unsub = onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(docs);
    });
  }).catch(e => console.warn("[firestore] subscribe failed:", e?.message));
  return () => { cancelled = true; if (unsub) unsub(); };
}

// ─── User profile ─────────────────────────────────────────────────────────────

export async function getUserProfile(userId) {
  const { db, doc, getDoc } = await fs();
  const snap = await getDoc(doc(db, "users", userId));
  return snap.exists() ? snap.data() : null;
}


// Usage counters (usage/{uid}_{YYYY-MM}) are written only by the rigor API; read
// them via paymentService.getUsage().

// ─── Timestamp helpers ────────────────────────────────────────────────────────

export function tsToDate(ts) {
  if (!ts) return null;
  if (typeof ts?.toDate === "function") return ts.toDate(); // Firestore Timestamp
  if (ts?.seconds) return new Date(ts.seconds * 1000);
  return new Date(ts);
}

export function tsToString(ts, opts = {}) {
  const d = tsToDate(ts);
  if (!d) return "";
  return d.toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric", ...opts
  });
}
