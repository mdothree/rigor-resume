// FS-NF-01/02/03 client: node --test tests/analysisState.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAnalysis, createAnalysisSession } from "../public/js/analysisState.js";

const good = { score: 80, missingKeywords: ["x"], strengths: ["s"], recommendations: ["r"] };

test("Number(null) / '' / false no longer become a real 0, and non-array recommendations are rejected", () => {
  for (const score of [null, "", false, [], undefined]) assert.throws(() => normalizeAnalysis({ ...good, score }), /incomplete/);
  assert.throws(() => normalizeAnalysis({ ...good, recommendations: "x" }), /incomplete/);
  assert.equal(normalizeAnalysis({ ...good, score: "55" }).score, 55);
});

test("save uses the analyzed inputs, not the textareas edited afterwards", () => {
  const s = createAnalysisSession(); s.identity("u1");
  const t = s.begin("RESUME AS ANALYZED", "JD AS ANALYZED");
  const rec = s.commit(t, normalizeAnalysis(good));
  assert.equal(rec.resumeSnippet, "RESUME AS ANALYZED");
  assert.equal(s.saveable("u1").score, 80);
  assert.throws(() => { "use strict"; rec.score = 1; }, TypeError);   // immutable record
});

test("identity change invalidates in-flight work and drops the record (no cross-account save)", () => {
  const s = createAnalysisSession(); s.identity("u1");
  const t = s.begin("r", "j");
  s.identity("u2");                                   // account switched while the request was pending
  assert.equal(s.commit(t, normalizeAnalysis(good)), null);
  assert.equal(s.saveable("u2"), null);
  const t2 = s.begin("r2", "j2"); s.commit(t2, normalizeAnalysis(good));
  s.identity("u1");
  assert.equal(s.saveable("u1"), null);               // u2's result is gone, and never saveable as u1
  s.identity(null);
  assert.equal(s.isCurrent(s.begin("a", "b")), false);// signed out: nothing is current
});
