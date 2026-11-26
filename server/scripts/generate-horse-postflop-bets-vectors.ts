/**
 * Writes scripts/ci/fixtures/horse-postflop-bets-vectors.json: the hands on which the engine reducer
 * (HorsePostflopBetRecord.postflopBetHandIncrements / addPostflopBetEvidence) and the database reducer
 * (public.fn_horse_postflop_bets_increments / fn_horse_postflop_bets_add, migration 20261126021624) must agree.
 * `expected` is what the ENGINE computes; HorsePostflopBetRecord.test.ts fails when the file and the engine disagree,
 * and scripts/ci/test-horse-exact-public-memory.py fails when the database and the file disagree.
 *
 * Run from server/:  npx tsx scripts/generate-horse-postflop-bets-vectors.ts
 * Deterministic (seeded). Reads no database and no network.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPostflopBetVectors } from '../src/engine/HorsePostflopBetRecord.test-support.js';

const out = resolve(
  import.meta.dirname,
  '../../scripts/ci/fixtures/horse-postflop-bets-vectors.json'
);
writeFileSync(out, JSON.stringify(buildPostflopBetVectors(), null, 1) + '\n');
console.log('wrote', out);
