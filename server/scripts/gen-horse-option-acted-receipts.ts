/**
 * Writes scripts/ops/horse-option-acted-receipts.json: the acted receipts of every registered option that takes shadow
 * or on_shadow, derived from the ledger (HorseOptionActedReceipts.ts). The live shadow watch
 * (scripts/ops/horse-option-shadow-watch.mjs) reads it; everyShadowOptionKnowsItsActedReceipts.law.test.ts fails when
 * it differs from the derivation.
 *
 *   npx tsx scripts/gen-horse-option-acted-receipts.ts           (from server/: rewrite the file)
 *   npx tsx scripts/gen-horse-option-acted-receipts.ts --check   (exit 1 when the file is stale)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { optionActedReceiptsJson } from '../src/engine/HorseOptionActedReceipts.js';
import { OPTION_SWITCH_REGISTRY } from '../src/engine/HorseOptionSwitch.js';

const FILE = fileURLToPath(
  new URL('../../scripts/ops/horse-option-acted-receipts.json', import.meta.url)
);
const text = optionActedReceiptsJson(OPTION_SWITCH_REGISTRY);
if (process.argv.includes('--check')) {
  let now: unknown = null;
  try {
    now = JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {
    /* missing or unreadable reads as stale */
  }
  // compared as data: the repository's formatter may lay the file out differently from JSON.stringify
  if (!isDeepStrictEqual(now, JSON.parse(text))) {
    console.error(
      `${FILE} is stale: run npx tsx scripts/gen-horse-option-acted-receipts.ts from server/`
    );
    process.exit(1);
  }
  console.log('acted receipts file is current');
} else {
  writeFileSync(FILE, text);
  console.log(`wrote ${FILE}`);
}
