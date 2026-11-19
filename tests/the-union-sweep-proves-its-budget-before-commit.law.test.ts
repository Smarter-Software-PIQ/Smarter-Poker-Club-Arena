/**
 * LAW - THE UNION SWEEP PROVES ITS BUDGET BEFORE COMMIT (2026-11-19)
 *
 * The anti-collusion sweep (public.fn_union_integrity_sweep, run for every
 * union by fn_union_integrity_sweep_all from the `union-integrity-sweep` cron
 * at :33 with a 120 s statement budget) finished in 43-52 s all day on
 * 2026-11-19. Migration 20261119063000 added one signal, the 7-day roster
 * measure, and the cron timed out at 10:33 and 11:33 UTC (300 s). Nothing in
 * the migration had run the sweep before COMMIT, so the first full run was
 * production's. 20261119121500 repaired it and was the first redefinition to
 * run the WHOLE sweep inside its own transaction and refuse itself past 90 s.
 *
 * This law makes that the rule for every later migration that redefines
 * fn_union_integrity_sweep or fn_union_integrity_sweep_all: after the last
 * redefinition and before COMMIT there must be a
 * `-- @probe-for: public.fn_union_integrity_sweep[_all]` DO block that
 *   - runs the whole sweep (fn_union_integrity_sweep_all, or
 *     fn_union_integrity_sweep in a loop over public.unions),
 *   - times itself with clock_timestamp() and RAISEs when it took longer than
 *     interval 'N seconds' with N at most 90 (the cron allows 120), and
 *   - unwinds with the 'probe-unwind' sentinel, so the sweep's writes never land.
 * A migration that would make the sweep slow is then refused by its own
 * rehearsal and by the applier, never discovered by the :33 cron.
 *
 * The migrations before this law are a frozen list; it never grows.
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, migrationCorpus, migrationText } from './helpers/migrationCorpus';

/** The cron's statement budget is 120 s; a probe must prove the sweep fits well inside it. */
export const SWEEP_PROBE_MAX_SECONDS = 90;

