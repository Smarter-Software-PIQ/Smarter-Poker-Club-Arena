/**
 * LAW: THE PROJECTION WORKER NEVER QUEUES ON THE TABLE LOCK OR A PLAYER KEY
 *
 * Incident 075013fd follow-up left open by #11269 (20261118073646 bounded the
 * post-commit envelope's own wait for the per-table mutex and named this one).
 *
 * fn_project_hand_side_effects, the projection worker's RPC, took
 * 'hand-post-commit:<table>', every seated player's 'player-stats:<uuid>' and
 * 'hand-projection:<table>' with a blocking pg_advisory_xact_lock, and the
 * after-function it calls took 'player-stats-user:<uuid>' blocking too, after
 * it had already written. Through PostgREST the worker inherits authenticator's
 * lock_timeout 8s (service_role's statement_timeout is 8s; the global
 * lock_timeout is 0), so one busy table or one busy player held a projection
 * connection for up to 8 s and queued the table behind it.
 *
 * 20261118155509 tries the mutex for at most 250 ms (table_busy) and every
 * other key, 'player-stats-user:' included, in uuid order within one 1 s
 * deadline (obligation_lock_busy), all before anything is written, under
 * #11269's versioned answer contract. The drain is NOT changed (a function
 * that drains many hands holds every hand's locks to its one commit).
 * smarter_private.f06_wait_table_lane keeps its own 4 s per-tournament wait:
 * separate, out of scope, and the one wait this law allows.
 *
 * Pinned: the preimage and postimage, the lock order, the bounded waits, the
 * player-stats-user key set against the live after-function, the contract
 * guard, the server's handling, and - for every later migration that names
 * either function, in any form (a literal CREATE OR REPLACE, a pg_temp
 * substitution helper, replace(), dynamic SQL) - no queueing lock.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sliceBetween, sliceDollarQuoted } from './helpers/sourceWindow';

const ROOT = join(__dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const RAKE_PART = '20261118034950_a_cash_hands_rake_waits_in_its_own_row_not_on_the_union_wall.sql';
const BANK_PART = '20261118071728_a_hands_bbj_drop_and_insurance_wait_in_their_own_rows_not_on.sql';
const AFTER_ORIGIN =
  '20261019194410_replay_holds_no_lock_past_its_receipt_player_stats_key_order.sql';
const CANDIDATE = '20261118155509_the_projection_worker_never_queues_on_the_table_lock_and_the.sql';
const PROJ_PRE = '39d043cda727119e0a6d883a3fb25d50';
const PROJ_POST = '94588bd7bc75f60b9b575eb396549d5c';
const AFTER_LIVE = 'cee6c2257fcc49c6c6974e5fe8832107'; // production read 2026-11-18
const ENVELOPE_POST = '39d75365156c46476bfe01854d3c86b9';

const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const code = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
const dollar = (sql: string, tag: string) => {
  const block = sliceDollarQuoted(sql, `$${tag}$`);
  expect(sql.split(`$${tag}$`).length, `exactly one $${tag}$ block`).toBe(3);
  return block.slice(tag.length + 2, block.length - tag.length - 2);
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
for (let i = 1; i <= 4; i++)
  projPre = once(projPre, dollar(bankPart, `oproj${i}`), dollar(bankPart, `nproj${i}`));
let projPost = projPre;
for (let i = 1; i <= 4; i++)
  projPost = once(projPost, dollar(candidate, `p${i}o`), dollar(candidate, `p${i}n`));

/* The after-function as production holds it: 20261019194410's $projection$ text. */
const afterLive = dollar(read('supabase', 'migrations', AFTER_ORIGIN), 'projection');

const proj = code(projPost);
const after = code(afterLive);
const at = (body: string, needle: string) => body.indexOf(needle);

/* ------------------------------------------------------------------------- *
 * THE GUARD FOR LATER MIGRATIONS. A migration names a function when its code
 * (comments aside, string literals and dollar bodies INCLUDED, because a
 * substitution migration carries the new body as strings) mentions it. Such a
 * migration may carry no queueing lock anywhere: every advisory lock token
 * must be a pg_try_ one (shared ones queue behind an exclusive holder too), no
 * row lock without NOWAIT or SKIP LOCKED in its statement, no LOCK TABLE. The
 * after-function's own three blocking calls are the exception for a migration
 * that names it, because the projection holds those keys first (pinned below).
 * ------------------------------------------------------------------------- */
