/**
 * LAW: A HAND'S MONEY PATH NEVER WRITES A SHARED ROW
 *
 * Incident 075013fd. The same failure was fixed one row at a time three times
 * and nothing ever stopped the fourth:
 *
 *   2026-09-29  clubs.total_rake updated on every raked hand
 *   2026-10-02  the club_wallets row on every raked hand (1,518 timeouts)
 *   2026-11-17  union_wallets.rake_wallet on every raked hand (8,303 timeouts;
 *               #11256 / #11270), then the union BBJ pool, its allocator row
 *               and union_wallets.insurance_wallet (#11266)
 *
 * Each time a per-hand transaction took a blocking exclusive lock on a row
 * every table of a club or union shares, and one slow holder queued the union.
 * Owner rulings 2026-11-17: a tournament problem must never affect another
 * game; the hand gap must stay under 2 s. Owner standard: every fix is
 * hardened so the same CLASS cannot recur.
 *
 * scripts/ci/hand-path-shared-writes.mjs reads the class off the catalog: the
 * hand doors' call closure plus the triggers their writes fire, the tables
 * whose unique key is no finer than a union/club/pool (+ time bucket), and the
 * blocking exclusive writes, row locks and advisory locks on them. This law
 * pins, without a database:
 *
 *   1. the live reader the latest reader migration installs IS the module's
 *      block, so CI and the applier ask the same question; since
 *      20261118160106 an UPDATE OF trigger is followed only when the
 *      statement SETs one of its columns (PostgreSQL's own rule);
 *   2. the applier splices the module's snapshot/check into every migration's
 *      own transaction, after the stale-pin pieces, so a migration that ADDS
 *      a shared write to a hand's path is refused and nothing installs;
 *   3. the allowlist is reasoned (function, kind, target, owner, reason, date)
 *      and does NOT excuse any of the 14 writes #11270/#11266 remove;
 *   4. judged against production's answer of 2026-11-18, exactly those 14 and
 *      the 11 the SET-target rule proves cannot fire are the violations; judged
 *      against production's answer under the SET-target rule, every violation
 *      is allowlisted AND every allowlisted entry still occurs (an entry whose
 *      write is gone fails here until it is removed); an answer without its
 *      doors is UNKNOWN, never green;
 *   5. the bankers excluded by name are the ones #11270/#11266 define, and
 *      nothing here runs on a timer;
 *   6. CI runs the live check (main's code under pull_request_target) and the
 *      PostgreSQL proof (scripts/ci/test-hand-path-shared-writes.py).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  HAND_PATH_ROOTS,
  HAND_PATH_BANKERS,
  HAND_PATH_CHECKED_FROM,
  handPathFunctionSQL,
  handPathParts,
  handPathGuardSQL,
  isHandPathChecked,
  canChangeHandPath,
  declaredHandPathWrites,
  judge,
  allowlistProblems,
  violationKey,
} from '../scripts/ci/hand-path-shared-writes.mjs';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const MIGRATION = '20261118084747_a_hands_money_path_never_writes_a_shared_row.sql';
const migration = read('supabase', 'migrations', MIGRATION);
/** The migration that installs the reader as it stands (the SET-target rule). */
const READER = '20261118160106_a_trigger_fires_only_on_the_columns_an_update_sets.sql';
const reader = read('supabase', 'migrations', READER);
const allowlist = JSON.parse(read('scripts', 'ci', 'hand-path-shared-writes.allowlist.json'));
const production = JSON.parse(
  read('scripts', 'ci', 'fixtures', 'hand-path-shared-writes', 'production-2026-11-18.json')
);
/** Production 2026-11-18 ~15:55 UTC, after #11270/#11266, read with the SET-target rule. */
const productionSet = JSON.parse(
  read(
    'scripts',
    'ci',
    'fixtures',
    'hand-path-shared-writes',
    'production-2026-11-18-set-list-targets.json'
  )
);

