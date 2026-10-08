import { authService } from "./services/authService.js";
import { apiFetch } from "./config/env.js";
import { toast } from "./utils/toast.js";
import { saveDoc, getUserDocs, tsToString } from "./services/firestoreService.js";
import { initPaywall, gate, showPricingModal, renderUsageMeter } from "./services/paywallUI.js";
import {
  initAuthModal, wireAuthNav, openAuthModal, escapeHtml, listItems,
  showToolError, clearToolError
} from "./utils/helpers.js";

// Server-side limits in api/analyze/handler.js (resume.slice(0, 4000), jobDescription.slice(0, 2000)).
// Shown to the user so nothing is cut off silently.
const RESUME_LIMIT = 4000;
const JD_LIMIT = 2000;
const HISTORY_COLLECTION = "resume-analyses";

// ─── State ───────────────────────────────────────────────────────────────────
let currentUser = null;

// ─── DOM ──────────────────────────────────────────────────────────────────────
const heroCta = document.getElementById("hero-cta");
const resumeFile = document.getElementById("resume-file");
const resumeDrop = document.getElementById("resume-drop");
const resumeTextArea = document.getElementById("resume-text");
const jobDesc = document.getElementById("job-description");
const btnAnalyze = document.getElementById("btn-analyze");
const results = document.getElementById("results");
const btnSave = document.getElementById("btn-save");
const historySection = document.getElementById("history-section");
const historyGrid = document.getElementById("history-grid");

// ─── Auth State ───────────────────────────────────────────────────────────────
authService.onAuthChanged(async user => {
  currentUser = user;
  const navLogin = document.getElementById("nav-login");
  if (navLogin) navLogin.textContent = user ? "Sign Out" : "Sign In";
  document.getElementById("nav-signup")?.classList.toggle("nav-signup-hidden", !!user);
  try {
    await initPaywall(user ? user.uid : null);
    if (user) renderUsageMeter("usage-meter-container", "analyses")?.catch?.(() => {});
  } catch (e) {
    console.warn("[paywall] init failed:", e?.message);
  }
  if (user) {
    historySection.classList.remove("hidden");
    loadHistory();
  } else {
    historySection.classList.add("hidden");
  }
});

// Upgrade / manage buttons
document.getElementById("nav-upgrade")?.addEventListener("click", () => showPricingModal("pro"));
document.getElementById("nav-manage")?.addEventListener("click", () => showPricingModal("pro"));
document.getElementById("pricing-upgrade-cta")?.addEventListener("click", (e) => { e.preventDefault(); showPricingModal("pro"); });

// ─── Auth modal + nav ─────────────────────────────────────────────────────────
initAuthModal(authService);
wireAuthNav(authService, () => currentUser);

heroCta?.addEventListener("click", () => {
  document.getElementById("tool").scrollIntoView({ behavior: "smooth" });
});

// ─── Character counters (honest truncation notice) ────────────────────────────
function updateCounter(textarea, noteId, limit, label) {
  const note = document.getElementById(noteId);
  if (!note) return;
  const n = textarea.value.trim().length;
  note.textContent = n > limit
    ? `${n.toLocaleString()} characters. Only the first ${limit.toLocaleString()} characters of your ${label} will be analyzed.`
    : `${n.toLocaleString()} / ${limit.toLocaleString()} characters analyzed`;
  note.classList.toggle("input-note-warn", n > limit);
}
const updateResumeCounter = () => updateCounter(resumeTextArea, "resume-count", RESUME_LIMIT, "resume");
const updateJdCounter = () => updateCounter(jobDesc, "jd-count", JD_LIMIT, "job description");
resumeTextArea.addEventListener("input", updateResumeCounter);
jobDesc.addEventListener("input", updateJdCounter);
updateResumeCounter();
updateJdCounter();

// ─── Resume Upload (plain text only) ──────────────────────────────────────────
// PDF/DOCX are binary formats; reading them as text produced garbage, and no
// parser library is bundled. Only .txt is accepted; other formats must be pasted.
resumeDrop.addEventListener("dragover", e => { e.preventDefault(); resumeDrop.classList.add("drag-over"); });
resumeDrop.addEventListener("dragleave", () => resumeDrop.classList.remove("drag-over"));
resumeDrop.addEventListener("drop", e => {
  e.preventDefault(); resumeDrop.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file) readFile(file);
});
resumeFile.addEventListener("change", e => { if (e.target.files[0]) readFile(e.target.files[0]); });

function isPlainText(file) {
  return file.type === "text/plain" || /\.txt$/i.test(file.name);
}

