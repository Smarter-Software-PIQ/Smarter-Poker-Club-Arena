/**
 * LAW: MYSTERY BOUNTY CHEST REVEALS AND ADD-ON BREAKS ARE OWED WAITS; THE
 * HAND-GAP RUNBOOK NEVER MISCLASSIFIES A TOURNAMENT BUST AS AN INTENDED REBUY
 * WAIT (2026-11-22, incident 1e532243).
 *
 * Production 2026-11-22 (serving engine c2d6e45e3bcc):
 *   1. Tournament f99647e1 had six MYSTERY CHEST reveals in 04:45-05:00 UTC
 *      (~20.3 s gaps = showdown hold + mysteryChestHoldMs ~14.3 s + coalesce).
 *      Because fn_ca_hand_gap_unintended_delay did not exclude pairs with a
 *      reserved tournament_bounty_awards row on that table/hand, every chest
 *      graded +14 s unintended and re-fired incident 1e532243 at 05:01 UTC.
 *   2. Add-on breaks hold dealing via holdDealingUntil(addon_period_ends_at)
 *      for the final addon_break_minutes (clamped 1..10) without setting
 *      break_started_at/break_ends_at, so gaps < 60 s across an add-on break
 *      were graded as unintended delay.
 *   3. smarter_private.reliability_runbook_hand_gap_classification classified
 *      any tournament bust in an is_rebuy/is_reentry tournament as intended
 *      'rebuy' even though tournament tables never pause for rebuys (only cash
 *      tables run the <= 5 s rebuy pause), omitted 'mystery_bounty' and
 *      'addon_break', and scanned 10 minutes instead of 15 minutes.
 *
 * Pinned statically here; proved natively on PostgreSQL 16 by
 * scripts/ci/test-hand-gap-watch.py (Phase 4).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const dir = join(ROOT, 'supabase', 'migrations');
const FILE = '20261122054826_mystery_bounty_and_addon_break_are_owed_waits.sql';
const sql = readFileSync(join(dir, FILE), 'utf8');
const proofScript = readFileSync(join(ROOT, 'scripts', 'ci', 'test-hand-gap-watch.py'), 'utf8');
const migrations = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

describe('mystery bounty chest reveals and add-on breaks are owed waits', () => {
  it('excludes Mystery Bounty chest reveals and add-on breaks by exact single-match anchor without dropping prior exclusions', () => {
    expect(sql).toContain(
      "pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'::regprocedure)"
    );
    expect(sql).toContain("c_old constant text := 'AND NOT EXISTS (SELECT 1 FROM tournaments t';");
    expect(sql).toContain(
      "(length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1"
    );
    expect(sql).toContain('FROM tournament_bounty_awards ba');
    expect(sql).toContain('(ba.table_id = nx.table_id OR ba.hand_id = p.id::text)');
    expect(sql).toContain('FROM tournaments ta');
    // Must clamp the add-on break window to the final addon_break_minutes (1..10) so
    // earlier open play in an addon_from_start tournament is NEVER excluded.
    expect(sql).toContain(
      'GREATEST(ta.addon_period_started_at, ta.addon_period_ends_at - make_interval(mins => LEAST(10, GREATEST(1, COALESCE(ta.addon_break_minutes, 1)))))'
    );
    // Keeps the tournament-break anchor intact for future migrations.
    expect(sql).toContain('AND NOT EXISTS (SELECT 1 FROM tournaments t');
  });

  it('the newest hand_gap_classification runbook scans 15 minutes, classifies mystery_bounty and addon_break, and never treats tournament busts as intended rebuys', () => {
    const newestRunbookFile = migrations
      .filter((m) =>
        readFileSync(join(dir, m), 'utf8').includes(
          'FUNCTION smarter_private.reliability_runbook_hand_gap_classification('
        )
      )
      .pop();
    expect(newestRunbookFile).toBe(FILE);
    const bodyStart = sql.indexOf(
      'CREATE OR REPLACE FUNCTION smarter_private.reliability_runbook_hand_gap_classification('
    );
    const body = sql.slice(bodyStart, sql.indexOf('$function$;', bodyStart));
    expect(body).toContain("interval '15 minutes'");
    expect(body).toContain("THEN 'mystery_bounty'");
    expect(body).toContain("THEN 'addon_break'");
    expect(body).toContain("WHEN sh.tournament_id IS NULL AND sh.someone_busted THEN 'rebuy'");
    expect(body).not.toContain('t.is_rebuy');
    expect(body).not.toContain('t.is_reentry');
    expect(body).toContain(
      "key IN ('hand_for_hand', 'mystery_bounty', 'addon_break', 'tournament_break', 'maintenance_break', 'rebuy')"
    );
  });

  it('locks down grants, probes both functions, carries a live proof, and is exercised in test-hand-gap-watch.py', () => {
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_hand_gap_unintended_delay(timestamptz, int) FROM PUBLIC, anon, authenticated;'
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_ca_hand_gap_unintended_delay(timestamptz, int) TO service_role;'
    );
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION smarter_private.reliability_runbook_hand_gap_classification(uuid, boolean, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;'
    );
    expect(sql).toContain('-- @probe-for: public.fn_ca_hand_gap_unintended_delay');
    expect(sql).toContain(
      '-- @probe-for: smarter_private.reliability_runbook_hand_gap_classification'
    );
    expect(sql).toMatch(/^-- @live-proof: /m);
    expect(proofScript).toContain(FILE);
  });
});
