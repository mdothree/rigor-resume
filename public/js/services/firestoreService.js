/**
 * services/firestoreService.js
 * Generic Firestore CRUD service. Each project passes its collection name.
 * Provides: save, getAll, getById, update, remove, subscribeToCollection
 */

import { db } from "../config/firebase.js";
import {
  collection, doc, addDoc, getDoc, getDocs, setDoc, updateDoc,
  deleteDoc, query, where, orderBy, limit, onSnapshot,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── Core CRUD ────────────────────────────────────────────────────────────────

export async function saveDoc(collectionName, userId, data) {
  const ref = await addDoc(collection(db, collectionName), {
    userId,
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return ref.id;
}

export async function updateDoc_(collectionName, docId, data) {
  await updateDoc(doc(db, collectionName, docId), {
    ...data,
    updatedAt: serverTimestamp()
  });
}

export async function getDoc_(collectionName, docId) {
  const snap = await getDoc(doc(db, collectionName, docId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function deleteDoc_(collectionName, docId) {
  await deleteDoc(doc(db, collectionName, docId));
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getUserDocs(collectionName, userId, options = {}) {
  const { orderByField = "createdAt", orderDir = "desc", limitTo = 50 } = options;
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

export function subscribeToUserDocs(collectionName, userId, callback, options = {}) {
  const { orderByField = "createdAt", orderDir = "desc", limitTo = 50 } = options;
  const q = query(
    collection(db, collectionName),
    where("userId", "==", userId),
    orderBy(orderByField, orderDir),
    limit(limitTo)
  );
  return onSnapshot(q, snap => {
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(docs);
  });
}

// ─── User profile ─────────────────────────────────────────────────────────────

export async function getUserProfile(userId) {
  const snap = await getDoc(doc(db, "users", userId));
  return snap.exists() ? snap.data() : null;
}

export async function upsertUserProfile(userId, data) {
  await setDoc(doc(db, "users", userId), {
    ...data,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// ─── Usage helpers ────────────────────────────────────────────────────────────

export async function incrementUsage(userId, action) {
  const month = new Date().toISOString().slice(0, 7);
  const ref = doc(db, "usage", `${userId}_${month}`);
  await setDoc(ref, {
    [action]: (await getUsageCount(userId, action)) + 1,
    userId, month,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

export async function getUsageCount(userId, action) {
  const month = new Date().toISOString().slice(0, 7);
  const snap = await getDoc(doc(db, "usage", `${userId}_${month}`));
  return snap.exists() ? (snap.data()[action] || 0) : 0;
}

// ─── Timestamp helpers ────────────────────────────────────────────────────────

export function tsToDate(ts) {
  if (!ts) return null;
  if (ts instanceof Timestamp) return ts.toDate();
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
