import { authService } from "./services/authService.js";
import { validators, guardSubmit } from "./utils/validate.js";
import { apiFetch } from "./config/env.js";
import { toast } from "./utils/toast.js";
import { firestoreService } from "./services/firestoreService.js";
import { initPaywall, gate, showPricingModal, renderUsageMeter } from "./services/paywallUI.js";

// ─── State ───────────────────────────────────────────────────────────────────
let currentUser = null;
let resumeText = "";

// ─── DOM ──────────────────────────────────────────────────────────────────────
const authModal = document.getElementById("auth-modal");
const modalClose = document.getElementById("modal-close");
const navLogin = document.getElementById("nav-login");
const navSignup = document.getElementById("nav-signup");
const heroCta = document.getElementById("hero-cta");
const btnLogin = document.getElementById("btn-login");
const btnSignup = document.getElementById("btn-signup");
const authError = document.getElementById("auth-error");
const tabBtns = document.querySelectorAll(".tab-btn");
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
  if (user) {
    navLogin.textContent = "Sign Out";
    navSignup.style.display = "none";
    await initPaywall(user.uid);
    renderUsageMeter("usage-meter-container", "analyses");
    loadHistory();
    historySection.classList.remove("hidden");
  } else {
    navLogin.textContent = "Sign In";
    navSignup.style.display = "";
    await initPaywall(null);
    historySection.classList.add("hidden");
  }
});

// Upgrade / manage buttons
document.getElementById("nav-upgrade")?.addEventListener("click", () => showPricingModal("pro"));
document.getElementById("nav-manage")?.addEventListener("click", () => showPricingModal("pro"));

// ─── Auth Handlers ────────────────────────────────────────────────────────────
function openModal(tab = "login") {
  authModal.classList.remove("hidden");
  document.querySelector(`[data-tab="${tab}"]`).click();
}

navLogin.addEventListener("click", e => {
  e.preventDefault();
  if (currentUser) {
    authService.signOut();
  } else {
    openModal("login");
  }
});

navSignup.addEventListener("click", e => { e.preventDefault(); openModal("signup"); });
heroCta.addEventListener("click", () => {
  document.getElementById("tool").scrollIntoView({ behavior: "smooth" });
});
modalClose.addEventListener("click", () => authModal.classList.add("hidden"));
authModal.addEventListener("click", e => { if (e.target === authModal) authModal.classList.add("hidden"); });

tabBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    tabBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".tab-content").forEach(t => t.classList.add("hidden"));
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove("hidden");
    authError.classList.add("hidden");
  });
});

btnLogin.addEventListener("click", async () => {
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;
  try {
    await authService.signIn(email, password);
    authModal.classList.add("hidden");
  } catch (err) {
    authError.textContent = err.message;
    authError.classList.remove("hidden");
  }
});

btnSignup.addEventListener("click", async () => {
  const name = document.getElementById("signup-name").value;
  const email = document.getElementById("signup-email").value;
  const password = document.getElementById("signup-password").value;
  try {
    await authService.signUp(email, password, name);
    authModal.classList.add("hidden");
  } catch (err) {
    authError.textContent = err.message;
    authError.classList.remove("hidden");
  }
});

// ─── Resume Upload ────────────────────────────────────────────────────────────
resumeDrop.addEventListener("dragover", e => { e.preventDefault(); resumeDrop.classList.add("drag-over"); });
resumeDrop.addEventListener("dragleave", () => resumeDrop.classList.remove("drag-over"));
resumeDrop.addEventListener("drop", e => {
  e.preventDefault(); resumeDrop.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file) readFile(file);
});
resumeFile.addEventListener("change", e => { if (e.target.files[0]) readFile(e.target.files[0]); });

function readFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    resumeText = e.target.result;
    resumeTextArea.value = resumeText.slice(0, 5000);
    resumeDrop.style.borderColor = "var(--gold)";
    resumeDrop.querySelector("p").textContent = `✓ ${file.name} loaded`;
  };
  reader.readAsText(file);
}

// ─── Analyze ──────────────────────────────────────────────────────────────────
btnAnalyze.addEventListener("click", async () => {
  const resume = resumeTextArea.value.trim() || resumeText;
  const jd = jobDesc.value.trim();
  if (!resume || !jd) return toast.warning("Please provide both a resume and job description.");

  // Gate behind paywall — free users get 3 analyses/month
  gate("analyses",
    async () => {
      // ── Allowed ──
      const btnText = document.querySelector(".btn-text");
      const btnLoader = document.querySelector(".btn-loader");
      btnText.classList.add("hidden");
      btnLoader.classList.remove("hidden");
      btnAnalyze.disabled = true;
      // Show skeleton while loading
      results.classList.remove("hidden");
      showSkeleton("results", 4, "table");
      try {
        const analysis = await callAnalysisAPI(resume, jd);
        hideSkeleton("results");
        renderResults(analysis);
        results.scrollIntoView({ behavior: "smooth" });
        renderUsageMeter("usage-meter-container", "analyses");
      } catch (err) {
        toast.error("Analysis failed: ");
      } finally {
        btnText.classList.remove("hidden");
        btnLoader.classList.add("hidden");
        btnAnalyze.disabled = false;
      }
    },
    () => {
      // ── Blocked — show upgrade prompt (handled by gate()) ──
    }
  );
});

async function callAnalysisAPI(resume, jobDescription) {
  const res = await apiFetch("/api/analyze", { resume, jobDescription });
  if (!res.ok) throw new Error("API error");
  return res.json();
}

function renderResults(data) {
  const score = data.score || 72;
  const circumference = 339.3;
  const offset = circumference - (score / 100) * circumference;

  document.getElementById("score-value").textContent = score;
  document.getElementById("score-ring-fill").style.strokeDashoffset = offset;
  document.getElementById("score-label").textContent = score >= 80 ? "Strong Match" : score >= 60 ? "Good Match" : "Needs Work";
  document.getElementById("score-desc").textContent = `This resume is ${score}% compatible with the job requirements.`;

  const kwEl = document.getElementById("missing-keywords");
  kwEl.innerHTML = (data.missingKeywords || []).map(k => `<span class="tag">${k}</span>`).join("");

  const strengthsEl = document.getElementById("strengths-list");
  strengthsEl.innerHTML = (data.strengths || []).map(s => `<li>${s}</li>`).join("");

  const fixesEl = document.getElementById("fixes-list");
  fixesEl.innerHTML = (data.recommendations || []).map(r => `<li>${r}</li>`).join("");
}

// ─── Save ─────────────────────────────────────────────────────────────────────
btnSave.addEventListener("click", async () => {
  if (!currentUser) return openModal("login");
  const score = document.getElementById("score-value").textContent;
  await firestoreService.saveAnalysis(currentUser.uid, {
    score: parseInt(score),
    jobSnippet: jobDesc.value.slice(0, 100),
    resumeSnippet: resumeTextArea.value.slice(0, 100)
  });
  loadHistory();
  toast.success("Analysis saved!");
});

// ─── History ──────────────────────────────────────────────────────────────────
async function loadHistory() {
  if (!currentUser) return;
  const items = await firestoreService.getAnalyses(currentUser.uid);
  historyGrid.innerHTML = items.map(item => `
    <div class="history-card">
      <div class="history-score">${item.score}</div>
      <div class="history-title">${item.jobSnippet || "Job Analysis"}...</div>
      <div class="history-date">${item.createdAt?.toDate?.().toLocaleDateString?.() || "Recently"}</div>
    </div>
  `).join("") || "<p style='color:var(--gray-400)'>No saved analyses yet.</p>";
}
