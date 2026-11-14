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
    expect(sql).toContain("coalesce(t.lifecycle, '') NOT IN ('closed', 'breaking')");
    expect(sql).toContain('HAVING count(*) >= 2');
    expect(sql).toContain("v_reason := 'nobody_in_game';");
  });
  it('never keeps a forced exit, an unowed seat or a wait past ten minutes', () => {
    expect(sql).toContain("ELSIF v_mode = 'forced' THEN v_reason := 'forced';");
    expect(sql).toContain("IF v_owed <= 0 THEN v_reason := 'not_owed';");
    expect(sql).toContain("now() - v_first > interval '10 minutes' THEN v_reason := 'not_moved';");
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
  });
});