const NAME = String.raw`(?:public\.)?fn_union_integrity_sweep(?:_all)?`;
const CREATE_RE = new RegExp(
  String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"?${NAME}"?\s*\(`,
  'gi'
);
const LITERAL_RE = new RegExp(String.raw`'${NAME}\(`, 'gi');

/** Blank every `--` comment (same length, so offsets survive). */
const code = (sql: string): string => sql.replace(/--[^\n]*/g, (m) => ' '.repeat(m.length));

/** Offset just past the last place this migration redefines the sweep, or -1. */
export function lastSweepRedefinition(sql: string): number {
  const c = code(sql);
  let last = -1;
  for (const m of c.matchAll(CREATE_RE)) last = Math.max(last, m.index! + m[0].length);
  // A pinned pre/postimage rewrite: the signature as a literal, a live text
  // read and an EXECUTE in the same file.
  if (/pg_get_functiondef/i.test(c) && /\bEXECUTE\b/i.test(c)) {
    for (const m of c.matchAll(LITERAL_RE)) last = Math.max(last, m.index! + m[0].length);
  }
  return last;
}

/** What is wrong with a migration's sweep probe; empty when it complies or does not redefine the sweep. */
export function sweepBudgetViolations(sql: string): string[] {
  const at = lastSweepRedefinition(sql);
  if (at < 0) return [];
  const commit = sql.lastIndexOf('COMMIT;');
  const probes = [
    ...sql.matchAll(
      /--\s*@probe-for:\s*public\.fn_union_integrity_sweep(?:_all)?\b[^\n]*\n\s*DO\s+\$probe\$([\s\S]*?)END\s+\$probe\$;/g
    ),
  ].filter((m) => m.index! > at && (commit < 0 || m.index! < commit));
  if (probes.length === 0) {
    return [
      'no @probe-for: public.fn_union_integrity_sweep DO block after the last redefinition and before COMMIT',
    ];
  }
  const failures: string[][] = probes.map((m) => {
    const body = code(m[1]);
    const out: string[] = [];
    const all = /fn_union_integrity_sweep_all\s*\(/i.test(body);
    const loop =
      /FROM\s+(?:public\.)?unions\b/i.test(body) && /fn_union_integrity_sweep\s*\(/i.test(body);
    if (!all && !loop) out.push('the probe does not run the whole sweep (every union)');
    if (!/clock_timestamp\(\)/i.test(body))
      out.push('the probe does not time the sweep with clock_timestamp()');
    const budgets = [
      ...body.matchAll(/>\s*interval\s*'(\d+)\s*seconds?'[\s\S]{0,40}?THEN\s+RAISE\s+EXCEPTION/gi),
    ].map((b) => Number(b[1]));
    if (budgets.length === 0) {
      out.push("the probe never refuses itself past interval 'N seconds'");
    } else if (Math.min(...budgets) > SWEEP_PROBE_MAX_SECONDS) {
      out.push(`the probe's budget ${Math.min(...budgets)} s is over ${SWEEP_PROBE_MAX_SECONDS} s`);
    }
    if (
      !/RAISE\s+EXCEPTION\s+'probe-unwind'/i.test(body) ||
      !/SQLERRM\s*<>\s*'probe-unwind'/i.test(body)
    ) {
      out.push("the probe does not unwind with the 'probe-unwind' sentinel");
    }
    return out;
  });
  // One compliant probe is enough.
  return failures.some((f) => f.length === 0) ? [] : failures[failures.length - 1];
}

/** Every migration on main that redefined the sweep before this law. Frozen: never grows. */
const GRANDFATHERED = new Set([
  '20260820135503_union_law_p8_integrity_sweep_by_agent.sql',
  '20260820135609_union_law_p8b_integrity_sweep_exclude_horses.sql',
  '20260820175822_union_integrity_sweep_all_unions.sql',
  '20260907054009_the_stop_loss_is_enforced_not_just_reported.sql',
  '20260908020401_the_open_week_is_snapshotted_and_every_reader_gets_the_one_basis_in_time.sql',
  '20260914110900_union_integrity_observes_its_own_events.sql',
  '20260914130826_union_integrity_observes_its_own_events.sql',
  '20260926073120_the_union_sweep_commits_its_money_controls_before_the_snapshot.sql',
  '20261003225101_the_union_sweep_stops_rebuilding_an_unread_snapshot.sql',
  '20261003235228_the_union_sweep_refreshes_the_windowed_snapshot_again.sql',
  '20261009180401_an_agent_roster_counts_no_horse.sql',
  '20261012114304_a_club_bank_claim_is_not_a_player_transfer.sql',
  '20261016013849_a_club_bank_send_is_not_a_player_transfer.sql',
  '20261017121603_the_union_sweep_warnings_close_on_their_evidence.sql',
  '20261020010133_the_open_week_rake_basis_lands_or_says_so.sql',
  '20261022062934_the_hourly_audits_read_only_what_changed_since_they_last_loo.sql',
  '20261112214754_the_union_sweep_counts_a_session_whole.sql',
  '20261118165323_a_cashout_to_your_own_agent_is_not_a_chip_dump.sql',
  '20261119063000_a_losing_roster_is_not_a_winning_agent.sql',
]);

// The shape 20261119121500 shipped: a pinned rewrite, then the whole sweep timed.
const GOOD = `BEGIN;
CREATE FUNCTION pg_temp.uis_subst(p_sig text) RETURNS void LANGUAGE plpgsql AS $h$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef(p_sig::regprocedure);
  EXECUTE replace(v_def, 'a', 'b');
END $h$;
SELECT pg_temp.uis_subst('public.fn_union_integrity_sweep(uuid,integer)');

-- @probe-for: public.fn_union_integrity_sweep
DO $probe$
DECLARE t0 timestamptz := clock_timestamp(); u record;
BEGIN
  FOR u IN SELECT id FROM public.unions LOOP
    PERFORM public.fn_union_integrity_sweep(u.id, 24);
  END LOOP;
  IF clock_timestamp() - t0 > interval '90 seconds' THEN
    RAISE EXCEPTION 'the union sweep still does not fit its cron budget: %', clock_timestamp() - t0;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
`;

describe('the checker', () => {
  it('accepts the 20261119121500 shape: the whole sweep, timed, refused past 90 s, unwound', () => {
    expect(sweepBudgetViolations(GOOD)).toEqual([]);
    expect(
      sweepBudgetViolations(
        GOOD.replace(
          /FOR u IN[\s\S]*?END LOOP;/,
          'PERFORM public.fn_union_integrity_sweep_all(24);'
        )
      )
    ).toEqual([]);
  });

  it('refuses the regression that timed the cron out: a redefinition with no probe at all', () => {
    const real = migrationText('20261119063000_a_losing_roster_is_not_a_winning_agent.sql');
    expect(lastSweepRedefinition(real)).toBeGreaterThan(0);
    expect(sweepBudgetViolations(real)).not.toEqual([]);
    const bare = GOOD.slice(0, GOOD.indexOf('-- @probe-for')) + 'COMMIT;\n';
    expect(sweepBudgetViolations(bare)[0]).toMatch(/no @probe-for/);
  });

  it('refuses a probe with no budget, a budget past 90 s, one union, no timer or no unwind', () => {
    expect(
      sweepBudgetViolations(GOOD.replace(/ {2}IF clock_timestamp\(\)[\s\S]*?END IF;\n/, '')).join()
    ).toMatch(/never refuses itself/);
    expect(sweepBudgetViolations(GOOD.replace("'90 seconds'", "'300 seconds'")).join()).toMatch(
      /300 s is over 90 s/
    );
    expect(
      sweepBudgetViolations(
        GOOD.replace(
          /FOR u IN[\s\S]*?END LOOP;/,
          "PERFORM public.fn_union_integrity_sweep('00000000-0000-0000-0000-000000000000'::uuid, 24);"
        )
      ).join()
    ).toMatch(/whole sweep/);
    expect(
      sweepBudgetViolations(
        GOOD.replace('clock_timestamp(); u record', 'now(); u record').replace(
          /clock_timestamp\(\)/g,
          'now()'
        )
      ).join()
    ).toMatch(/clock_timestamp/);
    expect(
      sweepBudgetViolations(GOOD.replace("RAISE EXCEPTION 'probe-unwind';", '')).join()
    ).toMatch(/sentinel/);
  });

  it('refuses a probe that sits before the redefinition or after COMMIT', () => {
    const head = GOOD.slice(0, GOOD.indexOf('-- @probe-for'));
    const probe = GOOD.slice(GOOD.indexOf('-- @probe-for'), GOOD.lastIndexOf('COMMIT;'));
    const before =
      head.replace('SELECT pg_temp.uis_subst(', probe + 'SELECT pg_temp.uis_subst(') + 'COMMIT;\n';
    expect(sweepBudgetViolations(before)).not.toEqual([]);
    expect(sweepBudgetViolations(head + 'COMMIT;\n' + probe)).not.toEqual([]);
  });

  it('a commented-out call does not count, and a grant or a read is not a redefinition', () => {
    expect(
      sweepBudgetViolations(
        GOOD.replace(
          '    PERFORM public.fn_union_integrity_sweep(u.id, 24);',
          '    -- PERFORM public.fn_union_integrity_sweep(u.id, 24);'
        )
      ).join()
    ).toMatch(/whole sweep/);
    expect(
      lastSweepRedefinition(
        "BEGIN;\nREVOKE ALL ON FUNCTION public.fn_union_integrity_sweep(uuid, integer) FROM anon;\nSELECT md5(pg_get_functiondef('public.fn_union_agent_roster_sustained_edge(uuid,uuid,integer)'::regprocedure));\nCOMMIT;\n"
      )
    ).toBe(-1);
  });
});

describe('every migration that redefines the union sweep proves its budget', () => {
  it('the frozen list holds only files that exist and predate this law', () => {
    expect(GRANDFATHERED.size).toBe(19);
    for (const f of GRANDFATHERED) {
      expect(existsSync(join(MIGRATIONS_DIR, f)), f).toBe(true);
      expect(f < '20261119121500', f).toBe(true);
    }
  });

  it('every other redefinition carries a timed whole-sweep probe', () => {
    const redefiners = migrationCorpus().filter((m) => lastSweepRedefinition(m.sql) >= 0);
    expect(redefiners.length).toBeGreaterThanOrEqual(GRANDFATHERED.size);
    for (const m of redefiners) {
      if (GRANDFATHERED.has(m.name)) continue;
      expect(sweepBudgetViolations(m.sql), m.name).toEqual([]);
    }
  });
});
