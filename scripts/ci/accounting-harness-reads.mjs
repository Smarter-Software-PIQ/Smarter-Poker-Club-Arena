#!/usr/bin/env node
// Generates scripts/ci/accounting-harness-reads.json: every repository file an
// accounting_postgres harness reads (see accountingHarnessReads in
// classify-ci-changes.mjs). --check fails when the committed file differs.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCOUNTING_HARNESS_READS,
  accountingHarnessReads,
  accountingJobNamedInputs,
} from './classify-ci-changes.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export function generatedAccountingHarnessReads(at = root) {
  const reads = accountingHarnessReads(at, accountingJobNamedInputs(at));
  return `${JSON.stringify({ generator: 'scripts/ci/accounting-harness-reads.mjs', ...reads }, null, 2)}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = resolve(root, ACCOUNTING_HARNESS_READS);
  const value = generatedAccountingHarnessReads();
  if (process.argv.includes('--write')) {
    writeFileSync(target, value);
    console.log(`wrote ${ACCOUNTING_HARNESS_READS}`);
  } else {
    let current = '';
    try {
      current = readFileSync(target, 'utf8');
    } catch {}
    if (current !== value) {
      console.error(
        `${ACCOUNTING_HARNESS_READS} differs: run node scripts/ci/accounting-harness-reads.mjs --write`
      );
      process.exit(1);
    }
    console.log(`${ACCOUNTING_HARNESS_READS} matches its harnesses`);
  }
}
