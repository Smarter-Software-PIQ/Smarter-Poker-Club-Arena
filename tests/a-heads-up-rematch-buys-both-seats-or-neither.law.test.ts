/**
 * A HEADS-UP REMATCH BUYS BOTH SEATS OR NEITHER.
 *
 * Dan, 2026-11-08: "IF BOTH PLAYERS AGREE, THE MATCH STARTS AGAIN. THEY BOTH
 * 'BUY BACK IN' RAKE IS TAKEN". His acceptance rules: both accept before
 * either is charged; each is charged exactly once through the normal buy-in
 * path; both reach the same fresh table; a decline, a timeout, insufficient
 * funds, a repeat tap or simultaneous accepts leave no partial charge and no
 * duplicate game.
 *
 * The first build bought each seat from each player's own browser after the
 * match was made, so one player could be charged while the other never
 * arrived. This law pins the shape that makes that impossible:
 *
 *  - the fresh game and BOTH purchases sit inside ONE subtransaction in the
 *    rematch core, so a refusal or an error undoes all of it together;
 *  - a person is charged through named-payer copies of the eight production
 *    buy-in layers, derived from their reviewed bodies (md5-pinned), callable
 *    by no browser or service role, and refused at runtime if a source body
 *    changes;
 *  - the outcome 'matched' is written only when that subtransaction finished
 *    with no failure;
 *  - the browser never buys a rematch seat itself.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');

function rematchMigration(): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith('_heads_up_rematch_atomic_buy_in.sql'));
  expect(file, 'the heads-up rematch migration').toBeTruthy();
  return readFileSync(resolve(MIGRATIONS, file as string), 'utf8');
}

function coreBody(sql: string): string {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_ca_heads_up_rematch_core(');
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf('$function$;', start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

const SOURCES = [
  'fn_register_for_tournament_before_atomic_capacity_20260907(uuid,boolean)',
  'fn_register_for_tournament_before_atomic_lifecycle_gate(uuid,boolean)',
  'fn_register_for_tournament_before_maintenance_announcement_gate(uuid,boolean)',
  'fn_register_for_tournament_before_terminal_seat_gate(uuid,boolean)',
  'fn_register_for_tournament(uuid,boolean)',
  'fn_take_seat_and_buy_in_before_maintenance_announcement_gate(uuid,integer)',
  'fn_take_seat_and_buy_in_before_terminal_seat_gate(uuid,integer)',
  'fn_take_seat_and_buy_in(uuid,integer)',
];

describe('a heads-up rematch buys both seats or neither', () => {
  const sql = rematchMigration();
  const core = coreBody(sql);

  it('creates the fresh game and buys both seats inside one subtransaction', () => {
    const block = core.slice(core.indexOf('v_receipts := \'[]\'::jsonb;'));
    const begin = block.indexOf('BEGIN');
    // The block's own handler, not a RAISE EXCEPTION inside it.
    const exception = block.search(/\n\s+EXCEPTION\n\s+WHEN SQLSTATE 'P0R01'/);
    expect(begin).toBeGreaterThan(-1);
    expect(exception).toBeGreaterThan(begin);
    const inside = block.slice(begin, exception);
    expect(inside).toContain('public.fn_create_seat_first_game_atomic(v_target, v_config)');
    expect(inside).toContain('public.fn_ca_rematch_take_seat_for_payer(');
    expect(inside).toContain('public.fn_seat_horse_in_seat_first_game(v_target, v_payer)');
    // A refusal raises inside the block, so everything in it is undone.
    expect(inside).toMatch(/RAISE EXCEPTION USING ERRCODE = 'P0R01'/);
    // The game's money terms are checked equal to the finished game's before anyone pays.
    expect(inside.indexOf("'rematch_terms_differ'")).toBeLessThan(inside.indexOf('FOREACH v_payer'));
  });

  it("writes 'matched' only when that subtransaction finished without a failure", () => {
    const writes = core.match(/v_row\.outcome := 'matched';/g) ?? [];
    expect(writes).toHaveLength(1);
    const at = core.indexOf("v_row.outcome := 'matched';");
    expect(core.slice(Math.max(0, at - 80), at)).toContain('IF v_fail IS NULL THEN');
  });

  it('buys only on the one transition from no outcome to an outcome, on a locked row', () => {
    expect(core).toMatch(/FROM public\.ca_heads_up_rematches r\s+WHERE r\.source_tournament_id = p_source_tournament_id\s+FOR UPDATE;/);
    expect(core).toContain('IF v_row.outcome IS NULL AND v_row.declined_by IS NULL AND v_now < v_row.respond_by THEN');
    expect(core).toContain('IF v_row.declined_by IS NULL AND cardinality(v_row.accepted_by) = 2 THEN');
  });

  it('copies exactly the eight reviewed buy-in layers, each pinned by md5', () => {
    for (const source of SOURCES) {
      const row = new RegExp(
        `\\('public\\.${source.replace(/[()]/g, '\\$&')}',\\s+'[0-9a-f]{32}'`
      );
      expect(sql, source).toMatch(row);
    }
    expect(sql).toContain("RAISE EXCEPTION 'heads_up_rematch_source_changed");
    // The runtime interlock: a changed source refuses before any purchase.
    expect(core).toContain('md5(pg_get_functiondef(s.source::regprocedure)) IS DISTINCT FROM s.source_md5');
    expect(core.indexOf("v_row.outcome := 'unavailable';")).toBeLessThan(
      core.indexOf('fn_create_seat_first_game_atomic')
    );
  });

  it('no browser or service role can execute a named-payer copy or the core', () => {
    expect(sql).toContain(
      "EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', p_signature);"
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_heads_up_rematch_core\(uuid, uuid, text\)\s+FROM PUBLIC, anon, authenticated, service_role;/
    );
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_ca_rematch_/);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_ca_heads_up_rematch_core/);
  });

  it('a copy never reads the caller: the payer is always a parameter', () => {
    expect(sql).toContain("IF position('auth.uid()' IN p_def) > 0 THEN");
    expect(sql).toContain("IF position('public.fn_caller_session_is_live()' IN p_def) > 0 THEN");
  });

  it('both browser doors refuse a signed-out session', () => {
    for (const door of ['ca_heads_up_rematch_respond', 'ca_heads_up_rematch_state']) {
      const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${door}(`);
      expect(start, door).toBeGreaterThan(-1);
      const body = sql.slice(start, sql.indexOf('$function$;', start));
      expect(body, door).toContain('IF NOT public.fn_caller_session_is_live() THEN');
    }
  });

  it('the browser never buys a rematch seat itself', () => {
    const host = readFileSync(resolve(ROOT, 'src/components/tournament/TournamentRankingHost.tsx'), 'utf8');
    const start = host.indexOf('HEADS UP REMATCH');
    expect(start).toBeGreaterThan(-1);
    const rematch = host.slice(start, host.indexOf('const playAgain = useCallback('));
    expect(rematch).not.toContain('fn_take_seat_and_buy_in');
  });
});
