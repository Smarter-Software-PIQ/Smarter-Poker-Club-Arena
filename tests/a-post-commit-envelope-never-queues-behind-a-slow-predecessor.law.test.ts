/**
 * LAW: A POST-COMMIT ENVELOPE NEVER QUEUES BEHIND A SLOW PREDECESSOR
 *
 * Incident 075013fd, 2026-11-18 (LightningHandHost.post_commit_obligations_pending,
 * money_integrity). One slow envelope at a Lightning host table made every
 * later hand of the table queue on pg_advisory_xact_lock('hand-post-commit:')
 * with no bound of its own until the 8 s statement timeout, only to be told under
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
const PRE = '7a796358fa28fda910e0f28ded72ff79';
const POST = '39d75365156c46476bfe01854d3c86b9';

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
  [bankSwitch, 'env0'],
  [bankSwitch, 'env1'],
  [bankSwitch, 'env2'],
] as const) {
  expect(preimage.split(dollar(sql, `o${tag}`)).length).toBe(2);
  const next = dollar(sql, `n${tag}`);
  preimage = preimage.replace(dollar(sql, `o${tag}`), () => next);
}
let postimage = preimage;
for (let i = 1; i <= 7; i++) {
  const old = dollar(candidate, `o${i}`);
  expect(postimage.split(old).length, `anchor ${i} occurs exactly once`).toBe(2);
  // A replacer function, not a string: '$' in the new text is literal SQL ($', $&).
  const next = dollar(candidate, `n${i}`);
  postimage = postimage.replace(old, () => next);
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
      /WHILE NOT pg_try_advisory_xact_lock\(v_mutex_key\) LOOP\s+IF clock_timestamp\(\) - v_mutex_started >= interval '250 milliseconds' THEN\s+RETURN jsonb_build_object\(\s+'ok', false,\s+'reason', CASE WHEN v_contract >= 2 THEN 'table_busy' ELSE 'predecessor_pending' END,\s+'queued_reason', 'table_busy',/
    );
    // No function-level setting: callers' and callees' own lock_timeout stand.
    expect(postimage).not.toMatch(/^ SET lock_timeout/m);
    expect(postimage.match(/^ SET /gm)).toEqual([' SET ']);
    expect(body).toMatch(
      /EXCEPTION WHEN lock_not_available THEN\s+RETURN jsonb_build_object\(\s+'ok', false,\s+'reason', CASE WHEN v_contract >= 2 THEN 'obligation_lock_busy' ELSE 'predecessor_pending' END,\s+'queued_reason', 'obligation_lock_busy',\s+'retryable', true/
    );
    // The handler covers the row lock and everything after it, up to the receipt.
    const block = body.lastIndexOf('BEGIN', at(/WHERE c\.hand_id = p_hand_id\s+FOR UPDATE;/));
    expect(body.slice(block, block + 5)).toBe('BEGIN');
    expect(body.indexOf('EXCEPTION WHEN lock_not_available')).toBeGreaterThan(
      body.indexOf('post_commit_completed_at = clock_timestamp()')
    );
  });

  it('bounds only the locks it names, and never inside a callee that swallows errors', () => {
    expect(body).toMatch(/v_caller_lock_timeout text := current_setting\('lock_timeout'\);/);
    const block = body.slice(at('pg_try_advisory_xact_lock(v_mutex_key)'));
    const BOUND = "set_config('lock_timeout', '1s', true)";
    const BACK = "set_config('lock_timeout', v_caller_lock_timeout, true)";
    // The hand row, bounded, then the caller's value again.
    expect(block).toMatch(
      /PERFORM set_config\('lock_timeout', '1s', true\);\s+SELECT c\.\* INTO v_commit\s+FROM public\.hand_atomic_commits c\s+WHERE c\.hand_id = p_hand_id\s+FOR UPDATE;\s+PERFORM set_config\('lock_timeout', v_caller_lock_timeout, true\);/
    );
    // promo_apply_playthrough's rows, in its own order, bounded; the call itself is not.
    expect(block).toMatch(
      /PERFORM set_config\('lock_timeout', '1s', true\);\s+PERFORM 1\s+FROM public\.player_stats s[\s\S]*?FOR UPDATE;\s+PERFORM 1\s+FROM public\.club_members m[\s\S]*?FOR UPDATE;\s+PERFORM set_config\('lock_timeout', v_caller_lock_timeout, true\);\s+v_promo_result := public\.promo_apply_playthrough\(/
    );
    expect(block).toMatch(
      /PERFORM set_config\('lock_timeout', '1s', true\);\s+SELECT a\.\* INTO v_addon\s+FROM public\.table_pending_addons a[\s\S]*?FOR UPDATE;\s+PERFORM set_config\('lock_timeout', v_caller_lock_timeout, true\);/
    );
    // Every bound is closed before anything else runs; no other value is ever set.
    const sets = [...block.matchAll(/set_config\('lock_timeout', ([^,]+), true\)/g)].map((m) => m[1]);
    expect(sets).toEqual(["'1s'", 'v_caller_lock_timeout', "'1s'", 'v_caller_lock_timeout', "'1s'", 'v_caller_lock_timeout']);
    expect(body.match(/set_config\('lock_timeout'/g)).toHaveLength(6);
    for (const callee of ['promo_apply_playthrough', 'resolve_pending_addon', 'fn_union_pnl_prove_posthand_escrow']) {
      const before = block.slice(0, block.indexOf(`public.${callee}(`));
      expect(before.lastIndexOf(BACK), `${callee} runs with the caller's lock_timeout`).toBeGreaterThan(
        before.lastIndexOf(BOUND)
      );
    }
  });

  it("#11266's insurance-bank try-lock refusal is answered as obligation_lock_busy", () => {
    const busy = postimage.search(/RAISE EXCEPTION 'insurance bank % is busy deciding another payout or debit \(hand %\)',\s+v_insurance_union, p_hand_id USING ERRCODE = '55P03';/);
    const block = postimage.indexOf('BEGIN\n  /* The bounded wait applies only where this function names the rows');
    const handler = postimage.indexOf('EXCEPTION WHEN lock_not_available THEN');
    expect(busy).toBeGreaterThan(-1);
    expect(block).toBeGreaterThan(-1);
    expect(block).toBeLessThan(busy);
    expect(busy).toBeLessThan(handler);
    const stall = read('server', 'src', 'lightning', 'LightningPostCommitStall.ts');
    expect(stall).not.toMatch(/insurance bank/i);
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
      ...new Set([
        ...[...body.matchAll(/'reason', '([a-z_]+)',\s+'retryable', true/g)].map((m) => m[1]),
        ...[...body.matchAll(/'queued_reason', '([a-z_]+)'/g)].map((m) => m[1]),
      ]),
    ].sort();
    expect(retryable).toEqual(['obligation_lock_busy', 'predecessor_pending', 'table_busy']);
    const reasons = read('server', 'src', 'services', 'supabase', 'postCommitReasons.ts');
    for (const r of retryable) expect(reasons).toContain(`'${r}'`);
  });

  it('the new answers are opt-in per request: an old caller only ever sees answers it handles', () => {
    // Contract 2 is the PostgREST request header, read once, without a subtransaction.
    expect(body).toMatch(/v_contract integer := 1;/);
    expect(body).toMatch(
      /IF pg_input_is_valid\(COALESCE\(current_setting\('request\.headers', true\), ''\), 'json'\)\s+AND \(current_setting\('request\.headers', true\)::json\s+->> 'x-ca-post-commit-contract'\) ~ '\^\[0-9\]\{1,3\}\$' THEN/
    );
    // Every new reason is behind the contract; without it, predecessor_pending.
    for (const r of ['table_busy', 'obligation_lock_busy']) {
      const uses = [...body.matchAll(new RegExp(`'${r}'`, 'g'))].map((m) => m.index!);
      const guarded = [
        ...body.matchAll(new RegExp(`CASE WHEN v_contract >= 2 THEN '${r}' ELSE 'predecessor_pending' END`, 'g')),
      ].length;
      const carried = [...body.matchAll(new RegExp(`'queued_reason', '${r}'`, 'g'))].length;
      expect(guarded, `${r} is returned only under contract 2`).toBeGreaterThan(0);
      expect(uses.length, `${r} appears only as a guarded reason or a queued_reason`).toBe(guarded + carried);
    }
    // The engine speaks it on every call that can receive the envelope's answer.
    const reasons = read('server', 'src', 'services', 'supabase', 'postCommitReasons.ts');
    expect(reasons).toContain("export const POST_COMMIT_CONTRACT_HEADER = 'x-ca-post-commit-contract';");
    expect(reasons).toContain("export const POST_COMMIT_CONTRACT_VERSION = '2';");
    const projection = read('server', 'src', 'services', 'supabase', 'handProjection.ts');
    expect(projection).toMatch(/speakPostCommitContract\(\s+supabase\.rpc\('fn_ca_process_hand_post_commit_obligations'/);
    expect(projection).toMatch(/speakPostCommitContract\(\s+supabase\.rpc\('fn_project_hand_side_effects'/);
    expect(projection.match(/supabase\.rpc\('fn_(ca_process_hand_post_commit_obligations|project_hand_side_effects)'/g)).toHaveLength(2);
    // The PostgreSQL proof runs both contracts.
    const harness = read('scripts', 'ci', 'test-post-commit-envelope-convoy-postgres.py');
    expect(harness).toContain("check('CONTRACT 1: every answer is one an existing caller already handles'");
  });

  it('one chain helper per table per process, and one stalled alert per table episode', () => {
    const projection = read('server', 'src', 'services', 'supabase', 'handProjection.ts');
    expect(projection).toMatch(/const chainHelpers = new Map<string, \{ walk: Promise<boolean>; endsByMs: number \}>\(\);/);
    expect(projection).toMatch(/const inFlight = chainHelpers\.get\(tableId!\);\s+if \(inFlight\) \{/);
    // The projection worker defers every queued answer instead of failing it.
    expect(projection).toMatch(/\} else if \(isQueuedPostCommitReason\(result\.reason\)\) \{\s+\/\/ Preserve the row\./);
    const host = read('server', 'src', 'lightning', 'LightningHandHost.ts');
    const drain = host.slice(host.indexOf('private async drainPostCommit('), host.indexOf('private filePostCommitAlert('));
    expect(drain).toMatch(/const \{ opened, episode \} = stalls\.stalled\(this\.hostTableId, oldestHandId, ageMs, this\.now\(\)\);\s+if \(!opened\) \{[\s\S]*?return false;\s+\}\s+this\.filePostCommitAlert\(handHistoryId, attempt, lastError, \{\s+kind: 'stalled'/);
    expect(drain).toMatch(/if \(kind === 'failed'\) failure = lastReason;/);
    expect(drain).toMatch(/if \(classifyPostCommitError\(lastReason\) === 'failed'\) failure = lastReason;/);
    // Definite is a closed list; everything else is queued.
    const stall = read('server', 'src', 'lightning', 'LightningPostCommitStall.ts');
    expect(stall).toMatch(/POST_COMMIT_DEFINITE_REASONS: ReadonlySet<string> = new Set\(\[\s+'not_found',\s+'legacy_no_obligations',\s+\]\)/);
    expect(stall).toMatch(/return isDefinitePostCommitError\(message\) \? 'failed' : 'queued';/);
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
    expect(harness).toContain("check('AFTER: the callee runs with the caller\\'s own lock_timeout (nothing shortened to swallow)'");
    expect(harness).toContain("check('AFTER: a caller holding the table mutex (fn_project_hand_side_effects) gets obligation_lock_busy and a usable transaction'");
    const workflow = read('.github', 'workflows', 'post-commit-envelope-convoy.yml');
    for (const f of [SWITCH, BANK_SWITCH, CANDIDATE]) expect(workflow).toContain(`supabase/migrations/${f}`);
    expect(workflow).toContain('python3 scripts/ci/test-post-commit-envelope-convoy-postgres.py');
  });
});
