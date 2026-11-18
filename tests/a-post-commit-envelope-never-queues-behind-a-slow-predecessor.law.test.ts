/**
 * LAW: A POST-COMMIT ENVELOPE NEVER QUEUES BEHIND A SLOW PREDECESSOR
 *
 * Incident 075013fd, 2026-11-18 (LightningHandHost.post_commit_obligations_pending,
 * money_integrity). One slow envelope at a Lightning host table made every
 * later hand of the table queue on pg_advisory_xact_lock('hand-post-commit:')
 * with no lock_timeout until the 8 s statement timeout, only to be told under
 * the lock that an earlier envelope was still open. Every caller then walked
 * the same predecessor chain, and every host filed its own critical alert:
 * 8,303 statement timeouts, 38 million RPC calls, post-commit lag up to
 * 6,410 s on seven host tables, 1,736 alert deliveries.
 *
 * 20261118073646 and the server change pin, from the files:
 *
 *   1. the migration turns the 20261118071736 (#11266) postimage, derived
 *      from the production text through 20261118035606 (#11256), into its
 *      pinned postimage and refuses any other;
 *   2. the envelope answers completed / predecessor_pending from an unlocked
 *      read BEFORE the tournament lane or any lock, and re-checks under the
 *      lock exactly as before (strict per-table order);
 *   3. the table mutex is a bounded try-lock (table_busy), never a blocking
 *      wait; every lock the envelope names itself (hand row, add-on rows, the
 *      player_stats and club_members rows promo_apply_playthrough will lock)
 *      is waited for at most 1 s, and a refused lock rolls the body back and
 *      answers obligation_lock_busy (exactly once). Callees run with no
 *      bounded wait of their own: promo_apply_playthrough swallows any error
 *      from its player_stats upsert, so a bounded wait there would silently
 *      drop the stat;
 *   4. the completion receipt and the closed callee list are unchanged;
 *   5. the server's queued reasons are the ones the envelope returns, one
 *      chain helper walks per table per process, and the Lightning host files
 *      one stalled alert per (table, oldest open hand);
 *   6. no later migration puts a blocking table mutex back;
 *   7. the PostgreSQL convoy proof stays wired.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const SWITCH = '20261118035606_a_cash_hand_never_waits_on_a_tournament_wallet_lock.sql';
const BANK_SWITCH = '20261118071736_a_cash_hand_never_waits_on_the_union_bbj_pool_or_insurance_b.sql';
const CANDIDATE = '20261118073646_a_post_commit_envelope_never_queues_behind_a_slow_predecesso.sql';
const ENVELOPE = 'fn_ca_process_hand_post_commit_obligations';
const PRE = '11f769218554c9585f92ee2c5745e61f';
const POST = '342387f93ce2c61dd0a754a1c0290a67';

const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const code = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
const dollar = (sql: string, tag: string) => {
  const parts = sql.split(`$${tag}$`);
  expect(parts.length, `exactly one $${tag}$ block`).toBe(3);
  return parts[1];
};

const fixture = JSON.parse(
  read('scripts', 'ci', 'fixtures', 'cash-rake-pending', 'live-definitions.json')
) as { functions: Record<string, { definition: string }> };
const sw = read('supabase', 'migrations', SWITCH);
const bankSwitch = read('supabase', 'migrations', BANK_SWITCH);
const candidate = read('supabase', 'migrations', CANDIDATE);
let preimage = fixture.functions[ENVELOPE].definition;
for (const [sql, tag] of [
  [sw, 'env0'],
  [bankSwitch, 'env1'],
  [bankSwitch, 'env2'],
] as const) {
  expect(preimage.split(dollar(sql, `o${tag}`)).length).toBe(2);
  preimage = preimage.replace(dollar(sql, `o${tag}`), dollar(sql, `n${tag}`));
}
let postimage = preimage;
for (let i = 1; i <= 8; i++) {
  const old = dollar(candidate, `o${i}`);
  expect(postimage.split(old).length, `anchor ${i} occurs exactly once`).toBe(2);
  postimage = postimage.replace(old, dollar(candidate, `n${i}`));
}
const body = code(postimage);
const at = (re: RegExp | string) =>
  typeof re === 'string' ? body.indexOf(re) : body.search(re);

describe('a post-commit envelope never queues behind a slow predecessor', () => {
  it("the migration pins #11266's postimage as its preimage and produces the pinned postimage", () => {
    expect(md5(preimage)).toBe(PRE);
    expect(md5(postimage)).toBe(POST);
    expect(candidate).toContain(`'${PRE}', '${POST}'`);
    expect(candidate).toMatch(/IF md5\(v_def\) <> p_before THEN\s+RAISE EXCEPTION/);
    expect(candidate).toContain(`@live-proof: (SELECT md5(pg_get_functiondef('public.${ENVELOPE}(uuid)'::regprocedure)) = '${POST}')`);
    expect(code(candidate)).toMatch(/^BEGIN;/m);
    expect(code(candidate)).toMatch(/^COMMIT;/m);
  });

  it('answers completed and predecessor_pending before the lane and before any lock', () => {
    const peekPredecessor = at(/'reason', 'predecessor_pending',\s+'retryable', true/);
    const peekCompleted = at(/IF v_peek_has_payload AND v_peek_completed_at IS NOT NULL THEN/);
    const lane = at('smarter_private.f06_wait_table_lane(v_table_id)');
    const mutex = at('pg_try_advisory_xact_lock(v_mutex_key)');
    const rowLock = at(/WHERE c\.hand_id = p_hand_id\s+FOR UPDATE;/);
    for (const i of [peekPredecessor, peekCompleted, lane, mutex, rowLock]) expect(i).toBeGreaterThan(-1);
    expect(peekCompleted).toBeLessThan(lane);
    expect(peekPredecessor).toBeLessThan(lane);
    expect(lane).toBeLessThan(mutex);
    expect(mutex).toBeLessThan(rowLock);
    expect(body.slice(0, lane)).not.toMatch(/FOR UPDATE|FOR SHARE|advisory/i);
  });

  it('still re-checks the predecessor under the lock, so strict per-table order holds', () => {
    const rowLock = at(/WHERE c\.hand_id = p_hand_id\s+FOR UPDATE;/);
    const recheck = body.slice(rowLock).search(
      /WHERE e\.table_id = v_commit\.table_id\s+AND e\.hand_number < v_commit\.hand_number\s+AND e\.post_commit_payload IS NOT NULL\s+AND e\.post_commit_completed_at IS NULL/
    );
    const receipt = body.slice(rowLock).search(/UPDATE public\.hand_atomic_commits c\s+SET post_commit_completed_at = clock_timestamp\(\)/);
    expect(recheck).toBeGreaterThan(-1);
    expect(receipt).toBeGreaterThan(recheck);
  });

  it('never blocks on the table mutex, and bounds every other lock wait', () => {
    expect(body).not.toMatch(/pg_advisory_xact_lock\(\s*hashtextextended\('hand-post-commit:/);
    expect(body).toMatch(
      /WHILE NOT pg_try_advisory_xact_lock\(v_mutex_key\) LOOP\s+IF clock_timestamp\(\) - v_mutex_started >= interval '250 milliseconds' THEN\s+RETURN jsonb_build_object\(\s+'ok', false,\s+'reason', 'table_busy'/
    );
    expect(postimage).toMatch(/^ SET lock_timeout TO '1s'$/m);
    expect(body).toMatch(
      /EXCEPTION WHEN lock_not_available THEN\s+RETURN jsonb_build_object\(\s+'ok', false,\s+'reason', 'obligation_lock_busy',\s+'retryable', true/
    );
    // The handler covers the row lock and everything after it, up to the receipt.
    const block = body.lastIndexOf('BEGIN', at(/WHERE c\.hand_id = p_hand_id\s+FOR UPDATE;/));
    expect(body.slice(block, block + 5)).toBe('BEGIN');
    expect(body.indexOf('EXCEPTION WHEN lock_not_available')).toBeGreaterThan(
      body.indexOf('post_commit_completed_at = clock_timestamp()')
    );
  });

  it('bounds only the locks it names, and never inside a callee that swallows errors', () => {
    const rowLock = at(/WHERE c\.hand_id = p_hand_id\s+FOR UPDATE;/);
    const after = body.slice(rowLock);
    // Right after the hand row: callees keep the wait they always had.
    expect(after).toMatch(/^WHERE c\.hand_id = p_hand_id\s+FOR UPDATE;\s+PERFORM set_config\('lock_timeout', '0', true\);/);
    // promo_apply_playthrough's rows, in its own order, bounded, then unbounded for the call.
    expect(after).toMatch(
      /PERFORM set_config\('lock_timeout', '1s', true\);\s+PERFORM 1\s+FROM public\.player_stats s[\s\S]*?FOR UPDATE;\s+PERFORM 1\s+FROM public\.club_members m[\s\S]*?FOR UPDATE;\s+PERFORM set_config\('lock_timeout', '0', true\);\s+v_promo_result := public\.promo_apply_playthrough\(/
    );
    expect(after).toMatch(
      /PERFORM set_config\('lock_timeout', '1s', true\);\s+SELECT a\.\* INTO v_addon\s+FROM public\.table_pending_addons a[\s\S]*?FOR UPDATE;\s+PERFORM set_config\('lock_timeout', '0', true\);/
    );
    // Every '1s' is closed by a '0' before any callee runs.
    const sets = [...after.matchAll(/set_config\('lock_timeout', '(0|1s)', true\)/g)].map((m) => m[1]);
    expect(sets).toEqual(['0', '1s', '0', '1s', '0']);
    for (const callee of ['promo_apply_playthrough', 'resolve_pending_addon', 'fn_union_pnl_prove_posthand_escrow']) {
      const i = after.indexOf(`public.${callee}(`);
      const last = after.slice(0, i).match(/set_config\('lock_timeout', '(0|1s)', true\)/g)!.pop();
      expect(last, `${callee} runs with lock_timeout 0`).toBe("set_config('lock_timeout', '0', true)");
    }
  });

  it('keeps the closed callee list of 20261118071736', () => {
    const callees = [
      ...new Set(
        [...body.matchAll(/\b(?:public|smarter_private)\.([a-z_0-9]+)\s*\(/g)]
          .filter((m) => !/(INSERT INTO|FUNCTION)\s+$/.test(body.slice(0, m.index)))
          .map((m) => m[1])
      ),
    ].sort();
    expect(callees).toEqual([
      'f06_wait_table_lane',
      'fn_platform_frozen',
      'fn_union_pnl_certify_posthand_escrow',
      'fn_union_pnl_prove_posthand_escrow',
      'original_inventory_proof_sources_match',
      'posthand_escrow_original_snapshot',
      'promo_apply_playthrough',
      'resolve_pending_addon',
    ]);
  });

  it('the server treats exactly the envelope retryable answers as queued', () => {
    const retryable = [
      ...new Set([...body.matchAll(/'reason', '([a-z_]+)',\s+'retryable', true/g)].map((m) => m[1])),
    ].sort();
    expect(retryable).toEqual(['obligation_lock_busy', 'predecessor_pending', 'table_busy']);
    const reasons = read('server', 'src', 'services', 'supabase', 'postCommitReasons.ts');
    for (const r of retryable) expect(reasons).toContain(`'${r}'`);
  });

  it('one chain helper per table per process, and one stalled alert per episode', () => {
    const projection = read('server', 'src', 'services', 'supabase', 'handProjection.ts');
    expect(projection).toMatch(/const chainHelpers = new Map<string, Promise<boolean>>\(\);/);
    expect(projection).toMatch(/const inFlight = chainHelpers\.get\(tableId!\);\s+if \(inFlight\) return/);
    const host = read('server', 'src', 'lightning', 'LightningHandHost.ts');
    const drain = host.slice(host.indexOf('private async drainPostCommit('), host.indexOf('private filePostCommitAlert('));
    expect(drain).toMatch(/if \(!stalls\.open\(this\.hostTableId, oldestHandId, this\.now\(\)\)\) \{[\s\S]*?return false;\s+\}\s+this\.filePostCommitAlert\(handHistoryId, attempt, lastError, \{\s+kind: 'stalled'/);
    expect(drain).toMatch(/if \(kind === 'failed'\) failure = lastReason;/);
  });

  it('no later migration puts a blocking table mutex back into the envelope', () => {
    const later = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql') && f.slice(0, 14) > CANDIDATE.slice(0, 14))
      .filter((f) => {
        const sql = code(readFileSync(join(MIGRATIONS, f), 'utf8'));
        return (
          new RegExp(`CREATE OR REPLACE FUNCTION public\\.${ENVELOPE}\\(`).test(sql) &&
          /pg_advisory_xact_lock\(\s*hashtextextended\('hand-post-commit:/.test(sql)
        );
      });
    expect(later, 'the envelope takes its table mutex with a bounded try-lock (20261118073646)').toEqual([]);
  });

  it('the PostgreSQL convoy proof stays wired', () => {
    const harness = read('scripts', 'ci', 'test-post-commit-envelope-convoy-postgres.py');
    expect(harness).toContain(`POST = '${POST}'`);
    expect(harness).toContain("check('AFTER: zero statement timeouts', timeouts == 0");
    expect(harness).toContain("check('AFTER: draining applies every hand exactly once'");
    expect(harness).toContain("check('AFTER: the stat is not dropped: nothing written while held, written once after'");
    expect(harness).toContain("check('AFTER: the callee runs with no bounded wait of its own (nothing to swallow)'");
    const workflow = read('.github', 'workflows', 'post-commit-envelope-convoy.yml');
    for (const f of [SWITCH, BANK_SWITCH, CANDIDATE]) expect(workflow).toContain(`supabase/migrations/${f}`);
    expect(workflow).toContain('python3 scripts/ci/test-post-commit-envelope-convoy-postgres.py');
  });
});
