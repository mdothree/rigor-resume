#!/usr/bin/env node
// copy-lint: fleet-wide public-copy guard (COPY/LEGAL issue type, latarence Bridge, 2026-10-17).
// CANONICAL COPY: ~/latarence/scripts/copy-lint/copy-lint.mjs. Repos COPY this file (no import, no
// dependency) to scripts/copy-lint.mjs and wire it as `prebuild` (or the static site's publish step),
// so a build fails before wrong public copy ships. Re-copy to update; keep the version line in sync.
// copy-lint version: 2026-10-17.3
//
// Fails (exit 1) on, in public copy:
//   FREE      the word "free" (paid-only, no free tier, ever; promo codes are the early-access lever)
//   ZERO      "$0" prices
//   NOCARD    "no card required" / "no credit card needed"
//   P99       .99 prices ("$9.99", price: 4.99); prices are round, no *.99
//   CODENAME  "AHL" / "Anne Huntington Laboratory" (internal codename, never in public copy)
//   LLC       an "... LLC" seller name not allowed by DECISIONS (project names are the seller; only
//             huntingtonapplied.com names "Huntington Applied LLC")
// Flags (printed, exit 0 unless config "delaware": "fail"):
//   DELAWARE  Delaware governing law/venue: open for MDO3/Studios/TSI until the Principal answers L1.
//
// Escapes, each one reviewed: a line containing `copy-lint-allow` (in a comment) is skipped; or
// copy-lint.config.json at the repo/app root:
//   { "scan": ["src","public"], "skip": ["src/trivia"], "allowSellers": ["Huntington Applied LLC"],
//     "allow": [{ "file": "src/data/faq.ts", "re": "free energy", "why": "physics term" }],
//     "delaware": "warn" }
//
//   node scripts/copy-lint.mjs              scan (root = the dir holding package.json/config, or --root DIR)
//   node scripts/copy-lint.mjs --self-test  only check the patterns
//   node scripts/copy-lint.mjs --json       machine-readable findings
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, extname, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };

// ---------- patterns ----------
// "free" uses, not offers: compounds and set phrases. Anything else that says "free" fails.
const FREE_OK = [
  /\b(feel|break|set|run|break(s|ing)?)\s+free\b/i, /\bfree\s+(up|space|memory|disk|ram|storage|text|time|form|throw|fall|will|speech|energy|electrons?|parameters?|variables?|surface|field|radicals?|flow(ing)?|standing|hand|rein|agent|port|slots?|cash\s+flow)\b/i,
  /\b(toll|hands|duty|tax|royalty|interest|risk|error|bug|lock|wait|ad|cruelty|gluten|sugar|stress|hassle|clutter|distraction|interruption|carbon|scot|dependency|allocation|cost|maintenance)[\s-]free\b/i,
  /\bfree\s*-\s*\w/i, /\w\s*-\s*free\b/i, /\bfree\s+energ(y|ies)\b/i, /\bwallpaper\s+free\b/i, /\bfree[\s-]+rid(er|ers|ing)\b/i, /\bfree\s+of\s+(?!charge\b|cost\b)\w+/i,
];
const RULES = [
  { id: "FREE", sev: "fail", re: /\bfree\b/i, ok: FREE_OK, msg: "\"free\" in public copy (paid-only; promo codes are the early-access lever)" },
  { id: "ZERO", sev: "fail", re: /\$\s?0(?:\.0{1,2})?(?![\d.,])/, ctx: /(\$\s?0(?:\.0{1,2})?\s*(\/|per\b|a\s+month|\/?\s*(mo|month|yr|year|forever)\b))|\b(price|pricing|plan|tier|starter|personal|basic|hobby|subscription|cost)s?\b/i, msg: "$0 price (balances/totals are fine; price context only)" },
  { id: "NOCARD", sev: "fail", re: /\bno\s+(credit\s+)?card\s+(is\s+)?(required|needed)\b/i, msg: "\"no card required\"" },
  { id: "P99", sev: "fail", re: /(\$\s?\d{1,5}\.99\b|\b(price|amount|cost|monthly|yearly|annual)\w*["']?\s*[:=]\s*["']?\d{1,5}\.99\b|\bdata-price=["']\d{1,5}\.99)/i, msg: ".99 price (prices are round)" },
  { id: "CODENAME", sev: "fail", re: /(\bAHL\b|Anne\s+Huntington\s+Laborator(y|ies))/, msg: "internal codename AHL / Anne Huntington Laboratory in public copy" },
  { id: "LLC", sev: "fail", re: /\b((?:[A-Z][\w&.'-]*\s+){0,4}[A-Z][\w&.'-]*,?\s+L\.?L\.?C)\b\.?/, msg: "LLC seller name (DECISIONS 2026-10-15: legal pages name the project; only Huntington Applied's own site names Huntington Applied LLC)", seller: true },
  { id: "DELAWARE", sev: "flag", re: /\bDelaware\b/, msg: "Delaware governing law/venue: flag, pending the Principal's L1 answer (do not change here)" },
];

// ---------- self-test (real copy that shipped, and real uses that must pass) ----------
const MUST_CATCH = {
  FREE: ["14-day free trial included. Cancel anytime.", "name: 'Free',", "Try any plan free for 30 days.", "free of charge", "Create a free account to save this design", "Play Free", "free web-based games", "Start free", "Free plan"],
  ZERO: ["Personal $0/month For individual developers", "Starter $0", "$0 per month", "price: '$0'"],
  NOCARD: ["log a contribution in under ten minutes. No card required.", "No credit card needed"],
  P99: ["Get Premium Names - $2.99", 'data-pro-label="$9.99/mo"', "price: 4.99,", 'data-price="4.99"'],
  CODENAME: ["Built by AHL", "a project of Anne Huntington Laboratory"],
  LLC: ["sold by Butts Studios, LLC", "Runwae Apparel LLC", "© 2026 Butts Technologies, LLC."],
  DELAWARE: ["governed by the laws of the State of Delaware"],
};
const MUST_PASS = [
  "Early access: ask for a promo code, then redeem it at checkout.", "Pure + dependency-free (no enums/namespaces)",
  "Flow state: sustained interruption free focus.", "launchPrice: 0.0144,", "Gibbs free energy of the system",
  "Feel free to reach out", "Starter $20/month", "Pro $5.00 per month", "$0.50 per run", "isFree && plan",
  "tier: 'free' | 'pro' | 'enterprise';", "free: true,", "{item.free ? (", "const isPaid = subscription.tier !== 'free';",
  "value: '$0', name: 'Total Earned'", "if (!cents) return '$0';", "solvation free energies", "keep codebases free of corruption", "A free rider is someone",
  "AHL_API_BASE", "toll-free number", "Google LLC, Gmail (email).", "Plans start at $5", "$100 / $500 / $2,000", "price: 9.90,",
];
const findRule = (line, sellers = ["Google LLC", "YouTube LLC"]) => {
  const out = [];
  // Code identifiers are not copy: lowercase 'free' literals, free: keys, x.free members, free?: types.
  const idMasked = line.replace(/(['"`])free\1/g, "#").replace(/\bfree\??\s*:/g, "#:").replace(/\.free\b/g, ".#");
  for (const r of RULES) {
    if (r.ctx && !r.ctx.test(line)) continue;
    const m = (r.id === "FREE" ? idMasked : line).match(r.re);
    if (!m) continue;
    if (r.ok && r.id === "FREE") {
      // every "free" occurrence must be covered by an allowed use
      const all = [...idMasked.matchAll(/\bfree\b/gi)];
      const masked = r.ok.reduce((s, re) => s.replace(new RegExp(re.source, "gi"), (x) => "#".repeat(x.length)), idMasked);
      if (!all.some((a) => /\bfree\b/i.test(masked.slice(Math.max(0, a.index - 1), a.index + 5)))) continue;
    }
    if (r.seller) {
      const name = m[1].replace(/\s+/g, " ").trim();
      if (sellers.some((s) => name.endsWith(s) || name.replace(/,/g, "").endsWith(s.replace(/,/g, "")))) continue;
    }
    out.push(r);
  }
  return out;
};
{
  let bad = 0;
  for (const [id, samples] of Object.entries(MUST_CATCH))
    for (const s of samples) if (!findRule(s).some((r) => r.id === id)) { console.error(`copy-lint self-test: ${id} misses ${JSON.stringify(s)}`); bad++; }
  for (const s of MUST_PASS) { const h = findRule(s); if (h.length) { console.error(`copy-lint self-test: false positive ${h.map((r) => r.id)} on ${JSON.stringify(s)}`); bad++; } }
  if (findRule("© 2026 Huntington Applied LLC", ["Huntington Applied LLC"]).length) { console.error("copy-lint self-test: allowSellers ignored"); bad++; }
  if (bad) process.exit(2);
  if (flag("--self-test")) { console.log("copy-lint: self-test OK"); process.exit(0); }
}

// ---------- config ----------
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(opt("--root") || (existsSync(join(here, "..", "package.json")) || existsSync(join(here, "..", "copy-lint.config.json")) ? join(here, "..") : process.cwd()));
let cfg = {};
const cfgPath = join(ROOT, "copy-lint.config.json");
if (existsSync(cfgPath)) { try { cfg = JSON.parse(readFileSync(cfgPath, "utf8")); } catch (e) { console.error(`copy-lint: bad ${cfgPath}: ${e.message}`); process.exit(2); } }
const DEFAULT_SCAN = ["src", "app", "pages", "components", "content", "public", "web", "site", "data", "lib/data", "templates", "_includes", "_layouts"];
const SCAN = cfg.scan || DEFAULT_SCAN;
const SKIP_DIR = new Set(["node_modules", ".next", ".nuxt", "out", "dist", "build", ".git", ".vercel", "coverage", "__tests__", "tests", "test", "e2e", "trivia", "Trivia", "vendor", "fonts", "img", "images", "assets/img", ...(cfg.skipDirs || [])]);
const SKIP = (cfg.skip || []).map((p) => p.replace(/\/$/, ""));
const EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".md", ".mdx", ".txt", ".html", ".htm", ".vue", ".svelte", ".astro", ".njk", ".liquid", ".yml", ".yaml", ".xml"]);
const CODE = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".vue", ".svelte", ".astro"]);
// Third-party processors named in privacy pages are not sellers.
const THIRD_PARTY = ["Google LLC", "YouTube LLC", "Waymo LLC", "Discord Inc"];
const SELLERS = [...THIRD_PARTY, ...(cfg.allowSellers || [])];
const ALLOW = (cfg.allow || []).map((a) => ({ file: a.file || "", re: new RegExp(a.re, "i") }));
const DELAWARE = cfg.delaware || "warn";