function readFile(file) {
  if (!isPlainText(file)) {
    toast.warning("Only .txt files can be uploaded. For PDF or Word resumes, copy the text and paste it into the box below.");
    resumeTextArea.focus();
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    resumeTextArea.value = String(e.target.result || "");
    updateResumeCounter();
    resumeDrop.style.borderColor = "var(--gold)";
    resumeDrop.querySelector("p").textContent = `✓ ${file.name} loaded`;
  };
  reader.onerror = () => toast.error("Couldn't read that file. Please paste your resume text instead.");
  reader.readAsText(file);
}

// ─── Analyze ──────────────────────────────────────────────────────────────────
function setBusy(busy) {
  btnAnalyze.querySelector(".btn-text").classList.toggle("hidden", busy);
  btnAnalyze.querySelector(".btn-loader").classList.toggle("hidden", !busy);
  btnAnalyze.disabled = busy;
}

async function runAnalysis(resume, jd) {
  clearToolError();
  results.classList.add("hidden");
  setBusy(true);
  try {
    const analysis = await apiFetch("/api/analyze", { resume, jobDescription: jd });
    renderResults(analysis);
    results.classList.remove("hidden");
    results.scrollIntoView({ behavior: "smooth" });
    renderUsageMeter("usage-meter-container", "analyses")?.catch?.(() => {});
  } catch (err) {
    showToolError(err, () => runAnalysis(resume, jd));
  } finally {
    setBusy(false);
  }
}

async function analyze() {
  const resume = resumeTextArea.value.trim();
  const jd = jobDesc.value.trim();
  if (!resume) { resumeTextArea.focus(); return toast.warning("Please paste your resume text."); }
  if (!jd) { jobDesc.focus(); return toast.warning("Please paste the job description."); }

  if (!currentUser) {
    toast.info("Sign in or create a free account to run an analysis.");
    openAuthModal("login");
    return;
  }

  // Gate behind paywall — free users get a limited number of analyses/month
  try {
    await gate("analyses", () => runAnalysis(resume, jd));
  } catch (err) {
    // e.g. Firestore permission errors while checking usage
    showToolError(err);
  }
}

btnAnalyze.addEventListener("click", analyze);

function renderResults(data) {
  const raw = Number(data?.score);
  if (!data || !Number.isFinite(raw)) {
    throw new Error("The analysis service returned an incomplete result (no score). Please try again.");
  }
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const circumference = 339.3;
  const offset = circumference - (score / 100) * circumference;

  document.getElementById("score-value").textContent = score;
  document.getElementById("score-ring-fill").style.strokeDashoffset = offset;
  document.getElementById("score-label").textContent = score >= 80 ? "Strong Match" : score >= 60 ? "Good Match" : "Needs Work";
  document.getElementById("score-desc").textContent = `AI-estimated match: ${score}/100 against this job description.`;

  const kw = Array.isArray(data.missingKeywords) ? data.missingKeywords : [];
  document.getElementById("missing-keywords").innerHTML = kw.length
    ? kw.map(k => `<span class="tag">${escapeHtml(k)}</span>`).join("")
    : `<p class="empty-note">None found.</p>`;
  document.getElementById("strengths-list").innerHTML = listItems(data.strengths);
  document.getElementById("fixes-list").innerHTML = listItems(data.recommendations);
}

// ─── Save ─────────────────────────────────────────────────────────────────────
btnSave.addEventListener("click", async () => {
  if (!currentUser) return openAuthModal("login");
  const score = parseInt(document.getElementById("score-value").textContent, 10);
  try {
    await saveDoc(HISTORY_COLLECTION, currentUser.uid, {
      score: Number.isFinite(score) ? score : null,
      jobSnippet: jobDesc.value.trim().slice(0, 100),
      resumeSnippet: resumeTextArea.value.trim().slice(0, 100)
    });
    toast.success("Analysis saved!");
    loadHistory();
  } catch (e) {
    toast.error(`Couldn't save: ${e?.message || "unknown error"}`);
  }
});

// ─── History ──────────────────────────────────────────────────────────────────
async function loadHistory() {
  if (!currentUser) return;
  try {
    const items = await getUserDocs(HISTORY_COLLECTION, currentUser.uid, { limitTo: 20 });
    historyGrid.innerHTML = items.map(item => {
      const snippet = item.jobSnippet || "Job analysis";
      return `
      <div class="history-card">
        <div class="history-score">${escapeHtml(item.score ?? "–")}</div>
        <div class="history-title">${escapeHtml(snippet)}${snippet.length >= 100 ? "…" : ""}</div>
        <div class="history-date">${escapeHtml(tsToString(item.createdAt) || "Recently")}</div>
      </div>`;
    }).join("") || `<p class="empty-note">No saved analyses yet.</p>`;
  } catch (e) {
    historyGrid.innerHTML = `<p class="empty-note">Couldn't load your saved analyses: ${escapeHtml(e?.message || "unknown error")}</p>`;
  }
}

// ─── Service worker (moved from an inline <script> so a strict CSP doesn't block it) ──
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