/**
 * Taken off the path by 20261118161644 (lane H1, installs on merge), proved on
 * production's own texts by scripts/ci/test-hand-path-cash-lane.py.
 */
const productionAfterWindow = JSON.parse(
  read('scripts', 'ci', 'fixtures', 'hand-path-shared-writes', 'production-2026-11-19.json')
);

/** Taken off the path by 20261118161703 (lane H1, daily window 2026-11-19 10:00 UTC). */
const FIXED_BY_20261118161703 = [
  'fn_apply_union_ladder|write|unions',
  'fn_ca_deleted_wallet_bank_return|row_lock|clubs',
];

const FIXED_BY_20261118161644 = [
  'fn_ca_deleted_wallet_bank_return|write|clubs',
  'fn_ca_horse_split_return_late_credit|row_lock|clubs',
  'fn_ca_horse_split_return_late_credit|write|clubs',
];

/** Reported by the first reader through UPDATE OF triggers that cannot fire: a column named only outside the SET list. */
const SET_TARGET_FALSE_POSITIVES = [
  'fn_apply_club_ladder|write|clubs',
  'fn_ca_fund_overlay_on_lock|row_lock|clubs',
  'fn_ca_fund_overlay_on_lock|row_lock|union_wallets',
  'fn_ca_fund_overlay_on_lock|write|clubs',
  'fn_ca_fund_overlay_on_lock|write|union_wallets',
  'fn_guard_tournament_start_readiness|row_lock|clubs',
  'fn_guard_tournament_start_readiness|row_lock|union_wallets',
  'fn_refresh_club_activity_counts|write|clubs',
  'fn_sync_club_staff_notice_group|write|club_messenger_staff_notice_groups',
  'fn_sync_club_table_counts|write|clubs',
  'guard_member_club_standalone_game|advisory_lock|club-game-ownership:',
];

/** What #11270 and #11266 take off the path, as the reader names it on production. */
const REMOVED_BY_11270_11266 = [
  'atomic_distribute_rake|write|club_wallets',
  'atomic_distribute_rake|write|union_wallets',
  'bbj_record_contribution|row_lock|bbj_pools',
  'bbj_record_contribution|write|bbj_pools',
  'fn_bbj_allocate|row_lock|ca_bbj_alloc_state',
  'fn_bbj_allocate|write|ca_bbj_alloc_state',
  'fn_bbj_contribution_drops_cached_hours|advisory_lock|bbj-facts-hours:',
  'fn_bbj_contribution_drops_cached_hours|write|bbj_pool_contribution_hours',
  'fn_ca_process_hand_post_commit_obligations|advisory_lock|bbj-pool:',
  'fn_ca_process_hand_post_commit_obligations|row_lock|bbj_pools',
  'fn_ca_process_hand_post_commit_obligations|write|bbj_pools',
  'record_insurance_transaction|write|club_wallets',
  'record_insurance_transaction|write|union_wallets',
  'trg_union_rake_weekly|write|union_rake_weekly',
];

