import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 2026-11-07: Dan delegated the V31 restart-or-park decision with both solver
 * hosts on. It was decided RESTART, as R8 (Dan approved the R8 plan on
 * 2026-11-06). gto_v31_program_state gains 'rebuilding': while no certified
 * dataset is active, the nightly audit reports where every stage stands as one
 * warn, and a Critical the moment no stage has moved for stall_after. Serving
 * anything without an active dataset is a Critical in every state, counted on
 * OPEN bindings only.
 */
const ROOT = path.resolve(__dirname, '..');
const MIGRATION = fs.readFileSync(
  path.join(
    ROOT,
    'supabase/migrations/20261107182648_the_v31_program_restarts_as_r8_and_a_stalled_rebuild_is_critical.sql'
  ),
  'utf8'
);

describe('a rebuilding V31 program is a warn until it stalls', () => {
  it('admits the rebuilding state and records the restart with its exit condition', () => {
    expect(MIGRATION).toContain("CHECK (state IN ('active','parked','rebuilding'))");
    expect(MIGRATION).toMatch(/SET state = 'rebuilding'/);
    expect(MIGRATION).toContain('RETURN TO PARKED');
    expect(MIGRATION).toContain("stall_after = interval '72 hours'");
  });

  it('counts only open serving bindings, and serving without an active dataset is Critical', () => {
    expect(MIGRATION).toContain(
      'SELECT count(*) INTO v_served FROM public.gto_v31_serving_bindings WHERE revoked_at IS NULL;'
    );
    expect(MIGRATION).toContain(
      "'severity','critical','category','gto','code','certified_v31_serving_without_active_dataset'"
    );
  });

  it('measures progress from every stage, not one heartbeat', () => {
    for (const stage of [
      "'worker_heartbeat'",
      "'compactor_heartbeat'",
      "'bundle_approved'",
      "'source_artifact'",
      "'dataset_transition'",
      "'evaluation_receipt'",
      "'execution_anchor'",
      "'recheck_round'",
    ]) {
      expect(MIGRATION).toContain(stage);
    }
  });

  it('is a warn while moving and a Critical once stalled', () => {
    const stalled = MIGRATION.indexOf("'code','certified_v31_rebuild_stalled'");
    const rebuilding = MIGRATION.indexOf("'code','certified_v31_rebuilding'");
    expect(MIGRATION).toContain(
      "'severity','critical','category','gto','code','certified_v31_rebuild_stalled'"
    );
    expect(MIGRATION).toContain(
      "'severity','warn','category','gto','code','certified_v31_rebuilding'"
    );
    expect(MIGRATION).toContain('IF v_last IS NULL OR now() - v_last > v_program.stall_after THEN');
    expect(stalled).toBeGreaterThan(0);
    expect(rebuilding).toBeGreaterThan(stalled);
  });

  it('keeps the original missing-dataset Critical for any other state', () => {
    expect(MIGRATION).toContain(
      "'severity','critical','category','gto','code','certified_v31_missing'"
    );
  });

  it('proves both branches before it commits, service_role only, one transaction', () => {
    expect(MIGRATION).toContain('expected certified_v31_rebuilding/warn');
    expect(MIGRATION).toContain('expected certified_v31_rebuild_stalled/critical');
    expect(MIGRATION).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_audit_gto_v31_certified(date) TO service_role;'
    );
    expect(MIGRATION.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(MIGRATION.match(/^COMMIT;$/gm)).toHaveLength(1);
  });
});
