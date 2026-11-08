#!/usr/bin/env node
/**
 * Writes docs/evidence/feature-activation/closure-freeze.json from the tree.
 * Usage (repo root, clean tree at the commit being frozen):
 *   (cd server && npx tsx scripts/write-closure-freeze.mjs --plan=<id> --reason="...") [--lift]
 * --lift writes active:false and keeps the record of what was frozen.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closureFreezeFiles, sha256File } from './closure-freeze-files.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(repo, 'docs/evidence/feature-activation/closure-freeze.json');
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
if (process.argv.includes('--lift')) {
  if (!existsSync(out)) throw Error('no freeze to lift');
  const m = JSON.parse(readFileSync(out, 'utf8'));
  m.active = false;
  m.liftedReason = arg('reason') ?? m.liftedReason;
  writeFileSync(out, JSON.stringify(m, null, 2) + '\n');
  process.exit(0);
}
const planId = arg('plan'),
  reason = arg('reason');
if (!planId || !reason) throw Error('--plan and --reason required');
const frozenAt = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const files = (await closureFreezeFiles(path.join(repo, 'server'))).map((p) => ({
  path: p,
  sha256: sha256File(path.join(repo, p)),
}));
const manifest = {
  schema: 'horse-decision-closure-freeze-v1',
  active: true,
  reason,
  planId,
  frozenAt,
  fileCount: files.length,
  files,
};
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log(`froze ${files.length} files at ${frozenAt}`);