describe("a hand's money path never writes a shared row", () => {
  it('the live reader the latest reader migration installs is the module block, byte for byte', () => {
    // The newest migration that (re)defines the reader is READER: a later
    // change to the block moves this pin with a migration of its own.
    const definers = readdirSync(join(ROOT, 'supabase', 'migrations'))
      .filter((f) => /^\d{14}_.*\.sql$/.test(f))
      .filter((f) =>
        read('supabase', 'migrations', f).includes(
          'FUNCTION public.fn_ca_hand_path_shared_writes()\n'
        )
      )
      .sort();
    expect(definers[definers.length - 1]).toBe(READER);
    // Lane H2's earlier SET-target reader (#11311) is superseded by this stricter one.
    expect(definers).toContain(
      '20261118155729_an_update_of_trigger_fires_on_a_set_target_never_a_where_col.sql'
    );
    for (const m of [migration, reader]) {
      expect(m).toMatch(/^BEGIN;$/m);
      expect(m).toMatch(/^COMMIT;\s*$/m);
      expect(m).toMatch(
        /^-- @live-proof: \(SELECT md5\(pg_get_functiondef\('public\.fn_ca_hand_path_shared_writes\(\)'::regprocedure\)\) = '[0-9a-f]{32}'\)$/m
      );
      expect(m).toContain(
        'REVOKE ALL ON FUNCTION public.fn_ca_hand_path_shared_writes() FROM PUBLIC, anon, authenticated;'
      );
      expect(m).not.toMatch(/@install-window/);
    }
    expect(reader).toContain(handPathFunctionSQL() + ';');
    // The SET-target rule: a trigger column is matched against what the statement SETs.
    expect(handPathFunctionSQL()).toContain('AND pa.attname::text = ANY (CASE WHEN w.stmt ~');
    expect(handPathFunctionSQL()).not.toContain(
      "ANY (pg_catalog.regexp_split_to_array(w.stmt, '[^a-z0-9_]+'))))))"
    );
    // A reader: it writes nothing and runs on no timer.
    const body = handPathFunctionSQL();
    expect(body).not.toMatch(/\b(insert\s+into|delete\s+from)\b/i);
    expect(body).not.toMatch(/\bupdate\s+(public\.)?[a-z_]+\s+set\b/i);
    expect(migration).not.toMatch(/cron\.schedule/i);
    expect(reader).not.toMatch(/cron\.schedule/i);
    expect(body).toMatch(/\bSTABLE\b/);
  });

  it('the doors are the three hand commits and the bankers are the two deferred ones #11270/#11266 define', () => {
    expect([...HAND_PATH_ROOTS].sort()).toEqual([
      'fn_ca_commit_hand_settlement',
      'fn_ca_commit_hand_submission',
      'fn_ca_process_hand_post_commit_obligations',
    ]);
    const files = readdirSync(join(ROOT, 'supabase', 'migrations'));
    for (const banker of HAND_PATH_BANKERS) {
      const definers = files.filter((f) =>
        new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${banker}\\(`).test(
          read('supabase', 'migrations', f)
        )
      );
      expect(definers.length, banker).toBeGreaterThan(0);
      // The exclusion is earned: the banker never waits for a shared row.
      const text = definers.map((f) => read('supabase', 'migrations', f)).join('\n');
      expect(text, banker).toMatch(/NOWAIT|pg_try_advisory_xact_lock/);
    }
  });

  it('the applier splices the check into the migration transaction after the stale-pin pieces', () => {
    const applier = read('scripts', 'ci', 'apply-recorded-migration.mjs');
    expect(applier).toContain("import { handPathParts } from './hand-path-shared-writes.mjs';");
    expect(applier).toContain('handPath = handPathParts(file, sql, transactionBody);');
    expect(applier).toMatch(
      /stalePin\.snapshot \+\s*handPath\.snapshot \+\s*middle \+\s*stalePin\.check \+\s*handPath\.check \+/
    );
  });

  it('the applier pieces are gated, reserved and refuse what they must', () => {
    const later = `supabase/migrations/${HAND_PATH_CHECKED_FROM.slice(0, 12)}59_x.sql`;
    expect(isHandPathChecked(MIGRATION)).toBe(true);
    expect(isHandPathChecked('supabase/migrations/20261117000000_x.sql')).toBe(false);
    expect(isHandPathChecked(later)).toBe(true);
    const ddl =
      'BEGIN;\nCREATE OR REPLACE FUNCTION public.f() RETURNS void LANGUAGE sql AS $$ $$;\nCOMMIT;\n';
    const data = 'BEGIN;\nUPDATE public.clubs SET name = name WHERE false;\nCOMMIT;\n';
    expect(canChangeHandPath(ddl)).toBe(true);
    expect(canChangeHandPath(data)).toBe(false);
    expect(canChangeHandPath("BEGIN;\nDO $$ BEGIN EXECUTE 'x'; END $$;\nCOMMIT;\n")).toBe(true);
    expect(handPathParts(later, data, data)).toEqual({ snapshot: '', check: '' });
    const wrapped = handPathGuardSQL(later, ddl, ddl);
    expect(wrapped.indexOf('$ca_hand_path_snapshot$')).toBeGreaterThan(wrapped.indexOf('BEGIN;'));
    expect(wrapped.indexOf('$ca_hand_path_check$')).toBeLessThan(wrapped.lastIndexOf('COMMIT;'));
    expect(wrapped).toContain('migration_adds_a_shared_write_to_the_hand_path');
    expect(wrapped).toContain('hand_path_door_missing');
    expect(wrapped).toContain('ca.hand_path_catalog_fp');
    expect(wrapped).toContain('ca.hand_path_check_mode');
    const reserved = ddl.replace('COMMIT;', () => "SELECT '$ca_hand_path_check$';\nCOMMIT;");
    expect(() => handPathParts(later, reserved, reserved)).toThrow(/reserved/);
    expect(() => handPathParts(later, 'CREATE TABLE t();', 'CREATE TABLE t();')).toThrow(
      /one BEGIN; \.\.\. COMMIT;/
    );
    expect(
      declaredHandPathWrites(
        '-- @hand-path-shared-write-ok: fn_x write union_wallets because the owner said so\n'
      )
    ).toEqual(['fn_x|write|union_wallets']);
    expect(
      declaredHandPathWrites('-- @hand-path-shared-write-ok: fn_x write union_wallets\n')
    ).toEqual([]);
  });

  it('the allowlist is reasoned and excuses none of the writes #11270/#11266 remove', () => {
    expect(allowlistProblems(allowlist)).toEqual([]);
    const keys = new Set(allowlist.entries.map(violationKey));
    for (const k of REMOVED_BY_11270_11266) expect(keys.has(k), k).toBe(false);
    // Nobody waves the class itself through.
    for (const e of allowlist.entries) {
      expect(e.function).not.toMatch(
        /^(atomic_distribute_rake|bbj_record_contribution|record_insurance_transaction|fn_ca_process_hand_post_commit_obligations)$/
      );
    }
  });

  it("judged against production's first answer of 2026-11-18, exactly the 14 #11270/#11266 remove and the 11 that cannot fire are not excused", () => {
    const verdict = judge(production, allowlist)!;
    expect(verdict.unknown).toBeUndefined();
    expect(verdict.unexpected!.map(violationKey).sort()).toEqual(
      [
        ...REMOVED_BY_11270_11266,
        ...SET_TARGET_FALSE_POSITIVES,
        ...FIXED_BY_20261118161644,
        ...FIXED_BY_20261118161703,
      ].sort()
    );
    expect(verdict.stale).toEqual([]);
    expect(production.violations.length).toBe(37);
    const keys = new Set(allowlist.entries.map(violationKey));
    for (const k of SET_TARGET_FALSE_POSITIVES) expect(keys.has(k), k).toBe(false);
  });

  it("judged against production's answer under the SET-target rule, the allowlist is exact: nothing unexcused, nothing stale", () => {
    // As measured: only what 20261118161644 removes is not excused.
    const measured = judge(productionSet, allowlist)!;
    expect(measured.unknown).toBeUndefined();
    expect(measured.unexpected!.map(violationKey).sort()).toEqual(
      [...FIXED_BY_20261118161644, ...FIXED_BY_20261118161703].sort()
    );
    expect(measured.stale).toEqual([]);
    // With 20261118161644 installed, exactly as the PostgreSQL proof shows it.
    const proof = read('scripts', 'ci', 'test-hand-path-cash-lane.py');
    for (const k of FIXED_BY_20261118161644) expect(proof, k).toContain(`'${k}'`);
    const afterPart1 = {
      ...productionSet,
      violations: productionSet.violations.filter(
        (v: any) =>
          !FIXED_BY_20261118161644.includes(violationKey(v)) &&
          !FIXED_BY_20261118161703.includes(violationKey(v))
      ),
    };
    // Production's own answer once both parts installed is exactly that.
    expect(productionAfterWindow.violations.map(violationKey).sort()).toEqual(
      afterPart1.violations.map(violationKey).sort()
    );
    const live = judge(productionAfterWindow, allowlist)!;
    expect(live.unexpected).toEqual([]);
    expect(live.stale).toEqual([]);
    const verdict = judge(afterPart1, allowlist)!;
    expect(verdict.unexpected).toEqual([]);
    // An allowlisted entry whose write is gone is a failure here, not a note:
    // remove the entry in the change that removes the write.
    expect(verdict.stale).toEqual([]);
    expect(afterPart1.violations.length).toBe(allowlist.entries.length);
    for (const k of SET_TARGET_FALSE_POSITIVES)
      expect(productionSet.violations.map(violationKey)).not.toContain(k);
    // Lane H2's remaining entries are reasoned from production evidence, with their native proof named.
    for (const e of allowlist.entries.filter((x: { function: string }) =>
      ['fn_ca_burn', 'fn_spin_book_entry', 'fn_spin_reserve_pool'].includes(x.function)
    )) {
      expect(e.reason).toMatch(/STATIC ONLY/);
      expect(e.reason).toContain('test-hand-path-shared-writes.py G3');
    }
    // Every violation carries the path the reader printed.
    for (const v of productionSet.violations) expect(v.path, violationKey(v)).toMatch(/^fn_ca_/);
  });

  it('a stale entry (its write gone) and an unexcused violation are both named by judge', () => {
    const one = allowlist.entries[0];
    const now = productionAfterWindow.violations;
    const gone = {
      ...productionSet,
      violations: now.filter((v: any) => violationKey(v) !== violationKey(one)),
    };
    expect(judge(gone, allowlist)!.stale!.map(violationKey)).toEqual([violationKey(one)]);
    const extra = {
      ...productionSet,
      violations: [...now, { function: 'fn_x', kind: 'write', target: 'clubs' }],
    };
    expect(judge(extra, allowlist)!.unexpected!.map(violationKey)).toEqual(['fn_x|write|clubs']);
  });

  it('an answer without its doors, or a malformed one, is never green', () => {
    expect(
      judge({ roots: ['fn_ca_commit_hand_settlement'], violations: [] }, allowlist)!.unknown
    ).toMatch(/hand doors not found/);
    expect(judge(null, allowlist)).toBeNull();
    expect(judge({ roots: [...HAND_PATH_ROOTS] }, allowlist)).toBeNull();
  });

  it('CI asks the live catalog with main code, and proves the rules on PostgreSQL', () => {
    const live = read('.github', 'workflows', 'hand-path-shared-writes.yml');
    expect(live).toContain('pull_request_target:');
    expect(live).toContain('environment: ci-main');
    expect(live).toContain('ref: ${{ github.event.repository.default_branch }}');
    expect(live).toContain('run: node scripts/ci/check-hand-path-shared-writes.mjs');
    expect(live).not.toMatch(/schedule:/);
    const proof = read('.github', 'workflows', 'hand-path-shared-writes-proof.yml');
    expect(proof).toContain('python3 scripts/ci/test-hand-path-shared-writes.py');
    expect(proof).toContain('./.github/actions/install-postgres-17');
    expect(proof).not.toMatch(/schedule:/);
    const check = read('scripts', 'ci', 'check-hand-path-shared-writes.mjs');
    expect(check).toContain('process.exit(2)');
    expect(check).toContain('if (!res.ok)');
  });
});
