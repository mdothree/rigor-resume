#!/usr/bin/env node
// L-RES-03: writes public/health.json at deploy build time (vercel.json buildCommand). No dependencies.
// It is a static deployment stamp: a 200 means this tool site is being served, nothing more.
// The truthful service signal is the rigor API's /health (api_health below), which the page's
// apiReachable() reads before checkout can open.
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
// Commit: VERCEL_GIT_COMMIT_SHA on git-connected builds; scripts/source-commit.txt is filled in by
// `git archive` (export-subst, .gitattributes) for CLI deploys of an archive; otherwise null.
let commit = process.env.VERCEL_GIT_COMMIT_SHA || null;
try {
  const s = readFileSync(new URL('scripts/source-commit.txt', root), 'utf8').trim();
  if (/^[0-9a-f]{40}$/.test(s)) commit = s;
} catch {}
const stamp = {
  service: pkg.name,
  kind: 'static',
  built_at: new Date().toISOString(),
  commit,
  vercel_env: process.env.VERCEL_ENV || null,
  api_health: 'https://api.rigor.design/health',
};
writeFileSync(new URL('public/health.json', root), JSON.stringify(stamp, null, 2) + '\n');
console.log(`health.json: ${stamp.service} ${stamp.built_at} ${commit || '(no commit)'}`);
