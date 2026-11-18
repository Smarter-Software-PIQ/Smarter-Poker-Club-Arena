/**
 * LAW: THE PROJECTION WORKER NEVER QUEUES ON THE TABLE LOCK, AND ONE DRAIN
 * CALL CLEARS A TABLE
 *
 * Incident 075013fd follow-ups left open by #11269 (20261118073646 bounded the
 * post-commit envelope's own wait for the per-table mutex and named these two).
 *
 *   1. fn_project_hand_side_effects, the projection worker's RPC, took
 *      pg_advisory_xact_lock('hand-post-commit:<table>') and every seated
 *      player's 'player-stats:<uuid>' lock with no bound of its own:
 *      production lock_timeout is 0, so each waiter held a connection until
 *      service_role's 8 s statement timeout, the same pile-up the incident
 *      was. 20261118155509 tries the mutex for at most 250 ms (table_busy)
 *      and the player locks within one 1 s deadline (obligation_lock_busy),
 *      both before anything is written, under #11269's versioned answer
 *      contract: only a request carrying x-ca-post-commit-contract: 2 sees
 *      the new reasons; every other caller sees predecessor_pending with the
 *      real reason in queued_reason.
 *   2. fn_ca_drain_orphaned_post_commit_envelopes advanced only each table's
 *      head-of-line hand per call. One call now walks each table's backlog in
 *      hand order up to p_limit, stopping a table at its first hand that does
 *      not complete. It has no caller and no schedule (its job was retired by
 *      20260922155223), and this change gives it neither.
 *
 * Pinned from the files: the pinned preimages and postimages, the lock order,
 * the bounded waits, the contract guard, the drain's per-table stop, the
 * server's handling, no later blocking mutex, and the PostgreSQL proof.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const RAKE_PART = '20261118034950_a_cash_hands_rake_waits_in_its_own_row_not_on_the_union_wall.sql';
const BANK_PART = '20261118071728_a_hands_bbj_drop_and_insurance_wait_in_their_own_rows_not_on.sql';
const DRAIN_ORIGIN = '20260909085724_a_hand_that_finished_stops_paging_and_an_orphan_envelope_gets_drained.sql';
const CANDIDATE = '20261118155509_the_projection_worker_never_queues_on_the_table_lock_and_the.sql';
const PROJ_PRE = '39d043cda727119e0a6d883a3fb25d50';
const PROJ_POST = '1e8eee8fe33b798b9fc2ac44c81d995a';
const DRAIN_PRE = '6abdcb7286ea8823034f7c0eb1c7ed40';
const DRAIN_POST = '7ae9773086093fad851bb66ffa1b8732';
const ENVELOPE_POST = '39d75365156c46476bfe01854d3c86b9';

const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const code = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
const dollar = (sql: string, tag: string) => {
  const parts = sql.split(`$${tag}$`);
  expect(parts.length, `exactly one $${tag}$ block`).toBe(3);
  return parts[1];
};
const once = (text: string, from: string, to: string) => {
  expect(text.split(from).length, 'anchor occurs exactly once').toBe(2);
  // A replacer function: '$' in SQL is literal ($', $&).
  return text.replace(from, () => to);
};

const fixture = JSON.parse(
  read('scripts', 'ci', 'fixtures', 'cash-rake-pending', 'live-definitions.json')
) as { functions: Record<string, { definition: string }> };
const candidate = read('supabase', 'migrations', CANDIDATE);
const rakePart = read('supabase', 'migrations', RAKE_PART);
const bankPart = read('supabase', 'migrations', BANK_PART);

/* The projection function as production holds it: the fixture's text through
   20261118034950 and 20261118071728 (the derivation the #11266 law pins). */
let projPre = once(
  fixture.functions.fn_project_hand_side_effects.definition,
  dollar(rakePart, 'oproj0'),
  dollar(rakePart, 'nproj0')
);
for (let i = 1; i <= 4; i++) projPre = once(projPre, dollar(bankPart, `oproj${i}`), dollar(bankPart, `nproj${i}`));
let projPost = projPre;
for (let i = 1; i <= 3; i++) projPost = once(projPost, dollar(candidate, `p${i}o`), dollar(candidate, `p${i}n`));

/* The drain as production holds it: 20260909085724's body under the header
   pg_get_functiondef prints for it. */
