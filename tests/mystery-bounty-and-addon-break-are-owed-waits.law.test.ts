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
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const dir = join(ROOT, 'supabase', 'migrations');
const FILE = '20261122054826_mystery_bounty_and_addon_break_are_owed_waits.sql';
const PARITY_FILE = '20261122095254_all_in_showdown_sweep_and_award_groups_parity.sql';
const sql = readFileSync(join(dir, FILE), 'utf8');
const paritySql = readFileSync(join(dir, PARITY_FILE), 'utf8');
const proofScript = readFileSync(join(ROOT, 'scripts', 'ci', 'test-hand-gap-watch.py'), 'utf8');
const migrations = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

function walkTs(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(root, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkTs(full));
    else if (entry.endsWith('.ts') && !entry.includes('.test.')) out.push(full);
  }
  return out;
}

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

  it('the newest hand_gap_classification runbook scans 15 minutes, classifies mystery_bounty and addon_break, never treats tournament busts as intended rebuys, and stays in parity with the grader', () => {
    const newestRunbookFile = migrations
      .filter((m) =>
        readFileSync(join(dir, m), 'utf8').includes(
          'FUNCTION smarter_private.reliability_runbook_hand_gap_classification('
        )
      )
      .pop();
    expect(newestRunbookFile).toBe(PARITY_FILE);
    const newestSql = readFileSync(join(dir, newestRunbookFile!), 'utf8');
    const bodyStart = newestSql.indexOf(
      'CREATE OR REPLACE FUNCTION smarter_private.reliability_runbook_hand_gap_classification('
    );
    const body = newestSql.slice(bodyStart, newestSql.indexOf('$function$;', bodyStart));
    expect(body).toContain("interval '15 minutes'");
    expect(body).toContain("THEN 'mystery_bounty'");
    expect(body).toContain("THEN 'addon_break'");
    expect(body).toContain("WHEN sh.tournament_id IS NULL AND sh.someone_busted THEN 'rebuy'");
    expect(body).not.toContain('t.is_rebuy');
    expect(body).not.toContain('t.is_reentry');
    expect(body).toContain(
      "key IN ('hand_for_hand', 'mystery_bounty', 'addon_break', 'tournament_break', 'maintenance_break', 'rebuy')"
    );
    expect(body).toContain("pair.next_cadence->>'all_in_showdown' = 'true'");
    expect(body).toContain("pair.next_cadence->>'bets_sweep_owed' = 'true'");
    expect(body).toContain(
      "WHERE pl->>'userId' = sd->>'user_id' AND coalesce((pl->>'stack')::numeric, 1) = 0"
    );
    expect(body).toContain(
      "count(DISTINCT (coalesce(aw->>'board', '1'), coalesce(aw->>'potIndex', pp->>'index', '0'), coalesce(aw->>'low', 'false')))"
    );
  });

  it('locks down grants, probes both functions, carries live proofs, and exercises both migrations in test-hand-gap-watch.py', () => {
    for (const [name, content] of [
      [FILE, sql],
      [PARITY_FILE, paritySql],
    ] as const) {
      expect(content, name).toContain(
        'REVOKE ALL ON FUNCTION public.fn_ca_hand_gap_unintended_delay(timestamptz, int) FROM PUBLIC, anon, authenticated;'
      );
      expect(content, name).toContain(
        'GRANT EXECUTE ON FUNCTION public.fn_ca_hand_gap_unintended_delay(timestamptz, int) TO service_role;'
      );
      expect(content, name).toContain(
        'REVOKE ALL ON FUNCTION smarter_private.reliability_runbook_hand_gap_classification(uuid, boolean, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;'
      );
      expect(content, name).toContain('-- @probe-for: public.fn_ca_hand_gap_unintended_delay');
      expect(content, name).toContain(
        '-- @probe-for: smarter_private.reliability_runbook_hand_gap_classification'
      );
      expect(content, name).toMatch(/^-- @live-proof: /m);
      expect(proofScript, name).toContain(name);
    }
    expect(paritySql).toContain(
      "(length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1"
    );
    expect(paritySql).toContain("pair.next_cadence->>'all_in_showdown' = 'true'");
    expect(paritySql).toContain("pair.next_cadence->>'bets_sweep_owed' = 'true'");
    expect(paritySql).toContain('count(DISTINCT');
  });

  it('every non-test holdDealingUntil() call site in server/src is accounted for by the hand-gap grader', () => {
    // COUPLING LAW (2026-11-22, incident 1e532243): Mystery Bounty chest reveals
    // and add-on breaks both paged fn_ca_hand_gap_watch because new inter-hand
    // holdDealingUntil() calls were added without matching grader exclusions.
    // Any new file calling holdDealingUntil() must be reviewed and covered in
    // fn_ca_hand_gap_unintended_delay + reliability_runbook_hand_gap_classification
    // before extending this allowlist.
    const callSites: Array<{ file: string; line: string }> = [];
    for (const full of walkTs(join(ROOT, 'server', 'src'))) {
      const rel = relative(ROOT, full);
      const lines = readFileSync(full, 'utf8').split('\n');
      for (const raw of lines) {
        const trimmed = raw.trim();
        if (
          trimmed.startsWith('//') ||
          trimmed.startsWith('*') ||
          trimmed.startsWith('/*') ||
          trimmed.includes('public holdDealingUntil(')
        )
          continue;
        if (trimmed.includes('.holdDealingUntil(')) {
          callSites.push({ file: rel, line: trimmed });
        }
      }
    }
    const files = [...new Set(callSites.map((s) => s.file))].sort();
    expect(files).toEqual([
      'server/src/tournament/TournamentManagerBase.ts',
      'server/src/tournament/TournamentManagerEliminations.ts',
    ]);
    // Every call site in TournamentManagerBase is pre-launch start or add-on break;
    // the sole call site in TournamentManagerEliminations is Mystery Bounty reveal.
    expect(callSites.length).toBe(8);
  });
});
