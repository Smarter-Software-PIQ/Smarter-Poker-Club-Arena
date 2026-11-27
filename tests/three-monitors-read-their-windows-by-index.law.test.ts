import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { splitConcurrentPreamble } from '../scripts/ci/migration-concurrent-preamble.mjs';

/**
 * THREE MONITORS READ THEIR WINDOWS BY INDEX, NOT ROW BY ROW (2026-11-27).
 *
 * After 20261126220936 three readers were still cancelled on production
 * (SQLSTATE 57014), each paying one random read per row, pool or pair:
 *
 *   - fn_union_treasury_selftest (PostgREST, 8 s): inside
 *     fn_bbj_conservation_check, a promo sweep sum and a snapshot count with no
 *     covering index, the contributions tail walking a whole index, and two
 *     chip_ledger probes per late pool (8,100 probes) for legs that are one
 *     range of idx_chip_ledger_bbj_pool_legs.
 *   - fn_ca_horse_exposure_watch (cron, 150 s): the leak breakdown joined
 *     window-wide CTEs to each other and the planner rescanned one per row of
 *     another, quadratic in the window (42 s for 300 hands; 13,629 never
 *     finished).
 *   - fn_rake_attribution_drift(24) (PostgREST, 8 s): one random probe of
 *     idx_rake_attributions_hand_id per hand, about 30,000 a day.
 *
 * Each check below is applied to the new definitions in the migration AND to
 * the live definitions they replace (captured from production on 2026-11-27,
 * md5 of pg_get_functiondef pinned here), and must hold for the new and fail
 * for the old.
 */
const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const FILE =
  'supabase/migrations/20261127043816_three_monitors_read_their_windows_by_index_instead_of_per_ro.sql';
const SQL = read(FILE);
const FIX = 'scripts/ci/fixtures/three-monitors-read-by-index';

const LIVE_MD5: Record<string, string> = {
  fn_bbj_contributions_total: '6a734d07f9e43b5ebbafa5e3974abfe5',
  fn_bbj_contributions_total_advance: 'd1a1edd7141b6a31532100bc67d3e89d',
  fn_bbj_conservation_check: '45166a61fd8b0f36a4bed1127b075e83',
  fn_rake_attribution_drift: '6a2f93c5f4370088fa0ea3634d44e780',
  fn_ca_horse_exposure_watch: 'fed9c02ebc2fa849ff056ad1166a4fe2',
};
const live = (name: string) => read(`${FIX}/${name}.live-20261127.sql`);

/** The function's text from `FUNCTION public.<name>(` to its closing `$function$`. */
function fn(sql: string, name: string): string {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  expect(start, `${name} is defined`).toBeGreaterThan(-1);
  const end = sql.indexOf('$function$', sql.indexOf('AS $function$', start) + 13);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}
const code = (s: string) => s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const squash = (s: string) => code(s).replace(/\s+/g, ' ');

