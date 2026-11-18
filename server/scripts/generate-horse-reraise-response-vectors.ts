/**
 * Writes scripts/ci/fixtures/horse-reraise-response-vectors.json: the hands on which the engine reducer
 * (HorseOmahaReraiseResponse.reraiseResponseHandIncrements / addReraiseResponseEvidence) and the database reducer
 * (public.fn_horse_reraise_response_increments / fn_horse_reraise_response_add, migration 20261118023000) must
 * agree. `expected` is what the ENGINE computes; HorseOmahaReraiseResponse.test.ts fails when the file and the
 * engine disagree, and scripts/ci/test-horse-exact-public-memory.py fails when the database and the file disagree.
 *
 * Run from server/:  npx tsx scripts/generate-horse-reraise-response-vectors.ts
 * Deterministic (seeded); running it twice writes the same content. Reads no database and no network.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildReraiseResponseVectors } from '../src/engine/HorseOmahaReraiseResponse.test-support.js';

const out = resolve(
  import.meta.dirname,
  '../../scripts/ci/fixtures/horse-reraise-response-vectors.json'
);
writeFileSync(out, JSON.stringify(buildReraiseResponseVectors(), null, 1) + '\n');
console.log('wrote', out);