const NAMES_PROJECTION = /fn_project_hand_side_effects(?![a-z0-9_])/i;
const NAMES_AFTER = /fn_project_hand_side_effects_after_post_commit/i;
const AFTER_PREHELD = [
  "pg_advisory_xact_lock(hashtextextended('hand-projection:'||v_h.table_id::text,0))",
  "pg_advisory_xact_lock(hashtextextended('player-stats-user:'||v_uid::text,0))",
];
export const queueingLocks = (sql: string): string[] => {
  // Both functions raise 'fn_project_hand_side_effects is engine/service only';
  // that message names neither.
  let body = code(sql).split("'fn_project_hand_side_effects is engine/service only'").join("''");
  const findings: string[] = [];
  if (!NAMES_PROJECTION.test(body) && !NAMES_AFTER.test(body)) return findings;
  if (!NAMES_PROJECTION.test(body)) {
    // Only the after-function: its pre-held keys and its outbox claim stay.
    for (const ok of AFTER_PREHELD) body = body.split(ok).join(' ');
    body = body.replace(/FOR UPDATE OF o;/g, ' ;');
  }
  for (const m of body.matchAll(/[a-z_]*advisory_(?:xact_)?lock[a-z_]*/gi)) {
    if (!/^pg_try_advisory_/i.test(m[0])) findings.push(`advisory: ${m[0]}`);
  }
  for (const m of body.matchAll(/\bFOR\s+(?:NO\s+KEY\s+UPDATE|UPDATE|KEY\s+SHARE|SHARE)\b/gi)) {
    const end = body.indexOf(';', m.index);
    const statement = body.slice(m.index, end < 0 ? undefined : end);
    if (!/\b(NOWAIT|SKIP\s+LOCKED)\b/i.test(statement)) findings.push(`row lock: ${m[0]}`);
  }
  for (const m of body.matchAll(/\bLOCK\s+TABLE\b/gi)) findings.push(`table lock: ${m[0]}`);
  return findings;
};

