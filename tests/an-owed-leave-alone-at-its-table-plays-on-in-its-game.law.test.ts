/**
 * AN OWED LEAVE ALONE AT ITS TABLE PLAYS ON IN ITS GAME (2026-11-14)
 *
 * Owner rule, Dan, 2026-11-06 (Hit And Run): a player in profit cannot leave
 * until 10 hands are played in profit. On 2026-11-14, when Lightning NLH
 * .25/.50 switched off at 03:33 Chicago, nine held leaves alone at former
 * anchor tables were waived with 0-3 of 10 played while the same game dealt at
 * another table. The waiver now asks the game, not the table.
 *
 * WHAT THIS PINS:
 * - the engine-only door that keeps the obligation while another live table of
 *   the same game has two players in, bounded at ten minutes and recorded;
 * - the engine asking it before the per-table waiver;
 * - the native before/after proof wired into CI.
 * Horses are players: nothing here reads horse identity.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const MIGRATION =
  'supabase/migrations/20261114160836_an_owed_leave_alone_at_its_table_plays_on_in_its_game.sql';
const sql = read(MIGRATION).replace(/\s+/g, ' ');
const BASE = read('server/src/engine/ServerTableEngineBase.ts');

describe('the door', () => {
  it('is engine-only and holds without deciding while frozen', () => {
    expect(sql).toContain('IF NOT coalesce(public.fn_caller_is_engine(), false) THEN');
    expect(sql).toContain(
      "IF public.fn_platform_frozen() THEN RETURN jsonb_build_object('keep', true, 'returned', false, 'reason', 'platform_frozen');"
    );
  });
  it('keeps only while another live table of the same game has two players in', () => {
    expect(sql).toContain('WHERE t.cluster_id = v_seat.cluster_id AND t.id <> p_table_id');
    expect(sql).toContain("AND t.role = 'main' AND t.lifecycle = 'live'");
    expect(sql).toContain(
      "ELSIF v_seat.role IS DISTINCT FROM 'feeder' THEN v_reason := 'not_on_feeder';"
    );
    expect(sql).toContain('HAVING count(*) >= 2');
    expect(sql).toContain("v_reason := 'nobody_in_game';");
  });
  it('never keeps a forced exit, an unowed seat or a Classic game (players never move there)', () => {
    expect(sql).toContain("ELSIF v_mode = 'forced' THEN v_reason := 'forced';");
    expect(sql).toContain("IF v_owed <= 0 THEN v_reason := 'not_owed';");
    expect(sql).toContain(
      'public.fn_cash_game_never_moves_players(g.template_name, g.ruleset_snapshot)'
    );
    expect(sql).toContain("v_reason := 'game_never_moves';");
  });
  it('counts an open chair exactly as the planner does, and never holds an unmovable full-ring feeder seat', () => {
    expect(sql).toContain('v_census := public.fn_cash_cluster_census(v_seat.cluster_id);');
    expect(sql).toContain('c.open_unreserved > 0 FROM unnest(v_census) c WHERE c.id = t.id');
    expect(sql).toContain(
      'ELSIF v_game.handedness >= 7 AND NOT coalesce(v_src.breaking, false) AND coalesce(v_src.seated, 0) < greatest(2, v_game.handedness - 2) THEN'
    );
    expect(sql).toContain("v_reason := 'not_movable';");
  });
  it('counts only a compatible table: same game, club, variant and blinds', () => {
    for (const col of ['club_id', 'game_variant', 'small_blind', 'big_blind'])
      expect(sql).toContain(`AND t.${col} IS NOT DISTINCT FROM v_seat.${col}`);
  });
  it('bounds the wait from the first keep: ten minutes only while every compatible table is full', () => {
    expect(sql).toContain('WHERE d.occupancy_id = p_occupancy_id AND d.keep;');
    expect(sql).toContain(
      "ELSIF v_first IS NOT NULL AND NOT v_open AND now() - v_first > interval '10 minutes' THEN v_reason := 'compatible_full';"
    );
    expect(sql).toContain(
      "ELSIF v_first IS NOT NULL AND now() - v_first > interval '30 minutes' THEN v_reason := 'not_moved';"
    );
  });
  it('withdraws only the pending flag: the sit-out stays as the blind off', () => {
    expect(sql).toContain(
      'UPDATE public.table_seats SET leave_pending = false WHERE id = v_seat.id;'
    );
    expect(sql).not.toContain('is_sitting_out = false');
  });
  it('moves no chips and never touches a departure time or an occupant', () => {
    expect(sql).not.toMatch(/SET[^;]*\bstack\b/);
    expect(sql).not.toMatch(/SET[^;]*\bleft_at\b/);
    expect(sql).not.toMatch(/is_horse/);
  });
  it('records every answer in a table with no foreign key to a hot table', () => {
    expect(sql).toContain('CREATE TABLE public.ca_owed_leave_decisions');
    expect(sql).not.toMatch(/REFERENCES/);
    expect(sql).toContain('INSERT INTO public.ca_owed_leave_decisions');
    expect(sql).toContain('ALTER TABLE public.ca_owed_leave_decisions ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain(
      'REVOKE ALL ON public.ca_owed_leave_decisions FROM PUBLIC, anon, authenticated;'
    );
    for (const col of [
      'dest_table_id uuid',
      'dest_open_chair boolean',
      'reason text NOT NULL',
      'hands_owed integer',
    ])
      expect(sql).toContain(col);
  });
  it('is granted to the engine only', () => {
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.fn_owed_leave_plays_on_in_game(uuid, uuid, integer, uuid) FROM PUBLIC, anon, authenticated;'
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_owed_leave_plays_on_in_game(uuid, uuid, integer, uuid) TO service_role;'
    );
  });
});

describe('the engine', () => {
  it('asks the game before the per-table waiver', () => {
    const release = BASE.slice(BASE.indexOf('protected async releaseLeavesHeldByClock'));
    const ask = release.indexOf(
      'if (nobodyElse && (await this.owedLeavePlaysOnInGame(userId, seated))) continue;'
    );
    const waive = release.indexOf('if (nobodyElse) {');
    expect(ask).toBeGreaterThan(0);
    expect(waive).toBeGreaterThan(ask);
  });
});

describe('the proof', () => {
  it('reproduces the waiver before and proves play-on after, in CI', () => {
    const wf = read('.github/workflows/lightning-hand-counts-every-player-dealt-in.yml');
    expect(wf).toContain('run: node scripts/qualify-owed-leave-plays-on.mjs');
    const harness = read('scripts/qualify-owed-leave-plays-on.mjs');
    expect(harness).toContain('Q0 WAIVER REPRODUCED');
    expect(harness).toContain("['Q1 PLAYS ON', 'Q2-Q10 PASS']");
    expect(read('scripts/qualification/owed-leave-plays-on/behavior.sql')).toContain(
      'Q10 access controls'
    );
  });
});