function* walk(p) {
  let st; try { st = statSync(p); } catch { return; }
  const rel = relative(ROOT, p);
  if (SKIP.some((s) => rel === s || rel.startsWith(s + "/"))) return;
  if (st.isDirectory()) { for (const n of readdirSync(p)) if (!SKIP_DIR.has(n)) yield* walk(join(p, n)); }
  else if (EXT.has(extname(p)) && !/(^|\/)README[^/]*$|\.(test|spec|stories)\.\w+$|\.min\.js$|\.map$|package(-lock)?\.json$|tsconfig.*\.json$/.test(p) && st.size < 2_000_000) yield p;
}
// Code comments are not served copy (minified away); HTML comments are served and stay in.
function stripComments(text) {
  let out = "", i = 0, inBlock = false;
  for (const line of text.split(/\r?\n/)) {
    let l = line;
    if (inBlock) { const e = l.indexOf("*/"); if (e < 0) { out += "\n"; continue; } l = " ".repeat(e + 2) + l.slice(e + 2); inBlock = false; }
    l = l.replace(/\/\*.*?\*\//g, (m) => " ".repeat(m.length));
    const b = l.search(/(^|[\s{(])\/\*/); if (b >= 0 && !l.slice(b).includes("*/")) { l = l.slice(0, b); inBlock = true; }
    l = l.replace(/(^|\s)\/\/.*$/, "");
    out += l + "\n"; i++;
  }
  return out;
}

const roots = new Set();
for (const d of SCAN) roots.add(join(ROOT, d));
for (const n of readdirSync(ROOT)) if (/\.(html?|md)$/.test(n) && !/^(README|CHANGELOG|CLAUDE|AGENTS|CONTRIBUTING)/i.test(n)) roots.add(join(ROOT, n));
const findings = [];
for (const r of roots) for (const f of walk(r)) {
  const raw = readFileSync(f, "utf8");
  const text = CODE.has(extname(f)) ? stripComments(raw) : raw;
  const rawLines = raw.split(/\r?\n/);
  const rel = relative(ROOT, f);
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim() || /copy-lint-allow/.test(rawLines[i] || "")) return;
    for (const rule of findRule(line, SELLERS)) {
      if (ALLOW.some((a) => (!a.file || rel === a.file || rel.startsWith(a.file)) && a.re.test(line))) continue;
      const sev = rule.id === "DELAWARE" ? (DELAWARE === "fail" ? "fail" : DELAWARE === "off" ? null : "flag") : rule.sev;
      if (sev) findings.push({ file: rel, line: i + 1, rule: rule.id, sev, msg: rule.msg, text: line.trim().slice(0, 180) });
    }
  });
}
const fails = findings.filter((f) => f.sev === "fail"), flags = findings.filter((f) => f.sev === "flag");
if (flag("--json")) { console.log(JSON.stringify({ root: ROOT, fails, flags }, null, 1)); process.exit(fails.length ? 1 : 0); }
for (const f of flags) console.log(`copy-lint FLAG ${f.file}:${f.line} [${f.rule}] ${f.text}`);
if (fails.length) {
  console.error(`copy-lint: ${fails.length} public-copy violation(s) (COPY/LEGAL; fix the copy, or add a reviewed copy-lint-allow):`);
  for (const f of fails) console.error(`  ${f.file}:${f.line} [${f.rule}] ${f.text}`);
  process.exit(1);
}
console.log(`copy-lint: OK (${flags.length} flag(s))`);