describe('the projection worker never queues on the table lock or a player key', () => {
  it('turns the pinned production preimage into the pinned postimage, and replaces nothing else', () => {
    expect(md5(projPre)).toBe(PROJ_PRE);
    expect(md5(projPost)).toBe(PROJ_POST);
    expect(candidate).toContain(`'${PROJ_PRE}', '${PROJ_POST}'`);
    expect(candidate).toMatch(/IF md5\(v_def\) <> p_before THEN\s+RAISE EXCEPTION/);
    expect(candidate).toContain(`<> '${ENVELOPE_POST}' THEN`);
    expect(candidate).toContain(
      `@live-proof: (SELECT md5(pg_get_functiondef('public.fn_project_hand_side_effects(uuid)'::regprocedure)) = '${PROJ_POST}')`
    );
    // Exactly one function is substituted; the drain and the envelope are not touched.
    expect(code(candidate).match(/SELECT pg_temp\.ca_projection_subst\(/g)).toHaveLength(1);
    expect(code(candidate)).not.toMatch(/fn_ca_drain_orphaned_post_commit_envelopes/);
    expect(code(candidate)).not.toMatch(
      /FUNCTION public\.fn_ca_process_hand_post_commit_obligations\(/
    );
    expect(code(candidate)).not.toMatch(/CREATE (OR REPLACE )?(FUNCTION|PROCEDURE) public\./);
    expect(code(candidate).match(/^BEGIN;/gm)).toHaveLength(1);
    expect(code(candidate).match(/^COMMIT;/gm)).toHaveLength(1);
    expect(candidate).toMatch(
      /RAISE EXCEPTION '%: owner, security, settings or grants moved', p_sig;/
    );
    expect(projPost.match(/^ SET .*$/gm)).toEqual([" SET search_path TO 'public', 'pg_temp'"]);
  });

  it('banks, then the lane, then the mutex, then players, envelope, projection key and player-stats-user keys, then the after-function', () => {
    const order = [
      'public.fn_ca_bank_pending_hand_obligations(p_hand_id)',
      'public.fn_ca_bank_pending_cash_rake(p_hand_id)',
      'smarter_private.f06_wait_table_lane(v_table_id)',
      'WHILE NOT pg_try_advisory_xact_lock(v_lock_key) LOOP',
      "WHILE NOT pg_try_advisory_xact_lock(hashtextextended('player-stats:' || v_seat_uid::text, 0)) LOOP",
      'public.fn_ca_process_hand_post_commit_obligations(p_hand_id)',
      "v_lock_key := hashtextextended('hand-projection:' || v_table_id::text, 0);",
      "WHILE NOT pg_try_advisory_xact_lock(hashtextextended('player-stats-user:' || v_seat_uid::text, 0)) LOOP",
      'public.fn_project_hand_side_effects_after_post_commit_20260908(',
    ].map((n) => [n, at(proj, n)] as const);
    for (const [n, i] of order) expect(i, n).toBeGreaterThan(-1);
    for (let k = 1; k < order.length; k++) {
      if (k === 1) continue; // the two bankers are independent branches
      expect(order[k - 1][1], `${order[k - 1][0]} before ${order[k][0]}`).toBeLessThan(order[k][1]);
    }
    expect(order[0][1]).toBeLessThan(order[2][1]);
    // Both player walks are in uuid order.
    const players = sliceBetween(proj, 'FOR v_seat_uid IN', 'LOOP');
    expect(players).toMatch(/ORDER BY 1\s+$/);
    const statsUser = sliceBetween(
      proj.slice(at(proj, "'hand-projection:'")),
      'FOR v_seat_uid IN',
      'LOOP'
    );
    expect(statsUser).toMatch(/ORDER BY 1\s+$/);
  });

  it('makes no queueing lock call: every key is tried under 250 ms / one 1 s deadline, and f06 is the only wait', () => {
    expect(queueingLocks(projPost)).toEqual([]);
    expect(proj).not.toMatch(/lock_timeout/);
    // The mutex: 250 ms. The deadline for everything after it: 1 s from the mutex.
    expect(proj).toMatch(
      /IF clock_timestamp\(\) - v_lock_started >= interval '250 milliseconds' THEN\s+RETURN jsonb_build_object\(\s+'ok', false,\s+'reason', CASE WHEN v_contract >= 2 THEN 'table_busy' ELSE 'predecessor_pending' END,/
    );
    const mutex = at(proj, 'WHILE NOT pg_try_advisory_xact_lock(v_lock_key) LOOP');
    const deadline = proj.indexOf('v_lock_started := clock_timestamp();', mutex);
    expect(deadline).toBeGreaterThan(mutex);
    expect(proj.split('v_lock_started := clock_timestamp();')).toHaveLength(3); // set twice, never reset again
    expect(proj.match(/IF v_lock_waited >= 1 THEN/g)).toHaveLength(3);
    for (const detail of [
      'player_stats_lock_busy',
      'hand_projection_lock_busy',
      'player_stats_user_lock_busy',
    ])
      expect(proj).toContain(`'detail', '${detail}'`);
    // Every wait loop sleeps between tries; none can spin past its deadline.
    expect(proj.match(/WHILE NOT pg_try_advisory_xact_lock\(/g)).toHaveLength(4);
    expect(proj.match(/PERFORM pg_sleep\(0\.025\);/g)).toHaveLength(4);
    // The function itself writes nothing; every write is a callee's, after the keys.
    expect(proj).not.toMatch(/\b(INSERT INTO|UPDATE public\.|DELETE FROM)\b/);
    // The only call that may wait: the f06 tournament lane (separate, out of scope).
    const callees = [
      ...new Set(
        [...proj.matchAll(/\b(public|smarter_private)\.([a-z_0-9]+)\s*\(/g)].map(
          (m) => `${m[1]}.${m[2]}`
        )
      ),
    ].sort();
    expect(callees).toEqual([
      'public.fn_ca_bank_pending_cash_rake',
      'public.fn_ca_bank_pending_hand_obligations',
      'public.fn_ca_process_hand_post_commit_obligations',
      'public.fn_project_hand_side_effects', // its own CREATE header
      'public.fn_project_hand_side_effects_after_post_commit_20260908',
      'smarter_private.f06_wait_table_lane',
    ]);
  });

  it('holds every player-stats-user key the after-function will take before it runs', () => {
    expect(md5(afterLive)).toBe(AFTER_LIVE);
    // The after-function's blocking keys are exactly the two the projection holds first.
    const blocking = [...after.matchAll(/pg_advisory_xact_lock\([^;]*\)/g)].map((m) => m[0]);
    expect(blocking).toEqual(AFTER_PREHELD);
    expect(after).toContain('FOR UPDATE OF o;');
    // Its player-stats-user walk: cash chip hand at a club, seated uuids, uuid order.
    const walk = sliceBetween(
      after,
      'IF NOT COALESCE(v_diamond,false) AND v_h.tournament_id IS NULL',
      'END LOOP;'
    );
    expect(walk).toMatch(/AND v_club IS NOT NULL/);
    expect(walk).toMatch(
      /SELECT DISTINCT \(pl->>'userId'\)::uuid\s+FROM jsonb_array_elements\(v_h\.players\) pl\s+WHERE \(pl->>'userId'\) ~\* '\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\$'\s+ORDER BY 1\s+LOOP\s+PERFORM pg_advisory_xact_lock\(hashtextextended\('player-stats-user:'\|\|v_uid::text,0\)\);/
    );
    // The projection takes the same keys for the same seats, under a condition no
    // narrower (no launch-accounting test, and any array of players).
    const pre = sliceBetween(
      proj,
      "v_lock_key := hashtextextended('hand-projection:'",
      'FOR v_seat_uid IN'
    );
    expect(pre).toMatch(
      /IF EXISTS \(SELECT 1\s+FROM public\.hand_history h\s+JOIN public\.tables t ON t\.id = h\.table_id\s+JOIN public\.clubs c ON c\.id = t\.club_id\s+WHERE h\.id = p_hand_id\s+AND h\.tournament_id IS NULL\s+AND NOT COALESCE\(c\.asset = 'diamonds', false\)\) THEN/
    );
    const sel = sliceBetween(
      proj.slice(at(proj, "v_lock_key := hashtextextended('hand-projection:'")),
      'FOR v_seat_uid IN',
      'LOOP'
    );
    expect(sel).toMatch(
      /SELECT DISTINCT \(pl->>'userId'\)::uuid\s+FROM public\.hand_history h,\s+jsonb_array_elements\(CASE WHEN jsonb_typeof\(h\.players\) = 'array'\s+THEN h\.players ELSE '\[\]'::jsonb END\) pl\s+WHERE h\.id = p_hand_id\s+AND \(pl->>'userId'\) ~\* '\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\$'\s+ORDER BY 1\s+$/
    );
    // The after-function's diamond test reads the same club row: t.club_id -> clubs.asset.
    expect(after).toMatch(
      /SELECT t\.club_id, \(t\.tournament_id IS NOT NULL\), c\.asset='diamonds'/
    );
    // The key spelling is the same key.
    expect(proj).toContain("hashtextextended('player-stats-user:' || v_seat_uid::text, 0)");
  });

  it("speaks #11269's contract exactly: an old caller only ever sees predecessor_pending", () => {
    expect(proj).toMatch(/v_contract integer := 1;/);
    expect(proj).toMatch(
      /IF pg_input_is_valid\(COALESCE\(current_setting\('request\.headers', true\), ''\), 'json'\)\s+AND \(current_setting\('request\.headers', true\)::json\s+->> 'x-ca-post-commit-contract'\) ~ '\^\[0-9\]\{1,3\}\$' THEN/
    );
    for (const r of ['table_busy', 'obligation_lock_busy']) {
      const uses = (proj.match(new RegExp(`'${r}'`, 'g')) ?? []).length;
      const guarded = (
        proj.match(
          new RegExp(`CASE WHEN v_contract >= 2 THEN '${r}' ELSE 'predecessor_pending' END`, 'g')
        ) ?? []
      ).length;
      const carried = (proj.match(new RegExp(`'queued_reason', '${r}'`, 'g')) ?? []).length;
      expect(guarded, `${r} is returned only under contract 2`).toBe(2);
      expect(carried, `${r} is always carried as queued_reason`).toBe(2);
      expect(uses, `${r} appears only guarded or as queued_reason`).toBe(guarded + carried);
    }
    const reasons = read('server', 'src', 'services', 'supabase', 'postCommitReasons.ts');
    for (const r of ['predecessor_pending', 'table_busy', 'obligation_lock_busy'])
      expect(reasons).toContain(`'${r}'`);
    const projection = read('server', 'src', 'services', 'supabase', 'handProjection.ts');
    expect(projection).toMatch(
      /speakPostCommitContract\(\s+supabase\.rpc\('fn_project_hand_side_effects'/
    );
    expect(projection).toMatch(
      /const result = readPostCommitAnswer\(\(projected \?\? \{\}\) as ProjectionResult\);/
    );
    expect(projection).toMatch(
      /\} else if \(isQueuedPostCommitReason\(result\.reason\)\) \{\s+\/\/ Preserve the row\./
    );
  });

  it('the guard catches a queueing lock however a migration rewrites the body', () => {
    const literal = `BEGIN;\nCREATE OR REPLACE FUNCTION public.fn_project_hand_side_effects(p_hand_id uuid) RETURNS jsonb AS $f$\nBEGIN\n  PERFORM pg_advisory_xact_lock(1);\nEND $f$ LANGUAGE plpgsql;\nCOMMIT;`;
    const helper = `BEGIN;\nCREATE FUNCTION pg_temp.subst(p text, o text, n text) RETURNS void LANGUAGE plpgsql AS $h$\nBEGIN EXECUTE replace(pg_get_functiondef(p::regprocedure), o, n); END $h$;\nSELECT pg_temp.subst('public.fn_project_hand_side_effects(uuid)', $o$WHILE NOT pg_try_advisory_xact_lock(v_lock_key) LOOP$o$, $n$PERFORM pg_advisory_xact_lock(v_lock_key); WHILE false LOOP$n$);\nCOMMIT;`;
    const replaced = `DO $d$ BEGIN EXECUTE replace(pg_get_functiondef('public.fn_project_hand_side_effects(uuid)'::regprocedure), 'pg_try_advisory_xact_lock', 'pg_advisory_xact_lock'); END $d$;`;
    const split = `DO $d$ BEGIN EXECUTE replace(pg_get_functiondef('public.fn_project_hand_side_effects(uuid)'::regprocedure), 'pg_try_' || 'advisory_xact_lock', 'pg_' || 'advisory_xact_lock'); END $d$;`;
    const shared = `SELECT pg_temp.subst('public.fn_project_hand_side_effects(uuid)', 'x', 'PERFORM pg_advisory_xact_lock_shared(1);');`;
    const rowLock = `SELECT pg_temp.subst('public.fn_project_hand_side_effects(uuid)', 'x', 'PERFORM 1 FROM public.tables WHERE id = v_table_id FOR UPDATE;');`;
    const afterNew = `SELECT pg_temp.subst('public.fn_project_hand_side_effects_after_post_commit_20260908(uuid)', 'x', 'PERFORM pg_advisory_xact_lock(hashtextextended(''club-wallet:''||v_club::text,0));');`;
    for (const sql of [literal, helper, replaced, split, shared, rowLock, afterNew])
      expect(queueingLocks(sql), sql).not.toEqual([]);
    // What stays allowed: try-locks, NOWAIT, the after-function's pre-held keys, and the unrelated.
    const tried = `SELECT pg_temp.subst('public.fn_project_hand_side_effects(uuid)', 'x', 'IF pg_try_advisory_xact_lock(1) THEN PERFORM 1 FROM public.tables FOR UPDATE NOWAIT; END IF;');`;
    expect(queueingLocks(tried)).toEqual([]);
    expect(
      queueingLocks(
        `CREATE OR REPLACE FUNCTION public.fn_project_hand_side_effects_after_post_commit_20260908(p uuid) RETURNS jsonb AS $f$ ${afterLive.slice(afterLive.indexOf('DECLARE'))}`
      )
    ).toEqual([]);
    expect(queueingLocks('SELECT pg_advisory_xact_lock(1); -- fn_other')).toEqual([]);
  });

  it('no later migration that names the projection or its after-function carries a queueing lock', () => {
    const later = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql') && f.slice(0, 14) > CANDIDATE.slice(0, 14))
      .map((f) => [f, queueingLocks(readFileSync(join(MIGRATIONS, f), 'utf8'))] as const)
      .filter(([, findings]) => findings.length > 0);
    expect(
      later,
      'fn_project_hand_side_effects never queues on a lock (20261118155509): put any other change in its own migration'
    ).toEqual([]);
  });

  it('the PostgreSQL proof stays wired', () => {
    const harness = read('scripts', 'ci', 'test-projection-table-lock-bound-postgres.py');
    expect(harness).toContain(CANDIDATE);
    expect(harness).toContain(`PROJ_PRE, DRAIN_PRE = '${PROJ_PRE}',`);
    for (const c of [
      "check(f'{label}: zero statement timeouts and no errors'",
      "check(f'{label}: each answers within ~0.3 s server-side'",
      "check(f'{label}: after release every hand projects exactly once'",
      "check(f'{label}: in hand order'",
      "check('CONTRACT 1: every answer is one the old engine already defers'",
      "check('the drain is not changed (still the production preimage)'",
      "check('BEFORE (c): a reverse-order holder deadlocks with the projection (40P01)'",
      "check('AFTER (c): a reverse-order holder is no deadlock",
      "check('AFTER (c): overlapping players, concurrent, both orders: 0 deadlocks and no errors'",
      "check('AFTER (c): neither hand ever waits past 1 s'",
    ])
      expect(harness).toContain(c);
    const workflow = read('.github', 'workflows', 'projection-table-lock-bound.yml');
    expect(workflow).toContain(`supabase/migrations/${CANDIDATE}`);
    expect(workflow).toContain(`supabase/migrations/${AFTER_ORIGIN}`);
    expect(workflow).toContain('python3 scripts/ci/test-projection-table-lock-bound-postgres.py');
    expect(workflow).not.toMatch(/^\s*schedule:/m);
  });
});
