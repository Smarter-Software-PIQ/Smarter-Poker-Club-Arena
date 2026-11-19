/**
 * Writes scripts/ci/fixtures/horse-flop-shown-vectors.json: the hands on which the engine reducer
 * (HorseOmahaFlopShown.flopShownClassOf / flopShownHandIncrements / addFlopShownEvidence) and the database
 * reducer (public.fn_horse_flop_shown_class / fn_horse_flop_shown_increments / fn_horse_flop_shown_add, migration
 * 20261119192551) must agree. `expected` is what the ENGINE computes; HorseOmahaFlopShown.test.ts fails when the file and the engine
 * disagree, and scripts/ci/test-horse-exact-public-memory.py fails when the database and the file disagree.
 *
 * Run from server/:  npx tsx scripts/generate-horse-flop-shown-vectors.ts
 * Deterministic (seeded); running it twice writes the same content. Reads no database and no network. Every
 * card in the file is invented.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildFlopShownVectors } from '../src/engine/HorseOmahaFlopShown.test-support.js';

const out = resolve(import.meta.dirname, '../../scripts/ci/fixtures/horse-flop-shown-vectors.json');
writeFileSync(out, JSON.stringify(buildFlopShownVectors()).replace(/\},\{/g, '},\n{') + '\n');
console.log('wrote', out);
