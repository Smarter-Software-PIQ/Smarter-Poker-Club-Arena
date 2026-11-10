import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
const root = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const migration = read(
  'supabase/migrations/20261012211046_original_posthand_escrow_retains_its_completed_financial_pro.sql'
);
describe('original posthand escrow stays separate from poker winnings', () => {
  it('requires immutable original funding, completed pending obligation and exact original certificate', () => {
    for (const guard of [
      'POSTHAND_ESCROW_EXPECTED_ORIGINAL_PROOF_CHANGED',
      'POSTHAND_ESCROW_ORIGINAL_EVENT_OWNED',
      'POSTHAND_ESCROW_PLATFORM_FROZEN',
      'POSTHAND_ESCROW_CERTIFICATE_IMMUTABLE',
      'posthand_escrow_projection_original_disagrees',
      'posthand_escrow_projection_touch_disagrees',
      'horse_cash_compact_atomic(jsonb)',
      'horse_cash_retained_atomic_matches(uuid,bigint,jsonb,jsonb,jsonb)',
    ])
      expect(migration).toContain(guard);
    expect(migration).not.toMatch(
      /(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:public\.)?(?:chip_ledger|club_members|table_seats|union_pnl_cash_outcomes|cash_hand_provenance_receipts|cash_hand_participant_manifests)\b/i
    );
    expect(migration).not.toMatch(/CREATE(?: OR REPLACE)? FUNCTION smarter_private\.horse_/i);
    expect(migration).toContain('POSTHAND_ESCROW_SOURCE_POSTIMAGE_CHANGED');
    expect(
      migration.match(/LEFT JOIN smarter_private\.posthand_escrow_certificates cert/g)
    ).toHaveLength(2);
    expect(migration).toContain('CASE WHEN h.shaped AND cert.hand_number IS NOT NULL THEN');
    expect(migration).toContain('CASE WHEN cert.hand_number IS NOT NULL THEN');
  });
  it('enforces actual native qualification and always retains a truthful transcript', () => {
    const workflow = read('.github/workflows/ci.yml');
    const start = workflow.indexOf(
      '- name: Original posthand escrow stays distinct from poker winnings'
    );
    expect(start).toBeGreaterThan(0);
    const steps = workflow.slice(start, workflow.indexOf('- name: Hand index writers', start));
    for (const text of [
      'if: matrix.shard == 3',
      'PGBIN: /usr/lib/postgresql/17/bin',
      'set -euo pipefail',
      'bash scripts/dev/probe-posthand-escrow-pg17.sh',
      'if: always()',
      'if-no-files-found: error',
    ])
      expect(steps).toContain(text);
    const probe = read('scripts/dev/probe-posthand-escrow-pg17.sh');
    for (const text of [
      'concurrency.py',
      'source-preservation.sql',
      'unchanged-pruner-boundary.sql',
      'certificate-boundaries.sql',
      'writer-boundaries.sql',
      '"${PSQL[@]}" -f "$MIG"',
    ])
      expect(probe).toContain(text);
    expect(probe).not.toContain('DATABASE_URL');
  });
  it('qualifies completed pending shapes at the original event with a bounded private lookup', () => {
    const next = read(
      'supabase/migrations/20261109234320_prove_all_original_posthand_pending_escrow_completions.sql'
    );
    for (const guard of [
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS cash_hand_provenance_table_time_cover',
      'POSTHAND_TEMPORAL_EXACT_VALID_COVER_REQUIRED',
      'POSTHAND_TEMPORAL_DEPENDENT_PIN_CHANGED',
      'POSTHAND_TEMPORAL_ORIGINAL_PROOF_GENERATION_CHANGED',
      'escrow_refused:original_direct_prehand_event_conservation_required',
      "SET plan_cache_mode TO 'force_generic_plan'",
      'original_unplayed_pending_escrow_completed_after_signed_hand',
      'original_sources_unqualified',
      "jsonb_build_object('accounting_admission',escrow_proof)",
      'posthand_escrow_original_snapshot(v_commit.table_id,v_commit.hand_number)',
    ])
      expect(next).toContain(guard);
    expect(next).not.toMatch(
      /CREATE(?: OR REPLACE)? FUNCTION (?:public|smarter_private)\.(?:fn_pnl_cash_hand_evidence|fn_cash_participant_funding_lineage|original_inventory_proof_sources_match|original_inventory_basis_generation)\(/
    );
    const probe = read('scripts/dev/probe-posthand-escrow-pg17.sh');
    for (const input of [
      'initial-native.sql',
      'multiple-native.sql',
      'event-refusal-native.sql',
      'lookup-native.sql',
      'direct-prehand-native.sql',
      'installation.py',
    ])
      expect(probe).toContain(input);
    const installer = read('tests/fixtures/posthand-escrow/temporal/installation.py');
    expect(installer).toContain('execute(preamble)');
    expect(installer).toContain('execute(body)');
    expect(installer).toContain('POSTHAND_TEMPORAL_ALREADY_INSTALLED');
  });
  it('binds every retained native input to reviewed exact bytes', () => {
    const binding = JSON.parse(read('tests/fixtures/posthand-escrow/source-binding.json')) as {
      sourceFiles: Record<string, string>;
    };
    for (const [path, hash] of Object.entries(binding.sourceFiles))
      expect(
        createHash('sha256')
          .update(readFileSync(resolve(root, path)))
          .digest('hex'),
        path
      ).toBe(hash);
  });
});