const origin = read('supabase', 'migrations', DRAIN_ORIGIN);
const drainSrc = origin.slice(
  origin.indexOf('$function$', origin.indexOf('FUNCTION public.fn_ca_drain_orphaned_post_commit_envelopes(')) + 10
);
const drainPre =
  "CREATE OR REPLACE FUNCTION public.fn_ca_drain_orphaned_post_commit_envelopes(p_older_than interval DEFAULT '00:10:00'::interval, p_limit integer DEFAULT 200)\n" +
  " RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'\nAS $function$" +
  drainSrc.slice(0, drainSrc.indexOf('$function$')) +
  '$function$\n';
const drainPost = once(drainPre, dollar(candidate, 'd1o'), dollar(candidate, 'd1n'));

const proj = code(projPost);
const drain = code(drainPost);
const at = (body: string, needle: string | RegExp) =>
  typeof needle === 'string' ? body.indexOf(needle) : body.search(needle);

describe('the projection worker never queues on the table lock', () => {
  it('turns the pinned production preimages into the pinned postimages, and nothing else', () => {
    expect(md5(projPre)).toBe(PROJ_PRE);
    expect(md5(drainPre)).toBe(DRAIN_PRE);
    expect(md5(projPost)).toBe(PROJ_POST);
    expect(md5(drainPost)).toBe(DRAIN_POST);
    expect(candidate).toContain(`'${PROJ_PRE}', '${PROJ_POST}'`);
    expect(candidate).toContain(`'${DRAIN_PRE}', '${DRAIN_POST}'`);
    expect(candidate).toMatch(/IF md5\(v_def\) <> p_before THEN\s+RAISE EXCEPTION/);
    // #11269's envelope must be live first, and is not replaced here.
    expect(candidate).toContain(`<> '${ENVELOPE_POST}' THEN`);
    expect(code(candidate)).not.toMatch(/FUNCTION public\.fn_ca_process_hand_post_commit_obligations\(/);
    expect(candidate).toContain(
      `@live-proof: (SELECT md5(pg_get_functiondef('public.fn_project_hand_side_effects(uuid)'::regprocedure)) = '${PROJ_POST}' AND md5(pg_get_functiondef('public.fn_ca_drain_orphaned_post_commit_envelopes(interval,integer)'::regprocedure)) = '${DRAIN_POST}')`
    );
    expect(code(candidate).match(/^BEGIN;/gm)).toHaveLength(1);
    expect(code(candidate).match(/^COMMIT;/gm)).toHaveLength(1);
    // Owner, security, settings and grants are asserted unchanged.
    expect(candidate).toMatch(/RAISE EXCEPTION '%: owner, security, settings or grants moved', p_sig;/);
  });

  it('banks first, then the lane, then the bounded mutex, then the bounded player locks, then the envelope', () => {
    const bank = at(proj, 'public.fn_ca_bank_pending_hand_obligations(p_hand_id)');
    const rake = at(proj, 'public.fn_ca_bank_pending_cash_rake(p_hand_id)');
    const lane = at(proj, 'smarter_private.f06_wait_table_lane(v_table_id)');
    const mutex = at(proj, 'WHILE NOT pg_try_advisory_xact_lock(v_lock_key) LOOP');
    const players = at(proj, "WHILE NOT pg_try_advisory_xact_lock(hashtextextended('player-stats:' || v_seat_uid::text, 0)) LOOP");
    const envelope = at(proj, 'public.fn_ca_process_hand_post_commit_obligations(p_hand_id)');
    const projection = at(proj, "pg_advisory_xact_lock(\n    hashtextextended('hand-projection:'");
    const after = at(proj, 'public.fn_project_hand_side_effects_after_post_commit_20260908(');
    for (const i of [bank, rake, lane, mutex, players, envelope, projection, after]) expect(i).toBeGreaterThan(-1);
    expect(bank).toBeLessThan(lane);
    expect(rake).toBeLessThan(lane);
    expect(lane).toBeLessThan(mutex);
    expect(mutex).toBeLessThan(players);
    expect(players).toBeLessThan(envelope);
    expect(envelope).toBeLessThan(projection);
    expect(projection).toBeLessThan(after);
    // The player locks are still claimed in uuid order.
    expect(proj.slice(mutex, players)).toMatch(/ORDER BY 1\s+LOOP\s+$/);
  });

  it('never blocks on the table mutex or a player lock, and answers before it writes', () => {
    expect(proj).not.toMatch(/pg_advisory_xact_lock\(\s*hashtextextended\('hand-post-commit:/);
    expect(proj).not.toMatch(/PERFORM pg_advisory_xact_lock\(hashtextextended\('player-stats:/);
    expect(proj).toMatch(
      /v_lock_key := hashtextextended\('hand-post-commit:' \|\| v_table_id::text, 0\);\s+v_lock_started := clock_timestamp\(\);\s+WHILE NOT pg_try_advisory_xact_lock\(v_lock_key\) LOOP\s+IF clock_timestamp\(\) - v_lock_started >= interval '250 milliseconds' THEN\s+RETURN jsonb_build_object\(\s+'ok', false,\s+'reason', CASE WHEN v_contract >= 2 THEN 'table_busy' ELSE 'predecessor_pending' END,\s+'queued_reason', 'table_busy',\s+'retryable', true,\s+'projection_applied', false,/
    );
    expect(proj).toMatch(
      /v_lock_waited := extract\(epoch FROM clock_timestamp\(\) - v_lock_started\);\s+IF v_lock_waited >= 1 THEN\s+RETURN jsonb_build_object\(\s+'ok', false,\s+'reason', CASE WHEN v_contract >= 2 THEN 'obligation_lock_busy' ELSE 'predecessor_pending' END,\s+'queued_reason', 'obligation_lock_busy',\s+'retryable', true,\s+'projection_applied', false,/
    );
    // One 1 s deadline for all the players, started after the mutex is held.
    const deadline = proj.indexOf('v_lock_started := clock_timestamp();', at(proj, 'WHILE NOT pg_try_advisory_xact_lock(v_lock_key) LOOP'));
    expect(deadline).toBeGreaterThan(-1);
    expect(deadline).toBeLessThan(at(proj, 'FOR v_seat_uid IN'));
    // The function itself writes nothing: every write is a callee's, after the locks.
    expect(proj).not.toMatch(/\b(INSERT INTO|UPDATE public\.|DELETE FROM)\b/);
    // No function-level setting moved (search_path only).
    expect(projPost.match(/^ SET .*$/gm)).toEqual([" SET search_path TO 'public', 'pg_temp'"]);
  });

  it("speaks #11269's contract exactly: an old caller only ever sees predecessor_pending", () => {
    expect(proj).toMatch(/v_contract integer := 1;/);
    expect(proj).toMatch(
      /IF pg_input_is_valid\(COALESCE\(current_setting\('request\.headers', true\), ''\), 'json'\)\s+AND \(current_setting\('request\.headers', true\)::json\s+->> 'x-ca-post-commit-contract'\) ~ '\^\[0-9\]\{1,3\}\$' THEN/
    );
    for (const r of ['table_busy', 'obligation_lock_busy']) {
      const uses = (proj.match(new RegExp(`'${r}'`, 'g')) ?? []).length;
      const guarded = (proj.match(new RegExp(`CASE WHEN v_contract >= 2 THEN '${r}' ELSE 'predecessor_pending' END`, 'g')) ?? []).length;
      const carried = (proj.match(new RegExp(`'queued_reason', '${r}'`, 'g')) ?? []).length;
      expect(guarded, `${r} is returned only under contract 2`).toBe(1);
      expect(uses, `${r} appears only guarded or as queued_reason`).toBe(guarded + carried);
    }
    // The server sends the header on this RPC and defers every queued reason.
    const reasons = read('server', 'src', 'services', 'supabase', 'postCommitReasons.ts');
    for (const r of ['predecessor_pending', 'table_busy', 'obligation_lock_busy']) expect(reasons).toContain(`'${r}'`);
    const projection = read('server', 'src', 'services', 'supabase', 'handProjection.ts');
    expect(projection).toMatch(/speakPostCommitContract\(\s+supabase\.rpc\('fn_project_hand_side_effects'/);
    expect(projection).toMatch(/const result = readPostCommitAnswer\(\(projected \?\? \{\}\) as ProjectionResult\);/);
    expect(projection).toMatch(/\} else if \(isQueuedPostCommitReason\(result\.reason\)\) \{\s+\/\/ Preserve the row\./);
  });

  it('one drain call walks each table in hand order and stops a table at its first hand that does not complete', () => {
    // The head-of-line-only barrier is gone; order is per table, by hand number.
    expect(drain).not.toMatch(/NOT EXISTS/);
    expect(drain).toMatch(/ORDER BY h\.head_at, p\.table_id, p\.hand_number/);
    expect(drain).toMatch(/IF r\.table_id = ANY \(v_stopped_tables\) THEN\s+v_skipped := v_skipped \+ 1;\s+CONTINUE;\s+END IF;\s+EXIT WHEN v_seen >= GREATEST\(p_limit, 1\);/);
    expect(drain).toMatch(/IF v_reason IS NOT NULL THEN\s+v_stopped_tables := v_stopped_tables \|\| r\.table_id;/);
    // Each hand is the envelope itself, in its own subtransaction; it reads the
    // contract-1 queued_reason first.
    expect(drain).toMatch(/BEGIN\s+v_res := public\.fn_ca_process_hand_post_commit_obligations\(r\.hand_id\);[\s\S]*?EXCEPTION WHEN OTHERS THEN/);
    expect(drain).toContain("COALESCE(v_res->>'queued_reason', v_res->>'reason')");
    const callees = [...new Set([...drain.matchAll(/\b(?:public|smarter_private)\.([a-z_0-9]+)\s*\(/g)].map((m) => m[1]))].sort();
    expect(callees).toEqual(['fn_ca_drain_orphaned_post_commit_envelopes', 'fn_ca_process_hand_post_commit_obligations']);
    // No lock of its own and no write of its own: every wait is the envelope's bounded one.
    expect(drain).not.toMatch(/advisory|FOR UPDATE|lock_timeout|\b(INSERT INTO|UPDATE public\.|DELETE FROM)\b/);
    // The answer keeps its old keys.
    expect(drain).toMatch(/jsonb_build_object\('ok', true, 'seen', v_seen, 'applied', v_done,\s+'failed', v_failed,/);
  });

  it('the drain stays a hand tool: this change schedules nothing and gives it no caller', () => {
    expect(code(candidate)).not.toMatch(/cron\.|pg_cron|schedule/i);
    const callers = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql') && f.slice(0, 14) >= CANDIDATE.slice(0, 14))
      .filter((f) => {
        const sql = code(readFileSync(join(MIGRATIONS, f), 'utf8'));
        return /cron\.schedule[\s\S]{0,400}fn_ca_drain_orphaned_post_commit_envelopes/.test(sql);
      });
    expect(callers).toEqual([]);
    const retired = read('tests', 'a-retired-compensation-job-is-never-scheduled-again.law.test.ts');
    expect(retired).toContain("'fn_ca_drain_orphaned_post_commit_envelopes',");
    expect(read('server', 'src', 'services', 'supabase', 'handProjection.ts')).not.toContain(
      'fn_ca_drain_orphaned_post_commit_envelopes'
    );
  });

  it('no later migration puts a blocking table mutex back into the projection function', () => {
    const later = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql') && f.slice(0, 14) > CANDIDATE.slice(0, 14))
      .filter((f) => {
        const sql = code(readFileSync(join(MIGRATIONS, f), 'utf8'));
        return (
          /CREATE OR REPLACE FUNCTION public\.fn_project_hand_side_effects\(/.test(sql) &&
          /pg_advisory_xact_lock\(\s*hashtextextended\('(hand-post-commit|player-stats):/.test(sql)
        );
      });
    expect(later, 'fn_project_hand_side_effects tries its table and player locks (20261118155509)').toEqual([]);
  });

  it('the PostgreSQL proof stays wired', () => {
    const harness = read('scripts', 'ci', 'test-projection-table-lock-bound-postgres.py');
    expect(harness).toContain(CANDIDATE);
    expect(harness).toContain(`PROJ_PRE, DRAIN_PRE = '${PROJ_PRE}', '${DRAIN_PRE}'`);
    for (const c of [
      "check(f'{label}: zero statement timeouts and no errors'",
      "check(f'{label}: each answers within ~0.3 s server-side'",
      "check(f'{label}: after release every hand projects exactly once'",
      "check(f'{label}: in hand order'",
      "check('CONTRACT 1: every answer is one the old engine already defers'",
      "check(f'AFTER (b): one drain call applies the whole {B}-hand backlog and the other table'",
      "check('AFTER (b): a held row stops the table at that hand (obligation_lock_busy) and skips its later hands'",
    ])
      expect(harness).toContain(c);
    const workflow = read('.github', 'workflows', 'projection-table-lock-bound.yml');
    expect(workflow).toContain(`supabase/migrations/${CANDIDATE}`);
    expect(workflow).toContain('python3 scripts/ci/test-projection-table-lock-bound-postgres.py');
    expect(workflow).not.toMatch(/^\s*schedule:/m);
  });
});
