/**
 * Writes scripts/ci/fixtures/horse-opener-response-vectors.json: the hands on which the engine reducer
 * (HorseOpenerAnswersThreeBet.openerResponseHandIncrements / addOpenerResponseEvidence) and the database reducer
 * (public.fn_horse_opener_response_increments / fn_horse_opener_response_add, migration 20261124195144) must agree.
 * `expected` is what the ENGINE computes; HorseOpenerAnswersThreeBet.test.ts fails when the file and the engine
 * disagree, and scripts/ci/test-horse-exact-public-memory.py fails when the database and the file disagree.
 *
 * Run from server/:  npx tsx scripts/generate-horse-opener-response-vectors.ts
 * Deterministic (seeded); running it twice writes the same content. Reads no database and no network.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildOpenerResponseVectors } from '../src/engine/HorseOpenerAnswersThreeBet.test-support.js';

const out = resolve(
  import.meta.dirname,
  '../../scripts/ci/fixtures/horse-opener-response-vectors.json'
);
writeFileSync(out, JSON.stringify(buildOpenerResponseVectors(), null, 1) + '\n');
console.log('wrote', out);
