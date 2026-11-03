// Pure state helpers for app.js (no DOM, no Firebase) so they can be unit-tested with `node --test`.
// FS-NF-01 / FS-NF-02 / FS-NF-03 (client side).

const isStrArr = a => Array.isArray(a) && a.every(x => typeof x === "string");

/** Strict result contract: finite 0-100 score (null / "" / booleans are NOT zero) and string arrays. Throws on anything else. */
export function normalizeAnalysis(data) {
  const s = data && data.score;
  const n = typeof s === "number" ? s : (typeof s === "string" && s.trim() !== "" ? Number(s) : NaN);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error("The analysis service returned an incomplete result (no valid score). Please try again.");
  if (!isStrArr(data.strengths) || !data.strengths.length || !isStrArr(data.recommendations) || !data.recommendations.length
      || (data.missingKeywords !== undefined && !isStrArr(data.missingKeywords))) {
    throw new Error("The analysis service returned an incomplete result. Please try again.");
  }
  return { score: Math.round(n), missingKeywords: data.missingKeywords || [], strengths: data.strengths, recommendations: data.recommendations };
}

/**
 * One session per page. `identity(uid)` is called on every auth change; a different uid starts a new generation, which
 * invalidates in-flight requests and drops the accepted analysis. `begin()` captures the generation and the exact
 * inputs sent for analysis; `commit()` only keeps the result if that generation is still current, so what Save later
 * persists is the immutable (inputs, result, uid) triple that was actually analyzed.
 */
export function createAnalysisSession() {
  let gen = 0, uid = null, record = null;
  return {
    identity(nextUid) {
      const changed = (nextUid || null) !== uid;
      if (changed) { gen++; record = null; }
      uid = nextUid || null;
      return changed;
    },
    begin(resume, jd) { return { gen, uid, resume, jd }; },
    isCurrent(ticket) { return ticket.gen === gen && ticket.uid === uid && uid !== null; },
    commit(ticket, analysis) {
      if (!this.isCurrent(ticket)) return null;
      record = Object.freeze({
        uid: ticket.uid, score: analysis.score,
        jobSnippet: ticket.jd.trim().slice(0, 100), resumeSnippet: ticket.resume.trim().slice(0, 100),
      });
      return record;
    },
    clearRecord() { record = null; },
    /** The record to persist, only for the user who ran it. */
    saveable(currentUid) { return record && record.uid === currentUid ? record : null; },
    ticket() { return { gen, uid }; },
  };
}