/** Each law, as a predicate over one definition. */
const LAWS: Record<string, (def: string) => boolean> = {
  // The tail since the checkpoint is two created_at ranges, never one walk of
  // the whole table, and is planned with the checkpoint's value.
  fn_bbj_contributions_total: (def) => {
    const s = squash(def);
    return (
      /SET plan_cache_mode TO 'force_custom_plan'/.test(def) &&
      s.includes('WHERE b.hand_id IS NOT NULL AND b.created_at >= v_as_of') &&
      s.includes('WHERE b.hand_id IS NULL AND b.created_at >= v_as_of') &&
      !/FROM bbj_contributions b WHERE b\.created_at >= v_as_of/.test(s)
    );
  },
  fn_bbj_contributions_total_advance: (def) => {
    const s = squash(def);
    return (
      /SET plan_cache_mode TO 'force_custom_plan'/.test(def) &&
      s.includes(
        'WHERE b.hand_id IS NOT NULL AND b.created_at >= v_as_of AND b.created_at < v_target'
      ) &&
      s.includes(
        'WHERE b.hand_id IS NULL AND b.created_at >= v_as_of AND b.created_at < v_target'
      ) &&
      !/WHERE b\.created_at >= v_as_of AND b\.created_at < v_target/.test(s)
    );
  },
  // A pool with kept sums takes its seeds and burns since the checkpoint from
  // one range of the bbj_pool legs; only a pool that needs a whole or absorbed
  // read probes by key, and no scalar subquery runs per pool.
  fn_bbj_conservation_check: (def) => {
    const s = squash(def);
    return (
      s.includes(
        'WITH o AS MATERIALIZED ( SELECT p.id AS pool_id, b.opened_at, k.seeded AS kept_seeded, k.burned AS kept_burned, k.absorbed AS kept_absorbed, k.absorbed_to AS kept_absorbed_to, (k.pool_id IS NOT NULL) AS has_kept'
      ) &&
      s.includes(
        "tail_legs AS MATERIALIZED ( SELECT l.to_type, l.from_type, l.to_entity_id, l.from_entity_id, l.category, l.amount FROM public.chip_ledger l WHERE (l.to_type = 'bbj_pool' OR l.from_type = 'bbj_pool') AND l.created_at > v_epoch_at AND l.created_at >= v_cp_through )"
      ) &&
      s.includes(
        "WHERE t.to_type = 'bbj_pool' AND t.category <> 'bbj_contribution' GROUP BY t.to_entity_id"
      ) &&
      s.includes(
        "WHERE t.from_type = 'bbj_pool' AND t.category NOT IN ('bbj_payout', 'promo') GROUP BY t.from_entity_id"
      ) &&
      s.includes("AND l.category <> 'bbj_contribution' AND l.created_at > v_epoch_at) ws") &&
      s.includes(
        "AND l.category NOT IN ('bbj_payout', 'promo') AND l.created_at > v_epoch_at) wb WHERE NOT n.has_kept"
      ) &&
      s.includes(
        'WHERE n.opened_at IS NOT NULL AND n.kept_absorbed_to IS DISTINCT FROM n.opened_at'
      ) &&
      s.includes('LEFT JOIN tail_seeded ts ON ts.pool_id = o.pool_id AND o.has_kept') &&
      s.includes('LEFT JOIN tail_burned tb ON tb.pool_id = o.pool_id AND o.has_kept') &&
      s.includes(
        'CASE WHEN o.has_kept THEN COALESCE(ts.amount, 0) ELSE COALESCE(w.seeded, 0) END AS seeded'
      ) &&
      s.includes(
        'CASE WHEN o.has_kept THEN COALESCE(tb.amount, 0) ELSE COALESCE(w.burned, 0) END AS burned'
      ) &&
      !/COALESCE\(\(SELECT sum\(l\.amount\) FROM public\.chip_ledger l WHERE l\.(to|from)_entity_id = o\.pool_id/.test(
        s
      )
    );
  },
  // The attributions are one created_at range from a day before the window,
  // grouped by hand; a hand the range misses is summed by hand id, unwindowed.
  fn_rake_attribution_drift: (def) => {
    const s = squash(def);
    return (
      /SET plan_cache_mode TO 'force_custom_plan'/.test(def) &&
      s.includes(
        "WHERE ra.created_at >= v_since - interval '1 day' AND ra.hand_id IN (SELECT r.hand_id FROM r) GROUP BY ra.hand_id"
      ) &&
      s.includes(
        'CASE WHEN w.hand_id IS NOT NULL THEN COALESCE(w.credit, 0) ELSE COALESCE((SELECT sum(a.weighted_rake_credit) FROM public.rake_attributions a WHERE a.hand_id = r.hand_id), 0) END AS allocated'
      ) &&
      !s.includes('LEFT JOIN public.rake_attributions ra ON ra.hand_id = r.hand_id')
    );
  },
  // Step 3 reads one hand at a time: every read is keyed by that hand, and no
  // window-wide CTE is joined to another.
  fn_ca_horse_exposure_watch: (def) => {
    const s = squash(def);
    const step3 = s.slice(
      s.indexOf('IF jsonb_array_length(v_flagged) > 0 THEN'),
      s.indexOf('IF p_dry_run THEN')
    );
    return (
      step3.includes("CROSS JOIN LATERAL (SELECT (h #>> '{}')::uuid AS hand_id) w") &&
      step3.includes('FROM public.hand_history hx WHERE hx.id = w.hand_id') &&
      step3.includes(
        'FROM public.ca_hand_facts f LEFT JOIN public.profiles p ON p.id = f.user_id WHERE f.hand_id = w.hand_id'
      ) &&
      step3.includes('FROM hs p JOIN hs x ON x.horse CROSS JOIN t') &&
      !step3.includes('JOIN win ON') &&
      !step3.includes('JOIN hs x ON x.hand_id = p.hand_id')
    );
  },
};

describe('the live definitions this replaces are pinned', () => {
  it('each fixture is byte for byte the production definition of 2026-11-27', () => {
    for (const [name, md5] of Object.entries(LIVE_MD5)) {
      expect(createHash('md5').update(live(name)).digest('hex'), name).toBe(md5);
    }
  });
});

describe('each read is bounded by its index', () => {
  for (const [name, law] of Object.entries(LAWS)) {
    it(`${name}: the new definition keeps the law and the live one breaks it`, () => {
      expect(law(fn(SQL, name)), `${name} in ${FILE}`).toBe(true);
      expect(law(fn(live(name), name)), `${name} as it is live`).toBe(false);
    });
  }
});

describe('nothing else in the definitions moves', () => {
  it('the conservation check differs from live only in the tail of the late pools', () => {
    const now = squash(fn(SQL, 'fn_bbj_conservation_check'));
    const was = squash(fn(live('fn_bbj_conservation_check'), 'fn_bbj_conservation_check'));
    const cut = (s: string) => [
      s.slice(0, s.indexOf('IF NOT FOUND THEN v_cp_through')),
      s.slice(s.indexOf('v_in := v_in + v_late_seeds;')),
    ];
    expect(cut(now)).toEqual(cut(was));
    // The promo sweep sum and the snapshot count keep their text: the new
    // indexes serve them as they are.
    expect(now).toContain(
      "(SELECT COALESCE(SUM(amount),0) FROM chip_transactions WHERE transaction_type='bbj_promo_sweep')"
    );
    expect(now).toContain(
      'SELECT count(*) INTO v_epoch_runs FROM public.ca_bbj_pool_snapshots WHERE NOT is_baseline;'
    );
  });

  it('the horse watch differs from live only inside step 3', () => {
    const now = fn(SQL, 'fn_ca_horse_exposure_watch');
    const was = fn(live('fn_ca_horse_exposure_watch'), 'fn_ca_horse_exposure_watch');
    const outside = (s: string) => [
      s.slice(0, s.indexOf('  IF jsonb_array_length(v_flagged) > 0 THEN')),
      s.slice(s.indexOf('  IF p_dry_run THEN')),
    ];
    expect(outside(now)).toEqual(outside(was));
  });

  it('the drift keeps its signature, window, settings and output', () => {
    const now = fn(SQL, 'fn_rake_attribution_drift');
    const was = fn(live('fn_rake_attribution_drift'), 'fn_rake_attribution_drift');
    const head = (s: string) => s.slice(0, s.indexOf('BEGIN'));
    expect(head(now)).toEqual(head(was));
    const s = squash(now);
    expect(s).toContain(
      "WHERE rr.rake_method = 'WEIGHTED_CONTRIBUTED' AND rr.hand_id IS NOT NULL AND rr.rake_amount > 0 AND rr.player_contributions IS NOT NULL AND rr.created_at > v_since"
    );
    expect(s).toContain(
      'round(j.rake_amount - j.allocated, 2) AS difference FROM j WHERE round(j.rake_amount - j.allocated, 2) <> 0;'
    );
  });
});

describe('the migration installs inside its budget and proves itself', () => {
  const split = splitConcurrentPreamble(SQL);

  it('builds exactly four covering indexes CONCURRENTLY, largest first, before one transaction', () => {
    expect(split.ok, split.ok ? '' : split.reason).toBe(true);
    if (!split.ok) return;
    expect(split.indexes.map((i) => `${i.table}.${i.name}`)).toEqual([
      'rake_attributions.idx_rake_attributions_created_cover',
      'bbj_contributions.idx_bbj_contrib_nullhand_created',
      'ca_bbj_pool_snapshots.idx_ca_bbj_pool_snapshots_runs',
      'chip_transactions.idx_chip_tx_bbj_promo_sweep',
    ]);
    const one = (s: string) => s.replace(/\s+/g, ' ');
    expect(one(split.indexes[0].statement)).toContain(
      'USING btree (created_at) INCLUDE (hand_id, weighted_rake_credit);'
    );
    expect(one(split.indexes[1].statement)).toContain(
      'USING btree (created_at) INCLUDE (amount) WHERE (hand_id IS NULL);'
    );
    expect(one(split.indexes[2].statement)).toContain(
      'USING btree (is_baseline) WHERE (NOT is_baseline);'
    );
    expect(one(split.indexes[3].statement)).toContain(
      "USING btree (transaction_type) INCLUDE (amount) WHERE (transaction_type = 'bbj_promo_sweep'::text);"
    );
    expect(SQL.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(SQL.match(/^COMMIT;$/gm)).toHaveLength(1);
  });

  it('refuses to install unless every index is valid with the shape the reads rely on', () => {
    const verify = SQL.slice(SQL.indexOf('DO $verify_index$'), SQL.indexOf('$verify_index$;'));
    for (const ix of [
      'idx_rake_attributions_created_cover',
      'idx_bbj_contrib_nullhand_created',
      'idx_ca_bbj_pool_snapshots_runs',
      'idx_chip_tx_bbj_promo_sweep',
    ]) {
      expect(verify).toContain(`'public.${ix}'`);
    }
    expect(verify).toContain('i.indisvalid AND i.indisready AND i.indislive');
    expect(verify).toContain("RAISE EXCEPTION 'MONITOR_INDEX_NOT_QUALIFIED: %'");
    expect(SQL.indexOf('DO $verify_index$')).toBeLessThan(
      SQL.indexOf('CREATE OR REPLACE FUNCTION')
    );
  });

  it('probes every function it replaces, after its definition, and unwinds', () => {
    for (const name of Object.keys(LAWS)) {
      const def = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
      const probe = SQL.indexOf(`-- @probe-for: public.${name}\n`);
      expect(def, name).toBeGreaterThan(-1);
      expect(probe, name).toBeGreaterThan(def);
    }
    expect(SQL.match(/RAISE EXCEPTION 'probe-unwind';/g)).toHaveLength(5);
    // The watch is probed as a dry run, which writes nothing.
    expect(SQL).toContain(
      "public.fn_ca_horse_exposure_watch('2000-01-01 00:00:00+00'::timestamptz, true)"
    );
  });

  it('restates every grant exactly as it is live: service_role only', () => {
    for (const sig of [
      'public.fn_bbj_contributions_total()',
      'public.fn_bbj_contributions_total_advance()',
      'public.fn_bbj_conservation_check()',
      'public.fn_rake_attribution_drift(integer)',
      'public.fn_ca_horse_exposure_watch(timestamp with time zone, boolean)',
    ]) {
      expect(SQL).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC, anon, authenticated;`);
      expect(SQL).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO service_role;`);
    }
    expect(code(SQL)).not.toMatch(/GRANT [^;]* TO (anon|authenticated|PUBLIC)/);
  });

  it('declares live proofs and touches no schedule, threshold or money', () => {
    expect(SQL.match(/^-- @live-proof: .+$/gm)?.length).toBe(3);
    const body = code(SQL);
    expect(body).not.toMatch(/cron\.(schedule|alter_job|unschedule)/);
    expect(body).not.toMatch(
      /\b(INSERT INTO|UPDATE|DELETE FROM)\s+public\.(chip_ledger|bbj_pools|bbj_contributions|rake_attributions)\b/
    );
    expect(body).not.toMatch(/is_horse\s*=\s*false|NOT\s+\w*\.?is_horse/);
  });

  it('the native horse proof answers the dry run with both definitions and runs every case on the new one', () => {
    const proof = read('scripts/ci/test-a-person-beating-the-horses-reaches-production-alerts.py');
    expect(proof).toContain(FILE.replace('supabase/migrations/', ''));
    expect(proof).toContain('assert r_bounded == r, (r_bounded, r)');
    expect(proof.indexOf('assert r_bounded == r')).toBeLessThan(
      proof.indexOf("ok('one PersonBeatsHorsesBeyondTwoSE warning")
    );
    const workflow = read(
      '.github/workflows/a-person-beating-the-horses-reaches-production-alerts.yml'
    );
    expect(workflow).toContain(FILE);
  });
});
