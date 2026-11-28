import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * EVERY PROMO FLOW KEEPS A REQUIRED PROOF (2026-11-24).
 *
 * Promo Play Through broke four game flows on its first enforced day
 * (2026-11-17: between-hand add-on, zero-fee Spin, satellite remainder,
 * Mystery Bounty champion residual) because nothing required a proof for each
 * flow. The required check "Promo play-through lock ledger and fee meter"
 * (ruleset 21163380) now runs a native PostgreSQL 17 proof for every flow below.
 * This law fails the build if a flow loses its proof: the script leaves the
 * required job, or the named behavioural assertion disappears from the script.
 * The assertions are behaviour (who holds the principal, what stays cashable,
 * what a hand may consume), so they survive a rewrite of the promo state
 * functions' internals.
 *
 * Promo functions are game-variant independent except fn_ca_promo_consume_event_fee
 * (Spin), so the variant dimension is proven by the Spin proof plus the
 * variant-agnostic hand proofs. Cash hit-and-run is a leave (table exit) then a
 * buy-in from the wallet; both halves are pinned. The operator equal-share abort
 * close is deliberately absent: it waits on an owner decision.
 */
const ROOT = join(__dirname, '..');
const WORKFLOW = readFileSync(join(ROOT, '.github/workflows/promo-play-through.yml'), 'utf8');
const REQUIRED_JOB = 'Promo play-through lock ledger and fee meter';

type Flow = { flow: string; script: string; proves: string[] };
const FLOWS: Flow[] = [
  {
    flow: 'cash buy-in',
    script: 'scripts/ci/test-promo-custody.py',
    proves: ['buyin moves principal to the table'],
  },
  {
    flow: 'cash top-up / add-on',
    script: 'scripts/ci/test-promo-custody.py',
    proves: [
      'applied addon principal joins its exact original position',
      'a hand cannot consume the still-pending addon',
    ],
  },
  {
    flow: 'cash-out',
    script: 'scripts/ci/test-promo-custody.py',
    proves: ['cashout cannot spend remaining promo'],
  },
  {
    flow: 'cash leave (table exit; first half of hit-and-run)',
    script: 'scripts/ci/test-promo-custody.py',
    proves: ['profit and deposits remain free after table exit'],
  },
  {
    flow: 'cash rebuy (second half of hit-and-run)',
    script: 'scripts/ci/test-promo-custody.py',
    proves: ['cashout then rebuy uses free winnings before promo'],
  },
  {
    flow: 'Lightning',
    script: 'scripts/ci/test-promo-custody.py',
    proves: ['Lightning retires principal at its original physical seat'],
  },
  {
    flow: 'tournament rebuy',
    script: 'scripts/ci/test-a-rebuy-reads-promo-fee-state-outside-its-lane.py',
    proves: ['the rebuy makes the snapshot current before it takes the event lane'],
  },
  {
    flow: 'tournament re-entry',
    script: 'scripts/ci/test-promo-tournament-earning-generation.py',
    proves: ['validated original reentry gains source context at one non-addon boundary'],
  },
  {
    flow: 'tournament add-on hand',
    script: 'scripts/ci/test-promo-tournament-earning-generation.py',
    proves: ['later addon belongs to current generation'],
  },
  {
    flow: 'unregister / cancellation refund',
    script: 'scripts/ci/test-promo-custody.py',
    proves: ['refund of surviving grant fee reduces its own unfinished'],
  },
  {
    flow: 'refund returns principal to its original fund',
    script: 'scripts/ci/test-promo-principal-returns.py',
    proves: ['fn_settle_tournament_refund_exact'],
  },
  {
    flow: 'every obligation kind, human and Horse',
    script: 'scripts/ci/test-promo-obligation-earning-matrix.py',
    proves: ["PLAYERS = ['human', 'horse']"],
  },
  {
    flow: "the engine's own hand-commit payload (golden, from the contract) through the promo capture",
    script: 'scripts/ci/test-promo-custody.py',
    proves: [
      "the engine's golden payload retires exactly the promo it lost",
      "the engine's golden payload records the net contribution as fee exposure",
      'uncalled chips do not inflate promo fee exposure',
    ],
  },
  {
    flow: 'cash promo readers take the net contribution (no second uncalled subtraction)',
    script: 'scripts/ci/test-promo-profit.py',
    proves: ['no cash promo reader subtracts the uncalled return from the net contribution'],
  },
  {
    flow: 'Spin zero-fee entry (the only variant-specific promo path)',
    script: 'scripts/ci/test-a-spin-fee-source-agrees-with-its-zero-fee-entry.py',
    proves: [],
  },
];

/* A step must EXECUTE the script: being listed as a promo input is not running it. */
function requiredJobRuns(script: string): boolean {
  const start = WORKFLOW.indexOf(`name: ${REQUIRED_JOB}`);
  if (start < 0) return false;
  const escaped = script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`python3(?: -B)? ${escaped}(?:\\s|$)`).test(WORKFLOW.slice(start));
}

/* An engine change to the hand-commit payload must run the promo proofs: the
   files that build or forward it, and its contract, are promo inputs. */
const ENGINE_PAYLOAD_INPUTS = [
  'scripts/ci/fixtures/promo-hand-commit-payload/**',
  'server/src/engine/thePromoHandCommitPayloadKeepsItsContract.test.ts',
  'server/src/engine/ServerTableEngineSettlement.ts',
  'server/src/engine/ServerTableEngineHandEvents.ts',
  'server/src/engine/handSeatGeneration.ts',
  'server/src/services/supabase/handHistory.ts',
];

describe('every promo flow keeps a required proof', () => {
  it('the required job exists under its ruleset name', () => {
    expect(WORKFLOW).toContain(`name: ${REQUIRED_JOB}`);
  });
  it('an engine change to the hand-commit payload runs every promo proof', () => {
    for (const path of ENGINE_PAYLOAD_INPUTS) {
      expect(WORKFLOW, `${path} must be a promo input`).toContain(`            ${path}\n`);
    }
  });
  for (const f of FLOWS) {
    it(`${f.flow}: proven by ${f.script}`, () => {
      expect(requiredJobRuns(f.script), `${f.script} must run in the required job`).toBe(true);
      const body = readFileSync(join(ROOT, f.script), 'utf8');
      for (const p of f.proves) expect(body, `${f.script} must still assert: ${p}`).toContain(p);
    });
  }
});
